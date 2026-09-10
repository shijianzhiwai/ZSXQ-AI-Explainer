/**
 * Full snapshot of daily-inbox/ + summaries/ into iCloud Drive.
 * Keep the newest N packages (default 2).
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { todayDateString } from './inbox-slug.mjs';

export const BACKUP_ZIP_PREFIX = 'zsxq-daily-';
const DATE_FOLDER_RE = /^\d{4}-\d{2}-\d{2}$/;
const BACKUP_ZIP_RE = /^zsxq-daily-(\d{4}-\d{2}-\d{2})\.zip$/;
const DEFAULT_KEEP_DAYS = 2;
const ICLOUD_DRIVE_REL = path.join('Library', 'Mobile Documents', 'com~apple~CloudDocs');
const DEFAULT_BACKUP_FOLDER = 'ZSXQ-AI-Explainer';

function isFalsyEnv(value) {
  const v = String(value ?? '').trim().toLowerCase();
  return v === '0' || v === 'false' || v === 'no' || v === 'off';
}

export function defaultIcloudDriveDir(home = os.homedir()) {
  return path.join(home, ICLOUD_DRIVE_REL);
}

export function resolveBackupConfig({
  env = process.env,
  home = os.homedir()
} = {}) {
  const keepRaw = Number(env.BACKUP_KEEP_DAYS);
  const keepDays = Number.isFinite(keepRaw) && keepRaw >= 1
    ? Math.floor(keepRaw)
    : DEFAULT_KEEP_DAYS;
  const customDir = String(env.ICLOUD_BACKUP_DIR || '').trim();
  return {
    enabled: !isFalsyEnv(env.ICLOUD_BACKUP),
    dir: customDir || path.join(defaultIcloudDriveDir(home), DEFAULT_BACKUP_FOLDER),
    keepDays,
    usesDefaultIcloud: !customDir
  };
}

function runZip(cwd, destZip, entries) {
  return new Promise((resolve, reject) => {
    const child = spawn('zip', ['-r', '-q', destZip, ...entries], {
      cwd,
      stdio: 'inherit'
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`zip failed (${code})`));
    });
  });
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function unlinkQuiet(filePath) {
  if (!filePath) return;
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

export async function pruneOldBackups(dir, keepDays = DEFAULT_KEEP_DAYS) {
  let names;
  try {
    names = await fs.readdir(dir);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  const zips = names.filter((name) => BACKUP_ZIP_RE.test(name)).sort().reverse();
  const dropped = zips.slice(Math.max(1, keepDays));
  for (const name of dropped) {
    await unlinkQuiet(path.join(dir, name));
  }
  return dropped;
}

/**
 * @param {object} options
 * @param {string} options.root repo root
 * @param {string} [options.date] snapshot label YYYY-MM-DD (default: today)
 * @returns {Promise<{ skipped: true, reason: string } | { skipped?: false, date: string, destPath: string, bytes: number, pruned: string[] }>}
 */
export async function backupDailyArtifacts({
  root,
  date,
  env = process.env,
  home = os.homedir()
}) {
  const stamp = String(date || '').trim();
  if (stamp && !DATE_FOLDER_RE.test(stamp)) {
    throw new Error(`backup date must be YYYY-MM-DD, got "${stamp}"`);
  }

  const config = resolveBackupConfig({ env, home });
  if (!config.enabled) {
    return { skipped: true, reason: 'ICLOUD_BACKUP=0' };
  }

  if (config.usesDefaultIcloud) {
    const cloudDocs = defaultIcloudDriveDir(home);
    if (!(await pathExists(cloudDocs))) {
      return { skipped: true, reason: `iCloud Drive not found: ${cloudDocs}` };
    }
  }

  const entries = [];
  if (await pathExists(path.join(root, 'daily-inbox'))) entries.push('daily-inbox');
  if (await pathExists(path.join(root, 'summaries'))) entries.push('summaries');
  if (!entries.length) {
    return { skipped: true, reason: 'missing daily-inbox/ and summaries/' };
  }

  const folder = stamp || todayDateString();

  await fs.mkdir(config.dir, { recursive: true });

  const destPath = path.join(config.dir, `${BACKUP_ZIP_PREFIX}${folder}.zip`);
  const tmpZip = path.join(
    os.tmpdir(),
    `${BACKUP_ZIP_PREFIX}${folder}-${process.pid}-${Date.now()}.zip`
  );

  try {
    await runZip(root, tmpZip, entries);
    await fs.copyFile(tmpZip, destPath);
  } finally {
    await unlinkQuiet(tmpZip);
  }

  const stat = await fs.stat(destPath);
  const pruned = await pruneOldBackups(config.dir, config.keepDays);
  return {
    date: folder,
    destPath,
    bytes: stat.size,
    pruned
  };
}
