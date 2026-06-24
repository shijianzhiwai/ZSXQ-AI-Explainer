#!/usr/bin/env node
/**
 * Local bridge: browser extension → repo daily-inbox/
 * Also serves summary HTML and inbox assets over HTTP.
 *
 * Usage:
 *   node scripts/local-inbox-server.mjs
 *   node scripts/local-inbox-server.mjs --port 3921 --root .
 *   node scripts/local-inbox-server.mjs --host 127.0.0.1   # localhost only
 *
 * POST /inbox/daily
 * Body: { date, manifest, images: [{ file, data_url }] }
 *
 * GET  /                          index of available reports
 * GET  /latest                    redirect to newest summary
 * GET  /summaries/YYYY-MM-DD.html daily report (images via ../daily-inbox/...)
 * GET  /daily-inbox/...           manifest, images, report.html
 * WS   /ws                        extension bridge (refresh_and_export)
 * POST /export/trigger            dispatch export command to extension
 * POST /export/debug               export top N digests posts to daily-inbox/{slug}/
 * GET  /export/status             websocket client status
 *
 * Scheduled job (default on): daily at 13:00 local time
 *   1. incremental export (WebSocket → extension)
 *   2. build-daily-pipeline (OCR → vision → summary → HTML)
 *   --no-schedule                 disable
 *   --schedule 13:00              override time (HH:MM)
 */
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachInboxWebSocket, inboxWsUrl } from './lib/inbox-ws-hub.mjs';
import { triggerExport, triggerDebugExport } from './lib/trigger-export.mjs';
import { parseScheduleTime, scheduleDailyAt } from './lib/daily-schedule.mjs';
import { todayDateString } from './lib/inbox-slug.mjs';
import { runDailyPipeline } from './lib/run-daily-pipeline.mjs';

export const DEFAULT_PORT = 3921;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function parseArgs(argv) {
  const args = {
    port: DEFAULT_PORT,
    host: '0.0.0.0',
    root: path.resolve(__dirname, '..'),
    schedule: true,
    scheduleTime: '13:00'
  };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--port') args.port = Number(argv[++i]);
    if (argv[i] === '--host') args.host = argv[++i];
    if (argv[i] === '--root') args.root = path.resolve(argv[++i]);
    if (argv[i] === '--no-schedule') args.schedule = false;
    if (argv[i] === '--schedule') args.scheduleTime = argv[++i];
  }
  return args;
}

export function getLanAddresses() {
  const addrs = [];
  for (const nets of Object.values(os.networkInterfaces())) {
    for (const net of nets || []) {
      if (net.family === 'IPv4' && !net.internal) addrs.push(net.address);
    }
  }
  return addrs;
}

export function summaryReportUrl(date, port = DEFAULT_PORT, host = '127.0.0.1') {
  return `http://${host}:${port}/summaries/${date}.html`;
}

export { inboxWsUrl };

function dataUrlToBuffer(dataUrl) {
  const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
  return Buffer.from(base64, 'base64');
}

async function handleDailyInbox(root, body) {
  const { date, manifest, images = [] } = body;
  if (!date || !manifest) {
    throw new Error('date and manifest are required');
  }

  const dayDir = path.join(root, 'daily-inbox', date);
  const imagesDir = path.join(dayDir, 'images');
  await fs.mkdir(imagesDir, { recursive: true });

  await fs.writeFile(
    path.join(dayDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf8'
  );

  let savedImages = 0;
  for (const image of images) {
    if (!image?.file || !image?.data_url) continue;
    const rel = image.file.replace(/^images\//, '');
    const target = path.join(imagesDir, rel);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, dataUrlToBuffer(image.data_url));
    savedImages += 1;
  }

  return {
    ok: true,
    path: `daily-inbox/${date}`,
    manifest: `daily-inbox/${date}/manifest.json`,
    images_saved: savedImages
  };
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 80 * 1024 * 1024) {
        reject(new Error('payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function resolveSafePath(root, urlPath) {
  const pathname = decodeURIComponent(String(urlPath || '/').split('?')[0]);
  const rel = pathname.replace(/^\/+/, '');
  const abs = path.resolve(root, rel || '.');
  const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (abs !== root && !abs.startsWith(rootWithSep)) return null;
  return abs;
}

async function listSummaryDates(root) {
  const dir = path.join(root, 'summaries');
  try {
    const files = await fs.readdir(dir);
    return files
      .filter((file) => /^\d{4}-\d{2}-\d{2}\.html$/.test(file))
      .map((file) => file.replace(/\.html$/, ''))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

function renderIndex(dates, baseUrl) {
  const items = dates.length
    ? dates.map((date) => {
      const href = `/summaries/${date}.html`;
      return `<li><a href="${href}">${date}</a> · <a href="/daily-inbox/${date}/report.html">report</a></li>`;
    }).join('\n')
    : '<li>暂无日报，请先运行 <code>node scripts/build-daily-pipeline.mjs</code></li>';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>每日总结</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 720px; margin: 48px auto; padding: 0 20px; color: #31302e; }
    h1 { font-size: 1.5rem; }
    a { color: #0075de; }
    code { background: #f6f5f4; padding: 2px 6px; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>每日总结</h1>
  <p>服务地址 <code>${baseUrl}</code></p>
  <ul>${items}</ul>
</body>
</html>`;
}

async function serveFile(root, urlPath, res, method = 'GET') {
  let abs = resolveSafePath(root, urlPath);
  if (!abs) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  let stat;
  try {
    stat = await fs.stat(abs);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
    return;
  }

  if (stat.isDirectory()) {
    const indexPath = path.join(abs, 'index.html');
    try {
      await fs.stat(indexPath);
      abs = indexPath;
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }
  }

  const ext = path.extname(abs).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  const body = method === 'HEAD' ? null : await fs.readFile(abs);
  res.writeHead(200, {
    'Content-Type': type,
    'Cache-Control': ext === '.html' ? 'no-cache, no-store, must-revalidate' : 'public, max-age=60'
  });
  res.end(body);
}

async function handleBrowse(root, req, res, port) {
  const host = req.headers.host || `127.0.0.1:${port}`;
  const baseUrl = `http://${host}`;
  const url = new URL(req.url || '/', baseUrl);

  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      root,
      websocket: wsHub.getStatus()
    }));
    return;
  }

  if (url.pathname === '/export/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, ...wsHub.getStatus() }));
    return;
  }

  if (url.pathname === '/') {
    const dates = await listSummaryDates(root);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderIndex(dates, baseUrl));
    return;
  }

  if (url.pathname === '/latest') {
    const dates = await listSummaryDates(root);
    if (!dates.length) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('No summary HTML found');
      return;
    }
    res.writeHead(302, { Location: `/summaries/${dates[0]}.html` });
    res.end();
    return;
  }

  await serveFile(root, url.pathname, res, req.method);
}

const { port, host, root, schedule, scheduleTime } = parseArgs(process.argv);

let wsHub;

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    try {
      await handleBrowse(root, req, res, port);
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(error.message);
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/inbox/daily') {
    try {
      const body = await readJson(req);
      const result = await handleDailyInbox(root, body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (error) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: error.message }));
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/export/trigger') {
    try {
      const body = await readJson(req);
      const result = await triggerExport(wsHub, body);
      const status = body.wait === false ? 202 : 200;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (error) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: error.message }));
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/export/debug') {
    try {
      const body = await readJson(req);
      const result = await triggerDebugExport(wsHub, body);
      const status = body.wait === false ? 202 : 200;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (error) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: error.message }));
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error: 'not found' }));
});

wsHub = attachInboxWebSocket(server, { path: '/ws' });

function startScheduledExport() {
  if (!schedule) return;
  const { hour, minute } = parseScheduleTime(scheduleTime);
  scheduleDailyAt(hour, minute, async () => {
    console.log('[schedule] step 1/2: incremental export…');
    const result = await triggerExport(wsHub, { reload: true, wait: true });

    if (result.data?.ok === false) {
      throw new Error(result.data.error || 'incremental export failed');
    }

    const posts = result.data?.manifest?.post_count;
    const images = result.data?.manifest?.image_count;
    const date = result.data?.manifest?.date || todayDateString();

    if (posts != null) {
      console.log(`[schedule] export done: ${posts} posts, ${images ?? 0} images → daily-inbox/${date}/`);
    } else {
      console.log('[schedule] export done:', JSON.stringify(result.data || result));
    }

    console.log(`[schedule] step 2/2: pipeline for ${date}…`);
    const pipeline = await runDailyPipeline(date);
    console.log(`[schedule] pipeline done → ${pipeline.reportUrl}`);
  }, { label: 'daily export + pipeline' });
}

function startServer() {
  server.listen(port, host, () => {
    console.log(`ZSXQ inbox server listening on http://${host}:${port}`);
    console.log(`Writing to ${path.join(root, 'daily-inbox')}`);
    console.log(`WebSocket ${inboxWsUrl(port, '127.0.0.1')}`);
    console.log(`Local:    http://127.0.0.1:${port}/latest`);
    for (const addr of getLanAddresses()) {
      console.log(`Network:  http://${addr}:${port}/latest`);
      console.log(`WS:       ${inboxWsUrl(port, addr)}`);
    }
    console.log(`Trigger:  node scripts/trigger-export.mjs`);
    console.log(`Debug:    node scripts/debug-export-digests.mjs --slug debug-digests --count 10`);
    if (schedule) {
      console.log(`Schedule: daily export + pipeline at ${scheduleTime} (local), --no-schedule to disable`);
    }
    console.log(`Index:    http://127.0.0.1:${port}/`);
    startScheduledExport();
  });
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  startServer();
}
