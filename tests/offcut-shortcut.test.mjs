import test from 'node:test';
import assert from 'node:assert/strict';
import { compactLayout, fixedWorkClock } from '../dist/compaction.js';
import { sampleParts, validateLayout } from '../dist/geometry.js';

// Roadmap 3.6: a beam child whose parent has another equal-best rectangle clear of the
// added one reuses the parent's answer. verifyOffcutShortcut re-runs the full grid
// pass for every reuse and throws if they differ.
test('every reused offcut answer equals a full grid pass', () => {
  const source = sampleParts();
  const parts = Array.from({ length: 24 }, (_, i) => ({ ...structuredClone(source[i % source.length]), id: 'p' + i }));
  const settings = { width: 560, height: 560, margin: 5, gap: 2, rotations: 4, scale: 1, allowMirror: false, minOffcutSide: 20 };
  const placements = parts.map((p, i) => ({ id: p.id, x: 5 + (i % 5) * 105, y: 5 + Math.floor(i / 5) * 110, angle: 0, scale: 1, sheet: 0 }));
  const options = { milliseconds: 150, passes: 1, profile: true };
  const checked = compactLayout(parts, placements, { ...settings, verifyOffcutShortcut: true }, { ...options, now: fixedWorkClock(0.05) });
  const plain = compactLayout(parts, placements, settings, { ...options, now: fixedWorkClock(0.05) });
  assert.ok(checked.profile.counts.offcutAnalysesSkipped > 100, 'the shortcut is used');
  assert.deepEqual(checked.placements, plain.placements);
  assert.deepEqual(validateLayout(parts, plain.placements, settings), []);
});
