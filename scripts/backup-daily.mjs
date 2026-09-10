#!/usr/bin/env node
/**
 * Full snapshot of daily-inbox/ + summaries/ into iCloud Drive.
 *
 * Usage:
 *   node scripts/backup-daily.mjs
 *   node scripts/backup-daily.mjs --date 2026-09-10   # only names the zip
 */
import './lib/load-env.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseInboxFolderArg, todayDateString } from './lib/inbox-slug.mjs';
import { backupDailyArtifacts } from './lib/icloud-backup.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

async function main() {
  const parsed = parseInboxFolderArg(process.argv, {
    defaultFolder: todayDateString()
  });
  const result = await backupDailyArtifacts({
    root: REPO_ROOT,
    date: parsed.date
  });

  if (result.skipped) {
    console.warn(`Skipped: ${result.reason}`);
    process.exitCode = 1;
    return;
  }

  const mb = (result.bytes / (1024 * 1024)).toFixed(1);
  console.log(`Wrote ${result.destPath} (${mb} MB)`);
  if (result.pruned.length) {
    console.log(`Pruned ${result.pruned.join(', ')}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
