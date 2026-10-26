const escapeHTML = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Keep the entire cut order visible; selection only changes its emphasis.
export function timberCutOverlay(sheet, selectedStep = 0) {
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
  const context = selected ? `<rect x="${selected.x}" y="${selected.y}" width="${selected.w}" height="${selected.h}" fill="none" stroke="#c9917d" stroke-width="${size / 1100}" stroke-dasharray="${size / 250} ${size / 300}"/>` : '';
  const lines = segments.map(({ cut, x1, y1, x2, y2 }) => {
    const active = cut.step === selectedStep;
    return `<line data-cut-line="${cut.step}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${active ? '#c64a31' : '#ad7057'}" stroke-width="${size / (active ? 450 : 950)}" ${active ? '' : `stroke-dasharray="${size / 260} ${size / 390}"`}/>`;
  }).join('');
  const leaders = [];
  const labels = badges.map((badge) => {
    const active = badge.step === selectedStep, color = active ? '#c64a31' : '#9a5e47';
    const leader = Math.hypot(badge.x - badge.anchorX, badge.y - badge.anchorY) > radius ? `<line x1="${badge.anchorX}" y1="${badge.anchorY}" x2="${badge.x}" y2="${badge.y}" stroke="${color}" stroke-width="${size / 1300}"/>` : '';
    leaders.push(leader);
    return `<g data-cut-number="${badge.step}" aria-label="Cut ${escapeHTML(badge.step)}${active ? ', selected' : ''}"><title>Cut ${escapeHTML(badge.step)}${active ? ' · selected' : ''}</title><circle cx="${badge.x}" cy="${badge.y}" r="${radius}" fill="${active ? color : '#fffdf9'}" stroke="${color}" stroke-width="${size / 1100}"/><text x="${badge.x}" y="${badge.y}" dy=".35em" text-anchor="middle" font-family="sans-serif" font-size="${radius * (String(badge.step).length > 2 ? .8 : 1.05)}" font-weight="700" fill="${active ? '#ffffff' : color}">${escapeHTML(badge.step)}</text></g>`;
  }).join('');
  return { markup: `<g class="numbered-cut-overlay" pointer-events="none">${context}${lines}${leaders.join('')}${labels}</g>`, rightMargin, badges, radius };
}
