import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { renderInline, toParagraphs, writeEpub, xmlEscape } from './epub-book.mjs';

const prose = '甲。'.repeat(120) + '乙。'.repeat(120) + '丙。';
const paragraphs = toParagraphs(prose);
assert.ok(paragraphs.length >= 3, `expected several paragraphs, got ${paragraphs.length}`);
assert.ok(paragraphs.every((paragraph) => paragraph.endsWith('。')));
assert.equal(paragraphs.join(''), prose);

assert.equal(xmlEscape('A & B <C>'), 'A &amp; B &lt;C&gt;');
assert.match(renderInline('增速 **4.5%** [原文](https://example.com/a?x=1&y=2)'), /<strong>4\.5%<\/strong>/);
assert.match(renderInline('见 [原文](https://example.com/a?x=1&y=2)'), /href="https:\/\/example\.com\/a\?x=1&amp;y=2"/);

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zsxq-epub-test-'));
const inbox = path.join(root, 'inbox');
await fs.mkdir(path.join(inbox, 'images'), { recursive: true });
await fs.writeFile(path.join(inbox, 'images', 'chart.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

const newer = {
  folder: '2026-10-20',
  inboxDir: inbox,
  manifest: { group: '南半球聊财经', posts: [] },
  summary: {
    title: '南半球聊财经 · 2026-10-20',
    overview: '今日主线是结构分化。工业托住总量。消费仍弱。',
    sections: [
      {
        title: '金融与股市',
        facts: 'GDP 同比 4.5% & 环比加快。出口仍强。',
        analysis: '总量和结构在打架。',
        takeaway: '记住分化，而不是单看增速。',
        bullets: [
          '三季度 GDP 同比增长 4.5%。 [原文](https://wx.zsxq.com/group/1/topic/2)'
        ]
      }
    ],
    posts: [
      {
        id: '1',
        topic_url: 'https://wx.zsxq.com/group/1/topic/2',
        author: '甲',
        published_at: '2026-10-20T21:04:00',
        facts: '图表把消费占比写到了 40.1%。',
        analysis: '比重不升反降。',
        takeaway: '规划目标和当年数据相反。',
        images: [{
          file: 'images/chart.jpg',
          caption: '消费占比',
          chart_summary: '2025 年约 40.1%，2026 年略回落。'
        }]
      }
    ],
    reading_list: []
  }
};

const older = {
  folder: '2026-10-19',
  inboxDir: path.join(root, 'empty'),
  manifest: { group: '南半球聊财经', posts: [] },
  summary: {
    overview: '前一日只保留一句要点。',
    sections: [],
    posts: [],
    reading_list: [{ id: '9', topic_url: 'https://wx.zsxq.com/group/1/topic/9', summary: '一篇待读长文的提要。' }]
  }
};

const outPath = path.join(root, 'book.epub');
const result = await writeEpub(outPath, [newer, older]);
assert.ok(result.bytes > 0);
assert.equal(result.images, 1);
assert.equal(result.title, '南半球聊财经 · 2026-10-19 至 2026-10-20');

const buf = await fs.readFile(outPath);
assert.equal(buf.readUInt32LE(0), 0x04034b50);
assert.equal(buf.readUInt16LE(8), 0, 'mimetype must be stored');
assert.equal(buf.readUInt16LE(28), 0, 'mimetype extra field must be empty');
const nameLen = buf.readUInt16LE(26);
assert.equal(buf.subarray(30, 30 + nameLen).toString(), 'mimetype');
const dataStart = 30 + nameLen;
assert.equal(buf.subarray(dataStart, dataStart + 20).toString(), 'application/epub+zip');
assert.equal(buf[dataStart + 20], 0x50);

const unzip = spawnSync('unzip', ['-t', outPath], { encoding: 'utf8' });
assert.equal(unzip.status, 0, unzip.stderr || unzip.stdout);

const extracted = path.join(root, 'unzipped');
const expand = spawnSync('unzip', ['-q', outPath, '-d', extracted], { encoding: 'utf8' });
assert.equal(expand.status, 0, expand.stderr || expand.stdout);

const nav = await fs.readFile(path.join(extracted, 'OEBPS', 'nav.xhtml'), 'utf8');
assert.match(nav, /10-20 周二/);
assert.match(nav, /金融与股市/);
assert.match(nav, /待读长文/);
const overview = await fs.readFile(path.join(extracted, 'OEBPS', 'text', 'd20261020-overview.xhtml'), 'utf8');
assert.match(overview, /2026-10-20 周二/);
assert.doesNotMatch(overview, /font-family|background\s*:/);
const section = await fs.readFile(path.join(extracted, 'OEBPS', 'text', 'd20261020-sec-1.xhtml'), 'utf8');
assert.match(section, /4\.5% &amp; 环比/);
assert.match(section, /href="https:\/\/wx\.zsxq\.com\/group\/1\/topic\/2"/);
assert.match(section, />要点</);
const css = await fs.readFile(path.join(extracted, 'OEBPS', 'styles.css'), 'utf8');
assert.doesNotMatch(css, /font-family|background|color\s*:/);
const opf = await fs.readFile(path.join(extracted, 'OEBPS', 'content.opf'), 'utf8');
assert.match(opf, /image\/jpeg/);
assert.match(opf, /properties="nav"/);

const xmlFiles = [];
for await (const file of walk(extracted)) {
  if (/\.(xhtml|opf|ncx|xml)$/.test(file)) xmlFiles.push(file);
}
const lint = spawnSync('xmllint', ['--noout', '--nonet', ...xmlFiles], { encoding: 'utf8' });
assert.equal(lint.status, 0, lint.stderr || lint.stdout);

await fs.rm(root, { recursive: true, force: true });
console.log('epub-book.test.mjs: ok');

async function* walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}
