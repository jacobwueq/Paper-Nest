import { t, onLanguageChange } from './locale.js?v=0.31.1';
import { planTimber, optimizeTimber, compareTimberPlans, manualCommandsFromPlan, manualTimber, timberFreeRegions, validateProject } from './timber-planner.js?v=0.31.1';
const escapeHTML = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (n) => Number.isFinite(n) ? Number(n.toFixed(2)).toLocaleString('en-GB', { maximumFractionDigits: 2 }) : '—';
const colors = ['#e5d2af', '#c8d8b9', '#bed6de', '#d9c7df', '#e9c4ac', '#becadb'];
const validSize = (p) => p && [p.length, p.width].every((n) => Number.isFinite(n) && n > 0 && n <= 20000);
export function normalizeVisualDraft(value) {
  const commands = Array.isArray(value?.commands) && value.commands.length <= 500 ? value.commands.filter((c) => c && typeof c.partId === 'string' && /^P\d+\.\d+$/.test(c.partId) && Number.isInteger(c.board) && c.board >= 0 && c.board < 200 && [c.x, c.y].every(Number.isFinite) && typeof c.rotated === 'boolean' && (c.direction === undefined || ['rip', 'cross'].includes(c.direction))).map((c) => ({ partId: c.partId, board: c.board, x: c.x, y: c.y, rotated: c.rotated, ...(c.direction ? { direction: c.direction } : {}) })) : [];
  return { mode: value?.mode === 'manual' ? 'manual' : 'preview', commands, selected: Number.isInteger(value?.selected) && value.selected >= 0 && value.selected < 100 ? value.selected : 0 };
}
export function installTimberVisual({ readProject, changePart, changeStock, addPart, removePart, applyPlan, onDraftChange, onStatusChange = () => {} }) {
  const root = document.getElementById('timber-visual');
  root.innerHTML = `
    <div class="visual-heading"><div><p class="eyebrow">LIVE MATERIAL WORKSPACE · 即時可視化</p><h2>See every piece as you type.<small>一路輸入，一路睇到。</small></h2></div><div class="visual-mode" role="group" aria-label="Planning mode"><button type="button" data-mode="preview" aria-pressed="true">Auto optimise · 自動排料</button><button type="button" data-mode="manual" aria-pressed="false">Place parts · 手動放置</button></div></div>
    <div class="visual-stats" id="visual-stats" role="status" aria-live="polite"></div>
    <div class="visual-workspace">
      <aside class="visual-parts"><div class="visual-parts-heading"><div><h3>Parts tray <small>零件區</small></h3><span>Click a part to edit / 點選修改尺寸</span><span class="tray-hint">Paste rows from a spreadsheet (Ctrl/⌘ V) / 可直接貼上試算表行</span></div><button type="button" id="visual-add" aria-label="Add part">＋</button></div><div id="visual-tray" class="visual-tray"></div>
        <div class="visual-inspector"><div class="inspector-heading"><strong id="visual-selected-name" data-user-content>Selected part</strong><span id="visual-selected-code"></span></div><label>Label · 名稱<input id="visual-label" data-visual-field="label" maxlength="100"></label><div class="visual-field-pair"><label>Length → · 長<input id="visual-length" data-visual-field="length" type="number" min="0.01" max="20000" step="any"></label><label>Width · 闊<input id="visual-width" data-visual-field="width" type="number" min="0.01" max="20000" step="any"></label></div><div class="visual-field-pair"><label>Qty · 數量<input id="visual-qty" data-visual-field="qty" type="number" min="1" max="500" step="1"></label><label>Thickness · 厚<input id="visual-thickness" data-visual-field="thickness" type="number" min="0.01" max="20000" step="any"></label></div><label>Material · 物料<input id="visual-material" data-visual-field="material" maxlength="80"></label><label class="visual-grain"><input id="visual-grain" data-visual-field="grain" type="checkbox">Lock grain along length · 固定木紋方向</label><div class="visual-place-actions"><button type="button" id="visual-rotate">↻ 90°</button><button type="button" id="visual-place">Place one · 放入一件 →</button></div></div>
      </aside>
      <div class="visual-board-area"><div class="visual-stock-toolbar"><label>Stock type · 板材<select id="visual-stock-type" data-user-content aria-label="Stock type"></select></label><label>Length · 長<input id="visual-stock-length" data-visual-stock="length" type="number" min="1" max="20000" step="any" aria-label="Stock length in millimetres"></label><span class="stock-times" aria-hidden="true">×</span><label>Width · 闊<input id="visual-stock-width" data-visual-stock="width" type="number" min="1" max="20000" step="any" aria-label="Stock width in millimetres"></label><label>Sheets · 張<input id="visual-stock-qty" data-visual-stock="qty" type="number" min="1" max="200" step="1" aria-label="Available stock quantity"></label><span class="visual-mm">mm</span></div>
        <div class="visual-canvas-toolbar"><div class="visual-sheet-tabs" id="visual-sheet-tabs" role="group" aria-label="Sheet selection"></div><div class="visual-view-tools" role="group" aria-label="Canvas view"><button type="button" id="visual-view" aria-pressed="false">Isometric · 立體</button><button type="button" id="visual-zoom-out" aria-label="Zoom out">−</button><button type="button" id="visual-fit">Fit</button><button type="button" id="visual-zoom-in" aria-label="Zoom in">＋</button></div></div>
        <div id="visual-canvas" class="visual-canvas"></div><div class="visual-board-caption"><span id="visual-board-label" data-user-content></span><span>Grain → · 木紋 / mm</span></div><div class="visual-instruction" id="visual-instruction" role="status" aria-live="polite"></div>
        <div class="visual-bottom"><div class="visual-legend"><span><i class="part-key"></i>Part · 零件</span><span><i class="free-key"></i>Free area · 可用空位</span><span><i class="selected-key"></i>Selected · 已選</span></div><div class="visual-history"><button type="button" id="visual-undo">↶ Undo · 撤銷</button><button type="button" id="visual-reset">Clear placements · 清空排位</button></div></div>
      </div>
    </div><div class="visual-footer"><p id="visual-plan-note">Live preview is an estimate. Confirm the layout to get the cut sequence.</p><button type="button" id="visual-improve" class="quiet-button">Improve layout · 繼續優化</button><button type="button" id="visual-confirm" class="primary-button">Use layout & cut guide · 確認排位及切割指引 →</button></div>`;
  const $ = (id) => document.getElementById(id);
  let project, draft = normalizeVisualDraft(null), estimate = null, manual = null, error = '', notice = '', modeSignature = '', timer, worker, workerFailed = false, revision = 0, activeBoard = 0, stockRow = 0, rotated = false, iso = false, zoom = 1, optimizing = false, searchTrials = 0;
  const signature = (p) => JSON.stringify({ settings: p.settings, stocks: p.stocks.map(({ label, ...s }) => s), parts: p.parts.map(({ label, priority, ...part }) => part) });
  const notify = (message) => { notice = message; $('visual-instruction').textContent = message; };
  const scheduleResult = ({ revision: resultRevision, plan, error: resultError, optimizing: running = false }) => {
    if (resultRevision !== revision || !root.isConnected) return;
    if (plan && (!estimate || compareTimberPlans(plan, estimate) < 0)) estimate = plan;
    optimizing = running; searchTrials = plan?.search?.trials || searchTrials;
    error = resultError || ''; render();
  };
  const runPreview = (p, token, budgetMs = 1200) => {
    optimizing = true; render();
    if (worker) { worker.postMessage({ project: p, revision: token, budgetMs, initialPlan: estimate }); return; }
    setTimeout(async () => {
      try {
        const initial = planTimber(p), warm = estimate || initial;
        scheduleResult({ revision: token, plan: initial, optimizing: true });
        const best = await optimizeTimber(p, { budgetMs, initialPlan: warm, maxTrials: budgetMs > 1500 ? 1500 : 256, shouldCancel: () => token !== revision || !root.isConnected, onProgress: (plan) => scheduleResult({ revision: token, plan, optimizing: true }) });
        if (best) scheduleResult({ revision: token, plan: best, optimizing: false });
      } catch (e) { scheduleResult({ revision: token, error: e.message }); }
    }, 0);
  };
  try {
    if (typeof Worker !== 'undefined') {
      worker = new Worker(new URL('./timber-live-worker.js?v=0.31.1', import.meta.url), { type: 'module' });
      worker.onmessage = ({ data }) => scheduleResult(data);
      worker.onerror = () => { worker.terminate(); worker = null; if (!workerFailed) { workerFailed = true; runPreview(project, revision); } };
    }
  } catch { worker = null; }
  function restore(value) { draft = normalizeVisualDraft(value); modeSignature = ''; rotated = false; activeBoard = 0; }
  function update(p) {
    project = p; revision++; clearTimeout(timer); worker?.postMessage({ cancel: true }); estimate = null; error = ''; optimizing = false; searchTrials = 0;
    const nextSignature = signature(p);
    if (modeSignature && modeSignature !== nextSignature && draft.commands.length) {
      draft.commands = []; notice = '尺寸或清單已更改，手動排位已重設。重新點選零件放入板材。';
    }
    modeSignature = nextSignature; draft.selected = Math.min(draft.selected, Math.max(0, p.parts.length - 1));
    stockRow = Math.min(stockRow, Math.max(0, p.stocks.length - 1));
    if (!p.settings.rotate || p.parts[draft.selected]?.grain) rotated = false;
    try {
      validateProject(p);
      try { manual = manualTimber(p, draft.commands); } catch { draft.commands = []; manual = manualTimber(p); notice = 'Saved placements no longer fit. 手動排位已重設，請重新放置。'; }
      timer = setTimeout(() => runPreview(p, revision), 160);
    } catch (e) { error = e.message; manual = null; }
    render();
  }
  function allBoards() {
    if (draft.mode === 'manual' && manual) return manual.boards;
    const fitted = estimate?.sheets || [];
    const references = project.stocks.filter((stock, index) => validSize(stock) && !fitted.some((board) => board.stockIndex === index)).map((stock) => {
      const t = Number.isFinite(project.settings.trim) && project.settings.trim >= 0 && project.settings.trim * 2 < Math.min(stock.length, stock.width) ? project.settings.trim : 0;
      return { stock, stockIndex: project.stocks.indexOf(stock), number: 1, parts: [], reference: true, root: { kind: 'free', x: t, y: t, w: stock.length - t * 2, h: stock.width - t * 2 } };
    });
    return [...fitted, ...references];
  }
  function boardOptions() { return allBoards().filter((board) => board.stockIndex === stockRow); }
  function currentBoard() { const options = boardOptions(); activeBoard = Math.max(0, Math.min(activeBoard, options.length - 1)); return options[activeBoard]; }
  function renderTray() {
    const placed = draft.mode === 'manual' && manual ? manual.sheets.flatMap((s) => s.parts) : [];
    const max = Math.max(1, ...project.parts.filter(validSize).flatMap((p) => [p.length, p.width]));
    $('visual-tray').innerHTML = project.parts.map((p, row) => {
      const valid = validSize(p), turn = row === draft.selected && rotated;
      const w = valid ? Math.max(3, (turn ? p.width : p.length) / max * 65) : 70, h = valid ? Math.max(3, (turn ? p.length : p.width) / max * 65) : 35;
      const assigned = placed.filter((item) => item.row === row).length;
      return `<div class="visual-part-entry"><button type="button" class="visual-part-card ${draft.selected === row ? 'is-selected' : ''}" data-row="${row}" aria-pressed="${draft.selected === row}"><span class="part-mini"><svg viewBox="0 0 120 78" aria-hidden="true"><rect x="${(120 - w) / 2}" y="${(78 - h) / 2}" width="${w}" height="${h}" rx="1" fill="${colors[row % colors.length]}" stroke="${draft.selected === row ? '#c2570c' : '#9d8b71'}" stroke-width="1.4"/>${p.grain && valid ? `<path d="M${(120 - w) / 2 + 3} 39h${Math.max(1, w - 6)}" stroke="#927f5f" stroke-dasharray="3 3"/>` : ''}</svg></span><span class="part-mini-copy"><strong data-user-content>P${row + 1} · ${escapeHTML(p.label || 'Untitled part')}</strong><span>${valid ? `${fmt(p.length)} × ${fmt(p.width)} mm` : 'Enter size · 輸入尺寸'}</span><small data-user-content>${escapeHTML(p.material)} · ${fmt(p.thickness)} mm${p.grain ? ' · → grain' : ''}</small></span><span class="part-mini-qty">${draft.mode === 'manual' ? `${assigned}/${fmt(p.qty)}` : `×${fmt(p.qty)}`}</span></button><button type="button" class="visual-part-delete" data-delete-row="${row}" aria-label="Delete ${escapeHTML(p.label || `Part ${row + 1}`)}" title="Delete part · 刪除零件">−</button></div>`;
    }).join('') || '<p class="visual-tray-empty">No parts yet · 暫未有零件<br>Use ＋ to add a part.</p>';
    const selected = project.parts[draft.selected];
    $('visual-selected-name').textContent = selected?.label || 'No part selected'; $('visual-selected-code').textContent = selected ? `P${draft.selected + 1}${rotated ? ' ↻ 90°' : ''}` : '—';
    for (const e of root.querySelectorAll('[data-visual-field]')) {
      const value = selected?.[e.dataset.visualField];
      e.disabled = !selected;
      if (document.activeElement !== e) { if (e.type === 'checkbox') e.checked = Boolean(value); else e.value = value ?? ''; }
    }
    $('visual-rotate').disabled = !selected || selected.grain || !project.settings.rotate;
    $('visual-rotate').setAttribute('aria-pressed', String(rotated));
    $('visual-rotate').textContent = rotated ? '↻ 90° ✓' : '↻ 90°';
    $('visual-place').disabled = !!error || !manual;
  }
  function draw(board) {
    if (!board || !validSize(board.stock)) { $('visual-canvas').innerHTML = '<div class="visual-placeholder">輸入板材尺寸，即時顯示板材。<small>Enter a stock size to see your sheet.</small></div>'; return; }
    const L = board.stock.length, W = board.stock.width, fs = Math.max(L, W) * .018, pad = Math.max(L, W) * .065;
    const parts = board.parts || [], free = timberFreeRegions(board), manualMode = draft.mode === 'manual';
    const selected = project.parts[draft.selected];
    const selectedW = rotated ? selected?.width : selected?.length, selectedH = rotated ? selected?.length : selected?.width;
    const sameMaterial = selected && board.stock.material.trim().toLowerCase() === selected.material.trim().toLowerCase() && board.stock.thickness === selected.thickness;
    const freeMarkup = free.map((r, i) => {
      const fits = manualMode && manual && validSize(selected) && sameMaterial && selectedW <= r.w + 1e-7 && selectedH <= r.h + 1e-7;
      return `<g data-region="${i}" ${manualMode ? `role="button" tabindex="0" aria-label="Free region ${fmt(r.w)} by ${fmt(r.h)} mm${fits ? ', click to place selected part' : ', selected part cannot fit'}"` : ''}><title>${fmt(r.w)} × ${fmt(r.h)} mm${fits ? ' · Click to place / 點選放入' : ''}</title><rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="${fits ? '#e3ecde' : '#eef0e8'}" stroke="${fits ? '#9cba87' : '#bdc5b2'}" stroke-width="${L / 1400}" stroke-dasharray="${L / 300} ${L / 500}"/>${r.w > fs * 6 && r.h > fs * 2 ? `<text x="${r.x + r.w / 2}" y="${r.y + r.h / 2}" text-anchor="middle" font-size="${fs * .55}" fill="#849278" pointer-events="none">${fits ? '+ ' : ''}${fmt(r.w)} × ${fmt(r.h)}</text>` : ''}</g>`;
    }).join('');
    const partMarkup = parts.map((p) => {
      const selectedPart = p.row === draft.selected, size = Math.min(fs * .75, p.h / 4, p.w / Math.max(p.id.length, 6));
      return `<g data-part-row="${p.row}" role="button" tabindex="0" aria-label="${escapeHTML(p.label)} ${fmt(p.length)} by ${fmt(p.width)} mm, select to edit"><title>${escapeHTML(p.label)} · ${p.id} · ${fmt(p.length)} × ${fmt(p.width)} mm</title><rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" fill="${colors[p.row % colors.length]}" fill-opacity="${manualMode ? 1 : .87}" stroke="${selectedPart ? '#c2570c' : '#9a896e'}" stroke-width="${L / (selectedPart ? 500 : 1400)}"/><text x="${p.x + p.w / 2}" y="${p.y + p.h / 2 - size * .2}" text-anchor="middle" font-size="${size}" fill="#4b4c43" pointer-events="none">${escapeHTML(p.id)}${p.rotated ? ' ↻' : ''}</text>${p.w > fs * 5 && p.h > fs * 2.5 ? `<text x="${p.x + p.w / 2}" y="${p.y + p.h / 2 + size}" text-anchor="middle" font-size="${size * .7}" fill="#767461" pointer-events="none">${fmt(p.w)} × ${fmt(p.h)}</text>` : ''}</g>`;
    }).join('');
    const outline = `<rect width="${L}" height="${W}" fill="#e5d7bd" stroke="#9b896c" stroke-width="${L / 1100}"/>${freeMarkup}${partMarkup}`;
    const face = iso ? `<g transform="translate(${W * .866} 0) matrix(.866 .5 -.866 .5 0 0)"><rect x="0" y="${board.stock.thickness * 1.8}" width="${L}" height="${W}" fill="#9c7a50"/>${outline}</g>` : outline;
    const box = iso ? `${-pad} ${-pad} ${(L + W) * .866 + 2 * pad} ${(L + W) * .5 + 2 * pad + board.stock.thickness * 2}` : `${-pad} ${-pad} ${L + 2 * pad} ${W + 2 * pad}`;
    const dims = iso ? '' : `<text x="${L / 2}" y="${-pad * .35}" text-anchor="middle" font-size="${fs * .7}" fill="#7d827e">${fmt(L)} mm · GRAIN →</text><text transform="translate(${-pad * .35} ${W / 2}) rotate(-90)" text-anchor="middle" font-size="${fs * .7}" fill="#7d827e">${fmt(W)} mm</text>`;
    $('visual-canvas').innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}" style="width:${zoom * 100}%;height:${zoom * 100}%" role="group" aria-label="${manualMode ? 'Manual' : 'Live preview'} sheet ${board.number}, ${fmt(L)} by ${fmt(W)} mm, ${parts.length} parts${iso ? ', isometric view' : ', top view'}">${face}${dims}</svg>`;
    $('visual-canvas').classList.toggle('is-manual', manualMode);
    $('visual-board-label').textContent = `${board.stock.label || 'Stock'} · ${board.stock.material} ${fmt(board.stock.thickness)} mm · ${fmt(L)} × ${fmt(W)} mm`;
  }
  function render() {
    if (!project) return;
    renderTray();
    const result = draft.mode === 'manual' ? manual : estimate;
    const total = project.parts.reduce((n, p) => n + (Number.isFinite(p.qty) ? p.qty : 0), 0);
    $('visual-stats').innerHTML = `<span><strong>${project.parts.length}</strong> part types · 種零件</span><span><strong>${fmt(total)}</strong> pieces · 件</span><span><strong>${result ? result.sheets.length : '—'}</strong> ${draft.mode === 'manual' ? 'sheets used · 已用板' : 'sheets estimated · 預計用板'}</span><span class="${result?.unplaced.length ? 'has-unplaced' : ''}"><strong>${result ? result.unplaced.length : '—'}</strong> ${draft.mode === 'manual' ? 'to place · 待放入' : 'unplaced · 未能放入'}</span><span class="cut-stat"><strong>${result?.fitness?.cutCount ?? '—'}</strong>${t('cuts','刀切割')}</span><span class="remnant-stat"><strong>${result?.reusableOffcuts?.[0] ? `${fmt(result.reusableOffcuts[0].w)} × ${fmt(result.reusableOffcuts[0].h)}` : '—'}</strong>mm · 最大餘料</span>`;
    root.querySelectorAll('[data-mode]').forEach((e) => e.setAttribute('aria-pressed', String(e.dataset.mode === draft.mode)));
    $('visual-stock-type').innerHTML = project.stocks.map((s, i) => `<option value="${i}" ${i === stockRow ? 'selected' : ''}>${escapeHTML(s.material)} / ${fmt(s.thickness)} mm · ${escapeHTML(s.label || `Stock ${i + 1}`)}</option>`).join('');
    for (const e of root.querySelectorAll('[data-visual-stock]')) if (document.activeElement !== e) e.value = project.stocks[stockRow]?.[e.dataset.visualStock] ?? '';
    const options = boardOptions(); currentBoard();
    $('visual-sheet-tabs').innerHTML = options.map((board, i) => `<button type="button" data-board="${i}" aria-pressed="${i === activeBoard}">${board.reference ? t('Stock preview','板材預覽') : 'S' + board.number}${draft.mode === 'manual' && !board.parts?.length ? t(' · empty',' · 空白') : ''}</button>`).join('') || '<span class="visual-no-sheet">Sheet preview · 板材預覽</span>';
    draw(currentBoard());
    $('visual-undo').disabled = draft.mode !== 'manual' || !draft.commands.length; $('visual-reset').disabled = draft.mode !== 'manual' || !draft.commands.length;
    $('visual-confirm').disabled = !result?.placed || !!error;
    $('visual-improve').disabled = !!error;
    $('visual-improve').textContent = draft.mode === 'manual' ? 'Auto optimise all · 全部自動排料' : optimizing ? 'Stop optimisation · 停止' : 'Improve layout · 繼續優化';
    $('visual-view').setAttribute('aria-pressed', String(iso)); $('visual-view').textContent = iso ? 'Top view · 平面' : 'Isometric · 立體';
    const description = !project.parts.length ? 'Parts tray is empty. Use ＋ to add a part · 零件區已清空，按 ＋ 新增。' : error ? `完成尺寸後繼續預覽 · ${error}` : notice || (draft.mode === 'manual' ? t('① Select a part on the left. ② Click a green free area to place it. Edges align automatically with room for kerf.','① 點選左邊零件 ② 點綠色空位放入。自動靠邊對齊，預留鋸縫。') : estimate ? t('Compare the whole list, ignoring input order: place all parts, minimise sheets, then reduce cuts by sharing matching edges.','自動比較整份清單，不跟輸入先後；先放齊、減少用板，再共用對齊邊，減少切割。') : '正在更新預覽 · Updating layout…');
    $('visual-instruction').textContent = description;
    $('visual-plan-note').textContent = draft.mode === 'manual' ? t('Manual layout. Free areas follow straight-through cuts; “Use this layout” makes the matching cutting order.','手動排位：空位會按直線切割分區；按「使用此排位」產生對應切割次序。') : t('Live estimate, limited by available stock. “Use this layout” makes the cutting guide.','即時預計，受可用板材數量限制；按「使用此排位」產生切割指引。');
    if (result?.sheets.length) {
      const groups = new Map();
      for (const board of result.sheets) { const label = `${board.stock.material} ${fmt(board.stock.thickness)} mm`; groups.set(label, (groups.get(label) || 0) + 1); }
      $('visual-plan-note').textContent += t(' Sheets by material: ',' 各物料用板：') + [...groups].map(([label, qty]) => `${label} × ${qty}${t(qty === 1 ? ' sheet' : ' sheets',' 張')}`).join('；');
    }
    if (draft.mode === 'preview') $('visual-plan-note').textContent += t(` ${optimizing ? 'Comparing' : 'Compared'} ${searchTrials} layouts; prioritise all parts, least stock (smaller offcut rows before a new sheet), then fewer cuts and usable offcuts.`, ` ${optimizing ? '正在比較排位' : '已比較'} ${searchTrials} 個方案；先放齊、用最少板材（先用較細嘅餘料板，再開新板），再減少切割及保留可用餘料。`);
    onStatusChange();
  }
  onLanguageChange(render);
  function select(row) { draft.selected = row; rotated = false; notice = ''; render(); onDraftChange(false); }
  function stopSearch() { revision++; clearTimeout(timer); worker?.postMessage({ cancel: true }); optimizing = false; }
  function setMode(mode) { clearTimeout(timer); draft.mode = mode; activeBoard = 0; notice = ''; if (mode === 'manual') stopSearch(); else if (!estimate && !error) runPreview(project, ++revision); render(); onDraftChange(); }
  function place(regionIndex) {
    if (!manual || error) return;
    const board = currentBoard(), selected = project.parts[draft.selected]; if (!board || !selected) return;
    const assigned = new Set(draft.commands.map((c) => c.partId));
    const copy = Array.from({ length: selected.qty }, (_, i) => `P${draft.selected + 1}.${i + 1}`).find((id) => !assigned.has(id));
    if (!copy) { notify('呢種零件已全部放入。All copies of this part are already placed.'); return; }
    const regions = timberFreeRegions(board);
    let region = regions[regionIndex];
    if (regionIndex === undefined) region = regions.filter((r) => (rotated ? selected.width : selected.length) <= r.w + 1e-7 && (rotated ? selected.length : selected.width) <= r.h + 1e-7).sort((a, b) => a.w * a.h - b.w * b.h)[0];
    if (!region) { notify('目前呢張板冇足夠空位，請轉另一張板，或按 90° 旋轉（木紋未鎖定時）。'); return; }
    const command = { partId: copy, board: manual.boards.indexOf(board), x: region.x, y: region.y, rotated };
    try { const next = manualTimber(project, [...draft.commands, command]); draft.commands.push(command); manual = next; notice = `${copy} 已放入 S${board.number}。繼續點空位放下一件，或選另一種零件。`; render(); onDraftChange(); }
    catch (e) { notify(e.message); }
  }
  $('visual-tray').addEventListener('click', (event) => {
    const remove = event.target.closest('[data-delete-row]');
    if (remove) {
      const row = Number(remove.dataset.deleteRow);
      if (draft.selected > row) draft.selected--;
      removePart(row);
      ($('visual-tray').querySelector(`[data-row="${draft.selected}"]`) || $('visual-add')).focus();
      return;
    }
    const e = event.target.closest('[data-row]'); if (e) select(Number(e.dataset.row));
  });
  for (const e of root.querySelectorAll('[data-visual-field]')) e.addEventListener('input', () => { changePart(draft.selected, e.dataset.visualField, e.type === 'checkbox' ? e.checked : e.type === 'number' ? Number(e.value) : e.value); });
  for (const e of root.querySelectorAll('[data-visual-stock]')) e.addEventListener('input', () => { changeStock(stockRow, e.dataset.visualStock, Number(e.value)); });
  root.querySelectorAll('[data-mode]').forEach((e) => e.onclick = () => setMode(e.dataset.mode));
  $('visual-add').onclick = () => { addPart(); select(readProject().parts.length - 1); $('visual-label').focus(); };
  $('visual-stock-type').onchange = () => { stockRow = Number($('visual-stock-type').value); activeBoard = 0; render(); };
  $('visual-sheet-tabs').onclick = (event) => { const e = event.target.closest('[data-board]'); if (e) { activeBoard = Number(e.dataset.board); render(); } };
  $('visual-rotate').onclick = () => { if ($('visual-rotate').disabled) return; rotated = !rotated; render(); };
  $('visual-place').onclick = () => { if (draft.mode !== 'manual') setMode('manual'); place(); };
  const canvasAction = (event) => {
    const part = event.target.closest('[data-part-row]'); if (part) { select(Number(part.dataset.partRow)); return; }
    const region = event.target.closest('[data-region]'); if (region && draft.mode === 'manual') place(Number(region.dataset.region));
  };
  $('visual-canvas').addEventListener('click', canvasAction);
  $('visual-canvas').addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); canvasAction(event); } });
  $('visual-view').onclick = () => { iso = !iso; zoom = 1; render(); };
  $('visual-zoom-in').onclick = () => { zoom = Math.min(3, zoom + .25); draw(currentBoard()); };
  $('visual-zoom-out').onclick = () => { zoom = Math.max(.5, zoom - .25); draw(currentBoard()); };
  $('visual-fit').onclick = () => { zoom = 1; draw(currentBoard()); };
  const replay = () => { manual = manualTimber(project, draft.commands); notice = ''; render(); onDraftChange(); };
  $('visual-undo').onclick = () => { draft.commands.pop(); replay(); };
  $('visual-reset').onclick = () => { draft.commands = []; replay(); };
  function confirmCurrent() { const result = draft.mode === 'manual' ? manual : estimate; if (!result?.placed || error) return false; stopSearch(); render(); applyPlan(result, draft.mode); return true; }
  $('visual-confirm').onclick = confirmCurrent;
  $('visual-improve').onclick = () => { if (draft.mode === 'manual') { draft.mode = 'preview'; activeBoard = 0; notice = ''; onDraftChange(); runPreview(project, ++revision, 6000); } else if (optimizing) { stopSearch(); render(); } else { notice = ''; onDraftChange(); runPreview(project, ++revision, 6000); } };
  return {
    activateAutomatic() { if (draft.mode !== 'preview') setMode('preview'); else if (!estimate && !error && !optimizing) { clearTimeout(timer); runPreview(project, ++revision); } return true; },
    activateManual() {
      try {
        let seeded = false;
        if (!draft.commands.length) { if (!estimate?.placed) return false; draft.commands = manualCommandsFromPlan(project, estimate); seeded = true; }
        manual = manualTimber(project, draft.commands); const changed = draft.mode !== 'manual' || seeded;
        draft.mode = 'manual'; activeBoard = 0; if (!manual.sheets.some((s) => s.stockIndex === stockRow)) stockRow = manual.sheets[0]?.stockIndex || 0; notice = seeded ? '已承接自動排位。可撤銷最近放置，再選空位重新放入。' : ''; stopSearch(); render(); if (changed) onDraftChange(); return true;
      } catch (e) { notify(e.message); return false; }
    },
    availability: () => ({ mode: draft.mode, canManual: !!(estimate?.placed || manual?.placed), canReview: !!(draft.mode === 'manual' ? manual?.placed : estimate?.placed) }),
    confirmCurrent,
    update, restore, getDraft: () => structuredClone(draft), select, bestAutomaticPlan: () => estimate, showAutomaticPlan(result) { stopSearch(); estimate = result; draft.mode = 'preview'; render(); onDraftChange(false); } };
}
