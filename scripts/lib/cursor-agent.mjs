import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, '../..');

function resolveAgentBin() {
  return process.env.CURSOR_AGENT_BIN || 'agent';
}

/**
 * Run Cursor CLI agent in headless print mode.
 * Requires `agent` on PATH and an authenticated Cursor session.
 *
 * Pass `options.model` per task (summary vs vision). Omit model only when
 * you intentionally want the CLI default (composer-2.5-fast).
 */
export function runCursorAgent(prompt, options = {}) {
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
