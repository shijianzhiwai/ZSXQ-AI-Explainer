#!/usr/bin/env node
/**
 * List images in manifest that need Cursor agent vision processing.
 *
 * Usage:
 *   node scripts/list-vision-tasks.mjs --date 2026-06-23
 *   node scripts/list-vision-tasks.mjs --date 2026-06-23 --limit 15
 *   node scripts/list-vision-tasks.mjs --date 2026-06-23 --write
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  collectVisionTasks,
  loadManifest,
  resolveInboxPaths
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
  const args = { date: todayDateString(), limit: 0, offset: 0, write: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--date') args.date = argv[++i];
    if (argv[i] === '--limit') args.limit = Number(argv[++i]);
    if (argv[i] === '--offset') args.offset = Number(argv[++i]);
    if (argv[i] === '--write') args.write = true;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const { manifestPath, visionTasksPath, inboxDir } = resolveInboxPaths(REPO_ROOT, args.date);
  const manifest = await loadManifest(manifestPath);
  const allTasks = collectVisionTasks(manifest);
  const tasks = collectVisionTasks(manifest, { limit: args.limit, offset: args.offset });

  const payload = {
    date: args.date,
    inbox_dir: inboxDir,
    total_needs_vision: allTasks.length,
    batch: {
      offset: args.offset,
      limit: args.limit || allTasks.length,
      count: tasks.length
    },
    tasks: tasks.map((task) => ({
      ...task,
      abs_path: path.join(inboxDir, task.file)
    })),
    result_schema: {
      image_id: 'required — matches manifest image.id',
      image_kind: 'text | chart | photo',
      chart_summary: 'required when image_kind=chart',
      ocr_text: 'optional — supplement PaddleOCR for text images',
      include_in_summary: 'optional boolean — default true except photo'
    }
  };

  if (args.write) {
    await fs.writeFile(visionTasksPath, JSON.stringify(payload, null, 2), 'utf8');
    console.log(`Wrote ${visionTasksPath}`);
  }

  console.log(JSON.stringify(payload, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
