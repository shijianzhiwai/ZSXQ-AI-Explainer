#!/usr/bin/env node
/**
 * Run Cursor CLI agent to write summary.json from lean manifest input.
 *
 * Usage:
 *   node scripts/run-summary-agent.mjs --date 2026-06-23
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCursorAgent, REPO_ROOT } from './lib/cursor-agent.mjs';
import { buildLeanManifest } from './lib/lean-manifest.mjs';
import { loadManifest, resolveInboxPaths } from './lib/manifest-vision.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function todayDateString(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseArgs(argv) {
  const args = { date: todayDateString(), dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--date') args.date = argv[++i];
    if (argv[i] === '--dry-run') args.dryRun = true;
  }
  return args;
}

async function readPromptTemplate() {
  return fs.readFile(path.join(__dirname, 'prompts', 'daily-summary.md'), 'utf8');
}

async function main() {
  const args = parseArgs(process.argv);
  const { inboxDir, manifestPath } = resolveInboxPaths(REPO_ROOT, args.date);
  const summaryInputPath = path.join(inboxDir, 'summary-input.json');
  const summaryPath = path.join(inboxDir, 'summary.json');

  const manifest = await loadManifest(manifestPath);
  const lean = buildLeanManifest(manifest);
  await fs.writeFile(summaryInputPath, JSON.stringify(lean, null, 2), 'utf8');
  console.log(`Wrote ${summaryInputPath} (${lean.posts.length} posts)`);

  if (args.dryRun) return;

  const summaryModel = process.env.CURSOR_SUMMARY_MODEL || 'gpt-5.5-medium';
  console.log(`Summary agent model: ${summaryModel}`);

  const promptTemplate = await readPromptTemplate();
  const prompt = `${promptTemplate.replaceAll('{DATE}', args.date)}

DATE=${args.date}
Input: daily-inbox/${args.date}/summary-input.json
Output: daily-inbox/${args.date}/summary.json`;

  const { stdout } = await runCursorAgent(prompt, {
    model: summaryModel,
    timeoutMs: Number(process.env.CURSOR_SUMMARY_TIMEOUT_MS || 1200000)
  });
  console.log(stdout.slice(-500));

  try {
    await fs.access(summaryPath);
    console.log(`Summary ready: ${summaryPath}`);
  } catch {
    throw new Error(`Agent did not write ${summaryPath}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
