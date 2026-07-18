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
import { parseInboxFolderArg } from './lib/inbox-slug.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function readPromptTemplate() {
  return fs.readFile(path.join(__dirname, 'prompts', 'daily-summary.md'), 'utf8');
}

async function main() {
  const { folder } = parseInboxFolderArg(process.argv);
  const args = { dryRun: process.argv.includes('--dry-run') };
  const { inboxDir, manifestPath } = resolveInboxPaths(REPO_ROOT, folder);
  const summaryInputPath = path.join(inboxDir, 'summary-input.json');
  const summaryPath = path.join(inboxDir, 'summary.json');

  const manifest = await loadManifest(manifestPath);
  const lean = buildLeanManifest(manifest);
  await fs.writeFile(summaryInputPath, JSON.stringify(lean, null, 2), 'utf8');
  console.log(`Wrote ${summaryInputPath} (${lean.posts.length} posts)`);

  if (args.dryRun) return;

  const summaryModel = process.env.CURSOR_SUMMARY_MODEL || 'cursor-grok-4.5-high-fast';
  console.log(`Summary agent model: ${summaryModel}`);

  const promptTemplate = await readPromptTemplate();
  const prompt = `${promptTemplate.replaceAll('{DATE}', folder)}

DATE=${folder}
Input: daily-inbox/${folder}/summary-input.json
Output: daily-inbox/${folder}/summary.json`;

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
