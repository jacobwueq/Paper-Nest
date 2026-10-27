import { scheduleCuts, fenceOf } from './timber-cut-passes.js?v=0.28.1';
import { cachedSimplifyTimberCuts } from './timber-cut-planner.js?v=0.28.1';
import { validateTimberSettings, settingValue } from './timber-settings.js?v=0.28.1';
// Rectangular guillotine plans. Every cut spans its current workpiece.
const EPS = 1e-7;
const positive = (v) => Number.isFinite(v) && v > 0 && v <= 20000;
const materialKey = (r) => `${r.material.trim().toLowerCase()}|${r.thickness}`;
export function validateProject(project) {
  const { settings, stocks, parts } = project;
  validateTimberSettings(settings);
  if (!Array.isArray(stocks) || !stocks.length || stocks.length > 50) throw new Error('Add between 1 and 50 stock rows.');
  if (!Array.isArray(parts) || !parts.length || parts.length > 100) throw new Error('Add between 1 and 100 part rows.');
  for (const [type, rows] of [['Stock', stocks], ['Part', parts]]) {
    rows.forEach((r, i) => {
      if (!r || !positive(r.length) || !positive(r.width) || !positive(r.thickness)) throw new Error(`${type} row ${i + 1}: dimensions and thickness must be positive numbers, up to 20,000 mm.`);
      if (!Number.isInteger(r.qty) || r.qty < 1 || r.qty > 500) throw new Error(`${type} row ${i + 1}: quantity must be a whole number from 1 to 500.`);
      if (typeof r.material !== 'string' || !r.material.trim() || r.material.length > 80) throw new Error(`${type} row ${i + 1}: enter a material, up to 80 characters.`);
      if (typeof r.label !== 'string' || r.label.length > 100) throw new Error(`${type} row ${i + 1}: labels must be at most 100 characters.`);
      if (type === 'Stock' && Math.min(r.length, r.width) <= 2 * settings.trim) throw new Error(`Stock row ${i + 1}: edge trim leaves no usable panel.`);
      if (type === 'Part' && ![0, 1, 2].includes(r.priority)) throw new Error(`Part row ${i + 1}: invalid priority.`);
    });
  }
  if (parts.reduce((n, p) => n + p.qty, 0) > 500) throw new Error('Plan up to 500 individual parts at a time.');
  if (stocks.reduce((n, s) => n + s.qty, 0) > 200) throw new Error('Plan up to 200 stock sheets at a time.');
  return project;
}
function leaves(node, into = []) {
  if (node.kind === 'free') into.push(node);
  if (node.first) leaves(node.first, into);
  if (node.second) leaves(node.second, into);
  return into;
}
function divide(node, axis, amount, kerf) {
  const dimension = axis === 'x' ? node.w : node.h;
  const delta = dimension - amount;
  if (delta <= EPS) return node;
  const consumed = Math.min(kerf, delta);
  node.kind = 'cut'; node.axis = axis; node.amount = amount; node.kerf = consumed;
  node.first = { kind: 'free', x: node.x, y: node.y, w: axis === 'x' ? amount : node.w, h: axis === 'y' ? amount : node.h };
  if (delta - consumed > EPS) node.second = { kind: 'free', x: node.x + (axis === 'x' ? amount + consumed : 0), y: node.y + (axis === 'y' ? amount + consumed : 0), w: axis === 'x' ? delta - consumed : node.w, h: axis === 'y' ? delta - consumed : node.h };
  return node.first;
}
function insert(node, p, rotated, direction, kerf) {
  const w = rotated ? p.width : p.length, h = rotated ? p.length : p.width;
  let target;
  if (direction === 'rip') target = divide(divide(node, 'y', h, kerf), 'x', w, kerf);
  else target = divide(divide(node, 'x', w, kerf), 'y', h, kerf);
  target.kind = 'part'; target.part = { ...p, placementDirection: direction, rotated, x: target.x, y: target.y, w, h };
}
function orientations(p, settings) {
  return settings.rotate && !p.grain && Math.abs(p.length - p.width) > EPS ? [false, true] : [false];
}
function fits(node, p, rotated) {
  return (rotated ? p.width : p.length) <= node.w + EPS && (rotated ? p.length : p.width) <= node.h + EPS;
}
function compareNumbers(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (Math.abs(d) > 1e-5) return d < 0 ? -1 : 1;
  }
  return 0;
}
function canonicalPart(a, b) {
  return materialKey(a).localeCompare(materialKey(b)) || b.length - a.length || b.width - a.width || Number(b.grain) - Number(a.grain) || a.copy - b.copy;
}
function splitChoices(leaf, p, rotated, settings, policy) {
  const w = rotated ? p.width : p.length, h = rotated ? p.length : p.width, k = settings.kerf;
  const rip = [{ w: leaf.w, h: Math.max(0, leaf.h - h - k) }, { w: Math.max(0, leaf.w - w - k), h }];
  const cross = [{ w: Math.max(0, leaf.w - w - k), h: leaf.h }, { w, h: Math.max(0, leaf.h - h - k) }];
  const dirs = settings.direction === 'auto' ? policy === 'rip' ? ['rip'] : policy === 'cross' ? ['cross'] : ['rip', 'cross'] : [settings.direction];
  return dirs.map((direction) => ({ direction, rectangles: direction === 'rip' ? rip : cross }));
}
// The first rank of a plan: unplaced parts (by priority when used), unplaced area,
// sheets, stock area. Known as soon as parts are placed, before any cut is ordered.
function primaryScore(project, sheets, unplaced) {
  const missing = project.settings.usePriorities ? [0, 1, 2].map((priority) => unplaced.filter((p) => p.priority === priority).length) : [unplaced.length];
  return [...missing, unplaced.reduce((n, p) => n + p.length * p.width, 0), sheets.length, sheets.reduce((n, s) => n + s.stock.length * s.stock.width, 0)];
}
// cutoff: a primary score to beat. A layout already worse than it cannot rank, so its
// cuts are not ordered (the slow part) and a pruned stand-in is returned instead.
function build(project, order, strategy, cutoff = null, cutCache = null) {
  const { settings } = project;
  const remaining = project.stocks.map((s) => s.qty), sheets = [], unplaced = [];
  const stockOrder = project.stocks.map((_, i) => i).sort((i, j) => materialKey(project.stocks[i]).localeCompare(materialKey(project.stocks[j])) || project.stocks[i].length - project.stocks[j].length || project.stocks[i].width - project.stocks[j].width);
  for (let index = 0; index < order.length; index++) {
    const p = order[index];
    const choose = (sheet, leaf, rotated, stockIndex = null) => {
      const w = rotated ? p.width : p.length, h = rotated ? p.length : p.width;
      let best;
      for (const split of splitChoices(leaf, p, rotated, settings, strategy.split)) {
        const areas = split.rectangles.map((r) => r.w * r.h).sort((a, b) => b - a);
        const short = Math.min(leaf.w - w, leaf.h - h), long = Math.max(leaf.w - w, leaf.h - h);
        let base = strategy.slot === 'cuts' ? Number(leaf.w - w > EPS) + Number(leaf.h - h > EPS) : strategy.slot === 'short' ? short : strategy.slot === 'long' ? long : strategy.slot === 'remnant' ? -areas[0] : leaf.w * leaf.h - w * h;
        if (strategy.slot === 'lookahead') {
          const future = order.slice(index + 1, index + 13).filter((q) => materialKey(q) === materialKey(p));
          const fitting = future.filter((q) => split.rectangles.some((r) => orientations(q, settings).some((turn) => fits(r, q, turn)))).length;
          base = -fitting;
        }
        const score = [base, -areas[0], -areas[1], short, long, leaf.y, leaf.x];
        if (!best || compareNumbers(score, best.score) < 0) best = { sheet, leaf, rotated, direction: split.direction, stockIndex, score };
      }
      return best;
    };
    let best;
    for (const sheet of sheets) {
      if (materialKey(sheet.stock) !== materialKey(p)) continue;
      for (const leaf of leaves(sheet.root)) for (const rotated of orientations(p, settings)) {
        if (!fits(leaf, p, rotated)) continue;
        const candidate = choose(sheet, leaf, rotated);
        if (!best || compareNumbers(candidate.score, best.score) < 0) best = candidate;
      }
    }
    if (!best) {
      for (const i of stockOrder) {
        const stock = project.stocks[i];
        if (!remaining[i] || materialKey(stock) !== materialKey(p)) continue;
        const root = { kind: 'free', x: settings.trim, y: settings.trim, w: stock.length - 2 * settings.trim, h: stock.width - 2 * settings.trim };
        for (const rotated of orientations(p, settings)) {
          if (!fits(root, p, rotated)) continue;
          const candidate = choose({ stock, stockIndex: i, root }, root, rotated, i);
          candidate.score.unshift(stock.length * stock.width * (strategy.stock === 'large' ? -1 : 1));
          if (!best || compareNumbers(candidate.score, best.score) < 0) best = candidate;
        }
      }
      if (best) {
        remaining[best.stockIndex]--; best.sheet.number = sheets.length + 1; sheets.push(best.sheet);
      }
    }
    if (!best) { unplaced.push(p); continue; }
    insert(best.leaf, p, best.rotated, best.direction, settings.kerf);
  }
  if (cutoff) {
    const primary = primaryScore(project, sheets, unplaced);
    if (compareNumbers(primary, cutoff) > 0) return { pruned: true, score: primary, fitness: { primary }, sheets: [], unplaced };
  }
  const plan = finalizePlan(project, sheets, unplaced, order.length, cutCache);
  plan.searchSeed = { order: order.map((p) => p.id), strategy };
  return plan;
}
function finalizePlan(project, sheets, unplaced, required, cutCache = null) {
  let cutLength = 0;
  const saw = settingValue(project.settings, 'saw'), limit = settingValue(project.settings, 'hybridLimit');
  sheets = sheets.map((sheet) => {
    const simplified = cachedSimplifyTimberCuts(sheet.root, project.settings.kerf, { direction: project.settings.direction, saw, limit }, cutCache);
    return { ...sheet, root: simplified.root, cutReduction: simplified.before - simplified.after, originalCutCount: simplified.before };
  });
  for (const sheet of sheets) {
    sheet.cuts = []; sheet.cutSegments = []; sheet.parts = []; sheet.offcuts = [];
    const records = new Map();
    let nextWorkpiece = 1;
    const descendants = (node) => node.kind === 'part' ? [node.part] : [...(node.first ? descendants(node.first) : []), ...(node.second ? descendants(node.second) : [])];
    const visit = (node, id, parentWorkpiece = null) => {
      node.id = id;
      if (node.kind === 'cut') {
        const step = 0;
        const first = `S${sheet.number}-W${nextWorkpiece++}`;
        const second = node.second ? `S${sheet.number}-W${nextWorkpiece++}` : null;
        const edge = node[node.axis] + node.amount, size = node.axis === 'x' ? 'w' : 'h';
        const edgeParts = descendants(node).filter((p) => Math.abs(p[node.axis] + p[size] - edge) < EPS || Math.abs(p[node.axis] - edge - node.kerf) < EPS).map((p) => p.id);
        const releasedParts = [node.first, node.second].filter((child) => child?.kind === 'part').map((child) => child.part.id);
        const record = { edgeParts, releasedParts, firstPartCount: descendants(node.first).length, secondPartCount: node.second ? descendants(node.second).length : 0, step, workpiece: id, parentWorkpiece, prerequisite: null, x: node.x, y: node.y, w: node.w, h: node.h, axis: node.axis, offset: node.amount, kerf: node.kerf, first, second };
        records.set(node, record); sheet.cutSegments.push(record);

        visit(node.first, first, id);
        if (node.second) visit(node.second, second, id);
      } else if (node.kind === 'part') sheet.parts.push({ ...node.part, workpiece: id });
      else sheet.offcuts.push({ ...node, id });
    };
    visit(sheet.root, `S${sheet.number}`);
    const schedule = scheduleCuts(sheet.root, saw, { limit }), byId = new Map(sheet.cutSegments.map((c) => [c.workpiece, c]));
    sheet.saw = saw; sheet.panelPasses = schedule.panelPasses ?? null; sheet.alignmentCost = schedule.alignmentCost; sheet.fenceSettings = schedule.setups ?? null; sheet.widestCrosscut = schedule.widestCrosscut ?? 0; cutLength += schedule.length;
    sheet.cuts = schedule.passes.map((nodes, index) => {
      const segments = nodes.map((node) => records.get(node)), step = index + 1;
      for (const c of segments) { c.step = step; c.prerequisite = c.parentWorkpiece ? byId.get(c.parentWorkpiece).step : null; }
      const representative = segments[Math.floor(segments.length / 2)];
      // In hybrid mode each step says which machine it is on.
      const machine = schedule.machines?.[index] ?? saw, previous = schedule.machines?.[index - 1] ?? saw;
      if (machine === 'table') for (const node of nodes) { const fence = fenceOf(node), record = records.get(node); record.fence = fence.distance; record.fenceFrom = fence.from; }
      const fenceRepeat = machine === 'table' && previous === 'table' && index > 0 && Math.abs(fenceOf(schedule.passes[index - 1][0]).distance - fenceOf(nodes[0]).distance) < 1e-4;
      const machineChange = saw === 'hybrid' && machine === 'table' && previous === 'panel' && index > 0;
      return { ...representative, step, segments, saw: machine, hybrid: saw === 'hybrid', machineChange, fenceRepeat, alignmentRequired: machine === 'panel' && segments.length > 1,
        prerequisite: Math.max(0, ...segments.map((c) => c.prerequisite || 0)) || null,
        edgeParts: [...new Set(segments.flatMap((c) => c.edgeParts))], releasedParts: [...new Set(segments.flatMap((c) => c.releasedParts))] };
    });
    sheet.usedArea = sheet.parts.reduce((n, p) => n + p.w * p.h, 0);
    sheet.area = sheet.stock.length * sheet.stock.width;
    sheet.yield = sheet.usedArea / sheet.area;
  }
  const reusableOffcuts = sheets.flatMap((s) => s.offcuts.map((r) => ({ ...r, sheet: s.number, area: r.w * r.h }))).filter((r) => Math.min(r.w, r.h) >= 50 - EPS).sort((a, b) => b.area - a.area || Math.min(b.w, b.h) - Math.min(a.w, a.h));
  const occupiedArea = sheets.reduce((total, s) => total + (Math.max(0, ...s.parts.map((p) => p.x + p.w)) - project.settings.trim) * (Math.max(0, ...s.parts.map((p) => p.y + p.h)) - project.settings.trim), 0);
  const score = primaryScore(project, sheets, unplaced);
  const fitness = { primary: score, offcuts: reusableOffcuts.map((r) => r.area), occupiedArea, cutLength, cutCount: sheets.reduce((n, s) => n + s.cuts.length, 0), alignmentCost: sheets.reduce((n, s) => n + s.alignmentCost, 0), saw, widestCrosscut: saw === 'table' ? Math.max(0, ...sheets.map((s) => s.widestCrosscut)) : 0 };
  const remaining = project.stocks.map((s, i) => s.qty - sheets.filter((sheet) => sheet.stockIndex === i).length);
  return { sheets, unplaced, score, fitness, reusableOffcuts, remaining, settings: { ...project.settings }, required, placed: required - unplaced.length };
}
// A stock row for an offcut kept for the next job: same material and thickness as its
// sheet; length along the sheet's grain (x), rounded down to 0.1 mm so the row is never
// larger than the real piece.
export function offcutStockRow(sheet, offcut) {
  const down = (v) => Math.floor(v * 10 + 1e-6) / 10;
  return { label: `Offcut ${offcut.id}`, material: sheet.stock.material, thickness: sheet.stock.thickness, length: down(offcut.w), width: down(offcut.h), qty: 1 };
}
export function timberFreeRegions(board) { return leaves(board.root).map(({ x, y, w, h }) => ({ x, y, w, h })); }
export function manualCommandsFromPlan(project, plan) {
  validateProject(project);
  if (!plan?.searchSeed?.order) throw new Error('Wait for an automatic layout before opening Manual Adjust.');
  const boards = project.stocks.flatMap((stock) => Array.from({ length: stock.qty }, () => ({ root: { kind: 'free', x: project.settings.trim, y: project.settings.trim, w: stock.length - 2 * project.settings.trim, h: stock.width - 2 * project.settings.trim } })));
  const next = project.stocks.map((_, i) => project.stocks.slice(0, i).reduce((n, s) => n + s.qty, 0));
  const pieces = new Map(), boardBySheet = new Map();
  for (const sheet of plan.sheets) {
    boardBySheet.set(sheet.number, next[sheet.stockIndex]++);
    for (const part of sheet.parts) pieces.set(part.id, { part, sheet });
  }
  const commands = [];
  for (const id of plan.searchSeed.order) {
    const found = pieces.get(id); if (!found) continue;
    const { part, sheet } = found, board = boardBySheet.get(sheet.number);
    const leaf = leaves(boards[board].root).find((r) => Math.abs(r.x - part.x) < EPS && Math.abs(r.y - part.y) < EPS);
    if (!leaf || !fits(leaf, part, part.rotated)) throw new Error('The automatic layout changed. Please return to Auto Nest.');
    const firstCut = sheet.cuts.find((c) => Math.abs(c.x - leaf.x) < EPS && Math.abs(c.y - leaf.y) < EPS && Math.abs(c.w - leaf.w) < EPS && Math.abs(c.h - leaf.h) < EPS);
    const direction = part.placementDirection || (firstCut?.axis === 'y' ? 'rip' : 'cross');
    const command = { partId: id, board, x: leaf.x, y: leaf.y, rotated: part.rotated, direction };
    insert(leaf, part, part.rotated, direction, project.settings.kerf); commands.push(command);
  }
  return commands;
}
export function manualTimber(project, commands = []) {
  validateProject(project);
  if (!Array.isArray(commands) || commands.length > 500) throw new Error('Invalid manual placement list.');
  const boards = project.stocks.flatMap((stock, stockIndex) => Array.from({ length: stock.qty }, () => ({ stock, stockIndex, root: { kind: 'free', x: project.settings.trim, y: project.settings.trim, w: stock.length - 2 * project.settings.trim, h: stock.width - 2 * project.settings.trim } })));
  boards.forEach((board, i) => { board.number = i + 1; board.parts = []; });
  const expanded = project.parts.flatMap((p, row) => Array.from({ length: p.qty }, (_, copy) => ({ ...p, row, copy: copy + 1, id: `P${row + 1}.${copy + 1}`, label: p.label || `Part ${row + 1}` })));
  const placed = new Set(), byId = new Map(expanded.map((p) => [p.id, p]));
  for (const [index, c] of commands.entries()) {
    const p = c && byId.get(c.partId), board = c && boards[c.board];
    if (!p || !board || placed.has(c.partId) || !Number.isInteger(c.board) || ![c.x, c.y].every(Number.isFinite) || typeof c.rotated !== 'boolean' || (c.direction !== undefined && !['rip', 'cross'].includes(c.direction))) throw new Error(`Manual placement ${index + 1} is invalid.`);
    if (materialKey(p) !== materialKey(board.stock)) throw new Error('Choose stock with matching material and thickness.');
    if (c.rotated && (!project.settings.rotate || p.grain)) throw new Error('Grain-locked parts cannot rotate.');
    const leaf = leaves(board.root).find((r) => Math.abs(r.x - c.x) < EPS && Math.abs(r.y - c.y) < EPS);
    if (!leaf || !fits(leaf, p, c.rotated)) throw new Error('This part does not fit that free region, including saw kerf.');
    let direction = project.settings.direction;
    if (direction === 'auto') {
      const w = c.rotated ? p.width : p.length, h = c.rotated ? p.length : p.width, k = project.settings.kerf;
      direction = c.direction || (Math.max(leaf.w * Math.max(0, leaf.h - h - k), Math.max(0, leaf.w - w - k) * h) > Math.max(Math.max(0, leaf.w - w - k) * leaf.h, w * Math.max(0, leaf.h - h - k)) ? 'rip' : 'cross');
    }
    insert(leaf, p, c.rotated, direction, project.settings.kerf); placed.add(p.id);
  }
  const used = boards.filter((board) => leaves(board.root).length !== 1 || board.root.kind !== 'free');
  const plan = finalizePlan(project, used, expanded.filter((p) => !placed.has(p.id)), expanded.length);
  // Editing keeps the original placement regions; review uses the simplified cutting tree.
  for (const sheet of plan.sheets) boards[sheet.number - 1].parts = sheet.parts;
  return { ...plan, boards, manual: true };
}
export function compareTimberPlans(a, b) {
  const primary = compareNumbers(a.fitness.primary, b.fitness.primary);
  if (primary) return primary;
  // Table saw: after placement and sheet use, ripping to strips before crosscutting wins.
  const crosscut = (a.fitness.widestCrosscut || 0) - (b.fitness.widestCrosscut || 0);
  if (Math.abs(crosscut) > 1e-7) return crosscut;
  // After placement and sheet use, fewer saw strokes win before offcut size.
  const cuts = a.fitness.cutCount - b.fitness.cutCount;
  if (cuts) return cuts;
  const alignment = (a.fitness.alignmentCost || 0) - (b.fitness.alignmentCost || 0);
  if (alignment) return alignment;
  // For equally simple cutting plans, preserve R1 before R2, then R3.
  const offcuts = compareNumbers(a.fitness.offcuts, b.fitness.offcuts);
  if (offcuts) return -offcuts;
  return compareNumbers([a.fitness.occupiedArea, a.fitness.cutLength], [b.fitness.occupiedArea, b.fitness.cutLength]);
}
function expand(project) {
  return project.parts.flatMap((p, row) => Array.from({ length: p.qty }, (_, copy) => ({ ...p, row, copy: copy + 1, id: `P${row + 1}.${copy + 1}`, label: p.label || `Part ${row + 1}` }))).sort(canonicalPart);
}
const strategies = [
  { slot: 'area', split: 'auto', stock: 'small' },
  { slot: 'short', split: 'auto', stock: 'small' },
  { slot: 'area', split: 'rip', stock: 'small' },
  { slot: 'area', split: 'cross', stock: 'small' },
  { slot: 'area', split: 'auto', stock: 'large' },
  { slot: 'long', split: 'auto', stock: 'small' },
  { slot: 'remnant', split: 'auto', stock: 'small' },
  { slot: 'lookahead', split: 'auto', stock: 'small' },
  { slot: 'cuts', split: 'auto', stock: 'small' },
];
const sorts = [
  (a, b) => b.length * b.width - a.length * a.width,
  (a, b) => Math.max(b.length, b.width) - Math.max(a.length, a.width),
  (a, b) => b.width - a.width || b.length - a.length,
  (a, b) => b.length - a.length || b.width - a.width,
  (a, b) => Math.min(b.length, b.width) - Math.min(a.length, a.width),
  (a, b) => Number(b.grain) - Number(a.grain) || b.length * b.width - a.length * a.width,
];
const priorityOrder = (project, sorter) => (a, b) => (project.settings.usePriorities ? a.priority - b.priority : 0) || sorter(a, b) || canonicalPart(a, b);
function searchKey(project) {
  return JSON.stringify([project.settings, project.stocks.map((s) => [materialKey(s), s.length, s.width, s.qty]), project.parts.map((p) => [materialKey(p), p.length, p.width, p.qty, p.grain, project.settings.usePriorities ? p.priority : null])]);
}
function randomFor(parts) {
  let seed = 2166136261;
  for (const c of parts.map((p) => `${materialKey(p)}:${p.length}:${p.width}:${p.grain}`).join(';')) seed = Math.imul(seed ^ c.charCodeAt(0), 16777619) >>> 0;
  return () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
}
function* candidates(project, warm, { pruning = true, keep = 8, caching = true } = {}) {
  const cutCache = caching ? new Map() : null;
  const expanded = expand(project), random = randomFor(expanded), population = [];
  const record = (order, strategy) => {
    // Only the best `keep` plans matter (8 for the evolving search, which picks parents
    // from them; 1 for the quick plan, which never does), so a layout worse on sheets
    // than the keep-th can change nothing: skip ordering its cuts.
    const plan = build(project, order, strategy, pruning && population.length >= keep ? population[keep - 1].plan.fitness.primary : null, cutCache);
    if (plan.pruned) return plan;
    population.push({ order, strategy, plan }); population.sort((a, b) => compareTimberPlans(a.plan, b.plan));
    if (population.length > 8) population.length = 8;
    return plan;
  };
  if (warm?.searchKey === searchKey(project) && warm.searchSeed) {
    const byId = new Map(expanded.map((p) => [p.id, p]));
    const order = warm.searchSeed.order.map((id) => byId.get(id));
    if (order.length === expanded.length && order.every(Boolean) && new Set(order).size === expanded.length) yield record(order, warm.searchSeed.strategy);
  }
  // Evaluate complementary sorts and split directions, independently of row order.
  for (let i = 0; i < 24; i++) {
    const sort = sorts[Math.floor(i / 4)];
    const strategy = strategies[(i % 4 + Math.floor(i / 4) * 3) % 8];
    yield record([...expanded].sort(priorityOrder(project, sort)), strategy);
  }
  for (const sort of sorts) yield record([...expanded].sort(priorityOrder(project, sort)), strategies[8]);
  for (let i = 0; ; i++) {
    if (i < 24) {
      const strategy = strategies[Math.floor(i / sorts.length) + 4];
      yield record([...expanded].sort(priorityOrder(project, sorts[i % sorts.length])), strategy);
      continue;
    }
    const parent = population[Math.floor(random() * population.length)];
    let order = [...parent.order];
    if (i % 9 === 0) {
      for (let n = order.length - 1; n > 0; n--) { const j = Math.floor(random() * (n + 1)); [order[n], order[j]] = [order[j], order[n]]; }
    } else {
      for (let n = 0; n < 1 + i % 4; n++) {
        const a = Math.floor(random() * order.length), b = Math.floor(random() * order.length);
        if (i % 3 === 0) { const [part] = order.splice(a, 1); order.splice(b, 0, part); }
        else [order[a], order[b]] = [order[b], order[a]];
      }
    }
    if (project.settings.usePriorities) order.sort((a, b) => a.priority - b.priority);
    const strategy = i % 3 === 0 ? parent.strategy : strategies[Math.floor(random() * strategies.length)];
    yield record(order, strategy);
  }
}
// pruning (default on) skips cut ordering for layouts that cannot rank; caching (on)
// reuses the cut order of a sheet already seen in this search. Off gives the same
// plan more slowly; the switches are kept for tests and benchmarks.
export function planTimber(project, { pruning = true, caching = true } = {}) {
  validateProject(project);
  let best, trials = 0, pruned = 0;
  // Its 30 tries are fixed sorts and never draw parents from the population.
  for (const plan of candidates(project, null, { pruning, caching, keep: 1 })) {
    trials++; if (plan.pruned) pruned++; else if (!best || compareTimberPlans(plan, best) < 0) best = plan;
    if (trials >= 30) break;
  }
  best.searchKey = searchKey(project); best.search = { trials, pruned, complete: true };
  return best;
}
export async function optimizeTimber(project, { budgetMs = 1200, maxTrials = 256, initialPlan, onProgress = () => {}, shouldCancel = () => false, pruning = true, caching = true } = {}) {
  validateProject(project);
  const started = performance.now(), duration = Math.max(0, Math.min(10000, budgetMs));
  let best, trials = 0, pruned = 0, lastReport = started, improved = false;
  for (const plan of candidates(project, initialPlan, { pruning, caching })) {
    if (shouldCancel()) return null;
    trials++; if (plan.pruned) pruned++;
    else if (!best || compareTimberPlans(plan, best) < 0) { best = plan; improved = true; }
    best.searchKey = searchKey(project); best.search = { trials, pruned, complete: false };
    if (trials === 1 || (improved && performance.now() - lastReport > 100)) { onProgress(best); lastReport = performance.now(); improved = false; }
    if (trials >= Math.max(1, Math.min(2000, maxTrials)) || performance.now() - started >= duration) break;
    if (trials % 4 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
  }
  if (shouldCancel()) return null;
  best.search = { trials, pruned, complete: true }; return best;
}
export function parseCSV(text) {
  const rows = []; let row = [], field = '', quoted = false;
  const input = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === '"') {
      if (quoted && input[i + 1] === '"') { field += '"'; i++; }
      else if (!quoted && field !== '') throw new Error('CSV quote must start at the beginning of a field.');
      else quoted = !quoted;
    } else if (c === ',' && !quoted) { row.push(field); field = ''; }
    else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && input[i + 1] === '\n') i++;
      row.push(field); if (row.some((v) => v.trim())) rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (quoted) throw new Error('CSV has an unclosed quoted field.');
  row.push(field); if (row.some((v) => v.trim())) rows.push(row);
  if (!rows.length) throw new Error('CSV is empty.');
  const headers = rows.shift().map((h) => h.trim().toLowerCase());
  for (const name of ['length', 'width', 'qty']) if (!headers.includes(name)) throw new Error(`CSV needs a ${name} column.`);
  if (!rows.length || rows.length > 100) throw new Error('CSV must contain between 1 and 100 part rows.');
  return rows.map((values, i) => {
    const get = (name, fallback) => headers.includes(name) ? values[headers.indexOf(name)]?.trim() ?? '' : fallback;
    const priority = get('priority', 'normal').toLowerCase();
    if (!['high', 'normal', 'low', '0', '1', '2'].includes(priority)) throw new Error(`CSV row ${i + 2}: priority must be high, normal or low.`);
    const grain = get('grain', 'no').toLowerCase();
    if (!['yes', 'no', 'true', 'false', '1', '0', ''].includes(grain)) throw new Error(`CSV row ${i + 2}: grain must be yes or no.`);
    return { label: get('label', `Part ${i + 1}`), length: Number(get('length', '')), width: Number(get('width', '')), qty: Number(get('qty', '')), material: get('material', 'Plywood'), thickness: Number(get('thickness', '18')), priority: ['high', 'normal', 'low'].includes(priority) ? ['high', 'normal', 'low'].indexOf(priority) : Number(priority), grain: ['yes', 'true', '1'].includes(grain) };
  });
}
export function toCSV(rows) {
  // Prefix spreadsheet formulas while retaining ordinary numeric values.
  const cell = (value) => { let s = String(value ?? ''); if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replaceAll('"', '""') + '"'; };
  return '\uFEFF' + rows.map((row) => row.map(cell).join(',')).join('\r\n');
}
