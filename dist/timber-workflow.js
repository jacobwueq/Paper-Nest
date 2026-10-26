import { t, onLanguageChange } from './locale.js?v=0.26.2';
const steps = [
  ['Setup 設定', 'Setup · 設定', 'Enter stock sizes, part dimensions and quantities. Watch the live preview as you type. 設定板材及零件，輸入時即時預覽。'],
  ['Auto Nest 排料', 'Auto Nest · 自動排料', 'Compare layouts for fewer sheets and fewer cuts. Matching edges share straight cuts; useful offcuts break ties. 自動比較排位，盡量慳板、保留大塊餘料。'],
  ['Manual Adjust 微調', 'Manual Adjust · 手動微調（可選）', 'Start from your current layout. Undo recent placements, then select a part and click a free region to reposition it. 承接目前排位；可撤銷後重新放置，或直接去檢查及匯出。'],
  ['Review & Export 匯出', 'Review & Export · 檢查及匯出', 'Play the cutting sequence, inspect the separated pieces, then print or download the cutting guide. 播放切割次序、核對板件，再列印或下載。'],
];
const titles = [['Setup','設定'],['Auto Nest','自動排料'],['Manual Adjust','手動微調'],['Review & Export','檢查及匯出']];
const help = [
 ['Enter stock sizes, part dimensions and quantities. Watch the live preview as you type.','設定板材、零件尺寸及數量，輸入時即時預覽。'],
 ['Compare layouts for fewer sheets and fewer cuts. Matching edges share straight cuts; useful offcuts break ties.','自動比較排位，先減少用板，再共用對齊邊以減少切割；相同刀數時保留較大餘料。'],
 ['Continue your manual layout, or start from Auto Nest. Undo recent placements, then select a part and a free region to reposition it. This step is optional.','承接手動排位，或由自動方案開始；可撤銷最近放置，再選零件及空位重新放入。此步驟可略過。'],
 ['Play the cutting sequence, inspect the separated pieces, then print or download the cutting guide.','播放切割次序、核對分開後嘅板件，再列印或下載切割指引。'],
];
export function installTimberWorkflow({ root, footer, form, results, getState, onEnter, onConfirm = null, onChange = () => {} }) {
  let step = 1;
  root.innerHTML = `<nav class="timber-step-tabs" role="tablist" aria-label="Timber cutting steps">${steps.map(([label], i) => `<button type="button" role="tab" id="timber-step-${i + 1}" data-timber-tab="${i + 1}" aria-controls="${i === 3 ? results.id : form.id}">${i + 1} · ${label}</button>`).join('')}</nav><section class="timber-step-intro"><h2 id="timber-step-title"></h2><p id="timber-step-help"></p></section>`;
  footer.innerHTML = '<button type="button" id="timber-step-back" class="quiet-button">← Back</button><span id="timber-step-progress" role="status" aria-live="polite"></span><div class="timber-footer-actions"><button type="button" id="timber-step-alt" class="quiet-button" hidden></button><button type="button" id="timber-step-next" class="primary-button"></button></div>';
  const tabs = [...root.querySelectorAll('[data-timber-tab]')], back = footer.querySelector('#timber-step-back'), next = footer.querySelector('#timber-step-next'), alt = footer.querySelector('#timber-step-alt');
  // Steps 2 and 3 share one forward action: confirm the shown layout and open Review & Export.
  const confirms = () => !!onConfirm && (step === 2 || step === 3);
  const canEnter = (target, state) => Number.isInteger(target) && target >= 1 && target <= 4 && (target === 1 || (state.valid && (target === 2 || (target === 3 ? state.canManual : state.hasReview || state.canReview))));
  function render() {
    const state = getState();
    document.body.dataset.timberStep = String(step);
    form.hidden = step === 4; results.hidden = step !== 4 || !state.hasReview;
    form.setAttribute('role', 'tabpanel'); form.setAttribute('aria-labelledby', `timber-step-${step === 4 ? 1 : step}`);
    results.setAttribute('role', 'tabpanel'); results.setAttribute('aria-labelledby', 'timber-step-4');
    tabs.forEach((tab, i) => { tab.textContent = `${i + 1} · ${t(...titles[i])}`; const current = step === i + 1; tab.disabled = !canEnter(i + 1, state); tab.setAttribute('aria-selected', String(current)); tab.setAttribute('aria-current', current ? 'step' : 'false'); tab.tabIndex = current ? 0 : -1; });
    root.querySelector('#timber-step-title').textContent = `${step} — ${t(...titles[step - 1])}`;
    root.querySelector('#timber-step-help').textContent = t(...help[step - 1]);
    back.textContent = t('← Back','← 上一步'); back.disabled = step === 1; next.hidden = step === 4;
    if (confirms()) { next.disabled = !state.valid || !state.canReview; next.textContent = t('Use this layout · Review & Export →', '使用此排位 · 檢查及匯出 →'); }
    else { next.disabled = step < 4 && !canEnter(step + 1, state); next.textContent = step < 4 ? t(`Next: ${titles[step][0]} →`, `下一步：${titles[step][1]} →`) : ''; }
    alt.hidden = step !== 2 || !onConfirm; alt.disabled = !canEnter(3, state); alt.textContent = t('Adjust manually first', '先手動微調');
    footer.querySelector('#timber-step-progress').textContent = t(`Step ${step} / 4${!state.valid ? ' · Complete stock and part sizes to continue.' : step === 2 && !state.canManual ? ' · Waiting for a layout…' : ''}`, `第 ${step} 步／共 4 步${!state.valid ? ' · 請先完成板材及零件尺寸。' : step === 2 && !state.canManual ? ' · 正在準備排料…' : ''}`);
    onChange(step);
  }
  function select(target) {
    if (!canEnter(target, getState())) return false;
    if (onEnter(target) === false) { render(); return false; }
    step = target; render(); root.querySelector('[role="tablist"]').scrollIntoView?.({ behavior: 'smooth', block: 'start' }); return true;
  }
  tabs.forEach((tab) => tab.onclick = () => select(Number(tab.dataset.timberTab)));
  root.querySelector('[role="tablist"]').addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const enabled = tabs.filter((tab) => !tab.disabled), index = enabled.indexOf(document.activeElement);
    const target = event.key === 'Home' ? 0 : event.key === 'End' ? enabled.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + enabled.length) % enabled.length;
    event.preventDefault(); enabled[target]?.focus();
  });
  back.onclick = () => select(step - 1);
  next.onclick = () => { if (!confirms()) { select(step + 1); return; } if (onConfirm() === false) render(); };
  alt.onclick = () => select(3);
  onLanguageChange(render);
  onEnter(1); render();
  return { select, refresh() { const state = getState(); if (step === 2 || step === 3) step = state.mode === 'manual' ? 3 : 2; render(); }, inputsChanged() { if (step === 4) step = 1; render(); }, showSetup() { step = 1; render(); }, showReview() { step = 4; render(); }, get step() { return step; } };
}
