import { scheduleCuts, fenceOf } from './timber-cut-passes.js?v=0.32.2';
import { cachedSimplifyTimberCuts } from './timber-cut-planner.js?v=0.32.2';
import { validateTimberSettings, settingValue } from './timber-settings.js?v=0.32.2';
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
// stock area used, then number of sheets. Known as soon as parts are placed, before
// any cut is ordered. Stock area comes before the sheet count (roadmap 3.2) so a few
// small offcut rows win over cutting into a new full sheet; with one stock size the
// two orders are the same.
function primaryScore(project, sheets, unplaced) {
  const missing = project.settings.usePriorities ? [0, 1, 2].map((priority) => unplaced.filter((p) => p.priority === priority).length) : [unplaced.length];
  return [...missing, unplaced.reduce((n, p) => n + p.length * p.width, 0), sheets.reduce((n, s) => n + s.stock.length * s.stock.width, 0), sheets.length];
}
// cutoff: a primary score to beat. A layout already worse than it cannot rank, so its
// cuts are not ordered (the slow part) and a pruned stand-in is returned instead.
// Guillotine placement only: parts in `order` go into the best free region by
// `strategy`, opening stock sheets as needed. No cut ordering.
function place(project, order, strategy) {
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
  return { sheets, unplaced };
}
function build(project, order, strategy, cutoff = null, cutCache = null) {
  const { sheets, unplaced } = place(project, order, strategy);
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
// One label per finished part (roadmap 2.3): what is written on it and when it comes
// off the saw. `step` is the cut that separates the part from its last neighbour on
// that sheet; null when the part is the whole prepared sheet.
export function partLabels(plan) {
  const labels = [];
  for (const sheet of plan.sheets) {
    const releasedAt = new Map();
    for (const c of sheet.cuts) for (const id of c.releasedParts || []) if (!releasedAt.has(id)) releasedAt.set(id, c.step);
    for (const p of sheet.parts) labels.push({ id: p.id, label: p.label, material: p.material, thickness: p.thickness, length: p.length, width: p.width, grain: !!p.grain, rotated: !!p.rotated, sheet: sheet.number, step: releasedAt.get(p.id) ?? null, machine: sheet.saw === 'hybrid' ? (sheet.cuts.find((c) => c.step === releasedAt.get(p.id))?.saw ?? null) : null });
  }
  const order = (id) => id.slice(1).split('.').map(Number);
  return labels.sort((a, b) => a.sheet - b.sheet || (a.step ?? 0) - (b.step ?? 0) || order(a.id)[0] - order(b.id)[0] || order(a.id)[1] - order(b.id)[1]);
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
// Roadmap 2.4: try to empty the least-used sheets into the gaps of the others. The
// plan's own placement order is kept for every other part and the weak sheet's parts
// go last, largest first, so they land in existing free regions before a new sheet
// is opened. A result is kept only when compareTimberPlans ranks it better, so the
// pass can never make a plan worse.
function repackPlan(project, plan, { cutCache = null, rounds = 3, weakest = 2 } = {}) {
  if (!plan?.searchSeed?.strategy || plan.sheets.length < 2) return plan;
  const byId = new Map(expand(project).map((p) => [p.id, p]));
  const tails = [(a, b) => b.length * b.width - a.length * a.width, (a, b) => Math.max(b.length, b.width) - Math.max(a.length, a.width)];
  let best = plan;
  for (let round = 0; round < rounds; round++) {
    let improved = false;
    for (const weak of [...best.sheets].sort((a, b) => a.yield - b.yield || b.number - a.number).slice(0, weakest)) {
      const moving = new Set(weak.parts.map((p) => p.id));
      const base = best.searchSeed.order.filter((id) => !moving.has(id)).map((id) => byId.get(id));
      for (const tail of tails) {
        const order = [...base, ...[...moving].map((id) => byId.get(id)).sort((a, b) => tail(a, b) || canonicalPart(a, b))];
        if (project.settings.usePriorities) order.sort((a, b) => a.priority - b.priority);
        for (const strategy of [best.searchSeed.strategy, ...strategies.filter((s) => s !== best.searchSeed.strategy).slice(0, 2)]) {
          const candidate = build(project, order, strategy, best.fitness.primary, cutCache);
          if (!candidate.pruned && compareTimberPlans(candidate, best) < 0) { best = candidate; improved = true; break; }
        }
        if (improved) break;
      }
      if (improved) break;
    }
    if (!improved) break;
  }
  if (best !== plan) best.repacked = true;
  return best;
}
// Roadmap 3.1: sheet-by-sheet filling with value correction (SVC). Each round fills one
// sheet at a time with the most valuable set of remaining parts it can hold, trying a
// few orders; afterwards the parts on poorly used sheets are made more valuable, so the
// next round places them earlier. It finds plans with fewer sheets where the
// whole-list greedy orders cannot, at the cost of some extra cuts.
const partIds = (node, out = []) => { if (node.kind === 'part') out.push(node.part.id); if (node.first) partIds(node.first, out); if (node.second) partIds(node.second, out); return out; };
// No plan can use fewer sheets than total part area over usable sheet area, per material.
function sheetLowerBound(project) {
  const t = project.settings.trim, need = new Map(), sheet = new Map();
  for (const p of project.parts) need.set(materialKey(p), (need.get(materialKey(p)) || 0) + p.qty * p.length * p.width);
  for (const s of project.stocks) sheet.set(materialKey(s), Math.max(sheet.get(materialKey(s)) || 0, (s.length - 2 * t) * (s.width - 2 * t)));
  return [...need].reduce((n, [key, area]) => n + (sheet.get(key) ? Math.ceil(area / sheet.get(key) - 1e-9) : 0), 0);
}
function* valueCorrection(project, { alpha = 0.3, ordersPerSheet = 12 } = {}) {
  const items = expand(project), byId = new Map(items.map((p) => [p.id, p]));
  const value = new Map(items.map((p) => [p.id, p.length * p.width])), random = randomFor(items);
  for (;;) {
    let remaining = items; const sheets = [], stockLeft = project.stocks.map((s) => s.qty);
    while (remaining.length) {
      let pick = null;
      for (let k = 0; k < ordersPerSheet; k++) {
        const noise = k === 0 ? 0 : 0.25, size = k % 3 !== 1;
        const key = new Map(remaining.map((p) => [p.id, (value.get(p.id) / (p.length * p.width)) * (1 + noise * (random() - 0.5)) * (size ? p.length * p.width : 1)]));
        const order = [...remaining].sort((a, b) => key.get(b.id) - key.get(a.id) || canonicalPart(a, b));
        const stocks = project.stocks.map((s, i) => ({ ...s, qty: Math.min(1, stockLeft[i]) }));
        const one = place({ ...project, stocks }, order, strategies[k % strategies.length]).sheets[0];
        if (!one) continue;
        const ids = partIds(one.root), worth = ids.reduce((n, id) => n + value.get(id), 0);
        if (!pick || worth > pick.worth) { const on = new Set(ids); one.placedOrder = order.filter((p) => on.has(p.id)).map((p) => p.id); pick = { sheet: one, ids, worth }; }
      }
      if (!pick) break;
      stockLeft[pick.sheet.stockIndex]--; sheets.push(pick.sheet);
      const placed = new Set(pick.ids); remaining = remaining.filter((p) => !placed.has(p.id));
    }
    for (const sheet of sheets) {
      const ids = partIds(sheet.root), used = ids.reduce((n, id) => n + byId.get(id).length * byId.get(id).width, 0) / (sheet.stock.length * sheet.stock.width);
      for (const id of ids) { const area = byId.get(id).length * byId.get(id).width; value.set(id, (1 - alpha) * value.get(id) + alpha * area / Math.max(used, 0.05)); }
    }
    for (const p of remaining) value.set(p.id, value.get(p.id) * 1.5);
    yield { sheets, unplaced: remaining };
  }
}
// Re-lay each sheet's own parts for the fewest cuts (same parts, same stock), then
// number and finalize the plan.
function finishSheets(project, raw, unplaced, cutCache) {
  const byId = new Map(expand(project).map((p) => [p.id, p]));
  const sheets = raw.map((sheet) => {
    const own = partIds(sheet.root).map((id) => byId.get(id));
    const sub = { ...project, stocks: project.stocks.map((s, i) => ({ ...s, qty: i === sheet.stockIndex ? 1 : 0 })) };
    let top = null;
    for (const sort of sorts) for (const strategy of strategies) {
      const order = [...own].sort((a, b) => sort(a, b) || canonicalPart(a, b));
      const plan = build(sub, order, strategy, null, cutCache);
      if (!plan.unplaced.length && (!top || compareTimberPlans(plan, top.plan) < 0)) top = { plan, order, strategy };
    }
    if (!top) return sheet;
    const laid = place(sub, top.order, top.strategy).sheets[0]; laid.placedOrder = top.order.map((p) => p.id); return laid;
  });
  sheets.forEach((s, i) => { s.number = i + 1; });
  const plan = finalizePlan(project, sheets, unplaced, byId.size, cutCache);
  // The placement order, sheet by sheet, lets Manual Adjust replay the layout. With no
  // strategy it is not a seed for the whole-list search.
  plan.searchSeed = { order: sheets.flatMap((s) => s.placedOrder), strategy: null }; plan.method = 'value-correction';
  return plan;
}
function* candidates(project, warm, { pruning = true, keep = 8, caching = true, cutCache = caching ? new Map() : null } = {}) {
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
  if (warm?.searchKey === searchKey(project) && warm.searchSeed?.strategy) {
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
// plan more slowly; the switches are kept for tests and benchmarks. repack (on) runs
// repackPlan on the winner; it only ever replaces it with a better plan.
export function planTimber(project, { pruning = true, caching = true, repack = true } = {}) {
  validateProject(project);
  let best, trials = 0, pruned = 0;
  const cutCache = caching ? new Map() : null;
  // Its 30 tries are fixed sorts and never draw parents from the population.
  for (const plan of candidates(project, null, { pruning, caching, cutCache, keep: 1 })) {
    trials++; if (plan.pruned) pruned++; else if (!best || compareTimberPlans(plan, best) < 0) best = plan;
    if (trials >= 30) break;
  }
  if (repack) best = repackPlan(project, best, { cutCache });
  best.searchKey = searchKey(project); best.search = { trials, pruned, complete: true };
  return best;
}
export async function optimizeTimber(project, { budgetMs = 1200, maxTrials = 256, initialPlan, onProgress = () => {}, shouldCancel = () => false, pruning = true, caching = true, repack = true, valueCorrection: svc = true } = {}) {
  validateProject(project);
  const started = performance.now(), duration = Math.max(0, Math.min(10000, budgetMs));
  let best, trials = 0, pruned = 0, lastReport = started, improved = false;
  const cutCache = caching ? new Map() : null;
  // Sheet-by-sheet value correction (3.1) runs only when the usual search leaves a gap
  // to the area lower bound, every part fits and part priorities are off.
  const bound = svc && !project.settings.usePriorities ? sheetLowerBound(project) : Infinity;
  const gap = () => best && !best.unplaced.length && best.sheets.length > bound;
  const svcStart = started + duration * 0.5, svcShare = duration * 0.15;
  const search = candidates(project, initialPlan, { pruning, caching, cutCache });
  let svcDone = false, rounds = 0;
  for (;;) {
    const { value: plan } = search.next();
    if (shouldCancel()) return null;
    trials++; if (plan.pruned) pruned++;
    else if (!best || compareTimberPlans(plan, best) < 0) { best = plan; improved = true; }
    best.searchKey = searchKey(project); best.search = { trials, pruned, complete: false };
    if (trials === 1 || (improved && performance.now() - lastReport > 100)) { onProgress(best); lastReport = performance.now(); improved = false; }
    if (trials >= Math.max(1, Math.min(2000, maxTrials)) || performance.now() - started >= duration) break;
    if (trials % 4 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    // Value correction runs once, from half the time or half the tries, for at most 8 rounds or 15 % of the
    // time (on the benchmark lists its first round already saves the sheet); the usual
    // search then resumes where it stopped.
    if (!svcDone && gap() && (performance.now() >= svcStart || trials >= Math.min(2000, maxTrials) / 2)) {
      svcDone = true;
      const svcEnd = performance.now() + svcShare;
      let top = null;
      for (const round of valueCorrection(project)) {
        if (shouldCancel()) return null;
        rounds++;
        if (!round.unplaced.length && (!top || round.sheets.length < top.sheets.length)) top = round;
        if (top?.sheets.length <= bound || rounds >= 8 || performance.now() >= svcEnd) break;
        if (rounds % 4 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
      }
      if (top && top.sheets.length < best.sheets.length) {
        const plan = finishSheets(project, top.sheets, top.unplaced, cutCache);
        if (compareTimberPlans(plan, best) < 0) { plan.searchKey = searchKey(project); best = plan; onProgress(best); }
      }
    }
  }
  if (shouldCancel()) return null;
  // Polish the winner once at the end; the pass only ever keeps a better plan.
  if (repack && !best.repacked && best.searchSeed?.strategy) { const polished = repackPlan(project, best, { cutCache }); if (polished !== best) { polished.searchKey = searchKey(project); best = polished; } }
  best.search = { trials, pruned, valueRounds: rounds, complete: true }; return best;
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

// Roadmap 2.5: rows pasted from a spreadsheet (tab-separated; comma or semicolon when
// there are no tabs). A header row names the columns; without one, the text cell is
// the label, the two largest numbers are length and width, a whole number ≤ 500 is the
// quantity and any number left over is the thickness. Lines that cannot be read are
// counted in `skipped`, never guessed.
const PASTE_HEADERS = {
  label: ['label', 'name', 'part', 'description', '名稱', '零件'], length: ['length', 'l', 'len', '長', '長度'], width: ['width', 'w', '闊', '寬', '寬度'],
  qty: ['qty', 'quantity', 'count', 'no', 'pcs', '數量'], material: ['material', '物料', '材料'], thickness: ['thickness', 't', 'thk', '厚', '厚度'], grain: ['grain', '木紋'],
};
const pasteNumber = (v) => { const t = String(v).trim().replace(/\s*(mm|毫米)$/i, '').replace(/(\d),(\d{3})/g, '$1$2'); return /^\d+(\.\d+)?$/.test(t) ? Number(t) : null; };
export function parsePastedParts(text, defaults = {}) {
  const { material = 'Plywood', thickness = 18 } = defaults;
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { rows: [], skipped: 0, header: false };
  const sep = lines.some((l) => l.includes('\t')) ? '\t' : lines.some((l) => l.includes(';')) ? ';' : ',';
  const cells = lines.map((l) => l.split(sep).map((c) => c.trim().replace(/^"(.*)"$/, '$1')));
  const column = (name) => cells[0].findIndex((h) => PASTE_HEADERS[name].includes(h.toLowerCase().replace(/\(.*?\)|（.*?）|\bmm\b|毫米/g, '').replace(/[^a-z\u4e00-\u9fff]/g, '')));
  const header = column('length') >= 0 && column('width') >= 0;
  const rows = []; let skipped = 0;
  for (const row of header ? cells.slice(1) : cells) {
    let part;
    if (header) {
      const get = (name) => { const i = column(name); return i >= 0 ? row[i] ?? '' : ''; };
      const grain = get('grain').toLowerCase();
      part = { label: get('label'), length: pasteNumber(get('length')), width: pasteNumber(get('width')), qty: get('qty') ? pasteNumber(get('qty')) : 1, material: get('material') || material, thickness: get('thickness') ? pasteNumber(get('thickness')) : thickness, grain: ['yes', 'y', 'true', '1', '是'].includes(grain) };
    } else {
      const numbers = row.map((v, i) => ({ v: pasteNumber(v), i })).filter((x) => x.v !== null);
      const words = row.filter((v) => v && pasteNumber(v) === null);
      if (numbers.length < 2) { skipped++; continue; }
      const dims = [...numbers].sort((a, b) => b.v - a.v).slice(0, 2).sort((a, b) => a.i - b.i);
      const rest = numbers.filter((x) => !dims.includes(x));
      const qty = rest.filter((x) => Number.isInteger(x.v) && x.v >= 1 && x.v <= 500).sort((a, b) => a.v - b.v)[0];
      const thick = rest.find((x) => x !== qty);
      part = { label: words[0] || '', length: Math.max(dims[0].v, dims[1].v), width: Math.min(dims[0].v, dims[1].v), qty: qty ? qty.v : 1, material, thickness: thick ? thick.v : thickness, grain: false };
    }
    const ok = [part.length, part.width, part.qty, part.thickness].every((v) => Number.isFinite(v) && v > 0) && Number.isInteger(part.qty) && part.qty <= 500 && part.length <= 20000;
    if (!ok) { skipped++; continue; }
    rows.push({ ...part, label: part.label.slice(0, 100), material: part.material.slice(0, 80), priority: 1 });
  }
  return { rows, skipped, header };
}
