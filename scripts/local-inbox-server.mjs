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
  return `http://${host}:${port}/view/${date}`;
}

export { inboxWsUrl };

function dataUrlToBuffer(dataUrl) {
  const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
  return Buffer.from(base64, 'base64');
}

function postKey(post) {
  return String(post?.topic_id || post?.id || '').trim();
}

// 与既有日期 manifest 合并（按 topic_id/id 并集），避免 backfill 覆盖既有帖子
async function mergeWithExistingManifest(dayDir, incoming) {
  let existing;
  try {
    existing = JSON.parse(await fs.readFile(path.join(dayDir, 'manifest.json'), 'utf8'));
  } catch {
    return incoming;
  }
  if (!Array.isArray(existing.posts) || existing.posts.length === 0) return incoming;

  const byKey = new Map();
  for (const post of existing.posts) {
    const key = postKey(post);
    if (key) byKey.set(key, post);
  }
  // 新数据覆盖同 key 旧数据（更可能含 enrich 后的图片/OCR）
  for (const post of incoming.posts || []) {
    const key = postKey(post);
    if (key) byKey.set(key, post);
  }

  const mergedPosts = [...byKey.values()].sort((a, b) => {
    const ta = Date.parse(a.published_at || '') || 0;
    const tb = Date.parse(b.published_at || '') || 0;
    return tb - ta;
  });

  const imageCount = mergedPosts.reduce((sum, post) => sum + (post.images?.length || 0), 0);
  const readingListCount = mergedPosts.filter((post) => post.post_kind === 'article_link').length;
  const checkpointAfter = mergedPosts
    .map((post) => post.published_at)
    .filter(Boolean)
    .sort()
    .at(-1) || incoming.checkpoint_after || existing.checkpoint_after || null;

  return {
    ...incoming,
    posts: mergedPosts,
    post_count: mergedPosts.length,
    image_count: imageCount,
    reading_list_count: readingListCount,
    checkpoint_after: checkpointAfter
  };
}

async function handleDailyInbox(root, body) {
  const { date, manifest, images = [], merge = false } = body;
  if (!date || !manifest) {
    throw new Error('date and manifest are required');
  }

  const dayDir = path.join(root, 'daily-inbox', date);
  const imagesDir = path.join(dayDir, 'images');
  await fs.mkdir(imagesDir, { recursive: true });

  const finalManifest = merge ? await mergeWithExistingManifest(dayDir, manifest) : manifest;

  await fs.writeFile(
    path.join(dayDir, 'manifest.json'),
    JSON.stringify(finalManifest, null, 2),
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

const VIEWER_PALETTE = `
    :root{
      --primary:#0075de; --primary-active:#005bab;
      --canvas:#ffffff; --canvas-soft:#f6f5f4; --surface:#ffffff;
      --ink:rgba(0,0,0,.95); --ink-secondary:#31302e; --ink-muted:#615d59; --ink-faint:#a39e98;
      --hairline:#e6e6e6; --band:#22314c;
      --radius-md:8px; --radius-lg:12px; --radius-full:9999px;
      --shadow-soft:0 1px 2px rgba(0,0,0,.04), 0 4px 16px rgba(0,0,0,.05);
      --font-sans:'Inter',-apple-system,system-ui,'Segoe UI',Helvetica,Arial,sans-serif;
    }`;

function renderIndex(dates, baseUrl) {
  const cards = dates.length
    ? dates.map((date) => `      <a class="card" href="/view/${date}">
        <span class="card-date">${date}</span>
        <span class="card-go">查看 →</span>
      </a>`).join('\n')
    : '      <p class="empty">暂无日报，请先运行 <code>node scripts/build-daily-pipeline.mjs</code></p>';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>每日总结</title>
  <style>${VIEWER_PALETTE}
    *{box-sizing:border-box;}
    body{margin:0;font-family:var(--font-sans);background:var(--canvas-soft);color:var(--ink-secondary);}
    .hero{background:var(--band);color:#fff;padding:44px 20px 60px;}
    .hero-inner{max-width:760px;margin:0 auto;}
    .hero h1{margin:0;font-size:30px;font-weight:700;letter-spacing:-.5px;}
    .addr{margin:14px 0 0;font-size:13px;color:rgba(255,255,255,.7);}
    .addr code{background:rgba(255,255,255,.12);padding:3px 8px;border-radius:var(--radius-md);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#fff;}
    .wrap{max-width:760px;margin:-32px auto 64px;padding:0 20px;}
    .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px;}
    .card{display:flex;align-items:center;justify-content:space-between;padding:18px 20px;background:var(--surface);border:1px solid var(--hairline);border-radius:var(--radius-lg);box-shadow:var(--shadow-soft);text-decoration:none;color:var(--ink);transition:transform .12s ease, box-shadow .12s ease, border-color .12s ease;}
    .card:hover{transform:translateY(-2px);box-shadow:0 6px 20px rgba(0,0,0,.08);border-color:#cfe2f7;}
    .card-date{font-size:18px;font-weight:700;}
    .card-go{font-size:13px;color:var(--ink-faint);}
    .card:hover .card-go{color:var(--primary);}
    .empty{color:var(--ink-muted);}
    .empty code{background:var(--canvas-soft);padding:2px 6px;border-radius:var(--radius-md);}
  </style>
</head>
<body>
  <header class="hero"><div class="hero-inner"><h1>每日总结</h1><p class="addr">服务地址 <code>${baseUrl}</code></p></div></header>
  <main class="wrap"><div class="grid">
${cards}
  </div></main>
</body>
</html>`;
}

function renderViewer(date) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${date} · 每日总结</title>
  <style>${VIEWER_PALETTE}
    *{box-sizing:border-box;}
    html,body{margin:0;height:100%;}
    body{display:flex;height:100vh;font-family:var(--font-sans);background:var(--canvas-soft);color:var(--ink-secondary);overflow:hidden;}
    .toc{flex:0 0 264px;display:flex;flex-direction:column;background:var(--surface);border-right:1px solid var(--hairline);overflow:hidden;transition:margin-left .22s ease;}
    .toc.collapsed{margin-left:-264px;}
    .toc-head{padding:18px 18px 12px;border-bottom:1px solid var(--hairline);}
    .toc-back{display:inline-flex;align-items:center;gap:4px;font-size:13px;color:var(--ink-faint);text-decoration:none;}
    .toc-back:hover{color:var(--primary);}
    .toc-title{margin-top:10px;font-size:18px;font-weight:700;color:var(--ink);}
    .toc-list{flex:1;overflow-y:auto;padding:10px 8px 28px;margin:0;list-style:none;}
    .toc-list a{display:block;padding:7px 10px;border-radius:var(--radius-md);font-size:14px;line-height:1.4;color:var(--ink-muted);text-decoration:none;cursor:pointer;}
    .toc-list a:hover{background:var(--canvas-soft);color:var(--ink);}
    .toc-list a.active{background:rgba(0,117,222,.08);color:var(--primary);font-weight:600;}
    .toc-list a.lvl1{font-weight:700;color:var(--ink);}
    .toc-list a.lvl2{padding-left:14px;}
    .stage{position:relative;flex:1;min-width:0;}
    .frame{width:100%;height:100%;border:0;background:#fff;display:block;}
    .toggle{position:fixed;top:14px;right:14px;z-index:20;display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 13px;font-family:var(--font-sans);font-size:13px;font-weight:600;color:var(--ink-secondary);background:var(--surface);border:1px solid var(--hairline);border-radius:var(--radius-md);box-shadow:var(--shadow-soft);cursor:pointer;}
    .toggle:hover{color:var(--primary);border-color:#cfe2f7;}
    @media (max-width:720px){
      .toc{position:fixed;z-index:15;top:0;bottom:0;left:0;box-shadow:0 10px 30px rgba(0,0,0,.18);}
    }
  </style>
</head>
<body>
  <button class="toggle" id="toggle" type="button">目录</button>
  <nav class="toc" id="toc">
    <div class="toc-head">
      <a class="toc-back" href="/">← 返回列表</a>
      <div class="toc-title">${date}</div>
    </div>
    <ul class="toc-list" id="toc-list"></ul>
  </nav>
  <div class="stage">
    <iframe class="frame" id="frame" src="/summaries/${date}.html" title="${date} 日报"></iframe>
  </div>
  <script>
  (function(){
    var frame=document.getElementById('frame');
    var list=document.getElementById('toc-list');
    var toc=document.getElementById('toc');
    var toggle=document.getElementById('toggle');
    var links=[];var heads=[];
    function clean(h){
      var c=h.cloneNode(true);
      var b=c.querySelectorAll('.badge,.badge-pill,.badge-dot');
      for(var i=0;i<b.length;i++){b[i].remove();}
      return (c.textContent||'').replace(/\\s+/g,' ').trim();
    }
    function build(){
      try{
        var doc=frame.contentDocument;if(!doc)return;
        var hs=doc.querySelectorAll('h1,h2');
        list.innerHTML='';links=[];heads=[];
        for(var i=0;i<hs.length;i++){(function(h){
          var label=clean(h);if(!label)return;
          var li=document.createElement('li');
          var a=document.createElement('a');
          a.textContent=label;
          a.className=(h.tagName==='H1')?'lvl1':'lvl2';
          a.addEventListener('click',function(e){e.preventDefault();h.scrollIntoView({behavior:'smooth',block:'start'});});
          li.appendChild(a);list.appendChild(li);
          links.push(a);heads.push(h);
        })(hs[i]);}
        attachSpy(doc);
      }catch(err){}
    }
    function attachSpy(doc){
      var win=frame.contentWindow;if(!win)return;
      function spy(){
        var top=(win.scrollY||doc.documentElement.scrollTop||0)+96;var best=0;
        for(var i=0;i<heads.length;i++){if(heads[i].offsetTop<=top)best=i;}
        for(var j=0;j<links.length;j++){links[j].classList.toggle('active',j===best);}
      }
      win.addEventListener('scroll',spy,{passive:true});spy();
    }
    frame.addEventListener('load',build);
    toggle.addEventListener('click',function(){toc.classList.toggle('collapsed');});
  })();
  </script>
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
    res.writeHead(302, { Location: `/view/${dates[0]}` });
    res.end();
    return;
  }

  const viewMatch = url.pathname.match(/^\/view\/([\w-]+)$/);
  if (viewMatch) {
    const date = viewMatch[1];
    try {
      await fs.stat(path.join(root, 'summaries', `${date}.html`));
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderViewer(date));
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
