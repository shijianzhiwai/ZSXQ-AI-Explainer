#!/usr/bin/env node
/**
 * Backfill topic_id / topic_url / group_id on an existing manifest.
 *
 * Usage:
 *   node scripts/backfill-topic-urls.mjs --date 2026-06-23
 *   node scripts/backfill-topic-urls.mjs --date 2026-06-23 --group-id 28518511148841
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachTopicUrls } from './lib/topic-url.mjs';
import { REPO_ROOT } from './lib/cursor-agent.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = { date: '', groupId: '' };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--date') args.date = argv[++i];
    if (argv[i] === '--group-id') args.groupId = argv[++i];
  }
  if (!args.date) {
    const d = new Date();
    args.date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const manifestPath = path.join(REPO_ROOT, 'daily-inbox', args.date, 'manifest.json');
  const raw = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  if (args.groupId) raw.group_id = args.groupId;
  const updated = attachTopicUrls(raw);
  await fs.writeFile(manifestPath, JSON.stringify(updated, null, 2), 'utf8');
  const withUrl = updated.posts.filter((p) => p.topic_url).length;
  console.log(`Updated ${manifestPath}: ${withUrl}/${updated.posts.length} posts have topic_url`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
