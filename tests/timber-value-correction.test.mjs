import test from 'node:test';
import assert from 'node:assert/strict';
import { optimizeTimber, manualCommandsFromPlan, manualTimber, compareTimberPlans } from '../dist/timber-planner.js';
import { timberList, planSignature } from '../benchmarks/timber-lists.mjs';

// Roadmap 3.1: sheet-by-sheet filling with value correction inside "Improve layout".
test('the 139-piece list drops from 18 to 17 sheets, and the plan is a valid guillotine layout', async () => {
  const project = timberList(50, 41, 'panel');
  const on = await optimizeTimber(project, { budgetMs: 20000, maxTrials: 40 });
  const off = await optimizeTimber(project, { budgetMs: 20000, maxTrials: 40, valueCorrection: false });
  assert.equal(off.sheets.length, 18); assert.equal(on.sheets.length, 17);
  assert.equal(on.method, 'value-correction'); assert.ok(compareTimberPlans(on, off) < 0);
  const ids = on.sheets.flatMap((s) => s.parts.map((p) => p.id));
  assert.equal(ids.length, 139); assert.equal(new Set(ids).size, 139); assert.equal(on.unplaced.length, 0);
  // Replaying the layout as manual placements re-checks every part against free regions.
  const replay = manualTimber(project, manualCommandsFromPlan(project, on));
  assert.equal(replay.sheets.length, 17); assert.equal(replay.unplaced.length, 0);
  for (const s of on.sheets) assert.equal(s.cuts.at(-1).step, s.cuts.length);
});

test('with a fixed number of tries it changes nothing where it cannot save a sheet', async () => {
  for (const [types, seed, saw] of [[30, 32, 'table'], [15, 22, 'hybrid']]) {
    const project = timberList(types, seed, saw);
    const on = await optimizeTimber(project, { budgetMs: 20000, maxTrials: 60 });
    const off = await optimizeTimber(project, { budgetMs: 20000, maxTrials: 60, valueCorrection: false });
    assert.equal(planSignature(on), planSignature(off), `${types}/${seed} ${saw}`);
  }
});

test('it stays out of the way when part priorities are on', async () => {
  const project = timberList(50, 41, 'panel'); project.settings.usePriorities = true;
  const plan = await optimizeTimber(project, { budgetMs: 20000, maxTrials: 30 });
  assert.equal(plan.method, undefined); assert.equal(plan.search.valueRounds, 0);
});
