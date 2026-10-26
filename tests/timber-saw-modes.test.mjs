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

test('table saw: rip into strips first, one piece per feed, steps grouped by fence distance', () => {
  const sheet = manualTimber(sawProject('table'), sawCommands()).sheets[0];
  assert.ok(sheet.cuts.every((c) => c.alignmentRequired === false && c.saw === 'table'));
  assert.equal(sheet.cuts[0].axis, 'y', 'the first cut on the full sheet is a rip');
  close(sheet.cuts[0].w, 2430);
  const widestCrosscut = Math.max(...cutSegments(sheet).filter((c) => c.axis === 'x').map((c) => c.h));
  assert.ok(widestCrosscut < 504, `crosscuts only on strips, widest ${widestCrosscut}`);
  for (const step of sheet.cuts) for (const s of step.segments) close(s.fence, step.fence);
  // The kept piece rides the fence: an offcut is never the measured side.
  const offcutTrim = cutSegments(sheet).find((c) => c.axis === 'x' && Math.abs(c.x + c.offset - 2259.4) < 1e-5 && c.w > 2000);
  assert.ok(offcutTrim); close(offcutTrim.fence, 2254.4); assert.equal(offcutTrim.fenceFrom, 'left');
  const shared = sheet.cuts.find((c) => c.segments.length > 1);
  assert.match(cutDescription(shared, 'en'), /^Fence at [\d.,]+ mm · \d pieces, one after another/);
  assert.match(cutDetail(shared, 'en'), /feed each piece separately/);
  assert.match(cutDetail(shared, 'en'), /edge against the fence/);
  assert.doesNotMatch(cutDetail(shared, 'en'), /aligned/);
  assert.match(cutDetail(shared, 'zh-Hant'), /逐件推過/);
  assert.match(cutDescription(sheet.cuts[0], 'en'), /^Rip cut · fence at 450 mm from the top edge/);
  assert.match(cutDescription(sheet.cuts[0], 'zh-Hant'), /上邊靠鋸導尺/);
  assert.match(cutEfficiency(sheet, 'en'), /^Table saw · \d+ pieces fed through the saw with \d+ fence settings/);
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
  assert.throws(() => validateProject(sawProject('bandsaw')), /panel saw, a table saw or hybrid/);
});

test('hybrid: the panel saw breaks the sheet into columns, then the table saw cuts them at shared fence settings', () => {
  const sheet = manualTimber({ ...sawProject('hybrid') }, sawCommands()).sheets[0];
  const machines = sheet.cuts.map((c) => c.saw);
  const firstTable = machines.indexOf('table');
  assert.ok(firstTable > 0 && machines.slice(firstTable).every((m) => m === 'table'), 'all panel-saw steps come first');
  for (const c of sheet.cuts.slice(0, firstTable)) for (const s of c.segments) assert.ok(Math.max(s.w, s.h) > 1220, 'panel saw only cuts pieces longer than the limit');
  for (const c of sheet.cuts.slice(firstTable)) for (const s of c.segments) assert.ok(Math.max(s.w, s.h) <= 1220);
  assert.equal(sheet.cuts[firstTable].machineChange, true);
  assert.match(cutDetail(sheet.cuts[firstTable], 'en'), /^Move the pieces to the table saw\./);
  assert.match(cutDescription(sheet.cuts[0], 'en'), /^Panel saw · /);
  assert.match(cutDescription(sheet.cuts[firstTable], 'zh-Hant'), /^檯鋸 · /);
  assert.ok(sheet.cuts.slice(firstTable).some((c) => c.segments.length === 3), 'three columns share the 450 mm fence');
  assert.equal(sheet.cuts.length, 7);
  assert.match(cutEfficiency(sheet, 'en'), /^Hybrid · 4 panel-saw passes break the sheet down, then 3 table-saw steps/);
  verifySteps(sheet);
});

test('hybrid: a lower limit keeps more cuts on the panel saw; the limit is validated', () => {
  const p = sawProject('hybrid'); p.settings.hybridLimit = 800;
  const sheet = manualTimber(p, sawCommands()).sheets[0];
  const panel = sheet.cuts.filter((c) => c.saw === 'panel').length;
  assert.ok(panel > 4); verifySteps(sheet);
  const auto = planTimber(sawProject('hybrid')); for (const s of auto.sheets) verifySteps(s);
  p.settings.hybridLimit = 50; assert.throws(() => validateProject(p), /between 100 and 10,000 mm/);
});
