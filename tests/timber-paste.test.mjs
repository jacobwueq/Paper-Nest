import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePastedParts, validateProject } from '../dist/timber-planner.js';

// Roadmap 2.5: rows pasted from a spreadsheet become part rows.
const pick = (r) => [r.label, r.length, r.width, r.qty, r.thickness];
test('rows without a header: label, the two largest numbers as size, small whole number as qty', () => {
  const { rows, skipped, header } = parsePastedParts('Side panel\t720\t450\t2\nPlinth\t80\t764\t2\nTop\t1,200\t560\t1\t12\nnot a row', { material: 'Birch ply', thickness: 15 });
  assert.equal(header, false); assert.equal(skipped, 1);
  assert.deepEqual(rows.map(pick), [['Side panel', 720, 450, 2, 15], ['Plinth', 764, 80, 2, 15], ['Top', 1200, 560, 1, 12]]);
  assert.ok(rows.every((r) => r.material === 'Birch ply' && r.priority === 1 && r.grain === false));
});

test('a header row decides the columns, in English or Chinese, with units in the names', () => {
  assert.deepEqual(parsePastedParts('Name\tQty\tLength (mm)\tWidth (mm)\tGrain\tMaterial\nDoor\t2\t700\t400\tyes\tMDF').rows.map((r) => [...pick(r), r.grain, r.material]), [['Door', 700, 400, 2, 18, true, 'MDF']]);
  assert.deepEqual(parsePastedParts('名稱\t長度\t寬度\t數量\n側板\t720 mm\t450\t2').rows.map(pick), [['側板', 720, 450, 2, 18]]);
  assert.deepEqual(parsePastedParts('Back;2;1200;600;18').rows.map(pick), [['Back', 1200, 600, 2, 18]]);
});

test('unreadable lines are skipped, never guessed', () => {
  const { rows, skipped } = parsePastedParts('hello world\nonly 12\nWidth\tLength\nA\tB');
  assert.equal(rows.length, 0); assert.ok(skipped >= 2);
  assert.equal(parsePastedParts('Name\tLength\tWidth\tQty\nBig\t30000\t400\t1\nZero\t0\t400\t1').rows.length, 0);
});

test('pasted rows make a valid project', () => {
  const { rows } = parsePastedParts('Side\t720\t450\t2\nShelf\t764\t420\t3');
  validateProject({ schema: 'paper-nest-timber-v1', name: 'p', settings: { kerf: 3.2, trim: 5, direction: 'auto', saw: 'panel', rotate: true }, stocks: [{ label: 'S', material: 'Plywood', thickness: 18, length: 2440, width: 1220, qty: 2 }], parts: rows });
});
