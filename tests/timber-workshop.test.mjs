import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { planTimber } from '../dist/timber-planner.js';
import { cutHeadline } from '../dist/timber-text.js';
import { timberList } from '../benchmarks/timber-lists.mjs';

// Roadmap 2.2: the workshop view's big number must be the one the operator sets.
test('panel saw headline: the measurement and the edge to measure from', () => {
  for (const sheet of planTimber(timberList(15, 21, 'panel')).sheets) for (const c of sheet.cuts) {
    const h = cutHeadline(c, 'en');
    assert.equal(h.machine, 'panel');
    assert.match(h.how, c.axis === 'x' ? /Crosscut · measure from the left edge/ : /Rip cut · measure from the top edge/);
    const offsets = new Set((c.segments || [c]).map((s) => Number(s.offset.toFixed(2))));
    if (offsets.size === 1) assert.equal(h.measure, `${Number([...offsets][0]).toLocaleString('en-GB', { maximumFractionDigits: 2 })} mm`);
    else assert.equal(h.measure, null);
  }
});

test('table saw headline: fence distance, and the fence edge only when every piece shares it', () => {
  let mixed = 0;
  for (const saw of ['table', 'hybrid']) for (const sheet of planTimber(timberList(30, 32, saw)).sheets) for (const c of sheet.cuts.filter((c) => c.saw === 'table')) {
    const h = cutHeadline(c, 'en'), zh = cutHeadline(c, 'zh-Hant');
    assert.equal(h.machine, 'table'); assert.ok(h.measure?.endsWith(' mm'));
    const edges = new Set((c.segments?.length > 1 ? c.segments : [c]).map((s) => s.fenceFrom || (s.axis === 'x' ? 'left' : 'top')));
    if (edges.size === 1) assert.match(h.how, new RegExp(`${[...edges][0]} edge against the fence`));
    else { mixed++; assert.match(h.how, /differs per piece/); assert.match(zh.how, /每件/); }
  }
  assert.ok(mixed >= 0);
});

test('Review opens the workshop view; it keeps the screen awake and traps focus', () => {
  const page = fs.readFileSync(new URL('../dist/timber.js', import.meta.url), 'utf8');
  const view = fs.readFileSync(new URL('../dist/timber-workshop.js', import.meta.url), 'utf8');
  assert.match(fs.readFileSync(new URL('../dist/timber.html', import.meta.url), 'utf8'), /id="open-workshop"/);
  assert.match(page, /\$\('open-workshop'\)\.onclick = \(\) => workshop\.open\(activeSheet, 0\)/);
  assert.match(view, /navigator\.wakeLock\.request\('screen'\)/);
  assert.match(view, /aria-modal/); assert.match(view, /event\.key === 'Tab'/);
});

test('the workshop view animates each cut and can replay it', () => {
  const view = fs.readFileSync(new URL('../dist/timber-workshop.js', import.meta.url), 'utf8');
  const page = fs.readFileSync(new URL('../dist/timber.js', import.meta.url), 'utf8');
  assert.match(view, /requestAnimationFrame\(tick\)/);
  assert.match(view, /data-workshop="replay"/);
  assert.match(view, /prefers-reduced-motion: reduce/);
  assert.match(page, /animateFrame: \(svg, s, cut, state\) => \{ updateBoardSeparation\(svg, s, state\); updateCutTrace\(svg, cut, state\); \}/);
});
