import { t } from './locale.js?v=0.23.0';
const escapeHTML = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const escWorkpiece = (s) => escapeHTML(s || '');

// Keep the entire cut order visible; selection only changes its emphasis.
export function timberCutOverlay(sheet, selectedStep = 0, playback = null) {
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
    badges.push(badge); segments.push({ cut, x1, y1, x2, y2 });
  }
  const selected = sheet.cuts.find((cut) => cut.step === selectedStep);
  const context = selected && !playback?.finished ? `<g data-cut-context="true" data-cut-workpiece="${escWorkpiece(selected.workpiece)}"><rect x="${selected.x}" y="${selected.y}" width="${selected.w}" height="${selected.h}" fill="${playback?.active ? '#f6dda0' : 'none'}" fill-opacity=".18" stroke="#c9917d" stroke-width="${size / 1100}" stroke-dasharray="${size / 250} ${size / 300}"/></g>` : '';
  const lines = segments.map(({ cut, x1, y1, x2, y2 }) => {
    const active = cut.step === selectedStep;
    const completed = playback?.active && cut.step <= playback.completedThrough;
    return `<g data-cut-workpiece="${escWorkpiece(cut.workpiece)}"><line data-cut-line="${cut.step}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${completed ? '#4f805e' : active ? '#c64a31' : '#ad7057'}" stroke-width="${size / (active ? 450 : 950)}" opacity="${playback?.active && !active && !completed ? .4 : 1}" ${active || completed ? '' : `stroke-dasharray="${size / 260} ${size / 390}"`}/></g>`;
  }).join('');
  const leaders = [];
  const labels = badges.map((badge) => {
    const active = badge.step === selectedStep, completed = playback?.active && badge.step <= playback.completedThrough, color = completed ? '#4f805e' : active ? '#c64a31' : '#9a5e47';
    const leader = Math.hypot(badge.x - badge.anchorX, badge.y - badge.anchorY) > radius ? `<line x1="${badge.anchorX}" y1="${badge.anchorY}" x2="${badge.x}" y2="${badge.y}" stroke="${color}" stroke-width="${size / 1300}"/>` : '';
    const workpiece = sheet.cuts.find((cut) => cut.step === badge.step)?.workpiece;
    leaders.push(leader ? `<g data-cut-workpiece="${escWorkpiece(workpiece)}">${leader}</g>` : '');
    return `<g data-cut-number="${badge.step}" data-cut-workpiece="${escWorkpiece(workpiece)}" aria-label="${t("Cut","第")} ${escapeHTML(badge.step)}${t(""," 刀")}${completed ? ', completed' : active ? ', selected' : ''}"><title>${t("Cut","第")} ${escapeHTML(badge.step)}${t(""," 刀")}${completed ? t(' · completed',' · 已完成') : active ? t(' · selected',' · 已選') : ''}</title><circle cx="${badge.x}" cy="${badge.y}" r="${radius}" fill="${active || completed ? color : '#fffdf9'}" stroke="${color}" stroke-width="${size / 1100}"/><text x="${badge.x}" y="${badge.y}" dy=".35em" text-anchor="middle" font-family="sans-serif" font-size="${radius * (String(badge.step).length > 2 ? .8 : 1.05)}" font-weight="700" fill="${active || completed ? '#ffffff' : color}">${escapeHTML(badge.step)}</text></g>`;
  }).join('');
  const segment = segments.find(({ cut }) => cut.step === selectedStep);
  let trace = '';
  if (segment && playback?.active && !playback.finished && !playback.reducedMotion) {
    const { x1, y1, x2, y2 } = segment, p = Math.max(0, Math.min(1, playback.progress));
    const x = x1 + (x2 - x1) * p, y = y1 + (y2 - y1) * p;
    trace = `<g class="cut-play-stroke" data-cut-workpiece="${escWorkpiece(segment.cut.workpiece)}"><line data-cut-trace="${selectedStep}" x1="${x1}" y1="${y1}" x2="${x}" y2="${y}" stroke="#f0ae35" stroke-width="${size / 330}" stroke-linecap="round"/><circle data-cut-head="${selectedStep}" cx="${x}" cy="${y}" r="${size * .006}" fill="#ffffff" stroke="#c64a31" stroke-width="${size / 900}"/></g>`;
  }
  return { markup: `<g class="numbered-cut-overlay" pointer-events="none">${context}${lines}${trace}${leaders.join('')}${labels}</g>`, rightMargin, badges, radius };
}
