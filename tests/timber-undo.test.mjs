import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Roadmap 1.4/1.5: every way of removing rows or adding offcuts offers Undo. The flows
// are checked in a browser before release; this guards that no path skips the notice.
const page = fs.readFileSync(new URL('../dist/timber.js', import.meta.url), 'utf8');
const body = (name) => page.slice(page.indexOf(`function ${name}(`), page.indexOf('\n}', page.indexOf(`function ${name}(`)));

test('row removal and offcuts-to-stock all go through the undo notice', () => {
  assert.match(body('removeRow'), /const before = readProject\(\)[\s\S]*notifyUndo\([\s\S]*before\)/);
  assert.match(page, /removePart\(row\) \{ removeRow\('parts', row\); \}/);
  assert.match(page, /removeRow\(type, \[\.\.\.\$\(type\)\.rows\]\.indexOf\(remove\.closest\('tr'\)\)\)/);
  assert.match(page, /p\.stocks\.push\(\.\.\.rows\)[\s\S]{0,200}notifyUndo\(/);
  // Only removeRow deletes a row element directly.
  const direct = [...page.matchAll(/rows\[[^\]]+\]\??\.remove\(\)|closest\('tr'\)\.remove\(\)/g)].map((m) => m.index);
  assert.equal(direct.length, 1); assert.ok(direct[0] > page.indexOf('function removeRow('));
  assert.match(body('notifyUndo'), /renderInputs\(snapshot\)/);
});
