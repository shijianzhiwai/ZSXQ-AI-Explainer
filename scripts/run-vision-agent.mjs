#!/usr/bin/env node
/**
 * Run Cursor CLI agent for chart vision batches.
 *
 * Usage:
 *   node scripts/run-vision-agent.mjs --date 2026-06-23
 *   node scripts/run-vision-agent.mjs --date 2026-06-23 --batch-size 15
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCursorAgent, REPO_ROOT } from './lib/cursor-agent.mjs';
import {
  collectVisionTasks,
  loadManifest,
  resolveInboxPaths
} from './lib/manifest-vision.mjs';
import { inboxCliArgs, parseInboxFolderArg } from './lib/inbox-slug.mjs';
import { spawn } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = { batchSize: 15, dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--batch-size') args.batchSize = Number(argv[++i]);
    if (argv[i] === '--dry-run') args.dryRun = true;
  }
  return args;
}

async function readPromptTemplate() {
  const p = path.join(__dirname, 'prompts', 'vision-batch.md');
  return fs.readFile(p, 'utf8');
}

function runNodeScript(script, scriptArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...scriptArgs], {
      cwd: REPO_ROOT,
      stdio: 'inherit'
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`${path.basename(script)} exited ${code}`));
      else resolve();
    });
  });
}

async function main() {
  const { folder } = parseInboxFolderArg(process.argv);
  const args = parseArgs(process.argv);
  const { inboxDir, manifestPath } = resolveInboxPaths(REPO_ROOT, folder);
  const visionResultsPath = path.join(inboxDir, 'vision-results.json');
  const visionBatchPath = path.join(inboxDir, 'vision-batch.json');
  const promptTemplate = await readPromptTemplate();

  let round = 0;
  let totalApplied = 0;

  while (true) {
    const manifest = await loadManifest(manifestPath);
    const tasks = collectVisionTasks(manifest, { limit: args.batchSize });
    if (!tasks.length) {
      console.log(`Vision complete for ${folder} (${totalApplied} images applied)`);
      break;
    }

    round += 1;
    const batchPayload = {
      date: folder,
      inbox_dir: inboxDir,
      round,
      tasks: tasks.map((task) => ({
        ...task,
        abs_path: path.join(inboxDir, task.file)
      }))
    };

    await fs.writeFile(visionBatchPath, JSON.stringify(batchPayload, null, 2), 'utf8');
    console.log(`Vision round ${round}: ${tasks.length} images`);

    if (args.dryRun) {
      console.log('Dry run — wrote', visionBatchPath);
      break;
    }

    const prompt = `${promptTemplate.replaceAll('{DATE}', folder)}

DATE=${folder}
Batch file: daily-inbox/${folder}/vision-batch.json
Output file: daily-inbox/${folder}/vision-results.json`;

    const visionModel = process.env.CURSOR_VISION_MODEL || 'auto';
    console.log(`Vision agent model: ${visionModel}`);

    const { stdout } = await runCursorAgent(prompt, { model: visionModel });
    console.log(stdout.slice(-500));

    await runNodeScript(
      path.join(__dirname, 'apply-vision-results.mjs'),
      [...inboxCliArgs(folder), '--input', visionResultsPath]
    );

    totalApplied += tasks.length;

    const reportPath = path.join(inboxDir, 'vision-apply-report.json');
    try {
      const report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
      if (report.remaining > 0) continue;
      break;
    } catch {
      // continue loop
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
