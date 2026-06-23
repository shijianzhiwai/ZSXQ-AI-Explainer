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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

function todayDateString(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseArgs(argv) {
  const args = { date: todayDateString(), input: '', dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--date') args.date = argv[++i];
    if (argv[i] === '--input') args.input = argv[++i];
    if (argv[i] === '--dry-run') args.dryRun = true;
  }
  if (!args.input) {
    args.input = path.join(REPO_ROOT, 'daily-inbox', args.date, 'vision-results.json');
  } else if (!path.isAbsolute(args.input)) {
    args.input = path.resolve(REPO_ROOT, args.input);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const { manifestPath } = resolveInboxPaths(REPO_ROOT, args.date);

  const [manifest, resultsRaw] = await Promise.all([
    loadManifest(manifestPath),
    fs.readFile(args.input, 'utf8')
  ]);

  const payload = JSON.parse(resultsRaw);
  const results = payload.results || payload;
  if (!Array.isArray(results)) {
    throw new Error('Expected results array in vision-results.json');
  }

  const before = collectVisionTasks(manifest).length;
  const { applied, errors, remaining } = applyVisionResults(manifest, results);

  const report = {
    date: args.date,
    input: args.input,
    before,
    applied: applied.length,
    errors,
    remaining
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
