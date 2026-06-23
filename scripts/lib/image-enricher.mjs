import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const OCR_SCRIPT = path.resolve(__dirname, '../ocr/paddle_ocr.py');
let cachedOcrResults = null;

function resolvePaddlePython() {
  if (process.env.PADDLE_OCR_PYTHON) return process.env.PADDLE_OCR_PYTHON;
  const venvPython = path.join(REPO_ROOT, '.venv', 'bin', 'python');
  if (fs.existsSync(venvPython)) return venvPython;
  return 'python3';
}

const CHART_KEYWORD_RE = /\b(ETF|GDP|Source:|Chart by|Y-Axis|X-Axis|Powered by|rebased|Total Return|clearance rate|holdings|Surprise|ratio|Exhibit|MSCI|Stoxx|S&P|RHS|LHS|PPP|OECD|LSEG|Datastream|Treasury|Auction|outlays|Economic)\b/i;
const CHART_TITLE_RE = /图表\s*\d*|^图\s*\d+/m;

function hasNumericSignal(text) {
  return /[%％]|\d+\.\d+|\d{2,}/.test(text || '');
}

function analyzeOcrText(text) {
  const lines = text.split(/\n/).map((line) => line.trim()).filter(Boolean);
  const chars = text.replace(/\s/g, '');
  const zhCount = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const zhRatio = zhCount / (chars.length || 1);
  const shortLines = lines.filter((line) => line.length <= 12).length;
  const shortLineRatio = lines.length ? shortLines / lines.length : 0;
  const numOnlyLines = lines.filter((line) => /^[-+]?\d+(\.\d+)?%?$/.test(line) || /^\d{2}$/.test(line)).length;
  const axisLike = lines.filter((line) => (
    /^\d{2,4}$/.test(line)
    || /^\d{2}-\d{4}$/.test(line)
    || /^[A-Z][a-z]{2} '?\d{2}$/.test(line)
  )).length;
  const sentenceLike = lines.filter((line) => line.length > 40 && /[。，；：]/.test(line)).length;
  const avgLineLen = lines.length
    ? lines.reduce((sum, line) => sum + line.length, 0) / lines.length
    : 0;

  return {
    lines,
    zhCount,
    zhRatio,
    shortLineRatio,
    numOnlyLines,
    axisLike,
    sentenceLike,
    avgLineLen,
    hasChartKw: CHART_KEYWORD_RE.test(text)
  };
}

function scoreChartByOcr(text, feat = analyzeOcrText(text)) {
  let score = 0;
  const reasons = [];

  if (feat.shortLineRatio >= 0.65) {
    score += 2;
    reasons.push('short_lines');
  }
  if (feat.avgLineLen <= 15) {
    score += 2;
    reasons.push('avg_line_short');
  }
  if (feat.numOnlyLines >= 5) {
    score += 2;
    reasons.push('num_only_lines');
  }
  if (feat.axisLike >= 4) {
    score += 2;
    reasons.push('axis_ticks');
  }
  if (feat.hasChartKw) {
    score += 2;
    reasons.push('chart_kw');
  }
  if (feat.sentenceLike === 0 && feat.zhRatio < 0.25) {
    score += 1;
    reasons.push('no_prose');
  }
  if (feat.zhRatio >= 0.35 && feat.avgLineLen >= 18) {
    score -= 4;
    reasons.push('chinese_prose');
  }
  if (feat.sentenceLike >= 2) {
    score -= 3;
    reasons.push('sentences');
  }
  if (feat.zhCount >= 80) {
    score -= 5;
    reasons.push('zh_count');
  }

  return { score, reasons, feat };
}

function chartClassification(reason) {
  return {
    image_kind: 'chart',
    reason,
    include_in_summary: true,
    needs_vision: true,
    vision_task: 'chart_summary'
  };
}

function pendingVisionClassification(reason) {
  return {
    image_kind: 'pending_vision',
    reason,
    include_in_summary: false,
    needs_vision: true,
    vision_task: 'classify'
  };
}

export function classifyByOcr(ocr) {
  const text = (ocr?.text || '').trim();
  const charCount = text.length;
  const confidence = Number(ocr?.confidence || 0);

  if (!charCount) {
    return pendingVisionClassification('ocr_empty');
  }

  if (CHART_TITLE_RE.test(text)) {
    return chartClassification('ocr_chart_title');
  }

  const { score, reasons, feat } = scoreChartByOcr(text);
  if (score >= 7) {
    return chartClassification(`ocr_chart_heuristic:${reasons.join('+')}`);
  }

  if (feat.zhCount >= 80 && feat.avgLineLen >= 18) {
    return { image_kind: 'text', reason: 'ocr_long_text', include_in_summary: true };
  }
  if (feat.zhRatio >= 0.35 && charCount >= 80) {
    return { image_kind: 'text', reason: 'ocr_long_text', include_in_summary: true };
  }
  if (feat.zhRatio >= 0.35 && charCount >= 30 && confidence >= 0.75) {
    return { image_kind: 'text', reason: 'ocr_medium_text', include_in_summary: true };
  }
  if (feat.sentenceLike >= 2) {
    return { image_kind: 'text', reason: 'ocr_prose', include_in_summary: true };
  }

  if (charCount >= 15 && feat.zhRatio >= 0.15 && hasNumericSignal(text)) {
    return chartClassification('ocr_partial_chart');
  }

  if (charCount < 15) {
    return pendingVisionClassification('ocr_too_short');
  }

  return pendingVisionClassification('ocr_ambiguous');
}

export async function preloadPaddleOcr(imagePaths) {
  if (!imagePaths.length) {
    cachedOcrResults = {};
    return cachedOcrResults;
  }

  const python = resolvePaddlePython();
  cachedOcrResults = await new Promise((resolve, reject) => {
    const child = spawn(python, [OCR_SCRIPT, '--batch'], {
      env: { ...process.env, PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK: 'True' }
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `batch OCR exited with code ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim()));
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.write(JSON.stringify(imagePaths));
    child.stdin.end();
  });

  return cachedOcrResults;
}

export async function runPaddleOcr(imagePath) {
  if (cachedOcrResults && cachedOcrResults[imagePath]) {
    return cachedOcrResults[imagePath];
  }
  const python = resolvePaddlePython();
  try {
    const { stdout } = await execFileAsync(python, [OCR_SCRIPT, imagePath], {
      timeout: Number(process.env.PADDLE_OCR_TIMEOUT_MS || 120000),
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK: 'True' }
    });
    const parsed = JSON.parse(stdout.trim());
    if (!parsed.ok) {
      return { ok: false, text: '', confidence: 0, error: parsed.error || 'ocr failed' };
    }
    return { ok: true, ...parsed };
  } catch (error) {
    return { ok: false, text: '', confidence: 0, error: error.message };
  }
}

/** OCR only — vision/chart summary via local Cursor agent CLI */
export async function enrichImage({ imagePath, ocrEnabled = true }) {
  const ocr = ocrEnabled
    ? await runPaddleOcr(imagePath)
    : { ok: false, text: '', confidence: 0 };

  const classification = classifyByOcr(ocr);
  const ocrText = (ocr.text || '').trim();

  const result = {
    ocr_text: classification.image_kind === 'text' ? ocrText : (ocrText || ''),
    ocr_confidence: ocr.confidence || 0,
    chart_summary: '',
    image_kind: classification.image_kind,
    include_in_summary: classification.include_in_summary,
    needs_vision: Boolean(classification.needs_vision),
    vision_task: classification.vision_task || null,
    enrich_source: 'paddleocr',
    ocr_reason: classification.reason
  };

  if (classification.image_kind === 'text') {
    result.needs_vision = false;
    result.vision_task = null;
  }

  if (!ocr.ok && ocr.error) {
    result.ocr_error = ocr.error;
  }

  return result;
}
