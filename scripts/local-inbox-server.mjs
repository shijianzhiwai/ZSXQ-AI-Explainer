#!/usr/bin/env node
/**
 * Local bridge: browser extension → repo daily-inbox/
 *
 * Usage:
 *   node scripts/local-inbox-server.mjs
 *   node scripts/local-inbox-server.mjs --port 3921 --root .
 *
 * POST /inbox/daily
 * Body: { date, manifest, images: [{ file, data_url }] }
 */
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = { port: 3921, root: path.resolve(__dirname, '..') };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--port') args.port = Number(argv[++i]);
    if (argv[i] === '--root') args.root = path.resolve(argv[++i]);
  }
  return args;
}

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
      } catch (error) {
        reject(new Error('invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

const { port, root } = parseArgs(process.argv);

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, root }));
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

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error: 'not found' }));
});

server.listen(port, '127.0.0.1', () => {
  console.log(`ZSXQ inbox server listening on http://127.0.0.1:${port}`);
  console.log(`Writing to ${path.join(root, 'daily-inbox')}`);
});
