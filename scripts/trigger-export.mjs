#!/usr/bin/env node
/**
 * Trigger incremental export via local inbox WebSocket.
 *
 * Usage:
 *   node scripts/trigger-export.mjs
 *   node scripts/trigger-export.mjs --no-reload
 *   node scripts/trigger-export.mjs --url http://192.168.1.10:3921
 */
import { DEFAULT_PORT } from './local-inbox-server.mjs';

function parseArgs(argv) {
  const args = {
    url: `http://127.0.0.1:${DEFAULT_PORT}`,
    reload: true,
    wait: true,
    timeoutMs: 300_000
  };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--url') args.url = argv[++i];
    if (argv[i] === '--no-reload') args.reload = false;
    if (argv[i] === '--no-wait') args.wait = false;
    if (argv[i] === '--timeout') args.timeoutMs = Number(argv[++i]);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const base = args.url.replace(/\/$/, '');
  const response = await fetch(`${base}/export/trigger`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      reload: args.reload,
      wait: args.wait,
      timeout_ms: args.timeoutMs
    })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error(body.error || response.statusText);
    process.exit(1);
  }
  console.log(JSON.stringify(body, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
