import test from 'node:test';
import assert from 'node:assert/strict';
import { planTimber, optimizeTimber, compareTimberPlans } from '../dist/timber-planner.js';
import { timberList } from '../benchmarks/timber-lists.mjs';

// Roadmap 2.4: refill the least-used sheets into the gaps of the others. The pass keeps
// a result only when it ranks better, so it must never make a plan worse.
test('repacking never makes a plan worse, and improves some', () => {
  let better = 0;
  for (const [types, seed] of [[15, 21], [15, 22], [30, 32]]) for (const saw of ['panel', 'table', 'hybrid']) {
    const project = timberList(types, seed, saw);
    const on = planTimber(project), off = planTimber(project, { repack: false });
    assert.ok(compareTimberPlans(on, off) <= 0, `${types}/${seed} ${saw}`);
    assert.ok(on.sheets.length <= off.sheets.length && on.unplaced.length <= off.unplaced.length);
    if (compareTimberPlans(on, off) < 0) { better++; assert.equal(on.repacked, true); }
  }
  assert.ok(better >= 3, `improved ${better} of 9`);
});

test('a repacked plan is complete and still respects part priorities', () => {
  const project = timberList(30, 32, 'panel');
  project.settings.usePriorities = true;
  project.parts.forEach((p, i) => { p.priority = i % 3; });
  project.stocks[0].qty = 5; // not enough for everything: low priorities must be left out first
  const plan = planTimber(project), off = planTimber(project, { repack: false });
  assert.ok(compareTimberPlans(plan, off) <= 0);
  const placed = plan.sheets.flatMap((s) => s.parts);
  const required = project.parts.reduce((n, p) => n + p.qty, 0);
  assert.equal(placed.length + plan.unplaced.length, required);
  assert.equal(new Set(placed.map((p) => p.id)).size, placed.length);
  // Priority 0 parts are placed before any priority 1 or 2 part is.
  const missing = [0, 1, 2].map((k) => plan.unplaced.filter((p) => p.priority === k).length);
  assert.ok(plan.unplaced.length > 0, 'stock is short in this test');
  assert.equal(missing[0], 0);
});

test('Improve layout polishes its winner once at the end', async () => {
  const project = timberList(15, 22, 'hybrid');
  const on = await optimizeTimber(project, { budgetMs: 10000, maxTrials: 40 });
  const off = await optimizeTimber(project, { budgetMs: 10000, maxTrials: 40, repack: false });
  assert.ok(compareTimberPlans(on, off) <= 0);
});
