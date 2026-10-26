// Rectangular guillotine plans. Every cut spans its current workpiece.
const EPS = 1e-7;
const positive = (v) => Number.isFinite(v) && v > 0 && v <= 20000;
const materialKey = (r) => `${r.material.trim().toLowerCase()}|${r.thickness}`;
export function validateProject(project) {
  const { settings, stocks, parts } = project;
  if (!settings || ![settings.kerf, settings.trim].every((v) => Number.isFinite(v) && v >= 0 && v <= 100)) throw new Error('Kerf and edge trim must be between 0 and 100 mm.');
  if (!['auto', 'rip', 'cross'].includes(settings.direction)) throw new Error('Choose a valid cutting direction.');
  if (settings.usePriorities !== undefined && typeof settings.usePriorities !== 'boolean') throw new Error('Part priorities must be enabled or disabled.');
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
  target.kind = 'part'; target.part = { ...p, rotated, x: target.x, y: target.y, w, h };
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
function build(project, order, strategy) {
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
        let base = strategy.slot === 'short' ? short : strategy.slot === 'long' ? long : strategy.slot === 'remnant' ? -areas[0] : leaf.w * leaf.h - w * h;
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
  const plan = finalizePlan(project, sheets, unplaced, order.length);
  plan.searchSeed = { order: order.map((p) => p.id), strategy };
  return plan;
}
function finalizePlan(project, sheets, unplaced, required) {
  let cutLength = 0;
  for (const sheet of sheets) {
    sheet.cuts = []; sheet.parts = []; sheet.offcuts = [];
    let nextWorkpiece = 1;
    const visit = (node, id, prerequisite = null) => {
      node.id = id;
      if (node.kind === 'cut') {
        const step = sheet.cuts.length + 1;
        const first = `S${sheet.number}-W${nextWorkpiece++}`;
        const second = node.second ? `S${sheet.number}-W${nextWorkpiece++}` : null;
        sheet.cuts.push({ step, workpiece: id, prerequisite, x: node.x, y: node.y, w: node.w, h: node.h, axis: node.axis, offset: node.amount, kerf: node.kerf, first, second });
        cutLength += node.axis === 'x' ? node.h : node.w;
        visit(node.first, first, step);
        if (node.second) visit(node.second, second, step);
      } else if (node.kind === 'part') sheet.parts.push({ ...node.part, workpiece: id });
      else sheet.offcuts.push({ ...node, id });
    };
    visit(sheet.root, `S${sheet.number}`);
    sheet.usedArea = sheet.parts.reduce((n, p) => n + p.w * p.h, 0);
    sheet.area = sheet.stock.length * sheet.stock.width;
    sheet.yield = sheet.usedArea / sheet.area;
  }
  const missing = project.settings.usePriorities ? [0, 1, 2].map((priority) => unplaced.filter((p) => p.priority === priority).length) : [unplaced.length];
  const area = sheets.reduce((n, s) => n + s.area, 0);
  const reusableOffcuts = sheets.flatMap((s) => s.offcuts.map((r) => ({ ...r, sheet: s.number, area: r.w * r.h }))).filter((r) => Math.min(r.w, r.h) >= 50 - EPS).sort((a, b) => b.area - a.area || Math.min(b.w, b.h) - Math.min(a.w, a.h));
  const occupiedArea = sheets.reduce((total, s) => total + (Math.max(0, ...s.parts.map((p) => p.x + p.w)) - project.settings.trim) * (Math.max(0, ...s.parts.map((p) => p.y + p.h)) - project.settings.trim), 0);
  const score = [...missing, unplaced.reduce((n, p) => n + p.length * p.width, 0), sheets.length, area];
  const fitness = { primary: score, offcuts: reusableOffcuts.map((r) => r.area), occupiedArea, cutLength, cutCount: sheets.reduce((n, s) => n + s.cuts.length, 0) };
  const remaining = project.stocks.map((s, i) => s.qty - sheets.filter((sheet) => sheet.stockIndex === i).length);
  return { sheets, unplaced, score, fitness, reusableOffcuts, remaining, settings: { ...project.settings }, required, placed: required - unplaced.length };
}
export function timberFreeRegions(board) { return leaves(board.root).map(({ x, y, w, h }) => ({ x, y, w, h })); }
export function manualTimber(project, commands = []) {
  validateProject(project);
  if (!Array.isArray(commands) || commands.length > 500) throw new Error('Invalid manual placement list.');
  const boards = project.stocks.flatMap((stock, stockIndex) => Array.from({ length: stock.qty }, () => ({ stock, stockIndex, root: { kind: 'free', x: project.settings.trim, y: project.settings.trim, w: stock.length - 2 * project.settings.trim, h: stock.width - 2 * project.settings.trim } })));
  boards.forEach((board, i) => { board.number = i + 1; board.parts = []; });
  const expanded = project.parts.flatMap((p, row) => Array.from({ length: p.qty }, (_, copy) => ({ ...p, row, copy: copy + 1, id: `P${row + 1}.${copy + 1}`, label: p.label || `Part ${row + 1}` })));
  const placed = new Set(), byId = new Map(expanded.map((p) => [p.id, p]));
  for (const [index, c] of commands.entries()) {
    const p = c && byId.get(c.partId), board = c && boards[c.board];
    if (!p || !board || placed.has(c.partId) || !Number.isInteger(c.board) || ![c.x, c.y].every(Number.isFinite) || typeof c.rotated !== 'boolean') throw new Error(`Manual placement ${index + 1} is invalid.`);
    if (materialKey(p) !== materialKey(board.stock)) throw new Error('Choose stock with matching material and thickness.');
    if (c.rotated && (!project.settings.rotate || p.grain)) throw new Error('Grain-locked parts cannot rotate.');
    const leaf = leaves(board.root).find((r) => Math.abs(r.x - c.x) < EPS && Math.abs(r.y - c.y) < EPS);
    if (!leaf || !fits(leaf, p, c.rotated)) throw new Error('This part does not fit that free region, including saw kerf.');
    let direction = project.settings.direction;
    if (direction === 'auto') {
      const w = c.rotated ? p.width : p.length, h = c.rotated ? p.length : p.width, k = project.settings.kerf;
      direction = Math.max(leaf.w * Math.max(0, leaf.h - h - k), Math.max(0, leaf.w - w - k) * h) > Math.max(Math.max(0, leaf.w - w - k) * leaf.h, w * Math.max(0, leaf.h - h - k)) ? 'rip' : 'cross';
    }
    insert(leaf, p, c.rotated, direction, project.settings.kerf); placed.add(p.id);
  }
  const used = boards.filter((board) => leaves(board.root).length !== 1 || board.root.kind !== 'free');
  const plan = finalizePlan(project, used, expanded.filter((p) => !placed.has(p.id)), expanded.length);
  return { ...plan, boards, manual: true };
}
export function compareTimberPlans(a, b) {
  const primary = compareNumbers(a.fitness.primary, b.fitness.primary);
  if (primary) return primary;
  // Like Laser: R1 wins before R2, then R3. Small scraps cannot buy a smaller R1.
  const offcuts = compareNumbers(a.fitness.offcuts, b.fitness.offcuts);
  if (offcuts) return -offcuts;
  return compareNumbers([a.fitness.occupiedArea, a.fitness.cutLength, a.fitness.cutCount], [b.fitness.occupiedArea, b.fitness.cutLength, b.fitness.cutCount]);
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
function* candidates(project, warm) {
  const expanded = expand(project), random = randomFor(expanded), population = [];
  const record = (order, strategy) => {
    const plan = build(project, order, strategy);
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
    const strategy = strategies[(i % 4 + Math.floor(i / 4) * 3) % strategies.length];
    yield record([...expanded].sort(priorityOrder(project, sort)), strategy);
  }
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
export function planTimber(project) {
  validateProject(project);
  let best, trials = 0;
  for (const plan of candidates(project)) {
    trials++; if (!best || compareTimberPlans(plan, best) < 0) best = plan;
    if (trials >= 24) break;
  }
  best.searchKey = searchKey(project); best.search = { trials, complete: true };
  return best;
}
export async function optimizeTimber(project, { budgetMs = 1200, maxTrials = 256, initialPlan, onProgress = () => {}, shouldCancel = () => false } = {}) {
  validateProject(project);
  const started = performance.now(), duration = Math.max(0, Math.min(10000, budgetMs));
  let best, trials = 0, lastReport = started, improved = false;
  for (const plan of candidates(project, initialPlan)) {
    if (shouldCancel()) return null;
    trials++;
    if (!best || compareTimberPlans(plan, best) < 0) { best = plan; improved = true; }
    best.searchKey = searchKey(project); best.search = { trials, complete: false };
    if (trials === 1 || (improved && performance.now() - lastReport > 100)) { onProgress(best); lastReport = performance.now(); improved = false; }
    if (trials >= Math.max(1, Math.min(2000, maxTrials)) || performance.now() - started >= duration) break;
    if (trials % 4 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
  }
  if (shouldCancel()) return null;
  best.search = { trials, complete: true }; return best;
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
