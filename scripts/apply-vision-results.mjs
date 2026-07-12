#!/usr/bin/env node
/**
 * Apply Cursor agent vision results back into manifest.json.
 *
 * Usage:
 *   node scripts/apply-vision-results.mjs --date 2026-06-23
 *   node scripts/apply-vision-results.mjs --date 2026-06-23 --input daily-inbox/2026-06-23/vision-results.json
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyVisionResults,
  collectVisionTasks,
  loadManifest,
  resolveInboxPaths,
  saveManifest
} from './lib/manifest-vision.mjs';
import { parseInboxFolderArg } from './lib/inbox-slug.mjs';
import { parseJsonTolerant } from './lib/json-repair.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

async function main() {
  const { folder } = parseInboxFolderArg(process.argv);
  const args = { input: '', dryRun: process.argv.includes('--dry-run') };
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '--input') args.input = process.argv[++i];
  }
  if (!args.input) {
    args.input = path.join(REPO_ROOT, 'daily-inbox', folder, 'vision-results.json');
  } else if (!path.isAbsolute(args.input)) {
    args.input = path.resolve(REPO_ROOT, args.input);
  }
  const { manifestPath } = resolveInboxPaths(REPO_ROOT, folder);

  const [manifest, resultsRaw] = await Promise.all([
    loadManifest(manifestPath),
    fs.readFile(args.input, 'utf8')
  ]);

  let parsed;
  try {
    parsed = parseJsonTolerant(resultsRaw);
  } catch (error) {
    throw new Error(`Invalid vision-results JSON (${args.input}): ${error.message}`);
  }
  if (parsed.didRepair) {
    console.warn(
      `Repaired invalid vision-results JSON (${parsed.steps.join(' → ')}): ${args.input}`
    );
    if (!args.dryRun) {
      await fs.writeFile(args.input, `${parsed.repairedText}\n`, 'utf8');
    }
  }

  const payload = parsed.value;
  const results = payload.results || payload;
  if (!Array.isArray(results)) {
    throw new Error('Expected results array in vision-results.json');
  }

  const before = collectVisionTasks(manifest).length;
  const { applied, errors, remaining } = applyVisionResults(manifest, results);

  const report = {
    folder,
    input: args.input,
    before,
    applied: applied.length,
    errors,
    remaining,
    json_repaired: parsed.didRepair,
    json_repair_steps: parsed.didRepair ? parsed.steps : undefined
  };

  if (!args.dryRun) {
    await saveManifest(manifestPath, manifest);
    await fs.writeFile(
      path.join(path.dirname(manifestPath), 'vision-apply-report.json'),
      JSON.stringify(report, null, 2),
      'utf8'
    );
  }

  console.log(JSON.stringify(report, null, 2));
  if (errors.length) process.exit(1);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
