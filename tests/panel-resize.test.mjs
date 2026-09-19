import test from "node:test";
import assert from "node:assert/strict";
import { fitPanelWidths } from "../dist/panel-resize.js";
test("panel widths keep readable minima and leave canvas largest across desktop sizes", () => {
  for (const width of [1100, 1280, 1440, 1920, 2560])
    for (const l of [220, 280, 440])
      for (const r of [280, 340, 520]) {
        const size = fitPanelWidths(width, l, r);
        const canvas = width - size.left - size.right;
        assert.ok(size.left >= 220);
        assert.ok(size.right >= 280);
        assert.ok(canvas >= 400);
        assert.ok(canvas >= Math.max(size.left, size.right));
      }
});
test("collapsed panels release their space without mutating preferred sizes", () => {
  assert.deepEqual(fitPanelWidths(1280, 280, 340, false, false), {
    left: 0,
    right: 0,
  });
  assert.deepEqual(fitPanelWidths(1280, 280, 340, false, true), {
    left: 0,
    right: 340,
  });
  assert.deepEqual(fitPanelWidths(1280, 280, 340, true, false), {
    left: 280,
    right: 0,
  });
});
