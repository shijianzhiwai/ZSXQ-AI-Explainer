/**
 * Reflowable EPUB 3 for e-ink readers.
 * Typography is left to the device (no font, color, or background).
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { collectReadingListFromManifest } from './article-link.mjs';
import { attachTopicUrls } from './topic-url.mjs';
import { writeZip } from './zip-store.mjs';

const PARAGRAPH_TARGET = 180;
const IMAGE_EDGE = 1400;
const IMAGE_QUALITY = 72;

const IMAGE_MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp'
};

const STYLES = `body{margin:0;padding:0;line-height:1.8;}
h1{font-size:1.4em;line-height:1.35;font-weight:bold;margin:0.2em 0 0.6em;page-break-after:avoid;break-after:avoid;page-break-inside:avoid;break-inside:avoid;}
h2{font-size:1.15em;line-height:1.4;font-weight:bold;margin:1.3em 0 0.4em;page-break-after:avoid;break-after:avoid;page-break-inside:avoid;break-inside:avoid;}
h2.post{margin-top:1.8em;}
h3{font-size:1em;line-height:1.4;font-weight:bold;margin:1.1em 0 0.3em;page-break-after:avoid;break-after:avoid;page-break-inside:avoid;break-inside:avoid;}
p{margin:0.55em 0;orphans:2;widows:2;}
p.kicker{margin:0 0 0.2em;font-size:0.85em;}
p.meta{margin:0 0 0.8em;font-size:0.85em;}
ul,ol{margin:0.3em 0 0.8em;padding-left:1.2em;}
li{margin:0.35em 0;}
a{text-decoration:underline;}
figure{margin:0.9em 0 1.1em;page-break-inside:avoid;break-inside:avoid;}
img{max-width:100%;height:auto;}
figcaption{font-size:0.9em;margin-top:0.35em;}
strong{font-weight:bold;}
`;

const CONTAINER = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`;

export function xmlEscape(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sanitizeAgentProse(text) {
  let s = String(text ?? '');
  s = s.replace(/OCR\s*(进一步称|同时提醒|还称|另称|补充称|显示|提到|指出|表明)[，,：:\s]*/gi, '');
  s = s.replace(/截图\s*(OCR|识别|文字)?\s*(显示|表明|提到|指出)[，,：:\s]*/gi, '');
  s = s.replace(/图片\s*(内容)?\s*OCR\s*/gi, '');
  s = s.replace(/（?\s*来自截图[^）]*）/g, '');
  return s;
}

export function renderInline(raw) {
  const links = [];
  let s = String(raw ?? '');
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_match, label, url) => {
    const token = `\uE000${links.length}\uE001`;
    links.push(`<a href="${xmlEscape(url)}">${xmlEscape(label)}</a>`);
    return token;
  });
  s = xmlEscape(s);
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\uE000(\d+)\uE001/g, (_match, n) => links[Number(n)] ?? '');
  return s;
}

function splitSourceLinks(text) {
  let body = String(text ?? '');
  const urls = [];
  const re = /\s*\[原文\]\((https?:\/\/[^\s)]+)\)\s*$/;
  while (true) {
    const match = body.match(re);
    if (!match) break;
    urls.unshift(match[1]);
    body = body.slice(0, match.index).trimEnd();
  }
  return { body: body.trim(), urls };
}

export function toParagraphs(text) {
  const cleaned = sanitizeAgentProse(text).replace(/\r\n/g, '\n').trim();
  if (!cleaned) return [];
  const paragraphs = [];
  for (const block of cleaned.split(/\n+/)) {
    const sentences = block.split(/(?<=[。！？!?])/u).map((part) => part.trim()).filter(Boolean);
    if (!sentences.length) {
      const fallback = block.trim();
      if (fallback) paragraphs.push(fallback);
      continue;
    }
    let buf = '';
    for (const sentence of sentences) {
      if (buf && buf.length >= PARAGRAPH_TARGET) {
        paragraphs.push(buf);
        buf = sentence;
      } else {
        buf += sentence;
      }
    }
    if (buf) paragraphs.push(buf);
  }
  return paragraphs;
}

function asText(value) {
  if (Array.isArray(value)) return value.filter(Boolean).join('\n');
  return String(value ?? '');
}

function paragraphsHtml(text) {
  return toParagraphs(text).map((paragraph) => `<p>${renderInline(paragraph)}</p>`).join('\n');
}

function httpUrl(url) {
  const value = String(url || '').trim();
  return /^https?:\/\//i.test(value) ? value : '';
}

function weekdayLabel(folder) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(folder)) return String(folder || '');
  const date = new Date(`${folder}T00:00:00`);
  if (Number.isNaN(date.getTime())) return folder;
  return `${folder} 周${'日一二三四五六'[date.getDay()]}`;
}

function shortDateLabel(folder, withYear) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(folder)) return String(folder || '');
  const date = new Date(`${folder}T00:00:00`);
  const week = Number.isNaN(date.getTime()) ? '' : ` 周${'日一二三四五六'[date.getDay()]}`;
  const day = withYear ? folder : folder.slice(5);
  return `${day}${week}`;
}

function formatPostTime(raw) {
  const value = String(raw ?? '').trim();
  const match = value.match(/(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})/);
  if (match) return `${match[2]}-${match[3]} ${match[4]}:${match[5]}`;
  return value;
}

function readingItems(day) {
  const notes = new Map(
    (day.summary?.reading_list || [])
      .filter((entry) => entry?.id)
      .map((entry) => [String(entry.id), asText(entry.summary).trim()])
  );
  const fromManifest = collectReadingListFromManifest(day.manifest || {});
  if (fromManifest.length) {
    return fromManifest.map((item) => ({
      ...item,
      summary: notes.get(String(item.id)) || ''
    }));
  }
  return (day.summary?.reading_list || []).map((entry) => ({
    id: entry.id,
    topic_url: entry.topic_url || '',
    article_title: '',
    article_url: '',
    article_links: [],
    published_at: '',
    summary: asText(entry.summary).trim()
  }));
}

function selectPosts(day) {
  const readingIds = new Set(readingItems(day).map((item) => String(item.id)));
  return (day.summary?.posts || []).filter((post) => {
    if (post?.post_kind === 'article_link') return false;
    if (readingIds.has(String(post?.id))) return false;
    return true;
  });
}

function chartCopy(caption, summary) {
  if (!caption) return { caption: '', extra: summary };
  if (!summary || summary === caption) return { caption, extra: '' };
  if (summary.includes(caption)) return { caption: '', extra: summary };
  if (caption.includes(summary)) return { caption, extra: '' };
  return { caption, extra: summary };
}

function figureBlock(image, embedded) {
  const shown = chartCopy(asText(image?.caption).trim(), asText(image?.chart_summary).trim());
  if (!embedded && !shown.caption && !shown.extra) return '';
  const parts = ['<figure>'];
  if (embedded) {
    const alt = (shown.caption || shown.extra || '图表').replace(/\s+/g, ' ').slice(0, 140);
    parts.push(`<img src="../${embedded.href}" alt="${xmlEscape(alt)}"/>`);
  }
  if (shown.caption) parts.push(`<figcaption>${renderInline(shown.caption)}</figcaption>`);
  if (shown.extra) parts.push(paragraphsHtml(shown.extra));
  parts.push('</figure>');
  return parts.join('\n');
}

function renderBullet(bullet) {
  const { body, urls } = splitSourceLinks(asText(bullet));
  const links = urls.map((url) => `<a href="${xmlEscape(url)}">原文</a>`).join(' ');
  const suffix = links ? ` ${links}` : '';
  return `<li>${renderInline(body)}${suffix}</li>`;
}

function xhtmlDocument({ title, cssHref, body }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="zh-CN" lang="zh-CN">
<head>
  <meta charset="utf-8"/>
  <title>${xmlEscape(title)}</title>
  <link rel="stylesheet" type="text/css" href="${cssHref}"/>
</head>
<body epub:type="bodymatter">
${body}
</body>
</html>
`;
}

function sectionBody(section, dateLabel) {
  const facts = asText(section.facts || (!section.analysis && !section.takeaway ? section.body : '')).trim();
  const analysis = asText(section.analysis).trim();
  const takeaway = asText(section.takeaway).trim();
  const bullets = Array.isArray(section.bullets) ? section.bullets.filter((item) => asText(item).trim()) : [];
  if (!facts && !analysis && !takeaway && !bullets.length) return '';

  const parts = [
    `<p class="meta">${xmlEscape(dateLabel)}</p>`,
    `<h1>${xmlEscape(section.title || '本节')}</h1>`
  ];
  if (takeaway) parts.push('<h2>要点</h2>', paragraphsHtml(takeaway));
  if (bullets.length) parts.push('<ul>', ...bullets.map((item) => renderBullet(item)), '</ul>');
  if (facts) parts.push('<h2>信息汇总</h2>', paragraphsHtml(facts));
  if (analysis) parts.push('<h2>解析</h2>', paragraphsHtml(analysis));
  return parts.join('\n');
}

function uniqueLabels(posts) {
  const labels = posts.map((post) => {
    const time = formatPostTime(post.published_at) || '帖子';
    return time;
  });
  const counts = new Map();
  for (const label of labels) counts.set(label, (counts.get(label) || 0) + 1);
  const seen = new Map();
  return labels.map((label, index) => {
    const author = asText(posts[index].author).trim();
    const authors = new Set(posts.map((post) => asText(post.author).trim()).filter(Boolean));
    let text = label;
    if (authors.size > 1 && author) text = `${text} · ${author}`;
    if ((counts.get(label) || 0) < 2) return text;
    const n = (seen.get(label) || 0) + 1;
    seen.set(label, n);
    return `${text}（${n}）`;
  });
}

function postBody(post, label, anchor, imageMap, day) {
  const parts = [`<h2 id="${anchor}" class="post">${xmlEscape(label)}</h2>`];
  const takeaway = asText(post.takeaway).trim();
  const facts = asText(post.facts).trim();
  const analysis = asText(post.analysis).trim();
  const fallback = asText(post.summary || post.text).trim();

  if (takeaway) {
    for (const paragraph of toParagraphs(takeaway)) {
      parts.push(`<p><strong>${renderInline(paragraph)}</strong></p>`);
    }
  }
  if (facts) parts.push(paragraphsHtml(facts));
  else if (!takeaway && fallback) parts.push(paragraphsHtml(fallback));
  if (analysis) {
    if (facts || takeaway) parts.push('<h3>解析</h3>');
    parts.push(paragraphsHtml(analysis));
  }

  for (const image of post.images || []) {
    const key = imageKey(day, image?.file);
    const block = figureBlock(image, key ? imageMap.get(key) : null);
    if (block) parts.push(block);
  }

  const topic = httpUrl(post.topic_url || post.source_url);
  if (topic) parts.push(`<p><a href="${xmlEscape(topic)}">原文</a></p>`);
  return parts.join('\n');
}

function readingBody(items, dateLabel) {
  if (!items.length) return '';
  const parts = [
    `<p class="meta">${xmlEscape(dateLabel)}</p>`,
    '<h1>待读长文</h1>',
    '<p>以下为长文提要，全文从链接打开。</p>'
  ];
  for (const item of items) {
    const links = readingLinks(item);
    const title = asText(item.article_title).trim() || links[0]?.title || '长文';
    parts.push(`<h2>${xmlEscape(title)}</h2>`);
    const when = formatPostTime(item.published_at);
    if (when) parts.push(`<p class="meta">${xmlEscape(when)}</p>`);
    if (asText(item.summary).trim()) parts.push(paragraphsHtml(item.summary));
    if (links.length) {
      parts.push('<ul>');
      for (const link of links) {
        parts.push(`<li><a href="${xmlEscape(link.url)}">${xmlEscape(link.title || '原文')}</a></li>`);
      }
      parts.push('</ul>');
    }
    const topic = httpUrl(item.topic_url);
    if (topic && !links.some((link) => link.url === topic)) {
      parts.push(`<p><a href="${xmlEscape(topic)}">原帖</a></p>`);
    }
  }
  return parts.join('\n');
}

function readingLinks(item) {
  const links = (item.article_links?.length
    ? item.article_links
    : [{ title: item.article_title, url: item.article_url }]
  ).filter((link) => httpUrl(link?.url));
  if (!links.length && httpUrl(item.topic_url)) {
    return [{ title: '原文', url: item.topic_url }];
  }
  return links.map((link) => ({
    title: asText(link.title).trim() || '原文',
    url: httpUrl(link.url)
  }));
}

function overviewBody(day, dateLabel, group, postCount, readingCount) {
  const overview = asText(day.summary?.overview).trim();
  if (!overview) return '';
  const bits = [];
  if (postCount) bits.push(`${postCount} 帖`);
  if (readingCount) bits.push(`${readingCount} 篇待读`);
  const parts = [
    `<p class="kicker">${xmlEscape(group)}</p>`,
    `<h1>${xmlEscape(dateLabel)}</h1>`
  ];
  if (bits.length) parts.push(`<p class="meta">${xmlEscape(bits.join(' · '))}</p>`);
  parts.push(paragraphsHtml(overview));
  return parts.join('\n');
}

function imageKey(day, file) {
  const rel = String(file || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!rel || rel.split('/').includes('..')) return '';
  return `${day.inboxDir}\0${rel}`;
}

function resolveInside(root, rel) {
  const cleaned = String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!cleaned || cleaned.split('/').includes('..')) return '';
  const abs = path.resolve(root, cleaned);
  const base = path.resolve(root);
  if (abs !== base && !abs.startsWith(base + path.sep)) return '';
  return abs;
}

function runCommand(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: 'ignore' });
    child.on('error', () => resolve(1));
    child.on('close', (code) => resolve(code ?? 1));
  });
}

async function fileSize(filePath) {
  try {
    const stat = await fs.stat(filePath);
    return stat.size;
  } catch {
    return 0;
  }
}

async function transcodeImage(src, destJpg) {
  const code = await runCommand('sips', [
    '-s', 'format', 'jpeg',
    '-s', 'formatOptions', String(IMAGE_QUALITY),
    '-Z', String(IMAGE_EDGE),
    src,
    '--out',
    destJpg
  ]);
  if (code !== 0) return false;
  return (await fileSize(destJpg)) > 0;
}

async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      out[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return out;
}

async function prepareImages(days) {
  const jobs = [];
  const seen = new Set();
  for (const day of days) {
    if (!day.inboxDir) continue;
    for (const post of selectPosts(day)) {
      for (const image of post.images || []) {
        const key = imageKey(day, image?.file);
        if (!key || seen.has(key)) continue;
        const abs = resolveInside(day.inboxDir, image.file);
        if (!abs) continue;
        seen.add(key);
        jobs.push({ key, abs });
      }
    }
  }

  const map = new Map();
  if (!jobs.length) return { map, missing: 0 };

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'zsxq-epub-'));
  let missing = 0;
  try {
    await mapPool(jobs, 4, async (job, index) => {
      try {
        await fs.access(job.abs);
      } catch {
        missing += 1;
        return;
      }
      const stem = `img-${String(index + 1).padStart(4, '0')}`;
      const destJpg = path.join(tmp, `${stem}.jpg`);
      if (await transcodeImage(job.abs, destJpg)) {
        map.set(job.key, {
          href: `images/${stem}.jpg`,
          mediaType: 'image/jpeg',
          data: await fs.readFile(destJpg)
        });
        return;
      }
      const ext = path.extname(job.abs).toLowerCase();
      const mediaType = IMAGE_MIME[ext];
      if (!mediaType) {
        missing += 1;
        return;
      }
      const suffix = ext === '.jpeg' ? '.jpg' : ext;
      const dest = path.join(tmp, `${stem}${suffix}`);
      await fs.copyFile(job.abs, dest);
      map.set(job.key, {
        href: `images/${stem}${suffix}`,
        mediaType,
        data: await fs.readFile(dest)
      });
    });
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
  return { map, missing };
}

function idPart(folder) {
  return String(folder || 'day').replace(/[^a-zA-Z0-9]+/g, '') || 'day';
}

function composeChapters(days, imageMap) {
  const multi = days.length > 1;
  const years = new Set(
    days.map((day) => String(day.folder || '').slice(0, 4)).filter((year) => /^\d{4}$/.test(year))
  );
  const withYear = years.size > 1;
  const chapters = [];
  const nav = [];

  for (const day of days) {
    const folder = String(day.folder || 'day');
    const prefix = `d${idPart(folder)}`;
    const dateLabel = weekdayLabel(folder);
    const group = asText(day.manifest?.group).trim() || '南半球聊财经';
    const posts = selectPosts(day);
    const readings = readingItems(day);
    const dayChapters = [];

    const overview = overviewBody(day, dateLabel, group, posts.length, readings.length);
    if (overview) {
      dayChapters.push({
        id: `${prefix}-overview`,
        href: `text/${prefix}-overview.xhtml`,
        navTitle: '今日要点',
        title: dateLabel,
        body: overview
      });
    }

    (day.summary?.sections || []).forEach((section, index) => {
      const body = sectionBody(section, dateLabel);
      if (!body) return;
      const title = asText(section.title).trim() || `第 ${index + 1} 节`;
      dayChapters.push({
        id: `${prefix}-sec-${index + 1}`,
        href: `text/${prefix}-sec-${index + 1}.xhtml`,
        navTitle: title,
        title,
        body
      });
    });

    const reading = readingBody(readings, dateLabel);
    if (reading) {
      dayChapters.push({
        id: `${prefix}-reading`,
        href: `text/${prefix}-reading.xhtml`,
        navTitle: '待读长文',
        title: '待读长文',
        body: reading
      });
    }

    if (posts.length) {
      const labels = uniqueLabels(posts);
      const children = [];
      const blocks = posts.map((post, index) => {
        const anchor = `p${index + 1}`;
        children.push({
          title: labels[index],
          href: `text/${prefix}-posts.xhtml#${anchor}`
        });
        return postBody(post, labels[index], anchor, imageMap, day);
      });
      dayChapters.push({
        id: `${prefix}-posts`,
        href: `text/${prefix}-posts.xhtml`,
        navTitle: '帖子详情',
        title: '帖子详情',
        body: [
          `<p class="meta">${xmlEscape(dateLabel)}</p>`,
          '<h1>帖子详情</h1>',
          ...blocks
        ].join('\n'),
        children
      });
    }

    if (!dayChapters.length) continue;
    chapters.push(...dayChapters);

    const nodes = dayChapters.map((chapter) => ({
      title: chapter.navTitle,
      href: chapter.href,
      children: chapter.children || []
    }));
    if (multi) {
      nav.push({
        title: shortDateLabel(folder, withYear),
        href: dayChapters[0].href,
        children: nodes
      });
    } else {
      nav.push(...nodes);
    }
  }

  return { chapters, nav };
}

function bookTitle(days) {
  const group = days.map((day) => asText(day.manifest?.group).trim()).find(Boolean) || '南半球聊财经';
  const dates = days
    .map((day) => String(day.folder || ''))
    .filter((folder) => /^\d{4}-\d{2}-\d{2}$/.test(folder))
    .sort();
  if (dates.length === 1) return days.find((day) => day.folder === dates[0])?.summary?.title || `${group} · ${dates[0]}`;
  if (dates.length > 1) return `${group} · ${dates[0]} 至 ${dates[dates.length - 1]}`;
  return days[0]?.summary?.title || group;
}

function bookId(days) {
  const key = days.map((day) => day.folder).join(',');
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `urn:zsxq:${(hash >>> 0).toString(16)}`;
}

function utcStamp(date = new Date()) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function renderNav(title, nodes, firstHref) {
  const items = renderList(nodes);
  return xhtmlDocument({
    title: '目录',
    cssHref: 'styles.css',
    body: `<nav epub:type="toc" id="toc">
  <h1>目录</h1>
  ${items}
</nav>
<nav epub:type="landmarks" id="landmarks">
  <ol>
    <li><a epub:type="bodymatter" href="${xmlEscape(firstHref)}">${xmlEscape(title)}</a></li>
  </ol>
</nav>`
  });
}

function renderList(nodes) {
  if (!nodes?.length) return '<ol></ol>';
  const items = nodes.map((node) => {
    const children = node.children?.length ? `\n${renderList(node.children)}` : '';
    return `<li><a href="${xmlEscape(node.href)}">${xmlEscape(node.title)}</a>${children}</li>`;
  }).join('\n');
  return `<ol>\n${items}\n</ol>`;
}

function renderNcx(title, uid, nodes) {
  const state = { n: 0 };
  return `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${xmlEscape(uid)}"/>
    <meta name="dtb:depth" content="3"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:totalLines" content="0"/>
  </head>
  <docTitle><text>${xmlEscape(title)}</text></docTitle>
  <navMap>
${renderNavPoints(nodes, state)}
  </navMap>
</ncx>
`;
}

function renderNavPoints(nodes, state) {
  return nodes.map((node) => {
    const play = ++state.n;
    const children = node.children?.length ? `\n${renderNavPoints(node.children, state)}` : '';
    return `    <navPoint id="np${play}" playOrder="${play}">
      <navLabel><text>${xmlEscape(node.title)}</text></navLabel>
      <content src="${xmlEscape(node.href)}"/>${children}
    </navPoint>`;
  }).join('\n');
}

function renderOpf({ title, uid, creator, chapters, images }) {
  const modified = utcStamp();
  const manifest = [
    '    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>',
    '    <item id="css" href="styles.css" media-type="text/css"/>',
    ...chapters.map((chapter) => `    <item id="${chapter.id}" href="${chapter.href}" media-type="application/xhtml+xml"/>`),
    ...images.map((image, index) => `    <item id="img-${index + 1}" href="${image.href}" media-type="${image.mediaType}"/>`)
  ].join('\n');
  const spine = chapters.map((chapter) => `    <itemref idref="${chapter.id}"/>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="zh-CN">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${xmlEscape(uid)}</dc:identifier>
    <dc:title>${xmlEscape(title)}</dc:title>
    <dc:language>zh-CN</dc:language>
    <dc:creator>${xmlEscape(creator)}</dc:creator>
    <dc:publisher>ZSXQ-AI-Explainer</dc:publisher>
    <meta property="dcterms:modified">${modified}</meta>
  </metadata>
  <manifest>
${manifest}
  </manifest>
  <spine toc="ncx">
${spine}
  </spine>
</package>
`;
}

export function defaultBookTitle(days) {
  return bookTitle(days);
}

export async function listDatedSummaries(repoRoot) {
  const root = path.join(repoRoot, 'daily-inbox');
  let names = [];
  try {
    names = await fs.readdir(root);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const dates = [];
  for (const name of names) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(name)) continue;
    try {
      await fs.access(path.join(root, name, 'summary.json'));
      dates.push(name);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  dates.sort();
  return dates;
}

export async function loadInboxDay(repoRoot, folder) {
  const inboxDir = path.join(repoRoot, 'daily-inbox', folder);
  const summaryPath = path.join(inboxDir, 'summary.json');
  let summaryRaw;
  try {
    summaryRaw = await fs.readFile(summaryPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`missing ${summaryPath}`);
    throw error;
  }
  let manifest = { posts: [] };
  try {
    const manifestRaw = await fs.readFile(path.join(inboxDir, 'manifest.json'), 'utf8');
    manifest = JSON.parse(manifestRaw);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return {
    folder,
    inboxDir,
    summary: JSON.parse(summaryRaw),
    manifest: attachTopicUrls(manifest)
  };
}

/**
 * @param {string} outPath
 * @param {object[]} days reading order (newest first for a multi-day book)
 * @param {{ includeImages?: boolean }} [options]
 */
export async function writeEpub(outPath, days, options = {}) {
  if (!days?.length) throw new Error('no days to write');
  const includeImages = options.includeImages !== false;
  const prepared = includeImages ? await prepareImages(days) : { map: new Map(), missing: 0 };
  const { chapters, nav } = composeChapters(days, prepared.map);
  if (!chapters.length) throw new Error('summary has no readable chapters');

  const title = bookTitle(days);
  const uid = bookId(days);
  const creator = days.map((day) => asText(day.manifest?.group).trim()).find(Boolean) || '南半球聊财经';
  const images = [...prepared.map.values()];
  const opf = renderOpf({ title, uid, creator, chapters, images });
  const navXhtml = renderNav(title, nav, chapters[0].href);
  const ncx = renderNcx(title, uid, nav);

  const entries = [
    { name: 'mimetype', data: Buffer.from('application/epub+zip'), compress: false },
    { name: 'META-INF/container.xml', data: Buffer.from(CONTAINER), compress: true },
    { name: 'OEBPS/content.opf', data: Buffer.from(opf), compress: true },
    { name: 'OEBPS/nav.xhtml', data: Buffer.from(navXhtml), compress: true },
    { name: 'OEBPS/toc.ncx', data: Buffer.from(ncx), compress: true },
    { name: 'OEBPS/styles.css', data: Buffer.from(STYLES), compress: true },
    ...chapters.map((chapter) => ({
      name: `OEBPS/${chapter.href}`,
      data: Buffer.from(xhtmlDocument({
        title: chapter.title,
        cssHref: '../styles.css',
        body: chapter.body
      })),
      compress: true
    })),
    ...images.map((image) => ({
      name: `OEBPS/${image.href}`,
      data: image.data,
      compress: false
    }))
  ];

  await writeZip(outPath, entries);
  const stat = await fs.stat(outPath);
  return {
    outPath,
    title,
    chapters: chapters.length,
    images: images.length,
    missingImages: prepared.missing,
    bytes: stat.size
  };
}
