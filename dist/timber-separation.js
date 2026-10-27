import { cutSegments } from './timber-cut-passes.js?v=0.31.1';
import { t } from './locale.js?v=0.31.1';
import { timberCutOverlay } from './timber-cut-overlay.js?v=0.31.1';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (n) => Number(n.toFixed(2)).toLocaleString('en-GB', { maximumFractionDigits: 2 });
const colors = ['#e5d2af', '#d0dbbd', '#c7d8dd', '#dbcee0', '#e8c8b0'];
const geometryCache = new WeakMap(), domCache = new WeakMap();

function geometry(sheet) {
  let cached = geometryCache.get(sheet); if (cached) return cached;
  const nodes = [], byWorkpiece = new Map(cutSegments(sheet).map((cut) => [cut.workpiece, cut]));
  const visit = (node) => { nodes.push(node); if (node.first) visit(node.first); if (node.second) visit(node.second); };
  visit(sheet.root);
  const size = Math.max(sheet.stock.length, sheet.stock.width);
  const average = sheet.parts.length ? sheet.parts.reduce((n, p) => n + Math.min(p.w, p.h), 0) / sheet.parts.length : size / 4;
  cached = { nodes, byWorkpiece, gap: Math.max(size * .006, Math.min(size * .045, average * .25)) };
  geometryCache.set(sheet, cached); return cached;
}

// Slicing-tree layout: expand parent regions to fit their separated descendants.
// This keeps sibling pieces apart even after later cuts expand their subtrees.
export function timberSeparationLayout(sheet, state) {
  const { byWorkpiece, gap } = geometry(sheet), pieces = new Map(), cutOffsets = new Map();
  const measure = (node) => {
    const cut = byWorkpiece.get(node.id);
    const completed = !!cut && (state.finished || cut.step <= state.completedThrough);
    const currentSplit = !!cut && state.active && cut.step === state.step && state.splitReady;
    const opened = completed || currentSplit, fraction = completed ? 1 : currentSplit ? state.separation : 0;
    const first = node.first ? measure(node.first) : null, second = node.second ? measure(node.second) : null;
    let w = node.w, h = node.h;
    if (opened && first) {
      if (second && cut.axis === 'x') { w = first.w + cut.kerf + gap * fraction + second.w; h = Math.max(first.h, second.h); }
      else if (second) { w = Math.max(first.w, second.w); h = first.h + cut.kerf + gap * fraction + second.h; }
      else { w = Math.max(node.w, first.w); h = Math.max(node.h, first.h); }
    }
    return { node, cut, opened, fraction, first, second, w, h };
  };
  const root = measure(sheet.root);
  const place = (entry, x, y, exposed) => {
    const { node, cut, opened, fraction, first, second } = entry;
    const dx = x - node.x, dy = y - node.y;
    pieces.set(node.id, { node, dx, dy, x, y, w: entry.w, h: entry.h, visible: exposed && !opened });
    if (cut) cutOffsets.set(node.id, {
      x: dx + (opened && second && cut.axis === 'x' ? first.w - node.first.w + gap * fraction / 2 : 0),
      y: dy + (opened && second && cut.axis === 'y' ? first.h - node.first.h + gap * fraction / 2 : 0),
      w: entry.w, h: entry.h,
    });
    if (first) place(first, x + node.first.x - node.x, y + node.first.y - node.y, exposed && opened);
    if (second) {
      const nextX = opened && cut.axis === 'x' ? x + first.w + cut.kerf + gap * fraction : x + node.second.x - node.x;
      const nextY = opened && cut.axis === 'y' ? y + first.h + cut.kerf + gap * fraction : y + node.second.y - node.y;
      place(second, nextX, nextY, exposed && opened);
    }
  };
  place(root, sheet.root.x, sheet.root.y, true);
  return { pieces, cutOffsets, width: root.w, height: root.h, gap };
}

export function separatedBoardSVG(sheet, selectedStep, state) {
  const size = Math.max(sheet.stock.length, sheet.stock.width), margin = size * .065;
  const full = timberSeparationLayout(sheet, { active: true, finished: true, completedThrough: Infinity, separation: 1 });
  const overlay = timberCutOverlay(sheet, selectedStep, state);
  const { nodes } = geometry(sheet);
  const pieces = nodes.map((node) => {
    const part = node.kind === 'part' ? node.part : null, offcut = node.kind === 'free';
    const fill = part ? colors[part.row % colors.length] : offcut ? '#e3ecd9' : '#e4d2af';
    const name = part ? part.id : offcut ? t('Offcut','餘料') : node.id;
    const detail = part ? part.label : offcut ? node.id : t('Workpiece','板件');
    const fs = Math.min(size * .014, node.w / 9, node.h / 3.5), depth = Math.min(size * .004, node.h * .04);
    return `<g data-sim-piece="${esc(node.id)}" style="display:none"><title>${esc(name)} · ${esc(detail)} · ${fmt(node.w)} × ${fmt(node.h)} mm</title><rect x="${node.x + depth}" y="${node.y + depth}" width="${node.w}" height="${node.h}" rx="${size / 1200}" fill="#9f8766" opacity=".3"/><rect x="${node.x}" y="${node.y}" width="${node.w}" height="${node.h}" rx="${size / 1200}" fill="${fill}" stroke="${offcut ? '#93aa7d' : '#9d8867'}" stroke-width="${size / 1100}"/><text x="${node.x + node.w / 2}" y="${node.y + node.h / 2 - fs * .35}" font-size="${fs}" font-family="sans-serif" text-anchor="middle" fill="#5c594b">${esc(name)}</text><text x="${node.x + node.w / 2}" y="${node.y + node.h / 2 + fs * .85}" font-size="${fs * .7}" font-family="sans-serif" text-anchor="middle" fill="#7d796b">${fmt(node.w)} × ${fmt(node.h)} mm</text></g>`;
  }).join('');
  const width = Math.max(sheet.stock.length, sheet.root.x + full.width) + margin + overlay.rightMargin;
  const height = Math.max(sheet.stock.width, sheet.root.y + full.height) + margin * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" data-board-simulation="separated" viewBox="${-margin} ${-margin} ${width} ${height}" role="img" aria-label="Sheet ${sheet.number}: simulated board separation, all cuts numbered; gaps exaggerated for clarity"><g class="simulated-pieces">${pieces}</g>${overlay.markup}</svg>`;
}

export function updateBoardSeparation(svg, sheet, state) {
  if (!svg?.matches('[data-board-simulation="separated"]')) return;
  let elements = domCache.get(svg);
  if (!elements) {
    elements = {
      pieces: [...svg.querySelectorAll('[data-sim-piece]')],
      overlays: [...svg.querySelectorAll('[data-cut-workpiece]')],
      contexts: [...svg.querySelectorAll('[data-cut-context]')],
      lines: [...svg.querySelectorAll('[data-cut-line]')].map((el) => ({ el, cut: cutSegments(sheet).find((c) => c.workpiece === el.parentElement.dataset.cutWorkpiece) })),
    }; domCache.set(svg, elements);
  }
  const layout = timberSeparationLayout(sheet, state);
  for (const el of elements.pieces) {
    const piece = layout.pieces.get(el.dataset.simPiece); if (!piece) continue;
    const display = piece.visible ? '' : 'none'; if (el.style.display !== display) el.style.display = display;
    const transform = `translate(${piece.dx} ${piece.dy})`; if (el.getAttribute('transform') !== transform) el.setAttribute('transform', transform);
  }
  for (const el of elements.overlays) {
    const offset = layout.cutOffsets.get(el.dataset.cutWorkpiece); if (!offset) continue;
    const transform = `translate(${offset.x} ${offset.y})`; if (el.getAttribute('transform') !== transform) el.setAttribute('transform', transform);
  }
  for (const { el, cut } of elements.lines) {
    const offset = layout.cutOffsets.get(cut.workpiece);
    const attr = cut.axis === 'x' ? 'y2' : 'x2', value = String(cut.axis === 'x' ? cut.y + offset.h : cut.x + offset.w);
    if (el.getAttribute(attr) !== value) el.setAttribute(attr, value);
  }
  for (const el of elements.contexts) el.style.display = state.splitReady ? 'none' : '';
  return layout;
}
