import test from 'node:test';
import assert from 'node:assert/strict';
import { planTimber, optimizeTimber } from '../dist/timber-planner.js';
import { timberList } from '../benchmarks/timber-lists.mjs';

// Roadmap 3.2: offcut rows in stock (e.g. from "Add to stock") are used when they save
// cutting into a new full sheet. Plans rank stock area before the number of sheets.
const withOffcuts = (types, seed) => {
  const p = timberList(types, seed, 'panel'); p.stocks[0].qty = 30;
  p.stocks.unshift({ label: 'Offcut A', material: 'Plywood', thickness: 18, length: 1200, width: 600, qty: 1 },
    { label: 'Offcut B', material: 'Plywood', thickness: 18, length: 2400, width: 400, qty: 1 },
    { label: 'Offcut C', material: 'Plywood', thickness: 18, length: 900, width: 900, qty: 1 });
  return p;
};
const fullSheets = (plan) => plan.sheets.filter((s) => s.stock.length === 2440 && s.stock.width === 1220).length;

test('offcut rows replace a new full sheet when they can', () => {
  for (const [types, seed, before] of [[6, 11, 3], [15, 21, 3], [30, 32, 8]]) {
    const plan = planTimber(withOffcuts(types, seed));
    assert.equal(plan.unplaced.length, 0);
    assert.equal(fullSheets(plan), before - 1, `${types}/${seed}`);
    assert.ok(plan.sheets.some((s) => s.stock.label.startsWith('Offcut')));
  }
});

test('Improve layout keeps the saving when it starts from the quick plan', async () => {
  const project = withOffcuts(15, 21), quick = planTimber(project);
  const best = await optimizeTimber(project, { budgetMs: 20000, maxTrials: 60, initialPlan: quick });
  assert.ok(fullSheets(best) <= fullSheets(quick));
  const area = (p) => p.sheets.reduce((n, s) => n + s.stock.length * s.stock.width, 0);
  assert.ok(area(best) <= area(quick));
});

test('an offcut that saves nothing is left in stock', () => {
  const p = timberList(6, 12, 'panel'); p.stocks[0].qty = 30; p.stocks.unshift({ label: 'Offcut', material: 'Plywood', thickness: 18, length: 300, width: 200, qty: 1 });
  assert.ok(!planTimber(p).sheets.some((s) => s.stock.label === 'Offcut'));
});
