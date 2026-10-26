// Timber planning benchmark: 7 survey cut lists × panel / table / hybrid saw.
//   node scripts/benchmark-timber.mjs              quick plans, compared with the baseline
//   node scripts/benchmark-timber.mjs --extended   also a 4 s "Improve layout" search
//   node scripts/benchmark-timber.mjs --save       write benchmarks/timber-baseline.json
// Sheets, steps and plan signatures are deterministic; timings depend on the machine,
// so compare them as ratios on the same machine.
import fs from 'node:fs';
import os from 'node:os';
import { planTimber, optimizeTimber } from '../dist/timber-planner.js';
import { TIMBER_LISTS, timberList, areaLowerBound, planSignature } from '../benchmarks/timber-lists.mjs';

const extended = process.argv.includes('--extended'), save = process.argv.includes('--save');
const baselinePath = new URL('../benchmarks/timber-baseline.json', import.meta.url);
const rows = [];
for (const [types, seed] of TIMBER_LISTS) for (const saw of ['panel', 'table', 'hybrid']) {
  const project = timberList(types, seed, saw);
  const pieces = project.parts.reduce((n, p) => n + p.qty, 0);
  const t0 = performance.now(), plan = planTimber(project), quickMs = performance.now() - t0;
  const row = { list: `${types}/${seed}`, saw, pieces, lowerBound: areaLowerBound(project), sheets: plan.sheets.length, unplaced: plan.unplaced.length,
    steps: plan.fitness.cutCount, quickMs: Math.round(quickMs), signature: planSignature(plan) };
  if (extended) {
    const t1 = performance.now(), best = await optimizeTimber(project, { budgetMs: 4000, maxTrials: 2000, initialPlan: plan });
    Object.assign(row, { extendedSheets: best.sheets.length, extendedSteps: best.fitness.cutCount, extendedTrials: best.search.trials, extendedMs: Math.round(performance.now() - t1) });
  }
  rows.push(row);
}

const baseline = fs.existsSync(baselinePath) ? JSON.parse(fs.readFileSync(baselinePath, 'utf8')) : null;
const table = rows.map((r) => {
  const b = baseline?.rows.find((x) => x.list === r.list && x.saw === r.saw);
  const out = { list: r.list, saw: r.saw, pieces: r.pieces, bound: r.lowerBound, sheets: r.sheets, steps: r.steps, quickMs: r.quickMs };
  if (b) Object.assign(out, { 'Δsheets': r.sheets - b.sheets, 'Δsteps': r.steps - b.steps, 'time×': +(r.quickMs / b.quickMs).toFixed(2), samePlan: r.signature === b.signature });
  if (extended) Object.assign(out, { extSheets: r.extendedSheets, extSteps: r.extendedSteps, extTries: r.extendedTrials });
  return out;
});
console.table(table);
if (baseline) {
  const worse = table.filter((r) => r['Δsheets'] > 0 || (r['Δsheets'] === 0 && r['Δsteps'] > 0));
  console.log(worse.length ? `Worse than baseline on ${worse.length} runs.` : 'No run is worse than the baseline on sheets or steps.');
}
if (save) {
  fs.mkdirSync(new URL('../benchmarks/', import.meta.url), { recursive: true });
  fs.writeFileSync(baselinePath, JSON.stringify({ date: new Date().toISOString(), node: process.version, cpu: os.cpus()[0]?.model, rows }, null, 1) + '\n');
  console.log('Saved benchmarks/timber-baseline.json');
}
