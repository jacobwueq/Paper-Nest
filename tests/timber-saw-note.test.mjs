import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { planTimber } from '../dist/timber-planner.js';
import { sawComparison } from '../dist/timber-text.js';
import { timberList } from '../benchmarks/timber-lists.mjs';

// Roadmap 2.7: Review says why the table saw needs more steps than a panel saw.
const summary = (plan) => ({ sheets: plan.sheets.length, steps: plan.fitness.cutCount, unplaced: plan.unplaced.length });
test('table saw with more steps: the note gives both counts, the feeds and the reason', () => {
  const panel = summary(planTimber(timberList(30, 32, 'panel'))), table = planTimber(timberList(30, 32, 'table'));
  assert.ok(table.fitness.cutCount > panel.steps);
  const en = sawComparison(table, panel, 'en'), zh = sawComparison(table, panel, 'zh-Hant');
  assert.match(en, new RegExp(`^Why ${table.fitness.cutCount} steps: a panel saw would cut this list in ${panel.steps} steps`));
  assert.match(en, /one piece at a time along the fence/); assert.match(en, /\d+ separate feeds/);
  assert.match(zh, new RegExp(`點解要 ${table.fitness.cutCount} 步`));
});

test('no reason is invented when the table saw or Hybrid is not slower, and nothing for a panel saw', () => {
  const panelPlan = planTimber(timberList(15, 21, 'panel')), panel = summary(panelPlan);
  const hybrid = planTimber(timberList(15, 21, 'hybrid'));
  assert.ok(hybrid.fitness.cutCount <= panel.steps);
  assert.match(sawComparison(hybrid, panel, 'en'), /is not slower here/);
  assert.equal(sawComparison(panelPlan, panel, 'en'), '');
  assert.equal(sawComparison(hybrid, null, 'en'), '');
});

test('the comparison runs in a worker, not on the page thread', () => {
  const page = fs.readFileSync(new URL('../dist/timber.js', import.meta.url), 'utf8');
  assert.match(page, /new Worker\(new URL\('\.\/timber-compare-worker\.js/);
  assert.match(fs.readFileSync(new URL('../dist/timber-compare-worker.js', import.meta.url), 'utf8'), /saw: 'panel'/);
});
