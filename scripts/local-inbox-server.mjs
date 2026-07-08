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
      color-scheme:dark;
      --primary:#62aef0; --primary-active:#8cc6f7;
      --canvas:#191817; --canvas-soft:#191817; --surface:#232220;
      --ink:rgba(255,255,255,.95); --ink-secondary:rgba(255,255,255,.82); --ink-muted:rgba(255,255,255,.6); --ink-faint:rgba(255,255,255,.4);
      --hairline:rgba(255,255,255,.12); --band:#213183;
      --radius-md:8px; --radius-lg:12px; --radius-full:9999px;
      --shadow-soft:0 8px 24px rgba(0,0,0,.10), 0 16px 40px rgba(0,0,0,.16);
      --font-sans:'Inter',-apple-system,system-ui,'Segoe UI',Helvetica,Arial,sans-serif;
    }`;

function escapeHtml(str) {
  return String(str || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** Read per-day stats + overview for the index page. Missing files are fine. */
async function loadIndexMeta(root, dates) {
  const metas = {};
  await Promise.all(dates.map(async (date) => {
    const dir = path.join(root, 'daily-inbox', date);
    const meta = { posts: 0, images: 0, reading: 0, overview: '', sections: [] };
    try {
      const m = JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8'));
      meta.posts = m.post_count ?? (m.posts || []).length;
      meta.images = m.image_count ?? 0;
      meta.reading = m.reading_list_count ?? 0;
    } catch { /* no manifest */ }
    try {
      const s = JSON.parse(await fs.readFile(path.join(dir, 'summary.json'), 'utf8'));
      if (typeof s.overview === 'string') meta.overview = s.overview.trim();
      meta.sections = (s.sections || []).map((x) => x && (x.title || x.heading)).filter(Boolean);
      if (!meta.posts) meta.posts = (s.posts || []).length;
    } catch { /* no summary */ }
    metas[date] = meta;
  }));
  return metas;
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

function describeDate(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  const weekday = Number.isNaN(d.getTime()) ? '' : `周${WEEKDAYS[d.getDay()]}`;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((today - d) / 86400000);
  let rel = '';
  if (diff === 0) rel = '今天';
  else if (diff === 1) rel = '昨天';
  else if (diff === 2) rel = '前天';
  else if (diff > 2 && diff <= 30) rel = `${diff} 天前`;
  return { weekday, rel };
}

function firstSentence(text) {
  const t = String(text || '').trim();
  if (!t) return '';
  const m = t.match(/^[^。！？!?]+[。！？!?]?/);
  return m ? m[0] : t;
}

function renderIndexBadges(meta) {
  const parts = [];
  if (meta.posts) parts.push(`<span class="badge"><i>◆</i>${meta.posts} 帖</span>`);
  if (meta.images) parts.push(`<span class="badge"><i>▣</i>${meta.images} 图</span>`);
  if (meta.reading) parts.push(`<span class="badge"><i>❖</i>${meta.reading} 待读</span>`);
  return parts.length ? `<span class="badges">${parts.join('')}</span>` : '';
}

function renderIndexCard(date, meta, index) {
  const { weekday, rel } = describeDate(date);
  const sub = [weekday, rel].filter(Boolean).join(' · ');
  const preview = firstSentence(meta.overview);
  return `      <a class="card" href="/view/${date}" style="--i:${index}">
        <span class="card-top">
          <span class="card-date">${date.slice(5).replace('-', ' / ')}</span>
          <span class="card-sub">${escapeHtml(sub)}</span>
        </span>
        ${preview ? `<span class="card-preview">${escapeHtml(preview)}</span>` : ''}
        ${renderIndexBadges(meta)}
      </a>`;
}

function renderIndexCover(date, meta) {
  const { weekday, rel } = describeDate(date);
  const sub = [weekday, rel].filter(Boolean).join(' · ');
  const chips = meta.sections.slice(0, 5).map((t) => `<span class="chip">${escapeHtml(t)}</span>`).join('');
  return `      <a class="cover" href="/view/${date}" style="--i:0">
        <span class="cover-flag"><span class="pulse"></span>最新日报</span>
        <span class="cover-date">${date}</span>
        <span class="cover-sub">${escapeHtml(sub)}</span>
        ${meta.overview ? `<span class="cover-preview">${escapeHtml(meta.overview)}</span>` : ''}
        <span class="cover-foot">
          ${chips ? `<span class="chips">${chips}</span>` : '<span></span>'}
          ${renderIndexBadges(meta)}
        </span>
        <span class="cover-go">阅读 →</span>
      </a>`;
}

function renderIndex(dates, baseUrl, metas = {}) {
  let body;
  if (!dates.length) {
    body = `    <div class="empty" style="--i:0">
      <div class="empty-orb"></div>
      <p>暂无日报</p>
      <p class="empty-hint">先运行 <code>node scripts/build-daily-pipeline.mjs</code></p>
    </div>`;
  } else {
    const [latest, ...rest] = dates;
    const groups = [];
    for (const date of rest) {
      const month = date.slice(0, 7);
      if (!groups.length || groups[groups.length - 1].month !== month) {
        groups.push({ month, dates: [] });
      }
      groups[groups.length - 1].dates.push(date);
    }
    let i = 1;
    const groupHtml = groups.map((g) => {
      const [y, m] = g.month.split('-');
      const cards = g.dates.map((d) => renderIndexCard(d, metas[d] || {}, i++)).join('\n');
      return `    <section class="month">
      <h2 class="month-label" style="--i:${i}">${y} 年 ${Number(m)} 月</h2>
      <div class="grid">
${cards}
      </div>
    </section>`;
    }).join('\n');
    body = `${renderIndexCover(latest, metas[latest] || {})}\n${groupHtml}`;
  }

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>每日总结</title>
  <style>
    @view-transition{navigation:auto;}
    @property --ang{syntax:'<angle>';initial-value:0deg;inherits:false;}
    *{box-sizing:border-box;}
    :root{
      --bg:#070b16; --card:rgba(255,255,255,.045); --card-border:rgba(255,255,255,.09);
      --ink:#e7ecf5; --ink-muted:#9aa7bd; --ink-faint:#5d6a82;
      --cyan:#5eead4; --violet:#a78bfa; --blue:#60a5fa;
      --font-sans:'Inter',-apple-system,system-ui,'Segoe UI',Helvetica,Arial,sans-serif;
      --mono:ui-monospace,SFMono-Regular,Menlo,monospace;
    }
    html{scrollbar-color:rgba(255,255,255,.18) transparent;}
    body{margin:0;min-height:100vh;font-family:var(--font-sans);background:var(--bg);color:var(--ink);overflow-x:hidden;}
    /* ---- aurora backdrop ---- */
    .sky{position:fixed;inset:0;z-index:-2;overflow:hidden;background:
      radial-gradient(ellipse at 70% -10%,rgba(37,52,95,.55),transparent 55%),var(--bg);}
    .blob{position:absolute;width:58vmax;height:58vmax;border-radius:50%;filter:blur(80px);opacity:.32;mix-blend-mode:screen;will-change:transform;}
    .b1{background:radial-gradient(circle,#0ea5e9,transparent 62%);top:-24vmax;left:-12vmax;animation:drift1 26s ease-in-out infinite alternate;}
    .b2{background:radial-gradient(circle,#7c3aed,transparent 62%);top:-18vmax;right:-16vmax;animation:drift2 32s ease-in-out infinite alternate;}
    .b3{background:radial-gradient(circle,#0d9488,transparent 65%);bottom:-30vmax;left:22vw;opacity:.2;animation:drift3 38s ease-in-out infinite alternate;}
    @keyframes drift1{to{transform:translate(9vw,7vh) scale(1.15);}}
    @keyframes drift2{to{transform:translate(-8vw,10vh) scale(.92);}}
    @keyframes drift3{to{transform:translate(6vw,-8vh) scale(1.1);}}
    #stars{position:fixed;inset:0;z-index:-1;pointer-events:none;}
    /* ---- hero ---- */
    .hero{max-width:960px;margin:0 auto;padding:72px 24px 40px;}
    .hero h1{margin:0;font-size:clamp(34px,6vw,52px);font-weight:800;letter-spacing:-1.5px;
      background:linear-gradient(100deg,#f1f5f9 10%,#7dd3fc 35%,#c4b5fd 60%,#f1f5f9 85%);
      background-size:200% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;
      animation:sheen 8s linear infinite;}
    @keyframes sheen{to{background-position:-200% 0;}}
    .addr{margin:14px 0 0;font-size:13px;color:var(--ink-faint);}
    .addr code{background:rgba(255,255,255,.06);border:1px solid var(--card-border);padding:3px 9px;border-radius:8px;font-family:var(--mono);color:var(--ink-muted);}
    .wrap{max-width:960px;margin:0 auto 90px;padding:0 24px;}
    /* ---- entrance ---- */
    .cover,.card,.month-label,.empty{opacity:0;transform:translateY(18px);
      animation:rise .65s cubic-bezier(.22,1,.36,1) forwards;animation-delay:calc(var(--i)*45ms);}
    @keyframes rise{to{opacity:1;transform:none;}}
    /* ---- shared card chrome ---- */
    .cover,.card{position:relative;display:flex;flex-direction:column;text-decoration:none;color:var(--ink);
      background:var(--card);border:1px solid var(--card-border);border-radius:18px;
      backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);
      transition:border-color .25s ease,background .25s ease,box-shadow .25s ease;
      transform-style:preserve-3d;will-change:transform;}
    .cover::before,.card::before{content:'';position:absolute;inset:-1px;border-radius:inherit;padding:1px;
      background:conic-gradient(from var(--ang),transparent 0%,rgba(94,234,212,.7) 10%,rgba(167,139,250,.7) 22%,transparent 38%);
      -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);
      -webkit-mask-composite:xor;mask-composite:exclude;
      opacity:0;transition:opacity .3s ease;pointer-events:none;}
    .cover:hover::before,.card:hover::before{opacity:1;animation:spin 3.2s linear infinite;}
    @keyframes spin{to{--ang:360deg;}}
    .cover::after,.card::after{content:'';position:absolute;inset:0;border-radius:inherit;pointer-events:none;opacity:0;transition:opacity .3s ease;
      background:radial-gradient(320px circle at var(--mx,50%) var(--my,50%),rgba(125,211,252,.12),transparent 65%);}
    .cover:hover::after,.card:hover::after{opacity:1;}
    .cover:hover,.card:hover{background:rgba(255,255,255,.07);box-shadow:0 18px 50px rgba(2,8,23,.55);}
    /* ---- cover card ---- */
    .cover{padding:30px 32px 26px;margin-bottom:36px;gap:8px;overflow:hidden;}
    .cover-flag{display:inline-flex;align-items:center;gap:8px;align-self:flex-start;font-size:12px;font-weight:700;letter-spacing:2px;
      color:var(--cyan);text-transform:uppercase;}
    .pulse{width:8px;height:8px;border-radius:50%;background:var(--cyan);box-shadow:0 0 0 0 rgba(94,234,212,.5);animation:pulse 2.2s ease-out infinite;}
    @keyframes pulse{70%{box-shadow:0 0 0 10px rgba(94,234,212,0);}100%{box-shadow:0 0 0 0 rgba(94,234,212,0);}}
    .cover-date{font-family:var(--mono);font-variant-numeric:tabular-nums;font-size:clamp(30px,5vw,42px);font-weight:800;letter-spacing:-1px;line-height:1.1;}
    .cover-sub{font-size:14px;color:var(--ink-muted);}
    .cover-preview{margin-top:8px;font-size:14.5px;line-height:1.75;color:var(--ink-muted);
      display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;}
    .cover-foot{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;margin-top:14px;}
    .chips{display:flex;flex-wrap:wrap;gap:8px;}
    .chip{font-size:12px;padding:4px 11px;border-radius:9999px;border:1px solid rgba(167,139,250,.35);color:#c4b5fd;background:rgba(124,58,237,.12);}
    .cover-go{position:absolute;top:28px;right:30px;font-size:14px;font-weight:600;color:var(--ink-faint);transition:color .25s ease,transform .25s ease;}
    .cover:hover .cover-go{color:var(--cyan);transform:translateX(4px);}
    /* ---- month groups & cards ---- */
    .month{margin-bottom:34px;}
    .month-label{display:flex;align-items:center;gap:14px;margin:0 0 16px;font-size:13px;font-weight:600;letter-spacing:3px;color:var(--ink-faint);}
    .month-label::after{content:'';flex:1;height:1px;background:linear-gradient(90deg,var(--card-border),transparent);}
    .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:14px;}
    .card{padding:18px 20px 16px;gap:9px;}
    .card-top{display:flex;align-items:baseline;justify-content:space-between;gap:8px;}
    .card-date{font-family:var(--mono);font-variant-numeric:tabular-nums;font-size:22px;font-weight:800;letter-spacing:-.5px;}
    .card-sub{font-size:12px;color:var(--ink-faint);white-space:nowrap;}
    .card-preview{font-size:13px;line-height:1.65;color:var(--ink-muted);
      display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
    .badges{display:flex;flex-wrap:wrap;gap:6px;margin-top:auto;}
    .badge{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;color:var(--ink-muted);
      padding:3px 9px;border-radius:9999px;border:1px solid var(--card-border);background:rgba(255,255,255,.03);}
    .badge i{font-style:normal;font-size:9px;color:var(--blue);}
    /* ---- empty ---- */
    .empty{text-align:center;padding:80px 0;color:var(--ink-muted);}
    .empty-orb{width:72px;height:72px;margin:0 auto 24px;border-radius:50%;
      background:radial-gradient(circle at 35% 35%,rgba(125,211,252,.7),rgba(124,58,237,.35) 65%,transparent);
      filter:blur(2px);animation:float 4s ease-in-out infinite alternate;}
    @keyframes float{to{transform:translateY(-14px);}}
    .empty-hint{font-size:13px;color:var(--ink-faint);}
    .empty code{background:rgba(255,255,255,.06);border:1px solid var(--card-border);padding:2px 8px;border-radius:8px;font-family:var(--mono);}
    @media (max-width:560px){
      .hero{padding:52px 20px 28px;}
      .wrap{padding:0 20px;}
      .cover{padding:24px 22px 22px;}
      .cover-go{display:none;}
    }
    @media (prefers-reduced-motion:reduce){
      *,*::before,*::after{animation:none!important;transition:none!important;}
      .cover,.card,.month-label,.empty{opacity:1;transform:none;}
      #stars{display:none;}
    }
  </style>
</head>
<body>
  <div class="sky"><div class="blob b1"></div><div class="blob b2"></div><div class="blob b3"></div></div>
  <canvas id="stars"></canvas>
  <header class="hero"><h1>每日总结</h1><p class="addr">服务地址 <code>${baseUrl}</code></p></header>
  <main class="wrap">
${body}
  </main>
  <script>
  (function(){
    var reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
    /* card tilt + cursor glow */
    var cards=document.querySelectorAll('.card,.cover');
    cards.forEach(function(el){
      el.addEventListener('pointermove',function(e){
        var r=el.getBoundingClientRect();
        var x=e.clientX-r.left, y=e.clientY-r.top;
        el.style.setProperty('--mx',(x/r.width*100)+'%');
        el.style.setProperty('--my',(y/r.height*100)+'%');
        if(reduced||e.pointerType!=='mouse')return;
        var rx=((y/r.height)-.5)*-5, ry=((x/r.width)-.5)*5;
        el.style.transform='perspective(900px) rotateX('+rx.toFixed(2)+'deg) rotateY('+ry.toFixed(2)+'deg) translateY(-2px)';
      });
      el.addEventListener('pointerleave',function(){el.style.transform='';});
    });
    /* drifting stars */
    if(reduced)return;
    var cv=document.getElementById('stars'),ctx=cv.getContext('2d'),stars=[],W,H;
    function size(){W=cv.width=innerWidth*devicePixelRatio;H=cv.height=innerHeight*devicePixelRatio;
      cv.style.width=innerWidth+'px';cv.style.height=innerHeight+'px';}
    size();addEventListener('resize',size);
    for(var i=0;i<70;i++)stars.push({x:Math.random(),y:Math.random(),r:Math.random()*1.4+.4,
      s:Math.random()*.00009+.00003,p:Math.random()*Math.PI*2});
    (function tick(t){
      ctx.clearRect(0,0,W,H);
      stars.forEach(function(st){
        st.y-=st.s; if(st.y<0)st.y=1;
        var tw=.35+.3*Math.sin(t*.001+st.p);
        ctx.beginPath();
        ctx.arc(st.x*W,st.y*H,st.r*devicePixelRatio,0,Math.PI*2);
        ctx.fillStyle='rgba(190,215,255,'+tw+')';
        ctx.fill();
      });
      requestAnimationFrame(tick);
    })(0);
  })();
  </script>
</body>
</html>`;
}

function renderViewer(date, dates = []) {
  const dateLinks = dates.map((d) => {
    const cls = d === date ? ' class="current"' : '';
    return `      <li><a${cls} href="/view/${d}">${d}</a></li>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${date} · 每日总结</title>
  <style>${VIEWER_PALETTE}
    @view-transition{navigation:auto;}
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
    .toc-list a.active{background:rgba(98,174,240,.16);color:var(--primary);font-weight:600;}
    .toc-list a.lvl1{font-weight:700;color:var(--ink);}
    .toc-list a.lvl2{padding-left:14px;}
    .toc-dates{flex:0 0 auto;max-height:38%;overflow-y:auto;border-top:1px solid var(--hairline);padding:10px 8px 16px;margin:0;list-style:none;}
    .toc-dates-label{padding:12px 18px 0;font-size:12px;font-weight:600;color:var(--ink-faint);border-top:1px solid var(--hairline);}
    .toc-dates-label + .toc-dates{border-top:0;padding-top:6px;}
    .toc-dates a{display:block;padding:6px 10px;border-radius:var(--radius-md);font-size:13px;line-height:1.4;color:var(--ink-muted);text-decoration:none;}
    .toc-dates a:hover{background:var(--canvas-soft);color:var(--ink);}
    .toc-dates a.current{background:rgba(98,174,240,.16);color:var(--primary);font-weight:600;}
    .stage{position:relative;flex:1;min-width:0;}
    .frame{width:100%;height:100%;border:0;background:var(--canvas);display:block;}
    .toggle{position:absolute;top:14px;right:16px;z-index:20;display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;padding:0;color:rgba(255,255,255,.75);background:rgba(25,24,23,.55);border:1px solid rgba(255,255,255,.14);border-radius:10px;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);cursor:pointer;transition:color .18s ease,background .18s ease,border-color .18s ease,transform .18s ease;}
    .toggle:hover{color:var(--primary);border-color:rgba(98,174,240,.45);background:rgba(25,24,23,.75);transform:scale(1.06);}
    .toggle:active{transform:scale(.96);}
    .toggle svg{width:18px;height:18px;display:block;}
    .toggle .pane{transition:opacity .18s ease;}
    .toggle[aria-expanded="false"] .pane{opacity:0;}
    @media (max-width:720px){
      .toc{position:fixed;z-index:15;top:0;bottom:0;left:0;box-shadow:0 10px 30px rgba(0,0,0,.18);}
    }
  </style>
</head>
<body>
  <nav class="toc" id="toc">
    <div class="toc-head">
      <a class="toc-back" href="/">← 返回列表</a>
      <div class="toc-title">${date}</div>
    </div>
    <ul class="toc-list" id="toc-list"></ul>
    <div class="toc-dates-label">日期</div>
    <ul class="toc-dates">
${dateLinks}
    </ul>
  </nav>
  <div class="stage">
    <button class="toggle" id="toggle" type="button" aria-expanded="true" aria-label="收起/展开目录" title="目录">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect x="3" y="4" width="18" height="16" rx="3"/>
        <line x1="9.5" y1="4" x2="9.5" y2="20"/>
        <line class="pane" x1="5.8" y1="8" x2="7.2" y2="8"/>
        <line class="pane" x1="5.8" y1="11" x2="7.2" y2="11"/>
        <line class="pane" x1="5.8" y1="14" x2="7.2" y2="14"/>
      </svg>
    </button>
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
    toggle.addEventListener('click',function(){
      var collapsed=toc.classList.toggle('collapsed');
      toggle.setAttribute('aria-expanded',collapsed?'false':'true');
    });
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
    const metas = await loadIndexMeta(root, dates);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderIndex(dates, baseUrl, metas));
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
    const dates = await listSummaryDates(root);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderViewer(date, dates));
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
