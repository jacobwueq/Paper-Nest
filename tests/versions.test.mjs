import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { versionsInUse } from '../scripts/set-version.mjs';

// Mixed ?v= tags let a browser keep an old copy of one module beside a new copy of
// another (two locale.js instances, for example). One version, set by the script.
test('every ?v= tag in dist matches VERSION', () => {
  const recorded = fs.readFileSync(new URL('../VERSION', import.meta.url), 'utf8').trim();
  const found = versionsInUse();
  const stray = [...found].filter(([version]) => version !== recorded).map(([version, files]) => `${version}: ${[...files].join(', ')}`);
  assert.deepEqual(stray, [], `run: node scripts/set-version.mjs ${recorded}`);
  assert.ok(found.has(recorded));
});
