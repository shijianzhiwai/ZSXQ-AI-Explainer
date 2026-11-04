#!/usr/bin/env node
/**
 * Local daily pipeline: OCR → Cursor agent vision → Cursor agent summary → HTML
 *
 * Usage:
 *   node scripts/build-daily-pipeline.mjs
 *   node scripts/build-daily-pipeline.mjs --date 2026-06-23
 *   node scripts/build-daily-pipeline.mjs --skip-vision --skip-summary
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO_ROOT } from './lib/cursor-agent.mjs';
import { resolveInboxPaths } from './lib/manifest-vision.mjs';
import { parseInboxFolderArg, todayDateString } from './lib/inbox-slug.mjs';
import { runDailyPipeline } from './lib/run-daily-pipeline.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function findLatestInboxDate() {
  const root = path.join(REPO_ROOT, 'daily-inbox');
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return todayDateString();
  }

  const dates = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.name)) continue;
    try {
      await fs.access(path.join(root, entry.name, 'manifest.json'));
      dates.push(entry.name);
    } catch {
      // skip
    }
  }
  dates.sort();
  return dates.at(-1) || todayDateString();
}

function parseArgs(argv) {
  const args = {
    date: '',
    skipOcr: false,
    skipVision: false,
    skipSummary: false,
    skipHtml: false,
    reclassifyOnly: false
  };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--date') args.date = argv[++i];
    if (argv[i] === '--skip-ocr') args.skipOcr = true;
    if (argv[i] === '--skip-vision') args.skipVision = true;
    if (argv[i] === '--skip-summary') args.skipSummary = true;
    if (argv[i] === '--skip-html') args.skipHtml = true;
    if (argv[i] === '--reclassify-only') args.reclassifyOnly = true;
  }
  return args;
}

async function main() {
  const parsed = parseInboxFolderArg(process.argv, { defaultFolder: '' });
  const args = parseArgs(process.argv);
  const folder = parsed.folder || args.date || await findLatestInboxDate();

  const result = await runDailyPipeline(folder, {
    skipOcr: args.skipOcr,
    skipVision: args.skipVision,
    skipSummary: args.skipSummary,
    skipHtml: args.skipHtml,
    reclassifyOnly: args.reclassifyOnly
  });

  console.log(`\nDone → ${result.reportUrl}`);
  console.log(`     → ${result.htmlPath}`);
  console.log(`     → ${result.reportPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
