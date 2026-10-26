import test from 'node:test';
import assert from 'node:assert/strict';
import { manualTimber, planTimber, validateProject } from '../dist/timber-planner.js';
import { cutSegments } from '../dist/timber-cut-passes.js';
import { cutDescription, cutDetail, cutEfficiency } from '../dist/timber-text.js';
import { timberSeparationLayout } from '../dist/timber-separation.js';
import { sawProject, sawCommands } from './fixtures/timber-saw-modes.mjs';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-5, `${a} differs from ${b}`);
const line = (c) => c[c.axis] + c.offset;

// Every workpiece in a step exists before the step, and material is conserved after every step.
function verifySteps(sheet) {
  const active = new Map([[sheet.root.id, sheet.root]]);
  for (const step of sheet.cuts) {
    for (const c of step.segments) {
      const node = active.get(c.workpiece);
      assert.ok(node, `${c.workpiece} is available before step ${step.step}`);
      assert.ok(!c.prerequisite || c.prerequisite < step.step);
    }
    for (const c of step.segments) {
      const node = active.get(c.workpiece); active.delete(c.workpiece);
      active.set(node.first.id, node.first); if (node.second) active.set(node.second.id, node.second);
    }
    const layout = timberSeparationLayout(sheet, { active: true, finished: false, step: step.step, completedThrough: step.step - 1, splitReady: true, separation: 1 });
    const visible = [...layout.pieces.values()].filter((p) => p.visible).reduce((n, p) => n + p.node.w * p.node.h, 0);
    const removed = cutSegments(sheet).filter((c) => c.step <= step.step).reduce((n, c) => n + c.kerf * (c.axis === 'x' ? c.h : c.w), 0);
    close(visible + removed, sheet.root.w * sheet.root.h);
  }
  assert.equal([...active.values()].filter((n) => n.kind === 'part').length, sheet.parts.length);
}

test('panel saw: strips come off first, then the 450 mm line runs across the whole panel before the columns separate', () => {
  const sheet = manualTimber(sawProject('panel'), sawCommands()).sheets[0];
  const order = sheet.cuts.map((c) => `${c.axis}${Math.round(line(c) * 10) / 10}x${c.segments.length}`);
  assert.deepEqual(order, ['y961.4x1', 'x2259.4x1', 'y455x1', 'x725x2', 'x1492.2x2', 'y878.2x2', 'y908.2x1']);
  const across = sheet.cuts[2];
  assert.equal(across.segments.length, 1, 'the 450 mm line is cut while the panel is one piece');
  close(across.w, 2254.4);
  for (const c of sheet.cuts.slice(3, 5)) assert.equal(c.alignmentRequired, true);
  verifySteps(sheet);
});

test('table saw: no step asks for pieces to be held in line; one fence setting serves several pieces', () => {
  const sheet = manualTimber(sawProject('table'), sawCommands()).sheets[0];
  assert.ok(sheet.cuts.every((c) => c.alignmentRequired === false && c.saw === 'table'));
  const fence450 = sheet.cuts.find((c) => c.segments.length === 3);
  assert.ok(fence450, 'the three columns share the 450 mm fence setting');
  for (const s of fence450.segments) close(s.offset, 450);
  assert.match(cutDescription(fence450, 'en'), /Fence at 450 mm · 3 pieces/);
  assert.match(cutDetail(fence450, 'en'), /feed each piece separately/);
  assert.doesNotMatch(cutDetail(fence450, 'en'), /aligned/);
  assert.match(cutDetail(fence450, 'zh-Hant'), /逐件推過/);
  assert.ok(sheet.fenceSettings < sheet.cuts.length, 'consecutive steps can keep the fence where it is');
  const repeat = sheet.cuts.find((c) => c.fenceRepeat);
  assert.ok(repeat); assert.match(cutDescription(repeat, 'en'), /fence unchanged/);
  assert.match(cutEfficiency(sheet, 'en'), /Table saw · 10 pieces fed through the saw with \d fence settings/);
  verifySteps(sheet);
});

test('both saws cut the same parts from the same layout', () => {
  const panel = manualTimber(sawProject('panel'), sawCommands()).sheets[0];
  const table = manualTimber(sawProject('table'), sawCommands()).sheets[0];
  const parts = (s) => s.parts.map((p) => `${p.id}@${p.x.toFixed(1)},${p.y.toFixed(1)}`).sort();
  assert.deepEqual(parts(table), parts(panel));
});

test('automatic planning works for both saws and older projects without a saw default to the panel saw', () => {
  for (const saw of ['panel', 'table']) {
    const plan = planTimber(sawProject(saw));
    assert.equal(plan.unplaced.length, 0);
    for (const sheet of plan.sheets) verifySteps(sheet);
  }
  const old = sawProject(); delete old.settings.saw;
  validateProject(old);
  assert.ok(planTimber(old).sheets[0].cuts.every((c) => c.saw === 'panel'));
  assert.throws(() => validateProject(sawProject('bandsaw')), /panel saw or a table saw/);
});
