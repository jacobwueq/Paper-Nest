import { planTimber, validateProject, parseCSV, toCSV, offcutStockRow, partLabels, parsePastedParts } from './timber-planner.js?v=0.31.3';
import { TIMBER_SETTINGS, cleanTimberSettings, defaultTimberSettings } from './timber-settings.js?v=0.31.3';
import { installTimberVisual, normalizeVisualDraft } from './timber-visual.js?v=0.31.3';
import { installTimberWorkflow } from './timber-workflow.js?v=0.31.3';
import { timberCutOverlay, updateCutTrace } from './timber-cut-overlay.js?v=0.31.3';
import { installCutPlayback } from './timber-playback.js?v=0.31.3';
import { separatedBoardSVG, updateBoardSeparation } from './timber-separation.js?v=0.31.3';
import { t, getLanguage, onLanguageChange } from './locale.js?v=0.31.3';
import { installWorkshop } from './timber-workshop.js?v=0.31.3';
import { saveFile } from './file-download.js?v=0.31.3';
import { createTimberPDF, createLabelsPDF, loadPDFTools } from './timber-pdf.js?v=0.31.3';
import { cutDescription, cutDetail, cutRetain, trimGuide, cutEfficiency, sawComparison } from './timber-text.js?v=0.31.3';
import { installSawHelp } from './timber-saw-help.js?v=0.31.3';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const fmt = (n) => Number(n.toFixed(2)).toLocaleString('en-GB', { maximumFractionDigits: 2 });
const priorityNames = ['High', 'Normal', 'Low'];
const STORAGE = 'paper-nest.timber.v1';
for (const label of document.querySelectorAll('.file-label')) {
  label.tabIndex = 0; label.setAttribute('role', 'button');
  label.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); label.querySelector('input').click(); } });
}
const sample = () => ({
  schema: 'paper-nest-timber-v1', name: 'Workshop cabinet',
  settings: defaultTimberSettings(),
  stocks: [{ label: 'Plywood sheet', material: 'Plywood', thickness: 18, length: 2440, width: 1220, qty: 2 }],
  parts: [
    { label: 'Side panel', material: 'Plywood', thickness: 18, length: 720, width: 450, qty: 2, priority: 0, grain: true },
    { label: 'Top / bottom', material: 'Plywood', thickness: 18, length: 764, width: 450, qty: 2, priority: 1, grain: true },
    { label: 'Shelf', material: 'Plywood', thickness: 18, length: 764, width: 420, qty: 2, priority: 1, grain: false },
    { label: 'Plinth', material: 'Plywood', thickness: 18, length: 764, width: 80, qty: 2, priority: 2, grain: false },
  ],
});
const keptOffcuts = new Map(); // offcut id → stock row, for "Add to stock" on Review
let plan = null, plannedProject = null, activeSheet = 0, activeStep = 1, revision = 0, visualUI = null, cutPlayback = null, workflow = null, workflowValid = false;
function notify(text, error = false) { $('message').textContent = text; $('message').classList.toggle('error', error); $('message').hidden = !text; }
// A notice with an Undo button. `snapshot` is a readProject() taken before the change;
// Undo puts every row, setting and the manual layout back.
function notifyUndo(text, snapshot) {
  notify(text);
  const undo = document.createElement('button');
  undo.type = 'button'; undo.className = 'text-button notice-undo'; undo.textContent = t('Undo', '撤銷');
  undo.onclick = () => { renderInputs(snapshot); notify(t('Undone.', '已撤銷。')); };
  $('message').append(' ', undo);
}
function input(row, key, kind, label) {
  const type = kind === 'number' ? 'number' : 'text';
  return `<input data-field="${key}" type="${type}" value="${esc(row[key])}" aria-label="${esc(label)}" ${type === 'number' ? `min="${key === 'qty' ? 1 : 0.01}" max="${key === 'qty' ? 500 : 20000}" step="${key === 'qty' ? 1 : 'any'}"` : `maxlength="${key === 'material' ? 80 : 100}"`} required>`;
}
function rowHTML(row, type, i) {
  const label = `${type === 'stocks' ? 'Stock' : 'Part'} row ${i + 1}`;
  return `<tr><td class="label">${input(row, 'label', 'text', label + ' label')}</td><td class="material">${input(row, 'material', 'text', label + ' material')}</td><td class="thickness">${input(row, 'thickness', 'number', label + ' thickness in mm')}</td><td class="numeric">${input(row, 'length', 'number', label + ' length in mm')}</td><td class="numeric">${input(row, 'width', 'number', label + ' width in mm')}</td><td class="qty">${input(row, 'qty', 'number', label + ' quantity')}</td>${type === 'parts' ? `<td><select data-field="priority" aria-label="${label} priority">${priorityNames.map((p, index) => `<option value="${index}" ${row.priority === index ? 'selected' : ''}>${p}</option>`).join('')}</select></td><td class="grain-cell"><input data-field="grain" type="checkbox" ${row.grain ? 'checked' : ''} aria-label="${label} grain lock"></td>` : ''}<td><button class="remove-row" type="button" data-remove="${type}" aria-label="Remove ${label}">×</button></td></tr>`;
}
function readRows(type) {
  return Array.from($(type).rows).map((tr) => {
    const r = {};
    for (const e of tr.querySelectorAll('[data-field]')) r[e.dataset.field] = e.type === 'checkbox' ? e.checked : e.type === 'number' || e.dataset.field === 'priority' ? Number(e.value) : e.value;
    return r;
  });
}
function readProject() {
  return { schema: 'paper-nest-timber-v1', name: $('project-name').value, settings: readSettings(), stocks: readRows('stocks'), parts: readRows('parts'), ...(visualUI ? { visual: visualUI.getDraft() } : {}) };
}
// Each setting's input on the page; defaults and validation come from timber-settings.js.
const SETTING_INPUTS = { kerf: 'kerf', trim: 'trim', direction: 'direction', saw: 'saw', hybridLimit: 'hybrid-limit', rotate: 'rotate', usePriorities: 'use-priorities' };
function readSettings() {
  const raw = {};
  for (const f of TIMBER_SETTINGS) { const input = $(SETTING_INPUTS[f.key]); raw[f.key] = f.type === 'boolean' ? input.checked : f.type === 'number' ? Number(input.value) : input.value; }
  for (const f of TIMBER_SETTINGS) if (f.when && !f.when(raw)) delete raw[f.key];
  return raw;
}
function renderSettings(settings) {
  const s = { ...Object.fromEntries(TIMBER_SETTINGS.map((f) => [f.key, f.default])), ...cleanTimberSettings(settings) };
  for (const f of TIMBER_SETTINGS) {
    const input = $(SETTING_INPUTS[f.key]);
    if (f.type === 'boolean') input.checked = s[f.key];
    else { input.value = s[f.key]; if (f.type === 'number') Object.assign(input, { min: f.min, max: f.max }); }
  }
  $('hybrid-limit-field').hidden = s.saw !== 'hybrid';
}
function cleanProject(p, allowDraft = false) {
  if (!p || p.schema !== 'paper-nest-timber-v1' || typeof p.name !== 'string' || p.name.length > 100) throw new Error('Choose a Paper Nest timber project JSON file.');
  if (allowDraft) {
    if (!p.settings || typeof p.settings !== 'object') throw new Error('Invalid saved settings.');
    for (const [key, limit] of [['stocks', 50], ['parts', 100]]) {
      if (!Array.isArray(p[key]) || (key === 'stocks' && !p[key].length) || p[key].length > limit) throw new Error('Invalid saved rows.');
      for (const r of p[key]) if (!r || !['length', 'width', 'qty', 'thickness'].every((k) => Number.isFinite(r[k])) || typeof r.label !== 'string' || r.label.length > 100 || typeof r.material !== 'string' || r.material.length > 80 || (key === 'parts' && ![0, 1, 2].includes(r.priority))) throw new Error('Invalid saved row.');
    }
  } else validateProject(p);
  if (p.parts.some((part) => typeof part.grain !== 'boolean')) throw new Error('Project rotation and grain values must be true or false.');
  const rows = (values, isPart) => values.map((r) => ({ label: r.label, material: r.material, thickness: r.thickness, length: r.length, width: r.width, qty: r.qty, ...(isPart ? { priority: r.priority, grain: r.grain } : {}) }));
  return { schema: p.schema, name: p.name, settings: cleanTimberSettings(p.settings), stocks: rows(p.stocks, false), parts: rows(p.parts, true), visual: normalizeVisualDraft(p.visual) };
}
function renderInputs(p) {
  $('project-name').value = p.name; renderSettings(p.settings);
  $('stocks').innerHTML = p.stocks.map((r, i) => rowHTML(r, 'stocks', i)).join('');
  $('parts').innerHTML = p.parts.map((r, i) => rowHTML(r, 'parts', i)).join('');
  visualUI?.restore(p.visual);
  invalidate();
  workflow?.showSetup();
}
function invalidate() {
  cutPlayback?.clear(); keptOffcuts.clear();
  revision++; plan = null; plannedProject = null;
  $('results').hidden = true; $('empty-plan').hidden = false;
  document.querySelectorAll('.print-sheet').forEach((e) => e.remove());
  const p = readProject();
  try { validateProject(p); workflowValid = true; } catch { workflowValid = false; }
  visualUI?.update(p);
  workflow?.inputsChanged();
  const count = p.parts.reduce((n, row) => n + (Number.isFinite(row.qty) ? row.qty : 0), 0);
  $('parts-count').textContent = t(`${p.parts.length} rows / ${fmt(count)} parts`, `${p.parts.length} 行／${fmt(count)} 件零件`);
  try { localStorage.setItem(STORAGE, JSON.stringify(readProject())); $('save-state').textContent = 'Saved in this browser · timber project & manual layout'; }
  catch { $('save-state').textContent = 'Browser saving unavailable. Use Save project to keep your work.'; }
}
function download(contents, name, type) {
  return saveFile(contents, name, type);
}
function filename(suffix) { return (plannedProject?.name || $('project-name').value || 'timber').replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 70) + suffix; }
function trimText(sheet) {
  return trimGuide(sheet, plan.settings);
}
function sheetSVG(s, selectedStep = 0, playback = null) {
  if (playback?.active && playback.separatePieces) return separatedBoardSVG(s, selectedStep, playback);
  const L = s.stock.length, W = s.stock.width, margin = Math.max(L, W) * .045, fs = Math.max(L, W) * .014;
  const colors = ['#e5d2af', '#d0dbbd', '#c7d8dd', '#dbcee0', '#e8c8b0'];
  const parts = s.parts.map((p) => {
    const labelSize = Math.min(fs, p.w / Math.max(p.id.length, 6) * 1.3, p.h / 4);
    const details = `${p.id} · ${p.label} · ${fmt(p.length)} × ${fmt(p.width)} mm${p.rotated ? ' · rotated 90°' : ''} · ${p.workpiece}`;
    return `<g><title>${esc(details)}</title><rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" fill="${colors[p.row % colors.length]}" stroke="#96846a" stroke-width="${L / 1400}"/><text x="${p.x + p.w / 2}" y="${p.y + p.h / 2 - labelSize / 3}" text-anchor="middle" font-size="${labelSize}" fill="#4e493f">${esc(p.id)}${p.rotated ? ' ↻' : ''}</text>${p.w > fs * 7 && p.h > fs * 3 ? `<text x="${p.x + p.w / 2}" y="${p.y + p.h / 2 + labelSize}" text-anchor="middle" font-size="${labelSize * .7}" fill="#736c60">${fmt(p.w)} × ${fmt(p.h)}</text>` : ''}</g>`;
  }).join('');
  const offcuts = s.offcuts.map((o) => `<g><title>${esc(o.id)} · offcut ${fmt(o.w)} × ${fmt(o.h)} mm</title><rect x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}" fill="#e8eee4" stroke="#a8b89a" stroke-width="${L / 1600}" stroke-dasharray="${L / 500} ${L / 500}"/>${o.w > fs * 7 && o.h > fs * 2 ? `<text x="${o.x + o.w / 2}" y="${o.y + o.h / 2}" text-anchor="middle" font-size="${fs * .65}" fill="#73836a">${fmt(o.w)} × ${fmt(o.h)}</text>` : ''}</g>`).join('');
  const overlay = timberCutOverlay(s, selectedStep, playback);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-margin} ${-margin} ${L + margin + overlay.rightMargin} ${W + 2 * margin}" role="img" aria-label="Sheet ${s.number}: ${s.parts.length} finished parts, all ${s.cuts.length} cuts numbered in order, stock ${fmt(L)} by ${fmt(W)} millimetres"><rect width="${L}" height="${W}" fill="#eee9df" stroke="#b4a58c" stroke-width="${L / 1000}"/>${offcuts}${parts}${overlay.markup}<text x="${L / 2}" y="${-margin * .35}" text-anchor="middle" font-size="${fs * .8}" fill="#8c8170">${fmt(L)} mm · ${t("GRAIN →","木紋 →")}</text><text transform="translate(${-margin * .35} ${W / 2}) rotate(-90)" text-anchor="middle" font-size="${fs * .8}" fill="#8c8170">${fmt(W)} mm</text></svg>`;
}
function renderSheet(resetPlayback = true) {
  if (!plan || !plan.sheets.length) return;
  const s = plan.sheets[activeSheet];
  $('sheet-meta').textContent = `${s.stock.label || 'Stock'} · ${s.stock.material} / ${fmt(s.stock.thickness)} mm · ${fmt(s.stock.length)} × ${fmt(s.stock.width)} mm · ${(s.yield * 100).toFixed(1)}% ${t('finished-part yield','成品材料利用率')}`;
  $('sheet-drawing').innerHTML = sheetSVG(s, activeStep, resetPlayback ? null : cutPlayback?.state);
  $('cut-count').textContent = t(`${s.cuts.length} cuts`, `${s.cuts.length} 刀`);
  $('trim-guide').textContent = trimText(s);
  $('cut-efficiency').textContent = cutEfficiency(s);
  for (const item of document.querySelectorAll('.legend-machine')) item.hidden = s.saw !== 'hybrid';
  for (const item of document.querySelectorAll('.legend-order-plain')) item.hidden = s.saw === 'hybrid';
  $('cut-guide').innerHTML = s.cuts.length ? s.cuts.map((c) => `<button type="button" class="cut-step" data-step="${c.step}"${s.saw === 'hybrid' ? ` data-machine="${c.saw}"` : ''} aria-pressed="${c.step === activeStep}"><span class="step-number">${c.step}</span><span><strong>${cutDescription(c)}</strong><small class="workpiece-reference">${esc(cutDetail(c))}</small><small>${esc(cutRetain(c))}</small></span></button>`).join('') : '<p class="panel-hint">This part uses the entire prepared panel. No further cuts needed.</p>';
  const useful = s.offcuts.filter((o) => Math.min(o.w, o.h) >= 50).sort((a, b) => b.w * b.h - a.w * a.h);
  const small = s.offcuts.length - useful.length;
  $('offcut-list').innerHTML = `<strong>${t('Reusable offcuts · both edges ≥ 50 mm','可用餘料 · 兩邊均 ≥ 50 毫米')}</strong>` + (useful.length ? useful.map((o) => `<label class="offcut-tag"><input type="checkbox" data-offcut="${esc(o.id)}"${keptOffcuts.has(o.id) ? ' checked' : ''}> ${esc(o.id)} · ${fmt(o.w)} × ${fmt(o.h)} mm</label>`).join('') : `<span>${t('No offcuts meet this size.','沒有符合此尺寸嘅餘料。')}</span>`) + (small ? `<div>${t(`${small} smaller remnant${small === 1 ? '' : 's'} also shown on the layout.`, `圖上另有 ${small} 塊較細餘料。`)}</div>` : '') + (useful.length ? `<div class="offcut-actions"><button type="button" class="small-button" id="offcuts-to-stock">${offcutButtonText()}</button><small>${t('Tick the offcuts you will keep; they become stock rows for the next cutting list.','剔選會保留嘅餘料，佢哋會成為下一張開料清單嘅板材。')}</small></div>` : '');
  $('offcuts-to-stock')?.toggleAttribute('disabled', !keptOffcuts.size);
  if (resetPlayback) cutPlayback?.setSheet(s, activeStep); else cutPlayback?.refreshLabels();
}
// Table saw / Hybrid: plan the same list for a panel saw in a worker and say why the
// chosen saw takes more steps (roadmap 2.7). Cached per project and settings.
const panelComparisons = new Map();
let compareWorker = null;
function showSawNote() {
  const note = $('saw-note'), key = plannedProject && JSON.stringify([plannedProject.settings, plannedProject.stocks, plannedProject.parts]);
  note.hidden = true;
  if (!plan || (plan.settings?.saw ?? 'panel') === 'panel' || plan.manual) return;
  const known = panelComparisons.get(key);
  if (known) { note.textContent = sawComparison(plan, known); note.hidden = !note.textContent; return; }
  try {
    compareWorker ||= new Worker(new URL('./timber-compare-worker.js?v=0.31.3', import.meta.url), { type: 'module' });
    compareWorker.onmessage = ({ data }) => { if (!data.error) panelComparisons.set(data.key, data); if (data.key === key) showSawNote(); };
    compareWorker.postMessage({ key, project: structuredClone(plannedProject) });
  } catch { /* the note is optional */ }
}
function renderPlan() {
  $('results').hidden = false; $('empty-plan').hidden = true;
  const area = plan.sheets.reduce((n, s) => n + s.area, 0), used = plan.sheets.reduce((n, s) => n + s.usedArea, 0);
  const cuts = plan.sheets.reduce((n, s) => n + s.cuts.length, 0);
  $('plan-caption').textContent = planCaption(); showSawNote();
  $('metrics').innerHTML = `<div class="metric"><span>Stock sheets used</span><strong>${plan.sheets.length}<small>of ${plannedProject.stocks.reduce((n, s) => n + s.qty, 0)} available</small></strong></div><div class="metric"><span>Parts placed</span><strong>${plan.placed}<small>/ ${plan.required}</small></strong></div><div class="metric"><span>Finished-part yield</span><strong>${area ? (used / area * 100).toFixed(1) : '0.0'}%<small>of used stock</small></strong></div><div class="metric"><span>Cutting steps</span><strong>${cuts}<small>+ edge preparation</small></strong></div>`;
  $('unplaced').hidden = plan.unplaced.length === 0;
  if (plan.unplaced.length) {
    const counts = new Map();
    for (const p of plan.unplaced) { const key = `${p.label} (${fmt(p.length)} × ${fmt(p.width)} mm, ${p.material} ${fmt(p.thickness)} mm)`; counts.set(key, (counts.get(key) || 0) + 1); }
    $('unplaced').textContent = plan.manual ? `${plan.unplaced.length} part(s) not yet placed · 尚未放入：${[...counts].map(([label, count]) => `${label} × ${count}`).join('; ')}. Continue placing them in the visual workspace.` : `${plan.unplaced.length} part(s) could not be placed: ${[...counts].map(([label, count]) => `${label} × ${count}`).join('; ')}. Check stock quantity, usable dimensions, material/thickness matches and grain locks. This heuristic may leave parts unplaced even if a different layout could fit.`;
  }
  activeSheet = 0; activeStep = 1;
  renderSheetStrip();
  document.querySelector('.plan-grid').hidden = !plan.sheets.length;
  renderSheet();
  $('finished-parts').innerHTML = plan.sheets.flatMap((s) => s.parts.map((p) => ({ ...p, sheet: s.number }))).sort((a, b) => a.row - b.row || a.copy - b.copy).map((p) => `<tr><td>${esc(p.id)}</td><td data-user-content>${esc(p.label)}</td><td>${fmt(p.length)} × ${fmt(p.width)}${p.rotated ? ' ↻' : ''}</td><td data-user-content>${esc(p.material)} / ${fmt(p.thickness)} mm</td><td class="${p.priority === 0 ? 'priority-high' : ''}">${priorityNames[p.priority]}</td><td>S${p.sheet} / ${esc(p.workpiece)}</td></tr>`).join('');
  workflow?.showReview();
}
$('timber-form').addEventListener('input', (event) => { if (event.target.closest('#timber-visual')) return; invalidate(); notify(''); });
$('timber-form').addEventListener('change', (event) => { if (event.target.closest('#timber-visual')) return; invalidate(); notify(''); });
// Removing a stock or part row (table or parts tray) can be undone from the notice.
function removeRow(type, row) {
  const before = readProject(), removed = before[type][row]; if (!removed) return;
  const name = removed.label || t(`row ${row + 1}`, `第 ${row + 1} 行`);
  $(type).rows[row].remove(); invalidate();
  notifyUndo(type === 'parts' ? t(`Removed part “${name}”.`, `已刪除零件「${name}」。`) : t(`Removed stock “${name}”.`, `已刪除板材「${name}」。`), before);
}
for (const type of ['stocks', 'parts']) $(type).addEventListener('click', (event) => {
  const remove = event.target.closest('[data-remove]'); if (!remove) return;
  if (type === 'stocks' && $(type).rows.length <= 1) { notify(t('Keep at least one stock row. Edit it to enter your stock.', '最少要保留一行板材，可直接修改。'), true); return; }
  removeRow(type, [...$(type).rows].indexOf(remove.closest('tr')));
});
const offcutButtonText = () => keptOffcuts.size ? t(`Add ${keptOffcuts.size} offcut${keptOffcuts.size === 1 ? '' : 's'} to stock`, `將 ${keptOffcuts.size} 塊餘料加入板材`) : t('Add to stock', '加入板材');
$('offcut-list').addEventListener('change', (event) => {
  const box = event.target.closest('[data-offcut]'); if (!box || !plan) return;
  const sheet = plan.sheets[activeSheet], offcut = sheet.offcuts.find((o) => o.id === box.dataset.offcut);
  if (box.checked && offcut) keptOffcuts.set(offcut.id, offcutStockRow(sheet, offcut)); else keptOffcuts.delete(box.dataset.offcut);
  $('offcuts-to-stock').textContent = offcutButtonText(); $('offcuts-to-stock').disabled = !keptOffcuts.size;
});
$('offcut-list').addEventListener('click', (event) => {
  if (!event.target.closest('#offcuts-to-stock') || !keptOffcuts.size) return;
  const before = readProject(), p = readProject(), rows = [...keptOffcuts.values()];
  if (p.stocks.length + rows.length > 50) { notify(t('Use up to 50 stock rows. Remove some rows first.', '最多 50 行板材，請先刪除部分。'), true); return; }
  p.stocks.push(...rows); keptOffcuts.clear(); renderInputs(p);
  document.querySelector('.visual-details').open = true;
  notifyUndo(t(`Added ${rows.map((r) => r.label).join(', ')} to stock.`, `已將 ${rows.map((r) => r.label).join('、')} 加入板材。`), before);
  $('message').scrollIntoView({ block: 'center' });
});
// Paste rows from a spreadsheet (roadmap 2.5): anywhere on the page except inside a
// text field, or into the parts table / tray when the clipboard holds several cells.
document.addEventListener('paste', (event) => {
  const text = event.clipboardData?.getData('text/plain') || '', target = event.target;
  const inField = !!target.closest?.('input, textarea, select, [contenteditable]');
  const multiCell = /[\t\n]/.test(text.trim());
  if (!text.trim() || $('timber-form').closest('[hidden]')) return;
  if (inField && !(multiCell && target.closest('#parts, #timber-visual'))) return;
  const before = readProject(), stock = before.stocks[0];
  const { rows, skipped } = parsePastedParts(text, { material: stock?.material, thickness: stock?.thickness });
  if (!rows.length) { if (!inField) notify(t('Could not read any part rows. Paste rows with a name, length, width and quantity, e.g. from a spreadsheet.', '讀唔到零件資料。請貼上包含名稱、長、闊及數量嘅行，例如由試算表複製。'), true); return; }
  event.preventDefault();
  const p = readProject(), room = 100 - p.parts.length, added = rows.slice(0, Math.max(0, room));
  if (!added.length) { notify(t('Use up to 100 part rows.', '最多 100 行零件。'), true); return; }
  p.parts.push(...added); renderInputs(p);
  const extra = [skipped ? t(` ${skipped} line${skipped === 1 ? '' : 's'} skipped.`, ` 略過 ${skipped} 行。`) : '', rows.length > added.length ? t(` ${rows.length - added.length} over the 100-row limit.`, ` ${rows.length - added.length} 行超出 100 行上限。`) : ''].join('');
  const list = added.slice(0, 3).map((r) => `${r.label || '—'} ${fmt(r.length)} × ${fmt(r.width)} × ${r.qty}`);
  notifyUndo(t(`Pasted ${added.length} part row${added.length === 1 ? '' : 's'}: ${list.join(', ')}${added.length > 3 ? '…' : ''}.${extra}`, `已貼上 ${added.length} 行零件：${list.join('、')}${added.length > 3 ? '…' : ''}。${extra}`), before);
});
$('add-stock').onclick = () => {
  const p = readProject(); if (p.stocks.length >= 50) { notify('Use up to 50 stock rows.', true); return; }
  p.stocks.push({ label: 'Stock ' + (p.stocks.length + 1), material: 'Plywood', thickness: 18, length: 2440, width: 1220, qty: 1 }); renderInputs(p); $('stocks').lastElementChild.querySelector('input').focus();
};
$('add-part').onclick = () => {
  const p = readProject(); if (p.parts.length >= 100) { notify('Use up to 100 part rows.', true); return; }
  const stock = p.stocks[0]; p.parts.push({ label: 'Part ' + (p.parts.length + 1), material: stock?.material || 'Plywood', thickness: stock?.thickness || 18, length: 600, width: 300, qty: 1, priority: 1, grain: false }); renderInputs(p); $('parts').lastElementChild.querySelector('input').focus();
};
$('sample').onclick = () => { renderInputs(sample()); notify('Sample cabinet loaded. Edit a part to see the live preview · 修改尺寸即時預覽。'); };
$('timber-form').addEventListener('submit', (event) => {
  event.preventDefault(); notify('');
  if (!$('timber-form').checkValidity()) { document.querySelector('.visual-details').open = true; $('timber-form').reportValidity(); return; }
  let project; try { project = cleanProject(readProject()); } catch (error) { notify(error.message, true); return; }
  const currentRevision = revision; $('calculate').disabled = true; $('calculate').textContent = 'Calculating…';
  setTimeout(() => {
    try {
      const result = visualUI?.bestAutomaticPlan() || planTimber(project);
      if (revision !== currentRevision) { notify('Inputs changed. Calculate again to use the latest list.'); return; }
      visualUI?.showAutomaticPlan(result); plan = result; plannedProject = project; renderPlan(); $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) { notify(error.message, true); }
    finally { $('calculate').disabled = false; $('calculate').innerHTML = 'Optimise cutting plan <span aria-hidden="true">→</span>'; }
  }, 20);
});
// Sheet strip (roadmap 2.1): one thumbnail per sheet with its use %, weakest sheet
// marked, instead of a dropdown that hid how full each sheet is.
function sheetThumb(s) {
  const L = s.stock.length, W = s.stock.width;
  const parts = s.parts.map((p) => `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" class="thumb-part"/>`).join('');
  return `<svg viewBox="0 0 ${L} ${W}" aria-hidden="true" preserveAspectRatio="xMidYMid meet"><rect width="${L}" height="${W}" class="thumb-stock"/>${parts}</svg>`;
}
function renderSheetStrip() {
  if (!plan) return;
  const lowest = plan.sheets.length > 1 ? Math.min(...plan.sheets.map((s) => s.yield)) : -1;
  const materials = new Set(plan.sheets.map((s) => `${s.stock.material} ${s.stock.thickness}`)).size > 1;
  $('sheet-strip').innerHTML = plan.sheets.map((s, i) => {
    const use = Math.round(s.yield * 100), weak = s.yield === lowest;
    return `<button type="button" role="tab" class="sheet-thumb${weak ? ' is-weak' : ''}" data-sheet="${i}" aria-selected="${i === activeSheet}" tabindex="${i === activeSheet ? 0 : -1}" aria-label="${t(`Sheet ${s.number}, ${use}% used`, `板材 ${s.number}，用料 ${use}%`)}${weak ? t(', least used', '，用料最少') : ''}">${sheetThumb(s)}<span class="thumb-name">S${s.number}${materials ? ` <small>${esc(s.stock.material)} ${fmt(s.stock.thickness)}</small>` : ''}</span><span class="thumb-use"><span class="thumb-bar"><i style="width:${use}%"></i></span><b>${use}%</b></span></button>`;
  }).join('');
}
function chooseSheet(i, focus = false) {
  if (!plan || i < 0 || i >= plan.sheets.length) return;
  activeSheet = i; activeStep = 1; renderSheetStrip(); renderSheet();
  if (focus) $('sheet-strip').querySelector(`[data-sheet="${i}"]`)?.focus();
}
const workshop = installWorkshop({
  getPlan: () => plan,
  drawSheet: (s, step) => sheetSVG(s, step),
  prepareText: (s) => trimText(s),
  onClose: (sheet, step) => { if (!plan) return; activeSheet = sheet; activeStep = Math.min(step, plan.sheets[sheet].cuts.length) || 1; renderSheetStrip(); renderSheet(); },
});
$('open-workshop').onclick = () => workshop.open(activeSheet, 0);
$('sheet-strip').addEventListener('click', (event) => { const b = event.target.closest('[data-sheet]'); if (b) chooseSheet(Number(b.dataset.sheet)); });
$('sheet-strip').addEventListener('keydown', (event) => {
  const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
  if (step) { event.preventDefault(); chooseSheet(activeSheet + step, true); }
  else if (event.key === 'Home') { event.preventDefault(); chooseSheet(0, true); }
  else if (event.key === 'End') { event.preventDefault(); chooseSheet(plan.sheets.length - 1, true); }
});
$('cut-guide').onclick = (event) => {
  const step = event.target.closest('[data-step]'); if (!step || !plan) return;
  cutPlayback.selectStep(Number(step.dataset.step));
};
$('project-download').onclick = () => {
  try { const p = cleanProject(readProject(), true); download(JSON.stringify(p, null, 2) + '\n', filename('.timber.json'), 'application/json'); }
  catch (error) { notify(error.message, true); }
};
async function readFile(input, kind) {
  const file = input.files?.[0]; if (!file) return;
  try {
    if (file.size > 1024 * 1024) throw new Error('Choose a file smaller than 1 MB.');
    const text = await file.text();
    if (kind === 'project') { renderInputs(cleanProject(JSON.parse(text), true)); notify('Timber project opened. The live workspace is ready · 已開啟即時工作區。'); }
    else {
      const parts = parseCSV(text), p = readProject(); p.parts = parts; cleanProject(p); renderInputs(p); notify(`Imported ${parts.length} cutting-list rows. Material defaults to Plywood and thickness to 18 mm when omitted.`);
    }
  } catch (error) { notify(error instanceof SyntaxError ? 'This file is not valid project JSON.' : error.message, true); }
  finally { input.value = ''; }
}
$('project-upload').onchange = () => readFile($('project-upload'), 'project');
$('csv-upload').onchange = () => readFile($('csv-upload'), 'csv');
$('csv-template').onclick = () => download(toCSV([
  ['label', 'material', 'thickness', 'length', 'width', 'qty', 'priority', 'grain'],
  ['Side panel', 'Plywood', 18, 720, 450, 2, 'high', 'yes'],
  ['Shelf', 'Plywood', 18, 764, 420, 2, 'normal', 'no'],
]), 'timber-cutting-list-template.csv', 'text/csv;charset=utf-8');
$('export-list').onclick = () => {
  if (!plan) return;
  const rows = [['part_id', 'label', 'material', 'thickness', 'length', 'width', 'qty', 'priority', 'grain', 'sheet', 'workpiece', 'rotated_90', 'status']];
  for (const s of plan.sheets) for (const p of s.parts) rows.push([p.id, p.label, p.material, p.thickness, p.length, p.width, 1, priorityNames[p.priority], p.grain ? 'yes' : 'no', s.number, p.workpiece, p.rotated ? 'yes' : 'no', 'placed']);
  for (const p of plan.unplaced) rows.push([p.id, p.label, p.material, p.thickness, p.length, p.width, 1, priorityNames[p.priority], p.grain ? 'yes' : 'no', '', '', '', 'unplaced']);
  download(toCSV(rows), filename('-cutting-list.csv'), 'text/csv;charset=utf-8');
};
$('export-guide').onclick = () => {
  if (!plan) return;
  const rows = [['sheet', 'step', 'workpiece', 'operation', 'measurement_from', 'offset_mm', 'workpiece_length_mm', 'workpiece_width_mm', 'kerf_mm', 'first_result', 'second_result', 'prerequisite_step', 'shared_part_edges', 'released_parts', 'instructions', 'alignment_required', 'segments_json', 'saw', 'fence_mm', 'fence_edge']];
  for (const s of plan.sheets) {
    rows.push([s.number, t('Prepare','準備'), `S${s.number}`, trimText(s), '', plan.settings.trim, s.stock.length, s.stock.width, plan.settings.kerf, `S${s.number}`, '', '', '', '', '', '', '', plan.settings.saw === 'table' ? 'table' : 'panel', '', '']);
    for (const c of s.cuts) {
      const members = c.segments || [c];
      const same = (key) => members.every((m) => Math.abs(m[key] - members[0][key]) < 1e-7) ? members[0][key] : '';
      rows.push([s.number, c.step, members.map((m) => m.workpiece).join(' + '), cutDescription(c),
        c.axis === 'x' ? t('each workpiece: left finished edge','各板件：左側完成邊') : t('each workpiece: top finished edge','各板件：上側完成邊'),
        same('offset'), same('w'), same('h'), same('kerf'), members.map((m) => m.first).join(' + '), members.map((m) => m.second || t('kerf waste','鋸縫廢料')).join(' + '),
        c.prerequisite || t('Prepare','準備'), (c.edgeParts || []).join(' + '), (c.releasedParts || []).join(' + '), cutDetail(c) + ' ' + cutRetain(c),
        c.alignmentRequired ? 'yes' : 'no', JSON.stringify(members.map(({workpiece,x,y,w,h,axis,offset,kerf,first,second,prerequisite,fence,fenceFrom}) => ({workpiece,x,y,w,h,axis,offset,kerf,first,second,prerequisite,...(fence !== undefined ? { fence, fenceFrom } : {})}))),
        c.saw || 'panel', c.saw === 'table' ? same('fence') : '', c.saw === 'table' ? (members.every((m) => m.fenceFrom === members[0].fenceFrom) ? members[0].fenceFrom : 'per workpiece') : '']);
    }
  }
  download(toCSV(rows), filename('-cut-guide.csv'), 'text/csv;charset=utf-8');
};
$('download-labels').onclick = async () => {
  if (!plan || !plannedProject) { notify(t('Confirm a cutting layout before downloading.', '請先確認排料方案，再下載。'), true); return; }
  const button = $('download-labels'), labels = partLabels(plan), project = structuredClone(plannedProject), language = getLanguage(), name = filename('-part-labels.pdf');
  button.disabled = true; const text = button.textContent; button.textContent = t('Preparing labels…', '正在製作標籤…');
  try {
    // Ask where to save while the click still counts as a user gesture, as for the plan PDF.
    let handle = null;
    if (typeof window.showSaveFilePicker === 'function') {
      try { handle = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }] }); }
      catch (error) { if (error.name === 'AbortError') return; }
    }
    const bytes = await createLabelsPDF(project, labels, { ...(await loadPDFTools()), language });
    await saveFile(bytes, name, 'application/pdf', { handle, picker: false });
    notify(t(`${labels.length} part labels · A4, 3 × 7 per page (63.5 × 38.1 mm stickers, or cut plain paper at the corner marks).`, `${labels.length} 張零件標籤 · A4，每頁 3 × 7（63.5 × 38.1 mm 貼紙，或沿角位記號剪開普通紙）。`));
  } catch (error) { notify(t(`Label download failed: ${error.message}`, `標籤下載失敗：${error.message}`), true); }
  finally { button.disabled = false; button.textContent = text; }
};
$('download-pdf').onclick = async () => {
  if (!plan || !plannedProject) { notify(t('Confirm a cutting layout before downloading.', '請先確認排料方案，再下載。'), true); return; }
  const button = $('download-pdf'), snapshot = plan, project = structuredClone(plannedProject), language = getLanguage(), name = filename('-cutting-plan.pdf');
  cutPlayback?.pause(); button.disabled = true; button.textContent = t('Preparing PDF…', '正在製作 PDF…');
  try {
    let handle = null;
    if (typeof window.showSaveFilePicker === 'function') {
      try { handle = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }] }); }
      catch (error) { if (error.name === 'AbortError') return; }
    }
    const tools = await loadPDFTools();
    const bytes = await createTimberPDF(project, snapshot, { ...tools, language });
    await saveFile(bytes, name, 'application/pdf', { handle, picker: false });
  } catch (error) { notify(t(`PDF download failed: ${error.message}. You can still use Print.`, `PDF 下載失敗：${error.message}。仍可使用列印。`), true); }
  finally { button.disabled = false; button.textContent = t('Download PDF ↓', '下載 PDF ↓'); }
};
$('print-plan').onclick = () => {
  if (!plan) return;
  cutPlayback?.pause();
  document.querySelectorAll('.print-sheet').forEach((e) => e.remove());
  for (const [printIndex, s] of plan.sheets.entries()) {
    const section = document.createElement('section'); section.className = 'print-sheet';
    section.innerHTML = `<h3>${esc(plannedProject.name)} · ${t("Sheet","板材")} ${printIndex + 1} / ${plan.sheets.length} · S${s.number}</h3><p>${esc(s.stock.material)} / ${fmt(s.stock.thickness)} mm · ${t("Stock","板材")} ${fmt(s.stock.length)} × ${fmt(s.stock.width)} mm · ${t("Kerf","鋸縫")} ${fmt(plan.settings.kerf)} mm</p><div class="trim-guide">${esc(trimText(s))}</div><p>${esc(cutEfficiency(s))}</p>${sheetSVG(s)}<h4>${t("Cutting sequence · measurements to finished edge, kerf between workpieces","切割次序 · 量至完成邊，鋸縫留喺板件之間")}</h4>${s.cuts.map((c) => `<p class="print-step"><strong>${c.step}. ${cutDescription(c)}</strong> · ${esc(cutDetail(c))} ${esc(cutRetain(c))}</p>`).join('') || '<p>No cuts needed after edge preparation.</p>'}<p>${t("Offcuts","餘料")}: ${s.offcuts.map((o) => `${esc(o.id)}: ${fmt(o.w)} × ${fmt(o.h)} mm`).join('; ') || t('None','無')}</p><p>${t("Geometric cut sequence. Check machine setup, blade allowances and workpiece support before cutting.","此為幾何切割次序。開料前請核對機台設定、鋸片預留及板件承托。")}</p>`;
    $('results').insertBefore(section, document.querySelector('.finished-panel'));
  }
  window.print();
};
cutPlayback = installCutPlayback({
  root: $('cut-playback'),
  describe: (cut) => `${cut.step}. ${cutDescription(cut)} · ${cutDetail(cut)}`,
  onStep(cut, state) {
    if (!cut || !plan?.sheets[activeSheet]) return;
    activeStep = cut.step;
    $('sheet-drawing').innerHTML = sheetSVG(plan.sheets[activeSheet], activeStep, state);
    if (state.active && state.separatePieces) updateBoardSeparation($('sheet-drawing').querySelector('svg'), plan.sheets[activeSheet], state);
    for (const button of $('cut-guide').querySelectorAll('[data-step]')) {
      const selected = Number(button.dataset.step) === activeStep;
      button.setAttribute('aria-pressed', String(selected));
      if (selected && state.playing) $('cut-guide').scrollTop = Math.max(0, button.offsetTop - $('cut-guide').offsetTop - 30);
    }
  },
  onFrame(cut, state) {
    if (state.separatePieces && plan?.sheets[activeSheet]) updateBoardSeparation($('sheet-drawing').querySelector('svg'), plan.sheets[activeSheet], state);
    updateCutTrace($('sheet-drawing').querySelector('svg'), cut, state);
  },
});
let initial = sample(), restored = false;
try { const saved = localStorage.getItem(STORAGE); if (saved) { initial = cleanProject(JSON.parse(saved), true); restored = true; } } catch { /* Use the sample when saved state is unavailable or structurally invalid. */ }
renderInputs(initial);
visualUI = installTimberVisual({
  readProject,
  changePart(row, field, value) {
    const input = $('parts').rows[row]?.querySelector(`[data-field="${field}"]`);
    if (!input) return;
    if (input.type === 'checkbox') input.checked = value; else input.value = value;
    invalidate(); notify('');
  },
  changeStock(row, field, value) {
    const input = $('stocks').rows[row]?.querySelector(`[data-field="${field}"]`);
    if (input) { input.value = value; invalidate(); notify(''); }
  },
  addPart() { $('add-part').click(); },
  removePart(row) { removeRow('parts', row); },
  applyPlan(result, mode) {
    try {
      const project = cleanProject(readProject()); plan = result; plannedProject = project;
      renderPlan();
      if (mode === 'manual') $('plan-caption').textContent = 'Manual layout · 手動排位 · ' + $('plan-caption').textContent;
      $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) { notify(error.message, true); }
  },
  onDraftChange(changed = true) {
    if (changed) { cutPlayback?.clear(); revision++; plan = null; plannedProject = null; $('results').hidden = true; document.querySelectorAll('.print-sheet').forEach((e) => e.remove()); }
    if (changed) workflow?.inputsChanged();
    try { localStorage.setItem(STORAGE, JSON.stringify(readProject())); } catch { $('save-state').textContent = 'Use Save project to keep your work.'; }
  },
  onStatusChange() { workflow?.refresh(); },
});
visualUI.restore(initial.visual); visualUI.update(readProject());
installSawHelp($('saw'));
// "More options" folds out over the canvas: close it on Escape or a click elsewhere.
{ const more = document.querySelector('.settings-more');
  document.addEventListener('click', (event) => { if (more?.open && !more.contains(event.target)) more.open = false; });
  document.addEventListener('keydown', (event) => { if (more?.open && event.key === 'Escape') { more.open = false; more.querySelector('summary').focus(); } }); }
$('saw').addEventListener('change', () => { $('hybrid-limit-field').hidden = $('saw').value !== 'hybrid'; });
workflow = installTimberWorkflow({
  root: $('timber-workflow'), footer: $('timber-workflow-footer'), form: $('timber-form'), results: $('results'),
  getState: () => ({ valid: workflowValid, hasReview: !!plan?.placed, ...visualUI.availability() }),
  onEnter(step) {
    if (step === 1 || step === 2) return visualUI.activateAutomatic();
    if (step === 3) return visualUI.activateManual();
    return !!plan?.placed || visualUI.confirmCurrent();
  },
  onConfirm: () => visualUI.confirmCurrent(),
  onChange(step) { if (step !== 4) cutPlayback.pause(); },
});
try { localStorage.setItem(STORAGE, JSON.stringify(readProject())); } catch { /* The visible save status already offers project download. */ }
if (restored) notify(t('Your saved timber project has been restored. The preview updates as you edit.', '已還原你儲存嘅木材專案，預覽會隨修改即時更新。'));

function planCaption() {
  if (!plan || !plannedProject) return '';
  return t(`${plannedProject.name || 'Untitled project'} · ${t("Kerf","鋸縫")} ${fmt(plan.settings.kerf)} mm · Edge trim ${fmt(plan.settings.trim)} mm · ${plan.settings.usePriorities ? 'Optional part priorities enabled' : 'Whole-list optimisation · fewer cuts first'} · ${plan.settings.direction === 'auto' ? 'Automatic cut direction' : plan.settings.direction === 'rip' ? 'Rip first' : 'Crosscut first'}`, `${plannedProject.name || '未命名專案'} · 鋸縫 ${fmt(plan.settings.kerf)} 毫米 · 修邊 ${fmt(plan.settings.trim)} 毫米 · ${plan.settings.usePriorities ? '已啟用可選優先級' : '整體優化，優先減少切割'} · ${plan.settings.direction === 'auto' ? '自動切割方向' : plan.settings.direction === 'rip' ? '先順紋切割' : '先橫紋切割'}`);
}
onLanguageChange(() => {
  workshop.refresh();
  if (plan) { $('plan-caption').textContent = planCaption(); showSawNote(); renderSheetStrip(); renderSheet(false); }
});
