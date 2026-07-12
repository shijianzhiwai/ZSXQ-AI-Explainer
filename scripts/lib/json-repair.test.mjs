import assert from 'node:assert/strict';
import { escapeBareQuotesInStrings, parseJsonTolerant, repairJsonText } from './json-repair.mjs';

const broken = `{
  "date": "2026-07-10",
  "results": [
    {
      "image_id": "14422155214225122-1",
      "image_kind": "text",
      "ocr_text": "UBS中国经济周报：提及监管整顿"取得阶段性进展"，或暗示收紧期接近尾声",
      "include_in_summary": true
    }
  ]
}`;

assert.throws(() => JSON.parse(broken));

const repaired = repairJsonText(broken);
assert.equal(repaired.value.results[0].ocr_text.includes('取得阶段性进展'), true);
assert.equal(repaired.value.results[0].ocr_text.includes('"'), true);

const escaped = escapeBareQuotesInStrings(broken);
assert.match(escaped, /整顿\\"取得阶段性进展\\"/);

const withFence = '```json\n{"a":1,}\n```';
const fenced = parseJsonTolerant(withFence);
assert.deepEqual(fenced.value, { a: 1 });
assert.equal(fenced.didRepair, true);

const clean = parseJsonTolerant('{"ok":true}');
assert.equal(clean.didRepair, false);
assert.deepEqual(clean.value, { ok: true });

console.log('json-repair.test.mjs: ok');
