import test from 'node:test';
import assert from 'node:assert/strict';
import { planTimber, optimizeTimber } from '../dist/timber-planner.js';
import { timberList, planSignature } from '../benchmarks/timber-lists.mjs';

// Roadmap 1.1: layouts already worse on unplaced parts, sheets or stock area skip cut
// ordering. That may only save time; the chosen plan must not change.
test('quick plan: pruning gives the identical plan on every saw', () => {
  for (const [types, seed] of [[6, 12], [15, 21], [30, 32]]) for (const saw of ['panel', 'table', 'hybrid']) {
    const project = timberList(types, seed, saw);
    const fast = planTimber(project), full = planTimber(project, { pruning: false });
    assert.equal(planSignature(fast), planSignature(full), `${types}/${seed} ${saw}`);
    assert.equal(fast.fitness.cutCount, full.fitness.cutCount);
    assert.equal(full.search.pruned, 0);
  }
  assert.ok(planTimber(timberList(30, 32, 'panel')).search.pruned > 0, 'some layouts are pruned');
});

test('evolving search: pruning keeps the same parents and the same result', async () => {
  // 70 tries reach the part of the search that picks parents from the best eight.
  const project = timberList(15, 22, 'hybrid');
  const run = (pruning) => optimizeTimber(project, { budgetMs: 10000, maxTrials: 70, pruning });
  const [fast, full] = [await run(true), await run(false)];
  assert.equal(fast.search.trials, 70); assert.equal(full.search.trials, 70);
  assert.equal(planSignature(fast), planSignature(full));
  assert.ok(fast.search.pruned > 0);
});
