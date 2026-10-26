import test from 'node:test';
import assert from 'node:assert/strict';
import { planTimber, optimizeTimber } from '../dist/timber-planner.js';
import { simplifyTimberCuts, cachedSimplifyTimberCuts } from '../dist/timber-cut-planner.js';
import { timberList, planSignature } from '../benchmarks/timber-lists.mjs';

// Roadmap 1.2: a sheet seen before in the same search reuses its cut order.
const part = (id, x, y, w, h) => ({ kind: 'part', x, y, w, h, part: { id, x, y, w, h } });
const sheet = (prefix) => ({ kind: 'cut', axis: 'y', amount: 400, kerf: 3, x: 5, y: 5, w: 1000, h: 800,
  first: { kind: 'cut', axis: 'x', amount: 300, kerf: 3, x: 5, y: 5, w: 1000, h: 400, first: part(`${prefix}1`, 5, 5, 300, 400), second: part(`${prefix}2`, 308, 5, 697, 400) },
  second: { kind: 'cut', axis: 'x', amount: 300, kerf: 3, x: 5, y: 408, w: 1000, h: 397, first: part(`${prefix}3`, 5, 408, 300, 397), second: { kind: 'free', x: 308, y: 408, w: 697, h: 397 } } });
const partsOf = (n) => n.kind === 'part' ? [n.part] : [...(n.first ? partsOf(n.first) : []), ...(n.second ? partsOf(n.second) : [])];
const shape = (n) => JSON.stringify(n, (k, v) => k === 'part' ? `${v.x},${v.y},${v.w},${v.h}` : v);

test('a cache hit gives the same cuts, a fresh tree and this sheet\'s own parts', () => {
  const cache = new Map(), options = { saw: 'panel' };
  const plain = simplifyTimberCuts(sheet('A'), 3, options);
  const first = cachedSimplifyTimberCuts(sheet('A'), 3, options, cache);
  const second = cachedSimplifyTimberCuts(sheet('B'), 3, options, cache);
  assert.equal(cache.hits, 1);
  assert.equal(shape(second.root), shape(plain.root));
  assert.deepEqual([second.before, second.after], [plain.before, plain.after]);
  assert.deepEqual(partsOf(second.root).map((p) => p.id).sort(), ['B1', 'B2', 'B3']);
  // Callers label nodes in place; a later hit must not see those labels.
  second.root.id = 'S1'; const third = cachedSimplifyTimberCuts(sheet('C'), 3, options, cache);
  assert.equal(third.root.id, undefined); assert.notEqual(third.root, second.root);
  // Different options or kerf never share an entry.
  cachedSimplifyTimberCuts(sheet('D'), 3, { saw: 'table' }, cache);
  cachedSimplifyTimberCuts(sheet('E'), 2, options, cache);
  assert.equal(cache.hits, 2); assert.equal(cache.size, 3);
});

test('quick plan and evolving search: caching gives identical plans', async () => {
  for (const [types, seed, saw] of [[15, 21, 'panel'], [30, 32, 'table'], [30, 31, 'hybrid']]) {
    const project = timberList(types, seed, saw);
    assert.equal(planSignature(planTimber(project)), planSignature(planTimber(project, { caching: false })), `${types}/${seed} ${saw}`);
  }
  const project = timberList(15, 22, 'panel');
  const run = (caching) => optimizeTimber(project, { budgetMs: 10000, maxTrials: 70, caching });
  assert.equal(planSignature(await run(true)), planSignature(await run(false)));
});
