import test from 'node:test';
import assert from 'node:assert/strict';
import { planTimber, manualTimber, timberFreeRegions, validateProject, parseCSV, toCSV } from '../dist/timber-planner.js';

const stock = (extra = {}) => ({ label: 'Sheet', material: 'Plywood', thickness: 18, length: 100, width: 100, qty: 1, ...extra });
const part = (extra = {}) => ({ label: 'Panel', material: 'Plywood', thickness: 18, length: 40, width: 40, qty: 1, priority: 1, grain: false, ...extra });
const project = (extra = {}) => ({ settings: { kerf: 3, trim: 0, direction: 'auto', rotate: true }, stocks: [stock()], parts: [part()], ...extra });
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-5, `${a} differs from ${b}`);

function verifyPlan(plan) {
  for (const sheet of plan.sheets) {
    const usedIds = new Set([`S${sheet.number}`]);
    for (const c of sheet.cuts) {
      assert.ok(usedIds.has(c.workpiece), 'workpiece exists before it is cut');
      usedIds.delete(c.workpiece); usedIds.add(c.first); if (c.second) usedIds.add(c.second);
      assert.ok(!c.prerequisite || c.prerequisite < c.step);
      assert.ok(c.offset > 0 && c.offset < (c.axis === 'x' ? c.w : c.h));
    }
    for (const p of sheet.parts) {
      assert.ok(usedIds.has(p.workpiece));
      close(p.w, p.rotated ? p.width : p.length); close(p.h, p.rotated ? p.length : p.width);
      assert.ok(p.x >= plan.settings.trim - 1e-7 && p.y >= plan.settings.trim - 1e-7);
      assert.ok(p.x + p.w <= sheet.stock.length - plan.settings.trim + 1e-7);
      assert.ok(p.y + p.h <= sheet.stock.width - plan.settings.trim + 1e-7);
      assert.ok(!p.grain || !p.rotated);
    }
    for (let i = 0; i < sheet.parts.length; i++) for (let j = i + 1; j < sheet.parts.length; j++) {
      const a = sheet.parts[i], b = sheet.parts[j], k = plan.settings.kerf;
      assert.ok(a.x + a.w + k <= b.x + 1e-6 || b.x + b.w + k <= a.x + 1e-6 || a.y + a.h + k <= b.y + 1e-6 || b.y + b.h + k <= a.y + 1e-6, 'parts have full saw clearance');
    }
    let area = sheet.parts.reduce((n, p) => n + p.w * p.h, 0) + sheet.offcuts.reduce((n, o) => n + o.w * o.h, 0);
    area += sheet.cuts.reduce((n, c) => n + c.kerf * (c.axis === 'x' ? c.h : c.w), 0);
    close(area, sheet.root.w * sheet.root.h);
  }
  assert.equal(plan.placed + plan.unplaced.length, plan.required);
}

test('exact fit requires no cuts and preserves finished dimensions', () => {
  const p = planTimber(project({ parts: [part({ length: 100, width: 100 })] }));
  assert.equal(p.placed, 1); assert.equal(p.sheets[0].cuts.length, 0); assert.equal(p.sheets[0].yield, 1); verifyPlan(p);
});
test('kerf prevents two nominal half-width panels fitting one sheet', () => {
  const p = planTimber(project({ stocks: [stock({ width: 50 })], parts: [part({ length: 50, width: 50, qty: 2 })] }));
  assert.equal(p.placed, 1); assert.equal(p.unplaced.length, 1); verifyPlan(p);
});
test('finite stock quantity is consumed exactly and additional sheets are opened', () => {
  const p = planTimber(project({ stocks: [stock({ qty: 2 })], parts: [part({ length: 100, width: 100, qty: 3 })] }));
  assert.equal(p.sheets.length, 2); assert.equal(p.unplaced.length, 1); assert.deepEqual(p.remaining, [0]); verifyPlan(p);
});
test('grain lock and global rotation setting prevent forbidden quarter turns', () => {
  const p = project({ stocks: [stock({ length: 60, width: 100 })], parts: [part({ length: 90, width: 40 })] });
  const rotated = planTimber(p); assert.equal(rotated.placed, 1); assert.equal(rotated.sheets[0].parts[0].rotated, true); verifyPlan(rotated);
  p.parts[0].grain = true; assert.equal(planTimber(p).placed, 0);
  p.parts[0].grain = false; p.settings.rotate = false; assert.equal(planTimber(p).placed, 0);
});
test('stock material and thickness must match, ignoring material case and whitespace', () => {
  const p = planTimber(project({ stocks: [stock({ material: ' plywood ' })], parts: [part(), part({ material: 'MDF' }), part({ thickness: 12 })] }));
  assert.equal(p.placed, 1); assert.equal(p.unplaced.length, 2); verifyPlan(p);
});
test('high-priority parts receive scarce stock before larger low-priority parts', () => {
  const p = planTimber(project({ parts: [part({ label: 'Low', length: 100, width: 100, priority: 2 }), part({ label: 'High', length: 80, width: 80, priority: 0 })] }));
  assert.equal(p.sheets[0].parts[0].label, 'High'); assert.equal(p.unplaced[0].label, 'Low'); verifyPlan(p);
});
test('edge preparation reduces usable dimensions on every side', () => {
  const p = project(); p.settings.trim = 5; p.parts = [part({ length: 90, width: 90 })];
  const result = planTimber(p); assert.equal(result.placed, 1); assert.equal(result.sheets[0].parts[0].x, 5); verifyPlan(result);
  p.parts[0].length = 91; p.parts[0].width = 91; assert.equal(planTimber(p).placed, 0);
});
test('rip-first and crosscut-first generate different first cut directions', () => {
  const p = project(); p.settings.direction = 'rip'; const rip = planTimber(p); assert.equal(rip.sheets[0].cuts[0].axis, 'y'); verifyPlan(rip);
  p.settings.direction = 'cross'; const cross = planTimber(p); assert.equal(cross.sheets[0].cuts[0].axis, 'x'); verifyPlan(cross);
});
test('zero kerf and slivers smaller than kerf preserve total material area', () => {
  const p = project({ parts: [part({ length: 99, width: 99 })] }); verifyPlan(planTimber(p));
  p.settings.kerf = 0; p.parts = [part({ length: 50, width: 50, qty: 4 })];
  const result = planTimber(p); assert.equal(result.placed, 4); verifyPlan(result);
});
test('seeded mixed-size cases retain guillotine dependencies, clearances and area', () => {
  let seed = 47; const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let trial = 0; trial < 12; trial++) {
    const p = project({ stocks: [stock({ length: 2440, width: 1220, qty: 4 })], parts: Array.from({ length: 15 }, (_, i) => part({ label: `Part ${i}`, length: 50 + Math.floor(rand() * 800), width: 50 + Math.floor(rand() * 500), qty: 1 + Math.floor(rand() * 3), priority: i % 3, grain: i % 2 === 0 })) });
    p.settings.trim = 5; p.settings.kerf = 3.2; verifyPlan(planTimber(p));
  }
});
test('invalid, fractional and oversized requests are rejected before expansion', () => {
  assert.throws(() => planTimber(project({ parts: [part({ qty: 1.2 })] })), /whole number/);
  assert.throws(() => planTimber(project({ parts: [part({ qty: 500 }), part({ qty: 1 })] })), /500 individual/);
  assert.throws(() => planTimber(project({ parts: [part({ width: NaN })] })), /dimensions/);
  assert.throws(() => planTimber(project({ stocks: [stock({ qty: 201 })] })), /200 stock/);
  const p = project(); p.settings.trim = 50; assert.throws(() => validateProject(p), /no usable/);
});
test('CSV imports quoted commas, escaped quotes, BOM, CRLF and grain priorities', () => {
  const rows = parseCSV('\uFEFFlabel,length,width,qty,priority,grain\r\n"Side, \"\"A\"\"",700,400,2,high,yes\r\nShelf,600,300,1,normal,no\r\n');
  assert.equal(rows[0].label, 'Side, "A"'); assert.equal(rows[0].priority, 0); assert.equal(rows[0].grain, true); assert.equal(rows[1].grain, false);
  validateProject(project({ parts: rows }));
  assert.throws(() => parseCSV('label,width,qty\nSide,400,1'), /length column/);
  assert.throws(() => parseCSV('length,width,qty\n"100,50,1'), /unclosed/);
  assert.throws(() => parseCSV('length,width,qty,priority\n100,50,1,urgent'), /priority/);
});
test('CSV export quotes values and neutralizes spreadsheet formulas', () => {
  const out = toCSV([['label', 'qty'], ['=HYPERLINK("bad")', 2], ['Plain, panel', 1]]);
  assert.ok(out.startsWith('\uFEFF')); assert.match(out, /'\=HYPERLINK/); assert.match(out, /"Plain, panel"/);
});

test('manual workspace starts with all finite stock sheets and an unplaced tray', () => {
  const p = manualTimber(project({ stocks: [stock({ qty: 2 })], parts: [part({ qty: 3 })] }));
  assert.equal(p.boards.length, 2); assert.equal(p.sheets.length, 0); assert.equal(p.placed, 0); assert.equal(p.unplaced.length, 3);
  assert.deepEqual(timberFreeRegions(p.boards[0]), [{ x: 0, y: 0, w: 100, h: 100 }]);
});
test('manual placement snaps to guillotine free regions and retains cut dependencies', () => {
  const p = project({ parts: [part({ qty: 4 })] });
  const commands = [{ partId: 'P1.1', board: 0, x: 0, y: 0, rotated: false }];
  let result = manualTimber(p, commands); verifyPlan(result);
  const free = timberFreeRegions(result.boards[0]).find((r) => r.w >= 40 && r.h >= 40);
  commands.push({ partId: 'P1.2', board: 0, x: free.x, y: free.y, rotated: false });
  result = manualTimber(p, commands); assert.equal(result.placed, 2); assert.equal(result.unplaced.length, 2); verifyPlan(result);
  assert.throws(() => manualTimber(p, [...commands, commands[0]]), /invalid/);
  assert.throws(() => manualTimber(p, [{ ...commands[0], x: 2 }]), /does not fit/);
});
test('manual placement respects grain, material, thickness, trim and stock identity', () => {
  const p = project({ stocks: [stock({ material: 'MDF' }), stock()], parts: [part({ grain: true })] }); p.settings.trim = 5;
  assert.throws(() => manualTimber(p, [{ partId: 'P1.1', board: 0, x: 5, y: 5, rotated: false }]), /matching material/);
  assert.throws(() => manualTimber(p, [{ partId: 'P1.1', board: 1, x: 5, y: 5, rotated: true }]), /cannot rotate/);
  const result = manualTimber(p, [{ partId: 'P1.1', board: 1, x: 5, y: 5, rotated: false }]);
  assert.equal(result.sheets.length, 1); assert.equal(result.sheets[0].number, 2); assert.equal(result.sheets[0].stockIndex, 1); assert.deepEqual(result.remaining, [1, 0]); verifyPlan(result);
});
test('replaying saved manual commands is deterministic, and undo frees the last region', () => {
  const p = project({ parts: [part({ qty: 2 })] });
  const first = { partId: 'P1.1', board: 0, x: 0, y: 0, rotated: false };
  const one = manualTimber(p, [first]);
  assert.deepEqual(manualTimber(p, JSON.parse(JSON.stringify([first]))), one);
  assert.equal(manualTimber(p, []).placed, 0);
  assert.throws(() => manualTimber(p, [{ ...first, board: 9 }]), /invalid/);
  assert.throws(() => manualTimber(p, [{ ...first, partId: 'P1.999' }]), /invalid/);
});
