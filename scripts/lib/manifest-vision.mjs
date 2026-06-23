import fs from 'node:fs/promises';
import path from 'node:path';

const VALID_KINDS = new Set(['text', 'chart', 'photo']);

export function collectVisionTasks(manifest, { limit = 0, offset = 0 } = {}) {
  const tasks = [];
  for (const post of manifest.posts || []) {
    for (const image of post.images || []) {
      if (!image.needs_vision) continue;
      tasks.push({
        post_id: post.id,
        image_id: image.id,
        file: image.file,
        vision_task: image.vision_task || 'classify',
        image_kind: image.image_kind || 'pending_vision',
        ocr_text: image.ocr_text || '',
        ocr_confidence: image.ocr_confidence ?? 0,
        ocr_reason: image.ocr_reason || null
      });
    }
  }

  tasks.sort((a, b) => {
    const rank = (task) => (task.vision_task === 'chart_summary' ? 0 : 1);
    const diff = rank(a) - rank(b);
    if (diff !== 0) return diff;
    return String(a.image_id).localeCompare(String(b.image_id));
  });

  if (offset > 0) return tasks.slice(offset, limit > 0 ? offset + limit : undefined);
  if (limit > 0) return tasks.slice(0, limit);
  return tasks;
}

export function applyVisionResult(image, result) {
  const kind = result.image_kind;
  if (!VALID_KINDS.has(kind)) {
    throw new Error(`Invalid image_kind for ${result.image_id}: ${kind}`);
  }

  image.image_kind = kind;
  image.needs_vision = false;
  image.vision_task = null;
  image.enrich_source = 'cursor_agent';

  if (typeof result.include_in_summary === 'boolean') {
    image.include_in_summary = result.include_in_summary;
  } else {
    image.include_in_summary = kind !== 'photo';
  }

  if (kind === 'text' && result.ocr_text) {
    image.ocr_text = result.ocr_text;
  } else if (result.ocr_text && !image.ocr_text) {
    image.ocr_text = result.ocr_text;
  }

  if (kind === 'chart') {
    image.chart_summary = (result.chart_summary || '').trim();
    if (!image.chart_summary) {
      throw new Error(`chart_summary required for chart image ${result.image_id}`);
    }
  } else if (result.chart_summary) {
    image.chart_summary = result.chart_summary;
  }

  if (result.notes) image.vision_notes = result.notes;
}

export function applyVisionResults(manifest, results) {
  const byId = new Map();
  for (const post of manifest.posts || []) {
    for (const image of post.images || []) {
      byId.set(image.id, image);
    }
  }

  const applied = [];
  const errors = [];

  for (const result of results) {
    const image = byId.get(result.image_id);
    if (!image) {
      errors.push({ image_id: result.image_id, error: 'image_not_found' });
      continue;
    }
    try {
      applyVisionResult(image, result);
      applied.push(result.image_id);
    } catch (error) {
      errors.push({ image_id: result.image_id, error: error.message });
    }
  }

  const remaining = collectVisionTasks(manifest).length;
  manifest.image_enrichment = {
    ...(manifest.image_enrichment || {}),
    vision_applied_at: new Date().toISOString(),
    vision_remaining: remaining
  };

  return { applied, errors, remaining };
}

export async function loadManifest(manifestPath) {
  const raw = await fs.readFile(manifestPath, 'utf8');
  return JSON.parse(raw);
}

export async function saveManifest(manifestPath, manifest) {
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
}

export function resolveInboxPaths(repoRoot, date) {
  const inboxDir = path.join(repoRoot, 'daily-inbox', date);
  return {
    inboxDir,
    manifestPath: path.join(inboxDir, 'manifest.json'),
    visionResultsPath: path.join(inboxDir, 'vision-results.json'),
    visionTasksPath: path.join(inboxDir, 'vision-tasks.json')
  };
}
