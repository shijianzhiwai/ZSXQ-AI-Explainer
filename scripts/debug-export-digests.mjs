#!/usr/bin/env node
/**
 * Debug: export top N posts from 精华 feed → daily-inbox/{slug}/, optionally run pipeline.
 *
 * Prerequisites:
 *   - node scripts/local-inbox-server.mjs
 *   - Chrome extension loaded + WebSocket connected
 *   - Logged into wx.zsxq.com (精华 tab will be auto-clicked if visible)
 *
 * Usage:
 *   node scripts/debug-export-digests.mjs --slug debug-digests --count 10
 *   node scripts/debug-export-digests.mjs --slug debug-digests --count 10 --pipeline
 *   node scripts/debug-export-digests.mjs --slug debug-digests --count 5 --no-reload --no-navigate
 *   node scripts/debug-export-digests.mjs --slug debug-digests --pipeline --skip-ocr
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PORT } from './local-inbox-server.mjs';
import { validateInboxSlug } from './lib/inbox-slug.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const args = {
    url: `http://127.0.0.1:${DEFAULT_PORT}`,
    slug: 'debug-digests',
    count: 10,
    reload: false,
    navigateDigests: true,
    wait: true,
    timeoutMs: 300_000,
    pipeline: false,
    skipOcr: false,
    skipVision: false,
    skipSummary: false,
    skipHtml: false
  };

  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--url') args.url = argv[++i];
    if (argv[i] === '--slug') args.slug = argv[++i];
    if (argv[i] === '--count') args.count = Number(argv[++i]);
    if (argv[i] === '--reload') args.reload = true;
    if (argv[i] === '--no-reload') args.reload = false;
    if (argv[i] === '--no-navigate') args.navigateDigests = false;
    if (argv[i] === '--no-wait') args.wait = false;
    if (argv[i] === '--timeout') args.timeoutMs = Number(argv[++i]);
    if (argv[i] === '--pipeline') args.pipeline = true;
    if (argv[i] === '--skip-ocr') args.skipOcr = true;
    if (argv[i] === '--skip-vision') args.skipVision = true;
    if (argv[i] === '--skip-summary') args.skipSummary = true;
    if (argv[i] === '--skip-html') args.skipHtml = true;
  }

  args.slug = validateInboxSlug(args.slug);
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

async function triggerDebugExport(args) {
  const base = args.url.replace(/\/$/, '');
  const response = await fetch(`${base}/export/debug`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      slug: args.slug,
      count: args.count,
      reload: args.reload,
      navigate_digests: args.navigateDigests,
      wait: args.wait,
      timeout_ms: args.timeoutMs
    })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || response.statusText);
  }
  return body;
}

function assertExportResult(result, slug) {
  const data = result?.data;
  if (!data || typeof data !== 'object') {
    throw new Error(
      `export returned invalid response (${JSON.stringify(data)}). Reload extension in chrome://extensions and retry.`
    );
  }
  if (data.ok === false) {
    throw new Error(data.error || 'export failed');
  }
  if (!data.manifest?.post_count) {
    throw new Error('export returned no posts — open 精华 feed and retry');
  }
  return data;
}

async function assertManifestWritten(slug) {
  const manifestPath = path.join(REPO_ROOT, 'daily-inbox', slug, 'manifest.json');
  try {
    await fs.access(manifestPath);
  } catch {
    throw new Error(`manifest not found at ${manifestPath} — check inbox server is running`);
  }
  return manifestPath;
}

async function runPipeline(args) {
  const pipelineArgs = ['--slug', args.slug];
  if (args.skipOcr) pipelineArgs.push('--skip-ocr');
  if (args.skipVision) pipelineArgs.push('--skip-vision');
  if (args.skipSummary) pipelineArgs.push('--skip-summary');
  if (args.skipHtml) pipelineArgs.push('--skip-html');
  await runNode('build-daily-pipeline.mjs', pipelineArgs);
}

async function main() {
  const args = parseArgs(process.argv);

  console.log(`Debug export → daily-inbox/${args.slug}/ (${args.count} posts from 精华)`);
  console.log(`Server: ${args.url}`);

  const result = await triggerDebugExport(args);
  const data = assertExportResult(result, args.slug);
  await assertManifestWritten(args.slug);
  console.log(JSON.stringify({ ok: true, slug: args.slug, data }, null, 2));

  const posts = data.manifest?.post_count;
  const articleLinks = data.article_link_count;
  console.log(`\nExported ${posts} posts (${articleLinks ?? 0} article links) → daily-inbox/${args.slug}/`);

  if (args.pipeline) {
    await runPipeline(args);
    console.log(`\nPipeline done. Open summaries/${args.slug}.html or daily-inbox/${args.slug}/report.html`);
  } else {
    console.log(`\nNext steps:`);
    console.log(`  node scripts/build-daily-pipeline.mjs --slug ${args.slug}`);
    console.log(`  # or re-run with --pipeline`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
