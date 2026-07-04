#!/usr/bin/env node
/**
 * Backfill missing daily summaries.
 *
 * Re-exports posts since a chosen start point, splits them into per-day inbox
 * folders, then runs the pipeline (OCR → vision → summary → HTML) for each day.
 *
 * Prerequisites:
 *   - node scripts/local-inbox-server.mjs   (running, extension connected)
 *   - Chrome extension loaded (>= 0.9.8) and logged into wx.zsxq.com
 *
 * Usage:
 *   node scripts/backfill-summaries.mjs
 *   node scripts/backfill-summaries.mjs --since 2026-06-27       # skip prompt, force date
 *   node scripts/backfill-summaries.mjs --url http://192.168.1.10:3921
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PORT } from './local-inbox-server.mjs';
import { runDailyPipeline } from './lib/run-daily-pipeline.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MIN_EXTENSION_VERSION = '0.9.8';

function compareVersion(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// 确认连接的扩展已是支持 since/分桶 的版本，否则会静默回退成旧增量逻辑
async function assertExtensionReady(baseUrl) {
  const response = await fetch(`${baseUrl}/export/status`).catch(() => null);
  if (!response || !response.ok) {
    throw new Error('无法连接 inbox 服务，请先运行 node scripts/local-inbox-server.mjs');
  }
  const status = await response.json().catch(() => ({}));
  if (!status.extension_clients) {
    throw new Error('没有扩展连接到 WebSocket，请在 chrome://extensions 加载/重载扩展并打开 wx.zsxq.com');
  }
  const versions = status.extension_versions || [];
  const ok = versions.some((v) => v && compareVersion(v, MIN_EXTENSION_VERSION) >= 0);
  if (!ok) {
    const seen = versions.map((v) => v || '未知').join(', ') || '未知';
    throw new Error(
      `扩展版本过低（当前：${seen}，需 >= ${MIN_EXTENSION_VERSION}）。\n` +
      `请在 chrome://extensions 点「重新加载」，确认版本变为 ${MIN_EXTENSION_VERSION} 后重试。`
    );
  }
}

function parseArgs(argv) {
  const args = {
    url: `http://127.0.0.1:${DEFAULT_PORT}`,
    since: '',
    maxPosts: 200,
    timeoutMs: 600_000
  };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--url') args.url = argv[++i];
    if (argv[i] === '--since') args.since = argv[++i];
    if (argv[i] === '--max-posts') args.maxPosts = Number(argv[++i]);
    if (argv[i] === '--timeout') args.timeoutMs = Number(argv[++i]);
  }
  return args;
}

async function findLatestSummarizedFolder() {
  const root = path.join(REPO_ROOT, 'daily-inbox');
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return null;
  }
  const dates = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !DATE_RE.test(entry.name)) continue;
    try {
      await fs.access(path.join(root, entry.name, 'summary.json'));
      dates.push(entry.name);
    } catch {
      // no summary yet
    }
  }
  dates.sort();
  return dates.at(-1) || null;
}

async function readLastEvent(date) {
  try {
    const manifest = JSON.parse(
      await fs.readFile(path.join(REPO_ROOT, 'daily-inbox', date, 'manifest.json'), 'utf8')
    );
    if (manifest.checkpoint_after) return manifest.checkpoint_after;
    const newest = (manifest.posts || [])
      .map((post) => post.published_at)
      .filter(Boolean)
      .map((value) => Date.parse(value))
      .filter((value) => !Number.isNaN(value))
      .sort((a, b) => b - a)[0];
    return newest ? new Date(newest).toISOString() : null;
  } catch {
    return null;
  }
}

function dateToLocalMidnightIso(dateStr) {
  const iso = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(iso.getTime())) throw new Error(`invalid date: ${dateStr}`);
  return iso.toISOString();
}

async function resolveSince(args) {
  if (args.since) {
    return { sinceIso: dateToLocalMidnightIso(args.since), label: `${args.since} 00:00 (--since)` };
  }

  const latest = await findLatestSummarizedFolder();
  const lastEvent = latest ? await readLastEvent(latest) : null;

  console.log('\n最新已有总结：' + (latest || '（无）'));
  console.log('最后一条事件：' + (lastEvent || '（无法读取）'));
  console.log('\n请选择补总结的导出起点：');
  console.log('  A) 从最新总结的最后一条事件继续' + (lastEvent ? `（${lastEvent}）` : '（不可用）'));
  console.log('  B) 强制从指定日期 00:00 开始');

  const rl = readline.createInterface({ input, output });
  try {
    const choice = (await rl.question('选择 [A/B]（默认 A）: ')).trim().toUpperCase() || 'A';

    if (choice === 'A') {
      if (!lastEvent) throw new Error('无法读取最新总结的最后事件，请用 B 或 --since 指定日期');
      return { sinceIso: lastEvent, label: `${latest} 最后事件之后` };
    }

    const defaultDate = '2026-06-27';
    const answer = (await rl.question(`从哪天 00:00 开始？(YYYY-MM-DD，默认 ${defaultDate}): `)).trim() || defaultDate;
    if (!DATE_RE.test(answer)) throw new Error(`日期格式应为 YYYY-MM-DD，收到：${answer}`);
    return { sinceIso: dateToLocalMidnightIso(answer), label: `${answer} 00:00` };
  } finally {
    rl.close();
  }
}

async function triggerBucketedExport(args, sinceIso) {
  const base = args.url.replace(/\/$/, '');
  const response = await fetch(`${base}/export/trigger`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      since: sinceIso,
      bucket_by_date: true,
      max_posts: args.maxPosts,
      reload: true,
      wait: true,
      timeout_ms: args.timeoutMs
    })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || response.statusText);
  }
  const dates = body.data?.dates;
  if (!Array.isArray(dates) || dates.length === 0) {
    throw new Error(`export returned no per-day buckets: ${JSON.stringify(body.data)}`);
  }
  return dates;
}

async function main() {
  const args = parseArgs(process.argv);
  const base = args.url.replace(/\/$/, '');
  await assertExtensionReady(base);

  const { sinceIso, label } = await resolveSince(args);

  console.log(`\n导出起点：${label}`);
  console.log(`起点 ISO：${sinceIso}`);
  console.log(`Server：${args.url}\n`);

  console.log('→ 触发按日期分桶导出…');
  const dates = await triggerBucketedExport(args, sinceIso);
  console.log('已导出日期：');
  for (const d of dates) {
    console.log(`  ${d.date}: ${d.post_count} 帖，${d.image_count} 图`);
  }

  for (const { date } of dates) {
    console.log(`\n================ 补总结 ${date} ================`);
    const result = await runDailyPipeline(date);
    console.log(`完成 ${date} → ${result.reportUrl}`);
  }

  console.log('\n全部补总结完成：');
  for (const { date } of dates) {
    console.log(`  summaries/${date}.html`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
