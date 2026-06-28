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
import { collectReadingListFromManifest, isArticleLinkPost } from './lib/article-link.mjs';
import { parseInboxFolderArg } from './lib/inbox-slug.mjs';
import { DEFAULT_PORT, getLanAddresses, summaryReportUrl } from './local-inbox-server.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

function todayDateString(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseArgs(argv) {
  const { folder } = parseInboxFolderArg(argv);
  const args = { date: folder, summary: '', out: '', open: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--summary') args.summary = argv[++i];
    if (argv[i] === '--out') args.out = argv[++i];
    if (argv[i] === '--open') args.open = true;
  }
  if (!args.summary) {
    args.summary = path.join(REPO_ROOT, 'daily-inbox', folder, 'summary.json');
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
  const pageTitle = `${date} 每日总结`;
  const footerLine = renderFooterLine(manifest, summary, builtAt);
  const readingList = collectReadingListFromManifest(manifest);
  const readingIds = new Set(readingList.map((item) => String(item.id)));
  const sections = (summary.sections || []).map((section) => renderSectionBlock(section)).join('\n');
  const summarizableSummaryPosts = (summary.posts || []).filter(
    (post) => !shouldSkipSummaryPost(post, readingIds)
  );
  const summarizableManifestPosts = (manifest.posts || []).filter(
    (post) => !isArticleLinkPost(post)
  );
  const postBlocks = summarizableSummaryPosts.length
    ? renderPostBlocks(summarizableSummaryPosts, inboxRel, urlMaps)
    : renderPostBlocks(
      summarizableManifestPosts.map((p) => ({
        ...p,
        summary: p.text
      })),
      inboxRel,
      urlMaps
    );
  const readingListBlock = renderReadingListSection(readingList, urlMaps);
  const readingLabel = readingList.length ? ` · ${readingList.length} 篇待读` : '';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
  <meta http-equiv="Pragma" content="no-cache">
  <meta http-equiv="Expires" content="0">
  <title>${escapeHtml(date)} 日报</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      color-scheme: light;
      --primary: #0075de;
      --primary-active: #005bab;
      --secondary: #213183;
      --on-primary: #ffffff;
      --canvas: #ffffff;
      --canvas-soft: #f6f5f4;
      --surface: #ffffff;
      --ink: rgba(0, 0, 0, 0.95);
      --ink-secondary: #31302e;
      --ink-muted: #615d59;
      --ink-faint: #a39e98;
      --hairline: #e6e6e6;
      --accent-sky: #62aef0;
      --accent-purple: #d6b6f6;
      --accent-pink: #ff64c8;
      --accent-orange: #dd5b00;
      --accent-teal: #2a9d99;
      --accent-green: #1aae39;
      --font-sans: 'Inter', -apple-system, system-ui, 'Segoe UI', Helvetica, Arial, sans-serif;
      --radius-xs: 4px;
      --radius-md: 8px;
      --radius-lg: 12px;
      --radius-xl: 16px;
      --radius-full: 9999px;
      --shadow-soft:
        rgba(0, 0, 0, 0.01) 0 0.175px 1.041px,
        rgba(0, 0, 0, 0.02) 0 0.8px 2.925px,
        rgba(0, 0, 0, 0.027) 0 2.025px 7.847px,
        rgba(0, 0, 0, 0.04) 0 4px 18px;
    }
    *, *::before, *::after { box-sizing: border-box; }
    body {
      font-family: var(--font-sans);
      font-size: 16px;
      font-weight: 400;
      line-height: 1.5;
      margin: 0;
      background: var(--canvas-soft);
      color: var(--ink-secondary);
      -webkit-font-smoothing: antialiased;
      font-feature-settings: 'lnum' 1, 'locl' 1;
    }
    .hero-band {
      background: var(--secondary);
      color: var(--on-primary);
      padding: 32px 24px 40px;
    }
    .hero-inner {
      max-width: 1200px;
      margin: 0 auto;
    }
    .page-label {
      font-size: 12px;
      font-weight: 600;
      line-height: 1.33;
      letter-spacing: 0.125px;
      color: rgba(255, 255, 255, 0.72);
      margin: 0 0 12px;
    }
    .hero-band h1 {
      margin: 0 0 12px;
      font-size: clamp(28px, 4.5vw, 40px);
      font-weight: 700;
      line-height: 1.1;
      letter-spacing: -1px;
      color: var(--on-primary);
    }
    .page-meta {
      margin: 0;
      font-size: 15px;
      color: rgba(255, 255, 255, 0.78);
    }
    .wrap {
      max-width: 1200px;
      margin: 0 auto;
      padding: 32px 24px 48px;
    }
    .legend {
      display: flex;
      flex-wrap: wrap;
      gap: 12px 20px;
      margin: 0 0 32px;
      padding: 20px 24px;
      background: var(--surface);
      border: 1px solid var(--hairline);
      border-radius: var(--radius-lg);
      font-size: 14px;
      color: var(--ink-muted);
    }
    .legend-item {
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      font-weight: 600;
      line-height: 1.33;
      letter-spacing: 0.125px;
      padding: 4px 8px;
      border-radius: var(--radius-full);
      margin-right: 8px;
      vertical-align: middle;
      background: var(--surface);
      color: var(--primary);
      border: 1px solid var(--hairline);
    }
    .badge-dot {
      width: 7px;
      height: 7px;
      border-radius: var(--radius-full);
      flex-shrink: 0;
    }
    .badge-dot-sky { background: var(--accent-sky); }
    .badge-dot-teal { background: var(--accent-teal); }
    .badge-dot-purple { background: var(--accent-purple); }
    .badge-dot-green { background: var(--accent-green); }
    .badge-dot-orange { background: var(--accent-orange); }
    .badge-dot-pink { background: var(--accent-pink); }
    .agent-block .badge { margin-bottom: 8px; }
    .overview.agent-block {
      margin-bottom: 32px;
      padding: 24px;
      background: var(--surface);
      border-radius: var(--radius-lg);
      border: 1px solid var(--hairline);
      box-shadow: var(--shadow-soft);
      color: var(--ink-secondary);
    }
    .block, .post {
      background: var(--surface);
      border-radius: var(--radius-lg);
      padding: 24px;
      margin-bottom: 24px;
      border: 1px solid var(--hairline);
    }
    .block { box-shadow: none; }
    .post {
      position: relative;
      box-shadow: var(--shadow-soft);
    }
    .post-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 16px;
    }
    .post-header time { flex: 1 1 auto; }
    .post-header .source-badge {
      flex: 0 0 auto;
    }
    .posts-section {
      margin-top: 32px;
    }
    .posts-section > h2 {
      margin: 0 0 24px;
      font-size: 26px;
      font-weight: 700;
      line-height: 1.23;
      letter-spacing: -0.625px;
      color: var(--ink);
    }
    h2 {
      margin: 0 0 16px;
      font-size: 22px;
      font-weight: 700;
      line-height: 1.27;
      letter-spacing: -0.25px;
      color: var(--ink);
    }
    h3 {
      margin: 0 0 4px;
      font-size: 20px;
      font-weight: 600;
      line-height: 1.4;
      letter-spacing: -0.125px;
      color: var(--ink);
    }
    a {
      color: var(--primary);
      text-decoration: none;
    }
    a:hover {
      color: var(--primary-active);
      text-decoration: underline;
    }
    .source-badge {
      z-index: 1;
      display: inline-flex;
      align-items: center;
      gap: 2px;
      font-family: var(--font-sans);
      font-size: 13px;
      font-weight: 500;
      line-height: 1.5;
      color: var(--ink-faint);
      text-decoration: none;
      background: none;
      border: none;
    }
    .source-badge::after {
      content: "↗";
      font-size: 12px;
    }
    .source-badge:hover {
      color: var(--primary);
      background: none;
      text-decoration: none;
    }
    time {
      color: var(--ink-faint);
      font-size: 14px;
    }
    ul { padding-left: 0; color: var(--ink-secondary); }
    li { color: var(--ink-secondary); }
    .chart {
      margin: 16px 0 0;
      position: relative;
    }
    .chart-agent {
      padding-top: 16px;
      border-top: 1px solid var(--hairline);
    }
    .chart-agent > .badge {
      position: absolute;
      top: 16px;
      right: 0;
    }
    .chart img {
      max-width: 100%;
      border-radius: var(--radius-lg);
      border: 1px solid var(--hairline);
      display: block;
    }
    .chart figcaption {
      color: var(--ink-muted);
      font-size: 14px;
      margin-top: 12px;
    }
    .chart-summary {
      color: var(--ink-secondary);
      font-size: 15px;
      margin-top: 12px;
      padding: 16px;
      background: var(--canvas-soft);
      border-radius: var(--radius-md);
      border: 1px solid var(--hairline);
    }
    .rich-block {
      font-size: 16px;
      margin: 16px 0 0;
      color: var(--ink-secondary);
    }
    .section-facts, .post-facts {
      padding: 16px;
      background: var(--canvas-soft);
      border-radius: var(--radius-md);
      border: 1px solid var(--hairline);
      color: var(--ink-secondary);
    }
    .section-analysis, .post-analysis {
      padding: 16px;
      background: var(--surface);
      border-radius: var(--radius-md);
      border: 1px solid var(--hairline);
      box-shadow: var(--shadow-soft);
      color: var(--ink-secondary);
    }
    .section-takeaway, .post-takeaway {
      padding: 12px 16px;
      border-left: 3px solid var(--primary);
      margin-top: 12px;
      font-size: 15px;
      color: var(--ink-muted);
      background: transparent;
    }
    .section-bullets {
      margin-top: 16px;
      padding-left: 0;
      list-style: none;
    }
    .bullet-item {
      position: relative;
      padding: 10px 48px 10px 16px;
      margin-bottom: 8px;
      color: var(--ink-secondary);
      border-bottom: 1px solid var(--hairline);
    }
    .bullet-item:last-child { border-bottom: none; }
    .bullet-item::before {
      content: "·";
      position: absolute;
      left: 0;
      color: var(--ink-faint);
      font-weight: 700;
    }
    .bullet-item .source-badge {
      position: absolute;
      top: 10px;
      right: 0;
    }
    .bullet-text { display: block; }
    .post-summary {
      font-size: 16px;
      color: var(--ink-secondary);
    }
    strong { color: var(--ink); font-weight: 600; }
    footer {
      margin-top: 0;
      padding: 32px 24px;
      background: var(--canvas-soft);
      border-top: 1px solid var(--hairline);
      color: var(--ink-secondary);
      font-size: 14px;
      text-align: center;
    }
    footer .build-stamp {
      font-size: 12px;
      color: var(--ink-faint);
    }
    footer .footer-line {
      margin: 0;
      line-height: 1.43;
    }
    .reading-list-block {
      background: var(--surface);
      border: 1px solid var(--hairline);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-soft);
      padding: 24px;
      margin-bottom: 24px;
    }
    .reading-list-block h2 {
      margin: 0 0 8px;
      font-size: 20px;
      font-weight: 700;
      color: var(--ink);
    }
    .reading-note {
      margin: 0 0 20px;
      color: var(--ink-muted);
      font-size: 14px;
    }
    .reading-item {
      position: relative;
      padding: 16px 0;
      border-top: 1px solid var(--hairline);
    }
    .reading-item:first-of-type { border-top: 0; padding-top: 0; }
    .reading-item time {
      display: block;
      font-size: 12px;
      color: var(--ink-faint);
      margin-bottom: 8px;
    }
    .reading-links {
      margin: 0;
      padding-left: 1.1em;
      color: var(--ink-secondary);
    }
    .reading-links li { margin: 6px 0; }
    .reading-links a {
      color: var(--primary);
      text-decoration: none;
      font-weight: 500;
    }
    .reading-links a:hover { text-decoration: underline; }
    .reading-links .link-kind {
      display: inline-block;
      margin-left: 8px;
      font-size: 12px;
      color: var(--ink-faint);
      font-weight: 400;
    }
    @media (max-width: 640px) {
      .hero-band { padding: 24px 16px 32px; }
      .wrap { padding: 24px 16px 32px; }
      .block, .post { padding: 20px 16px; }
      .bullet-item .source-badge { top: 10px; right: 0; }
      .legend { flex-direction: column; gap: 10px; }
    }
  </style>
</head>
<body>
  <header class="hero-band">
    <div class="hero-inner">
      <p class="page-label">每日总结</p>
      <h1>${escapeHtml(pageTitle)}</h1>
      <p class="page-meta">${escapeHtml(date)} · ${manifest.post_count || 0} 帖${readingLabel} · ${manifest.image_count || 0} 图</p>
    </div>
  </header>
  <div class="wrap">
    <div class="legend">
      <span class="legend-item">${renderAgentBadge('Agent 今日要点')}全天脉络</span>
      <span class="legend-item">${renderAgentBadge('Agent 信息汇总')}事实与数据</span>
      <span class="legend-item">${renderAgentBadge('Agent 解析')}背景与含义</span>
      <span class="legend-item">${renderAgentBadge('Agent 要点')}精简收束</span>
      <span class="legend-item">${renderAgentBadge('Agent 识图')}图表</span>
    </div>
    ${summary.overview ? `<div class="overview agent-block">${renderAgentBadge('Agent 今日要点')}${markdownLite(summary.overview)}</div>` : ''}
    ${readingListBlock}
    ${sections}
    <section class="posts-section">
      <h2>帖子详情</h2>
      ${postBlocks}
    </section>
  </div>
  <footer>
    <p class="footer-line">${footerLine}</p>
  </footer>
</body>
</html>`;
}

function shouldSkipSummaryPost(post, readingIds) {
  if (post?.post_kind === 'article_link') return true;
  if (readingIds?.has(String(post.id))) return true;
  return false;
}

function linkKindLabel(url) {
  if (/articles\.zsxq\.com/i.test(url)) return '星球长文';
  return '原文地址';
}

function renderReadingListSection(readingList, urlMaps) {
  if (!readingList?.length) return '';

  const items = readingList.map((item) => {
    const topicUrl = resolveTopicUrlForPost(item, urlMaps);
    const sourceBadge = topicUrl ? renderSourceBadge(topicUrl) : '';
    const links = (item.article_links?.length
      ? item.article_links
      : [{ title: item.article_title, url: item.article_url }])
      .filter((link) => link?.url);

    const linksHtml = links.map((link) => {
      const kind = linkKindLabel(link.url);
      return `<li><a href="${escapeHtml(link.url)}" target="_blank" rel="noopener">${escapeHtml(link.title || link.url)}</a><span class="link-kind">${escapeHtml(kind)}</span></li>`;
    }).join('');

    return `
      <article class="reading-item">
        ${sourceBadge}
        <time>${escapeHtml(item.published_at || '')}</time>
        <ul class="reading-links">${linksHtml}</ul>
      </article>`;
  }).join('\n');

  return `
    <section class="reading-list-block">
      <h2>待读长文</h2>
      <p class="reading-note">以下帖子仅列出完整文章链接，不做内容总结，请自行阅读。</p>
      ${items}
    </section>`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function collectAuthors(manifest, summary) {
  const posts = summary.posts?.length ? summary.posts : (manifest.posts || []);
  const seen = new Set();
  const authors = [];
  for (const post of posts) {
    const name = String(post.author || '').trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    authors.push(name);
  }
  return authors;
}

function renderFooterLine(manifest, summary, builtAt) {
  const parts = [];
  const group = String(manifest.group || '').trim();
  const authors = collectAuthors(manifest, summary);
  if (group) parts.push(`星球 ${escapeHtml(group)}`);
  if (authors.length) parts.push(`作者 ${escapeHtml(authors.join('、'))}`);
  parts.push('由 ZSXQ-AI-Explainer 每日流水线生成');
  const main = parts.join(' · ');
  return `${main}<span class="build-stamp"> · layout=notion-paper · built=${escapeHtml(builtAt)}</span>`;
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

function formatPostTime(raw) {
  const s = String(raw ?? '').trim();
  const m = s.match(/(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})/);
  if (m) return `${m[2]}-${m[3]} ${m[4]}:${m[5]}`;
  return s;
}

function renderBulletItem(bullet) {
  const { body, url } = splitSourceLink(bullet);
  return `<li class="bullet-item">${renderSourceBadge(url)}<span class="bullet-text">${markdownLite(body)}</span></li>`;
}

function sanitizeAgentProse(text) {
  let s = String(text ?? '');
  s = s.replace(/OCR\s*(进一步称|同时提醒|还称|另称|补充称|显示|提到|指出|表明)[，,：:\s]*/gi, '');
  s = s.replace(/截图\s*(OCR|识别|文字)?\s*(显示|表明|提到|指出)[，,：:\s]*/gi, '');
  s = s.replace(/图片\s*(内容)?\s*OCR\s*/gi, '');
  s = s.replace(/（?\s*来自截图[^）]*）/g, '');
  return s;
}

function markdownLite(text) {
  let s = sanitizeAgentProse(text);
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

const BADGE_DOTS = {
  'Agent 今日要点': 'sky',
  'Agent 信息汇总': 'teal',
  'Agent 解析': 'purple',
  'Agent 要点': 'green',
  'Agent 识图': 'orange',
  'Agent 图表解读': 'orange',
  'Agent 图注': 'pink',
  'Agent 章节': 'sky',
  'Agent 帖文解读': 'sky'
};

function renderAgentBadge(label = 'Agent') {
  const dot = BADGE_DOTS[label];
  const dotHtml = dot ? `<span class="badge-dot badge-dot-${dot}" aria-hidden="true"></span>` : '';
  return `<span class="badge badge-pill" title="由 Cursor Agent 生成">${dotHtml}${escapeHtml(label)}</span>`;
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
        <header class="post-header">
          <time>${escapeHtml(formatPostTime(post.published_at))}</time>
          ${sourceBadge}
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

  const readingList = collectReadingListFromManifest(manifest);
  const readingIds = new Set(readingList.map((item) => String(item.id)));
  const summarizableSummaryPosts = (summary.posts || []).filter(
    (post) => !shouldSkipSummaryPost(post, readingIds)
  );
  const summarizableManifestPosts = (manifest.posts || []).filter(
    (post) => !isArticleLinkPost(post)
  );
  const postCount = summarizableSummaryPosts.length || summarizableManifestPosts.length;
  const richPosts = summarizableSummaryPosts.filter((p) => p.facts || p.analysis || p.takeaway).length;
  console.log(`Input  manifest: ${manifestPath}`);
  console.log(`Input  summary:  ${summaryPath} (${postCount} summarized posts, ${readingList.length} reading-list, ${richPosts} with facts/analysis)`);

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
  const reportUrl = summaryReportUrl(args.date, DEFAULT_PORT);
  const lanAddrs = getLanAddresses();
  console.log(`\n浏览器打开（需先运行 local-inbox-server）：\n  ${reportUrl}`);
  if (lanAddrs.length) {
    console.log(`局域网：${lanAddrs.map((addr) => summaryReportUrl(args.date, DEFAULT_PORT, addr)).join('\n        ')}`);
  }
  console.log(`文件：${primaryHtml}`);
  console.log(`副本：${reportPath}`);
  console.log('页脚应显示 layout=notion-paper · built=...');

  if (args.open) {
    spawn('open', [reportUrl], { stdio: 'ignore', detached: true }).unref();
  }

  console.log('\nNote: this script only renders HTML. To regenerate summary content, run:');
  console.log(`  node scripts/run-summary-agent.mjs --date ${args.date}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
