import './load-env.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Agent, CursorAgentError } from '@cursor/sdk';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, '../..');

const DEFAULT_MODEL = 'composer-2.5';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveApiKey() {
  return String(process.env.CURSOR_API_KEY || '').trim();
}

function resolveModelId(model) {
  return String(model || '').trim() || DEFAULT_MODEL;
}

function statusValue(status) {
  if (status != null && typeof status === 'object' && 'value' in status) {
    return String(status.value).toLowerCase();
  }
  return String(status || '').toLowerCase();
}

function isFinishedStatus(status) {
  return ['finished', 'success', 'completed', 'ok'].includes(statusValue(status));
}

function resultStdout(result) {
  const text = result?.result;
  return text == null ? '' : String(text).trim();
}

function isRetryableAgentError(error) {
  if (error instanceof CursorAgentError && error.isRetryable) return true;
  const text = String(error?.message || '');
  return /econnreset|etimedout|enotfound|eai_again|econnrefused|epipe|socket disconnected|secure tls connection|network socket disconnected|fetch failed|getaddrinfo|\[aborted\]/i.test(text);
}

async function disposeAgent(agent) {
  if (!agent) return;
  if (typeof agent[Symbol.asyncDispose] === 'function') {
    await agent[Symbol.asyncDispose]();
    return;
  }
  if (typeof agent.close === 'function') {
    await agent.close();
  }
}

async function waitWithTimeout(run, timeoutMs) {
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    if (typeof run.cancel === 'function') {
      Promise.resolve(run.cancel()).catch(() => {});
    }
  }, timeoutMs);

  try {
    const result = await run.wait();
    if (timedOut || statusValue(result.status) === 'cancelled') {
      throw new Error(`Cursor agent timed out after ${timeoutMs}ms`);
    }
    return result;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One-shot local Cursor SDK agent.
 * Requires CURSOR_API_KEY. Local runtime writes files in `workspace`.
 */
async function runCursorAgentOnce(prompt, options = {}) {
  const {
    workspace = REPO_ROOT,
    model = '',
    timeoutMs = Number(process.env.CURSOR_AGENT_TIMEOUT_MS || 900000)
  } = options;

  const apiKey = resolveApiKey();
  if (!apiKey) {
    throw new Error('missing CURSOR_API_KEY');
  }

  const modelId = resolveModelId(model);
  const cwd = path.resolve(workspace);
  let agent;

  try {
    agent = await Agent.create({
      apiKey,
      model: { id: modelId },
      local: { cwd }
    });

    const run = await agent.send(prompt);
    console.log(`[cursor-sdk] run_id=${run.id} agent_id=${run.agentId} model=${modelId}`);

    const result = await waitWithTimeout(run, timeoutMs);
    if (!isFinishedStatus(result.status)) {
      const detail = result.error?.message || `run status=${result.status}`;
      throw new Error(detail);
    }

    return {
      stdout: resultStdout(result),
      stderr: '',
      runId: result.id,
      status: result.status
    };
  } catch (error) {
    if (error instanceof CursorAgentError) {
      const wrapped = new Error(`startup: ${error.message}`);
      wrapped.cause = error;
      wrapped.isRetryable = Boolean(error.isRetryable);
      throw wrapped;
    }
    throw error;
  } finally {
    await disposeAgent(agent);
  }
}

/**
 * Run a one-shot local Cursor agent via @cursor/sdk.
 *
 * Pass `options.model` per task (summary vs vision). Empty model falls back to composer-2.5.
 * Startup/network failures marked retryable by the SDK are retried with backoff.
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
      const retryable = error.isRetryable === true || isRetryableAgentError(error);
      const isLastAttempt = attempt === maxRetries;
      if (isLastAttempt || !retryable) {
        throw error;
      }
      const backoffMs = retryDelayMs * (attempt + 1);
      console.warn(
        `[cursor-sdk] retryable error, retrying (${attempt + 1}/${maxRetries}) in ${backoffMs}ms: ${error.message}`
      );
      await delay(backoffMs);
    }
  }
  throw lastError;
}
