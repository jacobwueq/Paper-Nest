import test from 'node:test';
import assert from 'node:assert/strict';
import { planTimber, offcutStockRow, validateProject } from '../dist/timber-planner.js';

const project = (stocks) => ({ schema: 'paper-nest-timber-v1', name: 'offcuts',
  settings: { kerf: 3.2, trim: 5, direction: 'auto', saw: 'panel', rotate: true, usePriorities: false },
  stocks, parts: [{ label: 'Side', material: 'Birch ply', thickness: 12, length: 720, width: 450, qty: 2, priority: 1, grain: true }] });

// Roadmap 1.4: a reusable offcut on Review can become a stock row for the next list.
test('an offcut becomes a valid stock row of the same material, never larger than the piece', () => {
  const plan = planTimber(project([{ label: 'Sheet', material: 'Birch ply', thickness: 12, length: 2440, width: 1220, qty: 1 }]));
  const sheet = plan.sheets[0], offcut = plan.reusableOffcuts.find((o) => o.sheet === sheet.number);
  const row = offcutStockRow(sheet, offcut);
  assert.equal(row.label, `Offcut ${offcut.id}`);
  assert.deepEqual([row.material, row.thickness, row.qty], ['Birch ply', 12, 1]);
  assert.ok(row.length <= offcut.w && offcut.w - row.length < 0.1 + 1e-9);
  assert.ok(row.width <= offcut.h && offcut.h - row.width < 0.1 + 1e-9);
  assert.equal(row.length, Math.round(row.length * 10) / 10);
  // The next project can plan from it: grain along the sheet's length is kept.
  const next = project([row]); next.parts = [{ label: 'Small', material: 'Birch ply', thickness: 12, length: Math.min(300, row.length - 20), width: Math.min(100, row.width - 20), qty: 1, priority: 1, grain: true }];
  validateProject(next);
  assert.equal(planTimber(next).unplaced.length, 0);
});

test('rounding down keeps exact sizes and trims float noise', () => {
  const sheet = { stock: { material: 'MDF', thickness: 18 } };
  assert.deepEqual(offcutStockRow(sheet, { id: 'S2-W4', w: 1662.8, h: 303.6 }), { label: 'Offcut S2-W4', material: 'MDF', thickness: 18, length: 1662.8, width: 303.6, qty: 1 });
  assert.equal(offcutStockRow(sheet, { id: 'S1-W1', w: 499.99999999, h: 120.06 }).length, 500);
  assert.equal(offcutStockRow(sheet, { id: 'S1-W1', w: 499.99, h: 120.06 }).width, 120);
});
