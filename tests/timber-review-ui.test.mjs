import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Phase 2 Review UI. Flows are checked in a browser before each release; these guard
// the structure so a later change cannot silently bring the old controls back.
const page = fs.readFileSync(new URL('../dist/timber.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../dist/timber.html', import.meta.url), 'utf8');

test('2.1 sheets are chosen from a thumbnail strip with use %, not a dropdown', () => {
  assert.doesNotMatch(html + page, /sheet-select/);
  assert.match(html, /id="sheet-strip"[^>]*role="tablist"/);
  assert.match(page, /role="tab" class="sheet-thumb/);
  assert.match(page, /Math\.round\(s\.yield \* 100\)/);
  assert.match(page, /ArrowRight: 1/);
});
