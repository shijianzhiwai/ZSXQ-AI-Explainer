#!/usr/bin/env node
/**
 * Enrich manifest images with PaddleOCR only.
 * Vision / chart summary deferred to local Cursor agent (run-vision-agent.mjs).
 *
 * Usage:
 *   node scripts/enrich-manifest-images.mjs --date 2026-06-23
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyByOcr, enrichImage, preloadPaddleOcr } from './lib/image-enricher.mjs';
import { parseInboxFolderArg } from './lib/inbox-slug.mjs';
import { resolveInboxPaths } from './lib/manifest-vision.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

async function main() {
  const { folder } = parseInboxFolderArg(process.argv);
  const args = {
    dryRun: process.argv.includes('--dry-run'),
    skipOcr: process.argv.includes('--skip-ocr'),
    reclassifyOnly: process.argv.includes('--reclassify-only')
  };
  const { inboxDir, manifestPath } = resolveInboxPaths(REPO_ROOT, folder);
  const manifestRaw = await fs.readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestRaw);

  const stats = {
    total: 0,
    text: 0,
    chart: 0,
    photo: 0,
    pending_vision: 0,
    needs_vision: 0,
    errors: 0
  };

  console.log(`Enriching ${manifestPath}`);
  const ocrMode = args.reclassifyOnly ? 'reclassify-only' : (args.skipOcr ? 'off' : 'paddleocr');
  console.log(`OCR: ${ocrMode} | Vision: cursor agent (run-vision-agent.mjs)`);

  const imagePaths = [];
  for (const post of manifest.posts || []) {
    for (const image of post.images || []) {
      const imagePath = path.join(inboxDir, image.file);
      try {
        await fs.access(imagePath);
        imagePaths.push(imagePath);
      } catch {
        // handled per-image
      }
    }
  }

  if (!args.reclassifyOnly && !args.skipOcr && imagePaths.length) {
    console.log(`Running batch OCR on ${imagePaths.length} images...`);
    await preloadPaddleOcr(imagePaths);
  }

  for (const post of manifest.posts || []) {
    for (const image of post.images || []) {
      stats.total += 1;
      const imagePath = path.join(inboxDir, image.file);
      try {
        await fs.access(imagePath);
      } catch {
        stats.errors += 1;
        image.enrich_error = 'image_file_missing';
        continue;
      }

      const enriched = args.reclassifyOnly
        ? (() => {
          const classification = classifyByOcr({
            text: image.ocr_text || '',
            confidence: image.ocr_confidence ?? 0
          });
          const result = {
            ocr_text: image.ocr_text || '',
            ocr_confidence: image.ocr_confidence ?? 0,
            chart_summary: classification.image_kind === 'chart' ? (image.chart_summary || '') : '',
            image_kind: classification.image_kind,
            include_in_summary: classification.include_in_summary,
            needs_vision: Boolean(classification.needs_vision),
            vision_task: classification.vision_task || null,
            enrich_source: 'paddleocr+heuristic',
            ocr_reason: classification.reason
          };
          if (classification.image_kind === 'text') {
            result.needs_vision = false;
            result.vision_task = null;
          }
          return result;
        })()
        : await enrichImage({
          imagePath,
          ocrEnabled: !args.skipOcr
        });

      image.image_kind = enriched.image_kind;
      image.ocr_text = enriched.ocr_text || '';
      image.ocr_confidence = enriched.ocr_confidence ?? 0;
      image.chart_summary = enriched.chart_summary || '';
      image.include_in_summary = enriched.include_in_summary !== false;
      image.needs_vision = Boolean(enriched.needs_vision);
      image.vision_task = enriched.vision_task || null;
      image.enrich_source = enriched.enrich_source;
      if (enriched.ocr_reason) image.ocr_reason = enriched.ocr_reason;
      if (enriched.ocr_error) image.ocr_error = enriched.ocr_error;

      stats[enriched.image_kind] = (stats[enriched.image_kind] || 0) + 1;
      if (enriched.needs_vision) stats.needs_vision += 1;

      const tag = enriched.needs_vision ? '→ agent' : '';
      console.log(`  [${image.id}] ${enriched.image_kind} (${enriched.enrich_source}) ${tag}`.trim());
    }
  }

  manifest.image_enrichment = {
    enriched_at: new Date().toISOString(),
    ocr_engine: args.skipOcr ? null : 'paddleocr',
    vision: 'cursor_agent',
    stats
  };

  if (!args.dryRun) {
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    await fs.writeFile(
      path.join(inboxDir, 'enrich-report.json'),
      JSON.stringify({ folder, ...stats }, null, 2),
      'utf8'
    );
  }

  console.log('Done:', stats);
  if (stats.needs_vision > 0) {
    console.log(`${stats.needs_vision} images marked needs_vision — run: node scripts/run-vision-agent.mjs --slug ${folder}`);
  }
  if (!args.dryRun) console.log(`Updated ${manifestPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
