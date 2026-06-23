#!/usr/bin/env node
/**
 * Merge manifest + agent-written summary JSON into a standalone HTML report.
 *
 * Usage:
 *   node scripts/build-daily-summary.mjs
 *   node scripts/build-daily-summary.mjs --date 2026-06-22
 *   node scripts/build-daily-summary.mjs --date 2026-06-22 --summary daily-inbox/2026-06-22/summary.json
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { attachTopicUrls } from './lib/topic-url.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

function todayDateString(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseArgs(argv) {
  const args = { date: todayDateString(), summary: '', out: '', open: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--date') args.date = argv[++i];
    if (argv[i] === '--summary') args.summary = argv[++i];
    if (argv[i] === '--out') args.out = argv[++i];
    if (argv[i] === '--open') args.open = true;
  }
  if (!args.summary) {
    args.summary = path.join(REPO_ROOT, 'daily-inbox', args.date, 'summary.json');
  }
  return args;
}

function resolveOutputTargets(date, outOverride = '') {
  const inboxDir = path.join(REPO_ROOT, 'daily-inbox', date);
  const targets = [
    {
      out: outOverride || path.join(REPO_ROOT, 'summaries', `${date}.html`),
      inboxRel: path.relative(
        path.dirname(outOverride || path.join(REPO_ROOT, 'summaries', `${date}.html`)),
        inboxDir
      ).replace(/\\/g, '/') || '.'
    },
    {
      out: path.join(inboxDir, 'report.html'),
      inboxRel: '.'
    }
  ];
  const seen = new Set();
  return targets.filter((target) => {
    const key = path.resolve(target.out);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildHtml({ manifest, summary, date, inboxRel, builtAt, urlMaps }) {
  const sections = (summary.sections || []).map((section) => renderSectionBlock(section)).join('\n');
  const postBlocks = summary.posts?.length
    ? renderPostBlocks(summary.posts, inboxRel, urlMaps)
    : renderPostBlocks(
      (manifest.posts || []).map((p) => ({
        ...p,
        summary: p.text
      })),
      inboxRel,
      urlMaps
    );

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
  <meta http-equiv="Pragma" content="no-cache">
  <meta http-equiv="Expires" content="0">
  <title>${escapeHtml(manifest.group || '知识星球')} — ${escapeHtml(date)} 日报</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #f0f0f0;
      --card: #f7f7f7;
      --text: #5c5c5c;
      --text-strong: #454545;
      --muted: #8a8a8a;
      --heading: #6b7f96;
      --link: #6b8cae;
      --agent: #8b7aa8;
      --agent-bg: rgba(0,0,0,.03);
      --panel: rgba(0,0,0,.02);
      --border: rgba(0,0,0,.07);
      --source-badge-text: #9a9a9a;
      --source-badge-bg: rgba(0,0,0,.03);
      --source-badge-border: rgba(0,0,0,.06);
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #141414;
        --card: #1a1a1a;
        --text: #c4c4c4;
        --text-strong: #dedede;
        --muted: #949494;
        --heading: #aeb9c8;
        --link: #9bb5d0;
        --agent: #c4a8d8;
        --agent-bg: rgba(255,255,255,.05);
        --panel: rgba(255,255,255,.04);
        --border: rgba(255,255,255,.1);
        --source-badge-text: #8a8a8a;
        --source-badge-bg: rgba(255,255,255,.04);
        --source-badge-border: rgba(255,255,255,.08);
      }
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      margin: 0;
      background: var(--bg);
      color: var(--text);
      line-height: 1.65;
      -webkit-font-smoothing: antialiased;
    }
    .wrap { max-width: 920px; margin: 0 auto; padding: 32px 20px 64px; }
    header.page { margin-bottom: 28px; }
    header.page h1 { margin: 0 0 8px; font-size: 1.75rem; color: var(--text-strong); font-weight: 600; }
    header.page p { margin: 0; color: var(--muted); }
    .legend { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0 0; color: var(--muted); font-size: .85rem; }
    .badge {
      display: inline-block;
      font-size: .68rem;
      font-weight: 500;
      line-height: 1.4;
      padding: 2px 8px;
      border-radius: 999px;
      margin-right: 6px;
      vertical-align: middle;
      background: var(--agent-bg);
      color: var(--agent);
      border: 1px solid var(--border);
    }
    .agent-block .badge { margin-bottom: 6px; }
    .overview.agent-block {
      margin-top: 14px;
      padding: 14px 16px;
      background: var(--panel);
      border-radius: 10px;
      border-left: 3px solid var(--border);
      color: var(--text);
    }
    .block, .post {
      background: var(--card);
      border-radius: 12px;
      padding: 20px 22px;
      margin-bottom: 16px;
      border: 1px solid var(--border);
      box-shadow: none;
    }
    .post { position: relative; padding-right: 52px; }
    h2 { margin-top: 0; color: var(--heading); font-size: 1.12rem; font-weight: 600; }
    h3 { margin: 0 0 4px; font-size: 1rem; color: var(--text-strong); font-weight: 500; }
    a { color: var(--link); }
    .source-badge {
      position: absolute;
      top: 12px;
      right: 12px;
      z-index: 1;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 32px;
      padding: 2px 7px;
      font-size: .65rem;
      font-weight: 400;
      line-height: 1.2;
      color: var(--source-badge-text);
      text-decoration: none;
      background: var(--source-badge-bg);
      border: 1px solid var(--source-badge-border);
      border-radius: 4px;
    }
    .source-badge:hover {
      color: var(--muted);
      background: var(--panel);
      border-color: var(--border);
    }
    time { color: var(--muted); font-size: .85rem; }
    ul { padding-left: 1.2rem; color: var(--text); }
    li { color: var(--text); }
    .chart { margin: 12px 0 0; position: relative; }
    .chart-agent { padding-top: 8px; border-top: 1px dashed var(--border); }
    .chart-agent > .badge { position: absolute; top: 12px; right: 0; }
    .chart img { max-width: 100%; border-radius: 8px; border: 1px solid var(--border); display: block; }
    .chart figcaption { color: var(--muted); font-size: .85rem; margin-top: 8px; }
    .chart-summary {
      color: var(--text);
      font-size: .9rem;
      margin-top: 8px;
      padding: 10px 12px;
      background: var(--panel);
      border-radius: 8px;
    }
    .rich-block { font-size: .95rem; margin: 10px 0 0; color: var(--text); }
    .section-facts, .post-facts {
      padding: 10px 12px;
      background: var(--panel);
      border-radius: 8px;
      color: var(--text);
    }
    .section-analysis, .post-analysis {
      padding: 10px 12px;
      background: var(--agent-bg);
      border-radius: 8px;
      color: var(--text);
    }
    .section-takeaway, .post-takeaway {
      padding: 8px 12px;
      border-left: 3px solid var(--border);
      margin-top: 8px;
      font-size: .92rem;
      color: var(--muted);
    }
    .section-bullets { margin-top: 12px; padding-left: 0; list-style: none; }
    .bullet-item {
      position: relative;
      padding: 8px 44px 8px 1.1rem;
      margin-bottom: 6px;
      color: var(--text);
    }
    .bullet-item::before {
      content: "•";
      position: absolute;
      left: 0;
      color: var(--muted);
    }
    .bullet-item .source-badge { top: 6px; right: 0; }
    .bullet-text { display: block; }
    .post-summary { font-size: .95rem; color: var(--text); }
    strong { color: var(--text-strong); font-weight: 600; }
    footer { margin-top: 32px; color: var(--muted); font-size: .8rem; text-align: center; }
    footer .build-stamp { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .72rem; opacity: .75; }
  </style>
</head>
<body>
  <div class="wrap">
    <header class="page">
      <h1>${escapeHtml(summary.title || `${manifest.group || '知识星球'} 每日总结`)}</h1>
      <p>${escapeHtml(date)} · ${manifest.post_count || 0} 帖 · ${manifest.image_count || 0} 图</p>
      <div class="legend">
        ${renderAgentBadge('Agent 今日要点')} 全天脉络
        ${renderAgentBadge('Agent 信息汇总')} 事实与数据
        ${renderAgentBadge('Agent 解析')} 背景与含义
        ${renderAgentBadge('Agent 要点')} 精简收束
        ${renderAgentBadge('Agent 识图')} 图表
      </div>
      ${summary.overview ? `<div class="overview agent-block">${renderAgentBadge('Agent 今日要点')}${markdownLite(summary.overview)}</div>` : ''}
    </header>
    ${sections}
    <section class="block">
      <h2>帖子详情</h2>
      ${postBlocks}
    </section>
    <footer>
      由 ZSXQ-AI-Explainer 每日流水线生成<br>
      <span class="build-stamp">layout=cursor-dark · built=${escapeHtml(builtAt)}</span>
    </footer>
  </div>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function splitSourceLink(text) {
  const s = String(text ?? '');
  const match = s.match(/\s*\[原文\]\((https?:\/\/[^\s)]+)\)\s*$/);
  if (!match) return { body: s, url: '' };
  return { body: s.slice(0, match.index).trim(), url: match[1] };
}

function renderSourceBadge(url) {
  if (!url) return '';
  return `<a class="source-badge" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" title="打开知识星球原帖">原文</a>`;
}

function renderBulletItem(bullet) {
  const { body, url } = splitSourceLink(bullet);
  return `<li class="bullet-item">${renderSourceBadge(url)}<span class="bullet-text">${markdownLite(body)}</span></li>`;
}

function markdownLite(text) {
  let s = String(text ?? '');
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label, url) => {
    return `%%LINK:${encodeURIComponent(url)}:${label}%%`;
  });
  s = escapeHtml(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/%%LINK:([^:]+):([^%]+)%%/g, (_, encUrl, label) => {
    const url = decodeURIComponent(encUrl);
    return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(label)}</a>`;
  });
  return s.replace(/\n/g, '<br>');
}

function renderAgentBadge(label = 'Agent') {
  return `<span class="badge badge-agent" title="由 Cursor Agent 生成">${escapeHtml(label)}</span>`;
}

function manifestUrlMaps(manifest) {
  const byId = new Map();
  const byAuthorTime = new Map();
  for (const post of manifest.posts || []) {
    if (post.topic_url) {
      byId.set(String(post.id), post.topic_url);
      byAuthorTime.set(`${post.author}|${post.published_at}`, post.topic_url);
    }
  }
  return { byId, byAuthorTime };
}

function resolveTopicUrlForPost(post, maps) {
  if (post.topic_url || post.source_url) return post.topic_url || post.source_url;
  if (post.id) {
    const byId = maps.byId.get(String(post.id));
    if (byId) return byId;
  }
  return maps.byAuthorTime.get(`${post.author}|${post.published_at}`) || '';
}

function renderRichTextBlock(label, text, className = 'rich-block') {
  const value = String(text ?? '').trim();
  if (!value) return '';
  return `<div class="${className} agent-block">${renderAgentBadge(label)}${markdownLite(value)}</div>`;
}

function renderSectionBlock(section) {
  const facts = section.facts || (!section.analysis && !section.takeaway ? section.body : '');
  const parts = [
    `<section class="block agent-block">`,
    `<h2>${escapeHtml(section.title)} ${renderAgentBadge('Agent 章节')}</h2>`,
    renderRichTextBlock('Agent 信息汇总', facts, 'section-facts'),
    renderRichTextBlock('Agent 解析', section.analysis, 'section-analysis'),
    renderRichTextBlock('Agent 要点', section.takeaway, 'section-takeaway')
  ];
  if (section.bullets?.length) {
    parts.push(`<ul class="section-bullets">${section.bullets.map((b) => renderBulletItem(b)).join('')}</ul>`);
  }
  parts.push('</section>');
  return parts.join('\n');
}

function renderPostContent(post) {
  if (post.facts || post.analysis || post.takeaway) {
    return [
      renderRichTextBlock('Agent 信息汇总', post.facts, 'post-facts'),
      renderRichTextBlock('Agent 解析', post.analysis, 'post-analysis'),
      renderRichTextBlock('Agent 要点', post.takeaway, 'post-takeaway')
    ].join('\n');
  }
  return renderRichTextBlock('Agent 帖文解读', post.summary || post.text || '', 'post-summary');
}

function resolveImageSrc(inboxRel, file) {
  const normalized = String(file || '').replace(/\\/g, '/');
  if (!normalized) return '';
  return path.posix.join(inboxRel, normalized).replace(/\\/g, '/');
}

function renderPostBlocks(posts, inboxRel, urlMaps) {
  return posts.map((post) => {
    const topicUrl = resolveTopicUrlForPost(post, urlMaps);
    const sourceBadge = renderSourceBadge(topicUrl);
    const images = (post.images || [])
      .filter((img) => img.image_kind === 'chart' || img.chart_summary || img.file)
      .map((img) => {
        const src = resolveImageSrc(inboxRel, img.file);
        const chartSummary = (img.chart_summary || '').trim();
        const caption = (img.caption || chartSummary || img.id || '').trim();
        const summaryBlock = chartSummary
          ? `<div class="chart-summary agent-block">${renderAgentBadge('Agent 图表解读')}${markdownLite(chartSummary)}</div>`
          : '';
        const captionBlock = caption
          ? `<figcaption>${renderAgentBadge('Agent 图注')}${markdownLite(caption)}</figcaption>`
          : '';
        return `<figure class="chart chart-agent">
      ${renderAgentBadge('Agent 识图')}
      <img src="${escapeHtml(src)}" alt="${escapeHtml(caption || chartSummary || 'chart')}" loading="lazy">
      ${captionBlock}
      ${summaryBlock}
    </figure>`;
      }).join('\n');

    return `
      <article class="post">
        ${sourceBadge}
        <header>
          <h3>${escapeHtml(post.author || '未知作者')}</h3>
          <time>${escapeHtml(post.published_at || '')}</time>
        </header>
        ${renderPostContent(post)}
        ${images}
      </article>`;
  }).join('\n');
}

async function main() {
  const args = parseArgs(process.argv);
  const manifestPath = path.join(REPO_ROOT, 'daily-inbox', args.date, 'manifest.json');
  const summaryPath = path.resolve(args.summary);

  const [manifestStat, summaryStat] = await Promise.all([
    fs.stat(manifestPath),
    fs.stat(summaryPath)
  ]);

  const [manifestRaw, summaryRaw] = await Promise.all([
    fs.readFile(manifestPath, 'utf8'),
    fs.readFile(summaryPath, 'utf8')
  ]);

  const manifest = attachTopicUrls(JSON.parse(manifestRaw));
  const summary = JSON.parse(summaryRaw);

  const manifestExportedAt = manifest.exported_at ? new Date(manifest.exported_at) : manifestStat.mtime;
  if (manifestExportedAt > summaryStat.mtime) {
    console.warn(
      `⚠ manifest (${manifestExportedAt.toISOString()}) is newer than summary.json (${summaryStat.mtime.toISOString()}).`
    );
    console.warn('  Re-run summary agent first: node scripts/run-summary-agent.mjs --date', args.date);
  }

  const postCount = summary.posts?.length || 0;
  const richPosts = (summary.posts || []).filter((p) => p.facts || p.analysis || p.takeaway).length;
  console.log(`Input  manifest: ${manifestPath}`);
  console.log(`Input  summary:  ${summaryPath} (${postCount} posts, ${richPosts} with facts/analysis)`);

  const urlMaps = manifestUrlMaps(manifest);
  const builtAt = new Date().toISOString();
  const targets = resolveOutputTargets(args.date, args.out);

  for (const target of targets) {
    const html = buildHtml({
      manifest,
      summary,
      date: args.date,
      inboxRel: target.inboxRel,
      builtAt,
      urlMaps
    });
    await fs.mkdir(path.dirname(target.out), { recursive: true });
    await fs.writeFile(target.out, html, 'utf8');
    console.log(`Wrote ${target.out} (${(html.length / 1024).toFixed(1)} KB)`);
  }

  const primaryHtml = path.join(REPO_ROOT, 'summaries', `${args.date}.html`);
  const reportPath = path.join(REPO_ROOT, 'daily-inbox', args.date, 'report.html');
  console.log(`\n主报告（推荐，图片路径已验证）：\n  ${primaryHtml}`);
  console.log(`副本：${reportPath}`);
  console.log('页脚应显示 layout=cursor-dark · built=...');

  if (args.open && process.platform === 'darwin') {
    spawn('open', [primaryHtml], { stdio: 'ignore', detached: true }).unref();
  }

  console.log('\nNote: this script only renders HTML. To regenerate summary content, run:');
  console.log(`  node scripts/run-summary-agent.mjs --date ${args.date}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
