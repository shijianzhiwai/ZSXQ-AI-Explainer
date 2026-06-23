import fs from 'node:fs/promises';
import path from 'node:path';

function getVisionConfig() {
  const apiKey = process.env.VISION_API_KEY
    || process.env.OPENAI_API_KEY
    || process.env.DEEPSEEK_API_KEY
    || '';
  const baseUrl = (process.env.VISION_BASE_URL
    || process.env.OPENAI_BASE_URL
    || 'https://api.openai.com/v1').replace(/\/$/, '');
  const model = process.env.VISION_MODEL || 'gpt-4o-mini';
  return { apiKey, baseUrl, model };
}

async function imageToDataUrl(imagePath) {
  const buffer = await fs.readFile(imagePath);
  const ext = path.extname(imagePath).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

export async function callVisionJson({ imagePath, prompt, maxTokens = 500 }) {
  const { apiKey, baseUrl, model } = getVisionConfig();
  if (!apiKey) {
    throw new Error('Set VISION_API_KEY or OPENAI_API_KEY for vision enrichment');
  }

  const dataUrl = await imageToDataUrl(imagePath);
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: dataUrl } }
        ]
      }]
    })
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Vision API ${response.status}: ${body || response.statusText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '{}';
  return JSON.parse(content);
}

export function hasVisionConfig() {
  return Boolean(
    process.env.VISION_API_KEY
    || process.env.OPENAI_API_KEY
    || process.env.DEEPSEEK_API_KEY
  );
}
