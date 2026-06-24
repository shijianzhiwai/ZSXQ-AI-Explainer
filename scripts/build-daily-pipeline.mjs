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
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { REPO_ROOT } from './lib/cursor-agent.mjs';
import { collectVisionTasks, loadManifest, resolveInboxPaths } from './lib/manifest-vision.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function todayDateString(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

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

function runNode(scriptName, scriptArgs = []) {
  const scriptPath = path.join(__dirname, scriptName);
  return new Promise((resolve, reject) => {
    console.log(`\n→ node scripts/${scriptName} ${scriptArgs.join(' ')}`.trim());
    const child = spawn(process.execPath, [scriptPath, ...scriptArgs], {
      cwd: REPO_ROOT,
      stdio: 'inherit'
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`scripts/${scriptName} failed (${code})`));
      else resolve();
    });
  });
}

async function main() {
  const args = parseArgs(process.argv);
  const date = args.date || await findLatestInboxDate();
  const { manifestPath } = resolveInboxPaths(REPO_ROOT, date);

  try {
    await fs.access(manifestPath);
  } catch {
    throw new Error(`Missing ${manifestPath} — export from extension first`);
  }

  console.log(`Daily pipeline for ${date}`);

  if (!args.skipOcr) {
    const ocrArgs = ['--date', date];
    if (args.reclassifyOnly) ocrArgs.push('--reclassify-only');
    await runNode('enrich-manifest-images.mjs', ocrArgs);
  } else {
    console.log('Skip OCR');
  }

  if (!args.skipVision) {
    const manifest = await loadManifest(manifestPath);
    const pending = collectVisionTasks(manifest).length;
    if (pending > 0) {
      await runNode('run-vision-agent.mjs', ['--date', date]);
    } else {
      console.log('Skip vision — no needs_vision images');
    }
  } else {
    console.log('Skip vision');
  }

  if (!args.skipSummary) {
    await runNode('run-summary-agent.mjs', ['--date', date]);
  } else {
    console.log('Skip summary');
  }

  if (!args.skipHtml) {
    await runNode('build-daily-summary.mjs', ['--date', date]);
  } else {
    console.log('Skip HTML');
  }

  const htmlPath = path.join(REPO_ROOT, 'summaries', `${date}.html`);
  const reportPath = path.join(REPO_ROOT, 'daily-inbox', date, 'report.html');
  const { summaryReportUrl, DEFAULT_PORT } = await import('./local-inbox-server.mjs');
  console.log(`\nDone → ${summaryReportUrl(date, DEFAULT_PORT)}`);
  console.log(`     → ${htmlPath}`);
  console.log(`     → ${reportPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
