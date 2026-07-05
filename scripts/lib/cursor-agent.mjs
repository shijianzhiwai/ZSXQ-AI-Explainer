import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, '../..');

function resolveAgentBin() {
  return process.env.CURSOR_AGENT_BIN || 'agent';
}

// Transient network/TLS failures while the `agent` CLI reaches Cursor's backend
// (Wi-Fi blip, VPN reconnect, proxy hiccup, DNS glitch) — safe to retry as-is,
// unlike real agent/model errors which would just fail the same way again.
const RETRYABLE_ERROR_PATTERNS = [
  /econnreset/i,
  /etimedout/i,
  /enotfound/i,
  /eai_again/i,
  /econnrefused/i,
  /epipe/i,
  /socket disconnected/i,
  /secure tls connection/i,
  /network socket disconnected/i,
  /fetch failed/i,
  /getaddrinfo/i,
  /\[aborted\]/i
];

function isRetryableAgentError(message) {
  const text = String(message || '');
  return RETRYABLE_ERROR_PATTERNS.some((pattern) => pattern.test(text));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runCursorAgentOnce(prompt, options = {}) {
  const {
    workspace = REPO_ROOT,
    model = '',
    force = true,
    timeoutMs = Number(process.env.CURSOR_AGENT_TIMEOUT_MS || 900000)
  } = options;

  const bin = resolveAgentBin();
  const args = ['--print', '--trust', '--workspace', workspace];
  if (force) args.push('--force');
  if (model) args.push('--model', model);
  args.push('-p', prompt);

  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: workspace,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Cursor agent timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `agent exited with code ${code}`));
        return;
      }
      resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

/**
 * Run Cursor CLI agent in headless print mode.
 * Requires `agent` on PATH and an authenticated Cursor session.
 *
 * Pass `options.model` per task (summary vs vision). Omit model only when
 * you intentionally want the CLI default (composer-2.5-fast).
 *
 * Transient network/TLS errors (e.g. "socket disconnected before secure TLS
 * connection was established") are retried a few times with backoff instead of
 * failing the whole daily pipeline on a single blip. Real agent failures
 * (bad prompt, model error, non-zero exit unrelated to networking) are not
 * retried and surface immediately.
 */
export async function runCursorAgent(prompt, options = {}) {
  const maxRetries = Number(options.maxRetries ?? process.env.CURSOR_AGENT_MAX_RETRIES ?? 2);
  const retryDelayMs = Number(options.retryDelayMs ?? process.env.CURSOR_AGENT_RETRY_DELAY_MS ?? 5000);

  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await runCursorAgentOnce(prompt, options);
    } catch (error) {
      lastError = error;
      const isLastAttempt = attempt === maxRetries;
      if (isLastAttempt || !isRetryableAgentError(error.message)) {
        throw error;
      }
      const backoffMs = retryDelayMs * (attempt + 1);
      console.warn(
        `[cursor-agent] transient network error, retrying (${attempt + 1}/${maxRetries}) in ${backoffMs}ms: ${error.message}`
      );
      await delay(backoffMs);
    }
  }
  throw lastError;
}
