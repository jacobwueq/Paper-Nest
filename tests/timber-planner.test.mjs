import test from 'node:test';
import assert from 'node:assert/strict';
import { planTimber, optimizeTimber, compareTimberPlans, manualCommandsFromPlan, manualTimber, timberFreeRegions, validateProject, parseCSV, toCSV } from '../dist/timber-planner.js';

import { simplifyTimberCuts } from '../dist/timber-cut-planner.js';
import { cutDetail, cutRetain } from '../dist/timber-text.js';

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
  const request = project({ parts: [part({ label: 'Low', length: 100, width: 100, priority: 2 }), part({ label: 'High', length: 80, width: 80, priority: 0 })] });
  request.settings.usePriorities = true;
  const p = planTimber(request);
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

test('default optimisation ignores row sequence and legacy per-part priorities', () => {
  const p = project({ stocks: [stock({ length: 2440, width: 1220, qty: 4 })], parts: [[800,300,2,true], [400,800,2,false], [1100,300,2,false], [1000,100,1,false], [300,300,1,false]].map(([length,width,qty,grain], i) => part({ length,width,qty,grain,priority:i % 3 })) });
  p.settings.kerf = 3.2; p.settings.trim = 5;
  const geometry = (r) => r.sheets.map((s) => s.parts.map(({ x,y,w,h }) => [x,y,w,h]).sort((a,b) => a[0]-b[0] || a[1]-b[1] || a[2]-b[2] || a[3]-b[3]));
  const a = planTimber(p); verifyPlan(a);
  p.parts.reverse(); p.parts.forEach((r, i) => { r.priority = (i + 1) % 3; });
  const b = planTimber(p); verifyPlan(b);
  assert.deepEqual(geometry(a), geometry(b));
  assert.equal(a.sheets.length, 1); assert.ok(a.reusableOffcuts[0].area >= 553873.44 - 1e-5, 'keep the large remnant rather than the old fragmented layout');
});
test('whole-list optimisation chooses one larger stock sheet over two smaller sheets', () => {
  const p = project({ stocks: [stock({ length:800,width:800,qty:2 }), stock({ length:1600,width:800,qty:1 })], parts: [part({ length:800,width:800,qty:2 })] }); p.settings.kerf=0;
  const result=planTimber(p); assert.equal(result.placed,2); assert.equal(result.sheets.length,1); verifyPlan(result);
});
test('mixed 20-piece regression fits two sheets instead of the old three-sheet layout', () => {
  const rows=[[700,200,1,false],[600,200,2,false],[200,200,1,false],[1100,300,2,true],[600,300,3,true],[400,800,2,false],[900,100,2,false],[300,500,2,true],[1100,200,3,true],[1200,600,2,false]];
  const p=project({stocks:[stock({length:2440,width:1220,qty:8})],parts:rows.map(([length,width,qty,grain],i)=>part({length,width,qty,grain,priority:i%3}))});
  p.settings.kerf=3.2;p.settings.trim=5;
  const result=planTimber(p);assert.equal(result.placed,20);assert.equal(result.sheets.length,2);verifyPlan(result);
});
test('one large reusable remnant beats the same free area split into smaller pieces', () => {
  const p=project({stocks:[stock({length:1200,width:1000})],parts:[part({length:500,width:500,qty:2})]}); p.settings.kerf=0;
  const start={partId:'P1.1',board:0,x:0,y:0,rotated:false};
  const compact=manualTimber(p,[start,{partId:'P1.2',board:0,x:0,y:500,rotated:false}]);
  const fragmented=manualTimber(p,[start,{partId:'P1.2',board:0,x:500,y:0,rotated:false}]);
  verifyPlan(compact); verifyPlan(fragmented);
  assert.equal(compact.reusableOffcuts[0].area,700000); assert.ok(compareTimberPlans(compact,fragmented)<0);
  const result=planTimber(p); assert.equal(result.reusableOffcuts[0].area,700000); verifyPlan(result);
});
test('continued optimisation preserves the best layout and cancellation stops results', async () => {
  const p=project({stocks:[stock({length:2440,width:1220,qty:3})],parts:[part({length:800,width:300,qty:5}),part({length:1200,width:400,qty:2}),part({length:600,width:500,qty:3})]});
  const initial=planTimber(p); let previous=initial;
  const best=await optimizeTimber(p,{budgetMs:10000,maxTrials:80,initialPlan:initial,onProgress(next){assert.ok(compareTimberPlans(next,previous)<=0);previous=next;}});
  assert.ok(compareTimberPlans(best,initial)<=0); assert.equal(best.search.trials,80); verifyPlan(best);
  assert.equal(await optimizeTimber(p,{shouldCancel:()=>true}),null);
});
test('Manual Adjust inherits automatic positions, rotations and guillotine splits exactly', () => {
  const p=project({stocks:[stock({length:1000,width:700,qty:2}),stock({material:'MDF',length:1200,width:800,qty:1})],parts:[part({length:420,width:300,qty:3}),part({length:700,width:200,qty:2}),part({material:'MDF',length:600,width:500,qty:1})]});
  const auto=planTimber(p), snapshot=JSON.stringify(auto), commands=manualCommandsFromPlan(p,auto), manual=manualTimber(p,commands);
  const geometry=(r)=>r.sheets.flatMap(s=>s.parts.map(q=>[q.id,s.stockIndex,q.x,q.y,q.w,q.h,q.rotated])).sort((a,b)=>a[0].localeCompare(b[0]));
  assert.deepEqual(geometry(manual),geometry(auto));assert.equal(manual.placed,auto.placed);assert.equal(JSON.stringify(auto),snapshot);verifyPlan(manual);
  assert.deepEqual(geometry(manualTimber(p,JSON.parse(JSON.stringify(commands)))),geometry(auto));
  const undone=manualTimber(p,commands.slice(0,-1));assert.equal(undone.placed,auto.placed-1);verifyPlan(undone);
});


test('one shared straight cut prepares two matching parts before they are separated', () => {
  const p = project({ stocks: [stock({ length: 83 })], parts: [part({ qty: 2, grain: true })] });
  p.settings.rotate = false;
  const result = manualTimber(p, [
    { partId: 'P1.1', board: 0, x: 0, y: 0, rotated: false, direction: 'cross' },
    { partId: 'P1.2', board: 0, x: 43, y: 0, rotated: false, direction: 'cross' },
  ]);
  const sheet = result.sheets[0]; verifyPlan(result);
  assert.equal(sheet.originalCutCount, 3); assert.equal(sheet.cuts.length, 2); assert.equal(sheet.cutReduction, 1);
  assert.equal(sheet.cuts[0].axis, 'y'); assert.equal(sheet.cuts[0].w, 83); assert.equal(sheet.cuts[0].offset, 40);
  assert.deepEqual(new Set(sheet.cuts[0].edgeParts), new Set(['P1.1', 'P1.2']));
  assert.deepEqual(new Set(sheet.cuts[1].releasedParts), new Set(['P1.1', 'P1.2']));
  assert.deepEqual(timberFreeRegions(result.boards[0]), [{ x: 0, y: 43, w: 40, h: 57 }, { x: 43, y: 43, w: 40, h: 57 }], 'manual editing retains its saved placement regions');
});
test('a repeated four-part grid needs five cuts rather than seven individual trims', () => {
  const p = project({ parts: [part({ qty: 4, grain: true })] }); p.settings.rotate = false;
  const result = manualTimber(p, [
    { partId: 'P1.1', board: 0, x: 0, y: 0, rotated: false, direction: 'rip' },
    { partId: 'P1.2', board: 0, x: 43, y: 0, rotated: false, direction: 'rip' },
    { partId: 'P1.3', board: 0, x: 0, y: 43, rotated: false, direction: 'cross' },
    { partId: 'P1.4', board: 0, x: 43, y: 43, rotated: false, direction: 'rip' },
  ]);
  assert.equal(result.sheets[0].originalCutCount, 7); assert.equal(result.fitness.cutCount, 5); verifyPlan(result);
  const automatic = planTimber(p); assert.equal(automatic.fitness.cutCount, 5); verifyPlan(automatic);
});
test('parts with different lengths can share the same width-setting cut', () => {
  const p = project({ stocks: [stock({ length: 73 })], parts: [part({ grain: true }), part({ length: 30, grain: true })] });
  p.settings.rotate = false;
  const result = planTimber(p); assert.equal(result.placed, 2); assert.equal(result.fitness.cutCount, 2); verifyPlan(result);
  assert.ok(result.sheets[0].cuts.some((c) => c.axis === 'y' && c.w === 73 && c.edgeParts.length === 2));
});
test('cut count ranks ahead of offcuts, while placed parts and sheet use remain first', () => {
  const base = planTimber(project()), more = structuredClone(base);
  more.fitness.cutCount += 1; more.fitness.offcuts = [1e12];
  assert.ok(compareTimberPlans(base, more) < 0, 'larger offcuts cannot buy more cuts');
  more.fitness.primary[0] += 1; more.fitness.cutCount = 0;
  assert.ok(compareTimberPlans(base, more) < 0, 'fewer cuts cannot buy an unplaced part');
  more.fitness.primary[0] -= 1; more.fitness.primary[2] += 1;
  assert.ok(compareTimberPlans(base, more) < 0, 'fewer cuts cannot buy an extra sheet');
});
test('shared cuts never cross a part interior or its required saw clearance', () => {
  const p = project({ stocks: [stock({ length: 700, width: 600, qty: 3 })], parts: [part({ length: 150, width: 100, qty: 5 }), part({ length: 150, width: 120, qty: 3 }), part({ length: 120, width: 100, qty: 4 })] });
  p.settings.trim = 5; p.settings.kerf = 3.2;
  const plan = planTimber(p); verifyPlan(plan);
  for (const sheet of plan.sheets) {
    for (const c of sheet.cuts) for (const p of sheet.parts) {
      const inRegion = p.x >= c.x - 1e-7 && p.y >= c.y - 1e-7 && p.x + p.w <= c.x + c.w + 1e-7 && p.y + p.h <= c.y + c.h + 1e-7;
      if (!inRegion) continue;
      const position = c[c.axis] + c.offset, size = c.axis === 'x' ? 'w' : 'h';
      assert.ok(p[c.axis] + p[size] <= position + 1e-6 || p[c.axis] >= position + c.kerf - 1e-6);
    }
    assert.ok(sheet.cuts.length <= sheet.originalCutCount);
  }
  const manual = manualTimber(p, manualCommandsFromPlan(p, plan)); verifyPlan(manual);
  assert.equal(manual.fitness.cutCount, plan.fitness.cutCount);
});


test('an exhausted cut-search budget keeps a valid, separate copy of the original tree', () => {
  const p = project({ stocks: [stock({ length: 83 })], parts: [part({ qty: 2 })] });
  const manual = manualTimber(p, [{ partId: 'P1.1', board: 0, x: 0, y: 0, rotated: false, direction: 'cross' }, { partId: 'P1.2', board: 0, x: 43, y: 0, rotated: false, direction: 'cross' }]);
  const root = manual.boards[0].root, before = JSON.stringify(root);
  const limited = simplifyTimberCuts(root, 3, { maxStates: 0 });
  assert.equal(limited.before, 3); assert.equal(limited.after, 3);
  assert.notEqual(limited.root, root); assert.notEqual(limited.root.first, root.first);
  assert.equal(JSON.stringify(root), before); assert.deepEqual(limited.root, root);
});
test('the shared-cut guide explains when to keep both finished workpieces in either language', () => {
  const p = project({ stocks: [stock({ length: 83 })], parts: [part({ qty: 2 })] }); p.settings.rotate = false;
  const result = planTimber(p), cut = result.sheets[0].cuts.find((c) => c.releasedParts.length === 2);
  assert.ok(cut); assert.match(cutDetail(cut, 'en'), /releases P1.1 \+ P1.2 together/);
  assert.match(cutDetail(cut, 'zh-Hant'), /同時分出/);
  assert.match(cutRetain(cut, 'en'), /Keep both workpieces/);
  assert.match(cutRetain(cut, 'zh-Hant'), /兩邊板件都保留/);
});
