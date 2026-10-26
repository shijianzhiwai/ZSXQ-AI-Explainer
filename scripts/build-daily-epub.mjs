#!/usr/bin/env node
/**
 * Build a reflowable EPUB for e-ink readers from summary.json.
 *
 *   node scripts/build-daily-epub.mjs
 *   node scripts/build-daily-epub.mjs --date 2026-10-20
 *   node scripts/build-daily-epub.mjs --days 7
 *   node scripts/build-daily-epub.mjs --since 2026-10-01 --until 2026-10-20
 *   node scripts/build-daily-epub.mjs --each
 *   node scripts/build-daily-epub.mjs --each --days 14
 *   node scripts/build-daily-epub.mjs --no-images
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDatedSummaries, loadInboxDay, writeEpub } from './lib/epub-book.mjs';
import { parseInboxFolderArg } from './lib/inbox-slug.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const HELP = `Usage:
  node scripts/build-daily-epub.mjs [--date YYYY-MM-DD | --slug name]
  node scripts/build-daily-epub.mjs --days 7
  node scripts/build-daily-epub.mjs --since YYYY-MM-DD [--until YYYY-MM-DD]
  node scripts/build-daily-epub.mjs --each [--days N | --since DATE]
  node scripts/build-daily-epub.mjs --out path.epub
  node scripts/build-daily-epub.mjs --no-images

One day (the default) writes summaries/YYYY-MM-DD.epub.
--days / --since write one book, newest day first.
--each writes one EPUB per day.`;

function parseArgs(argv) {
  const folderArg = parseInboxFolderArg(argv, { defaultFolder: '' });
  const args = {
    folder: folderArg.folder,
    days: 0,
    since: '',
    until: '',
    each: false,
    out: '',
    images: true,
    help: false
  };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--days') args.days = Number(argv[++i]);
    else if (argv[i] === '--since') args.since = argv[++i] || '';
    else if (argv[i] === '--until') args.until = argv[++i] || '';
    else if (argv[i] === '--each') args.each = true;
    else if (argv[i] === '--out') args.out = argv[++i] || '';
    else if (argv[i] === '--no-images') args.images = false;
    else if (argv[i] === '--help' || argv[i] === '-h') args.help = true;
  }
  return args;
}

function assertDate(label, value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} must be YYYY-MM-DD`);
  }
}

async function resolveFolders(repoRoot, args) {
  const dated = await listDatedSummaries(repoRoot);
  const ranged = Boolean(args.since || args.until || args.days);
  const slug = args.folder && !/^\d{4}-\d{2}-\d{2}$/.test(args.folder);

  if (slug) {
    if (ranged || args.each) throw new Error('--slug cannot be combined with --days, --since, or --each');
    return [args.folder];
  }
  if (args.folder && ranged) throw new Error('use either --date or --days/--since, not both');
  if (args.since) assertDate('--since', args.since);
  if (args.until) assertDate('--until', args.until);
  if (args.days && (!Number.isInteger(args.days) || args.days < 1)) {
    throw new Error('--days must be a positive integer');
  }

  if (!ranged && !args.each) {
    if (args.folder) return [args.folder];
    if (!dated.length) throw new Error('no summary.json under daily-inbox/');
    return [dated.at(-1)];
  }

  let selected = dated.slice();
  if (args.since) selected = selected.filter((date) => date >= args.since);
  if (args.until) selected = selected.filter((date) => date <= args.until);
  if (args.days) selected = selected.slice(-args.days);
  if (!selected.length) throw new Error('no summaries in the selected range');
  return selected;
}

function combinedPath(repoRoot, folders) {
  if (folders.length === 1) return path.join(repoRoot, 'summaries', `${folders[0]}.epub`);
  const sorted = [...folders].sort();
  return path.join(repoRoot, 'summaries', `zsxq-daily-${sorted[0]}_${sorted.at(-1)}.epub`);
}

function logResult(result) {
  const kb = (result.bytes / 1024).toFixed(1);
  const missing = result.missingImages ? `, ${result.missingImages} images missing` : '';
  console.log(`Wrote ${result.outPath} (${kb} KB, ${result.chapters} chapters, ${result.images} images${missing})`);
  console.log(`  ${result.title}`);
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(HELP);
    return;
  }

  const folders = await resolveFolders(REPO_ROOT, args);
  const writeOptions = { includeImages: args.images };

  if (args.each) {
    const dir = args.out ? path.resolve(args.out) : path.join(REPO_ROOT, 'summaries');
    await fs.mkdir(dir, { recursive: true });
    let failed = 0;
    for (const folder of folders) {
      try {
        const day = await loadInboxDay(REPO_ROOT, folder);
        const result = await writeEpub(path.join(dir, `${folder}.epub`), [day], writeOptions);
        logResult(result);
      } catch (error) {
        failed += 1;
        console.error(`Skip ${folder}: ${error.message}`);
      }
    }
    const done = folders.length - failed;
    console.log(`Done ${done} EPUB${done === 1 ? '' : 's'}`);
    if (failed) {
      console.error(`${failed} failed`);
      process.exit(1);
    }
    return;
  }

  const ordered = [...folders].sort().reverse();
  const days = [];
  for (const folder of ordered) days.push(await loadInboxDay(REPO_ROOT, folder));
  const outPath = args.out ? path.resolve(args.out) : combinedPath(REPO_ROOT, folders);
  const result = await writeEpub(outPath, days, writeOptions);
  logResult(result);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
