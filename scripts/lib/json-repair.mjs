/**
 * Tolerant JSON parse for LLM-written files.
 * Fixes common issues: unescaped " inside strings, trailing commas, markdown fences.
 */

function stripMarkdownFence(text) {
  const trimmed = String(text || '').trim();
  const fence = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i);
  return fence ? fence[1].trim() : trimmed;
}

function stripTrailingCommas(text) {
  return text.replace(/,(\s*[}\]])/g, '$1');
}

/**
 * Escape bare " that appear inside JSON string values.
 * A quote ends a string only when followed by optional whitespace and , } ] : or EOF.
 */
export function escapeBareQuotesInStrings(text) {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (!inString) {
      out += c;
      if (c === '"') inString = true;
      continue;
    }
    if (c === '\\') {
      out += c;
      if (i + 1 < text.length) {
        out += text[i + 1];
        i += 1;
      }
      continue;
    }
    if (c === '"') {
      const rest = text.slice(i + 1);
      if (/^\s*[,}\]:]/.test(rest) || /^\s*$/.test(rest)) {
        out += c;
        inString = false;
      } else {
        out += '\\"';
      }
      continue;
    }
    out += c;
  }
  return out;
}

export function repairJsonText(raw) {
  let text = stripMarkdownFence(raw);
  const steps = [];

  const tryParse = (candidate, label) => {
    try {
      return { ok: true, value: JSON.parse(candidate), text: candidate, steps: [...steps, label] };
    } catch (error) {
      return { ok: false, error };
    }
  };

  let attempt = tryParse(text, 'raw');
  if (attempt.ok) return attempt;

  text = stripTrailingCommas(text);
  steps.push('trailing-commas');
  attempt = tryParse(text, 'after-trailing-commas');
  if (attempt.ok) return attempt;

  text = escapeBareQuotesInStrings(text);
  steps.push('escape-bare-quotes');
  attempt = tryParse(text, 'after-escape-bare-quotes');
  if (attempt.ok) return attempt;

  text = stripTrailingCommas(text);
  steps.push('trailing-commas-again');
  attempt = tryParse(text, 'after-escape-and-trailing-commas');
  if (attempt.ok) return attempt;

  const err = attempt.error || new Error('Unable to repair JSON');
  const wrapped = new Error(`JSON repair failed: ${err.message}`);
  wrapped.cause = err;
  throw wrapped;
}

export function parseJsonTolerant(raw) {
  const repaired = repairJsonText(raw);
  return {
    value: repaired.value,
    repairedText: repaired.text,
    didRepair: repaired.steps.length > 1 || repaired.steps[0] !== 'raw',
    steps: repaired.steps
  };
}
