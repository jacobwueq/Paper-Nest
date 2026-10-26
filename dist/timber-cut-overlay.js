import { t } from './locale.js?v=0.26.1';
const escapeHTML = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const escWorkpiece = (s) => escapeHTML(s || '');

// In hybrid mode each machine keeps its own colour: filled = completed, outline = still to cut,
// red = the current cut. Hex values because the same SVG goes into the PDF.
export const SAW_COLOURS = { panel: '#2f6f8f', table: '#8a4fb0' };
// Keep the entire cut order visible; selection only changes its emphasis.
export function timberCutOverlay(sheet, selectedStep = 0, playback = null) {
  const machineOf = (step) => sheet.saw === 'hybrid' ? SAW_COLOURS[sheet.cuts.find((c) => c.step === step)?.saw] : null;
  const L = sheet.stock.length, W = sheet.stock.width, size = Math.max(L, W);
  const radius = size * .018, margin = size * .045, spacing = radius * 2.3;
  let rightMargin = margin, overflow = 0;
  const badges = [], segments = [];
  for (const cut of sheet.cuts) {
    const vertical = cut.axis === 'x';
    const x1 = vertical ? cut.x + cut.offset : cut.x, y1 = vertical ? cut.y : cut.y + cut.offset;
    const x2 = vertical ? x1 : cut.x + cut.w, y2 = vertical ? cut.y + cut.h : y1;
    let badge;
    for (const offset of [0, spacing, -spacing, spacing * 2, -spacing * 2]) {
      for (const fraction of [.5, .2, .8, .35, .65, .05, .95]) {
        const anchorX = x1 + (x2 - x1) * fraction, anchorY = y1 + (y2 - y1) * fraction;
        const x = anchorX + (vertical ? offset : 0), y = anchorY + (vertical ? 0 : offset);
        if (x - radius < -margin || x + radius > L + margin || y - radius < -margin || y + radius > W + margin) continue;
        if (badges.some((other) => Math.hypot(x - other.x, y - other.y) < spacing)) continue;
        badge = { x, y, anchorX, anchorY, step: cut.step }; break;
      }
      if (badge) break;
    }
    if (!badge) {
      const rows = Math.max(1, Math.floor((W + 2 * margin - 2 * radius) / spacing) + 1);
      const x = L + margin + spacing + Math.floor(overflow / rows) * spacing;
      const y = -margin + radius + (overflow % rows) * spacing;
      badge = { x, y, anchorX: (x1 + x2) / 2, anchorY: (y1 + y2) / 2, step: cut.step };
      rightMargin = Math.max(rightMargin, x + radius + margin / 3 - L); overflow++;
    }
    badges.push(badge);
    for (const member of cut.segments || [cut]) {
      const v = member.axis === 'x', ax = v ? member.x + member.offset : member.x, ay = v ? member.y : member.y + member.offset;
      segments.push({ cut: member, x1: ax, y1: ay, x2: v ? ax : member.x + member.w, y2: v ? member.y + member.h : ay });
    }
  }
  const selected = sheet.cuts.find((cut) => cut.step === selectedStep);
  const context = selected && !playback?.finished ? (selected.segments || [selected]).map((c) => `<g data-cut-context="true" data-cut-workpiece="${escWorkpiece(c.workpiece)}"><rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" fill="${playback?.active ? '#f6dda0' : 'none'}" fill-opacity=".18" stroke="#c9917d" stroke-width="${size / 1100}" stroke-dasharray="${size / 250} ${size / 300}"/></g>`).join('') : '';
  const lines = segments.map(({ cut, x1, y1, x2, y2 }) => {
    const active = cut.step === selectedStep;
    const completed = playback?.active && cut.step <= playback.completedThrough;
    return `<g data-cut-workpiece="${escWorkpiece(cut.workpiece)}"><line data-cut-line="${cut.step}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${active ? '#b3261e' : machineOf(cut.step) || (completed ? '#4f805e' : '#ad7057')}" stroke-width="${size / (active ? 450 : 950)}" opacity="${playback?.active && !active && !completed ? .4 : 1}" ${active || completed ? '' : `stroke-dasharray="${size / 260} ${size / 390}"`}/></g>`;
  }).join('');
  const leaders = [];
  const labels = badges.map((badge) => {
    const active = badge.step === selectedStep, completed = playback?.active && badge.step <= playback.completedThrough, color = active ? '#c64a31' : machineOf(badge.step) || (completed ? '#4f805e' : '#9a5e47');
    const leader = Math.hypot(badge.x - badge.anchorX, badge.y - badge.anchorY) > radius ? `<line x1="${badge.anchorX}" y1="${badge.anchorY}" x2="${badge.x}" y2="${badge.y}" stroke="${color}" stroke-width="${size / 1300}"/>` : '';
    const workpiece = sheet.cuts.find((cut) => cut.step === badge.step)?.workpiece;
    leaders.push(leader ? `<g data-cut-workpiece="${escWorkpiece(workpiece)}">${leader}</g>` : '');
    return `<g data-cut-number="${badge.step}" data-cut-workpiece="${escWorkpiece(workpiece)}" aria-label="${t("Cut","第")} ${escapeHTML(badge.step)}${t(""," 刀")}${completed ? ', completed' : active ? ', selected' : ''}"><title>${t("Cut","第")} ${escapeHTML(badge.step)}${t(""," 刀")}${completed ? t(' · completed',' · 已完成') : active ? t(' · selected',' · 已選') : ''}</title><circle cx="${badge.x}" cy="${badge.y}" r="${radius}" fill="${active || completed ? color : '#fffdf9'}" stroke="${color}" stroke-width="${size / 1100}"/><text x="${badge.x}" y="${badge.y}" dy=".35em" text-anchor="middle" font-family="sans-serif" font-size="${radius * (String(badge.step).length > 2 ? .8 : 1.05)}" font-weight="700" fill="${active || completed ? '#ffffff' : color}">${escapeHTML(badge.step)}</text></g>`;
  }).join('');
  let trace = '';
  if (selected && playback?.active && !playback.finished && !playback.reducedMotion) {
    trace = segments.filter(({ cut }) => cut.step === selectedStep).map(({ cut, x1, y1 }) => {
      const point = cutTracePoint(selected, cut, playback.progress);
      return `<g class="cut-play-stroke" data-cut-workpiece="${escWorkpiece(cut.workpiece)}"><line data-cut-trace="${selectedStep}" x1="${x1}" y1="${y1}" x2="${point.x}" y2="${point.y}" data-cut-target="${escWorkpiece(cut.workpiece)}" stroke="#f0ae35" stroke-width="${size / 330}" stroke-linecap="round"/><circle data-cut-head="${selectedStep}" cx="${point.x}" cy="${point.y}" data-cut-target="${escWorkpiece(cut.workpiece)}" style="display:${point.head ? '' : 'none'}" r="${size * .006}" fill="#ffffff" stroke="#c64a31" stroke-width="${size / 900}"/></g>`;
    }).join('');
  }
  return { markup: `<g class="numbered-cut-overlay" pointer-events="none">${context}${lines}${trace}${leaders.join('')}${labels}</g>`, rightMargin, badges, radius };
}

export function cutTracePoint(operation, segment, progress) {
  const members = operation.segments || [operation], vertical = segment.axis === 'x';
  const across = vertical ? 'y' : 'x', extent = vertical ? 'h' : 'w';
  const start = Math.min(...members.map((c) => c[across])), end = Math.max(...members.map((c) => c[across] + c[extent]));
  const distance = start + (end - start) * Math.max(0, Math.min(1, progress));
  const fraction = Math.max(0, Math.min(1, (distance - segment[across]) / segment[extent]));
  return { x: vertical ? segment.x + segment.offset : segment.x + segment.w * fraction, y: vertical ? segment.y + segment.h * fraction : segment.y + segment.offset,
    head: distance >= segment[across] && distance <= segment[across] + segment[extent] };
}
export function updateCutTrace(svg, operation, state) {
  if (!svg || !operation) return;
  const members = operation.segments || [operation];
  for (const trace of svg.querySelectorAll('[data-cut-trace]')) {
    const segment = members.find((c) => (c.workpiece || '') === trace.dataset.cutTarget); if (!segment) continue;
    const point = cutTracePoint(operation, segment, state.progress);
    trace.setAttribute('x2', point.x); trace.setAttribute('y2', point.y);
    const head = trace.parentElement.querySelector('[data-cut-head]');
    head.setAttribute('cx', point.x); head.setAttribute('cy', point.y); head.style.display = point.head ? '' : 'none';
  }
}
