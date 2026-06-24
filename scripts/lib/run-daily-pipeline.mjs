/**
 * Run OCR → vision → summary → HTML for one inbox folder (YYYY-MM-DD or slug).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { REPO_ROOT } from './cursor-agent.mjs';
import { collectVisionTasks, loadManifest, resolveInboxPaths } from './manifest-vision.mjs';
import { inboxCliArgs } from './inbox-slug.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = path.resolve(__dirname, '..');

function runNode(scriptName, scriptArgs = [], { cwd = REPO_ROOT } = {}) {
  const scriptPath = path.join(SCRIPTS_DIR, scriptName);
  return new Promise((resolve, reject) => {
    console.log(`\n→ node scripts/${scriptName} ${scriptArgs.join(' ')}`.trim());
    const child = spawn(process.execPath, [scriptPath, ...scriptArgs], {
      cwd,
      stdio: 'inherit',
      env: process.env
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`scripts/${scriptName} failed (${code})`));
      else resolve();
    });
  });
}

/**
 * @param {string} folder - inbox folder name, e.g. 2026-06-24
 * @param {object} options
 */
export async function runDailyPipeline(folder, options = {}) {
  const {
    skipOcr = false,
    skipVision = false,
    skipSummary = false,
    skipHtml = false,
    reclassifyOnly = false
  } = options;

  const { manifestPath } = resolveInboxPaths(REPO_ROOT, folder);

  try {
    await fs.access(manifestPath);
  } catch {
    throw new Error(`Missing ${manifestPath} — export from extension first`);
  }

  console.log(`Daily pipeline for ${folder}`);

  if (!skipOcr) {
    const ocrArgs = [...inboxCliArgs(folder)];
    if (reclassifyOnly) ocrArgs.push('--reclassify-only');
    await runNode('enrich-manifest-images.mjs', ocrArgs);
  } else {
    console.log('Skip OCR');
  }

  if (!skipVision) {
    const manifest = await loadManifest(manifestPath);
    const pending = collectVisionTasks(manifest).length;
    if (pending > 0) {
      await runNode('run-vision-agent.mjs', inboxCliArgs(folder));
    } else {
      console.log('Skip vision — no needs_vision images');
    }
  } else {
    console.log('Skip vision');
  }

  if (!skipSummary) {
    await runNode('run-summary-agent.mjs', inboxCliArgs(folder));
  } else {
    console.log('Skip summary');
  }

  if (!skipHtml) {
    await runNode('build-daily-summary.mjs', inboxCliArgs(folder));
  } else {
    console.log('Skip HTML');
  }

  const htmlPath = path.join(REPO_ROOT, 'summaries', `${folder}.html`);
  const reportPath = path.join(REPO_ROOT, 'daily-inbox', folder, 'report.html');
  const { summaryReportUrl, DEFAULT_PORT } = await import('../local-inbox-server.mjs');

  return {
    folder,
    htmlPath,
    reportPath,
    reportUrl: summaryReportUrl(folder, DEFAULT_PORT)
  };
}
