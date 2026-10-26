const steps = [
  ['Setup 設定', 'Setup · 設定', 'Enter stock sizes, part dimensions and quantities. Watch the live preview as you type. 設定板材及零件，輸入時即時預覽。'],
  ['Auto Nest 排料', 'Auto Nest · 自動排料', 'Compare layouts for fewer sheets and larger offcuts. Use Improve layout to keep searching. 自動比較排位，盡量慳板、保留大塊餘料。'],
  ['Manual Adjust 微調', 'Manual Adjust · 手動微調（可選）', 'Start from your current layout. Undo recent placements, then select a part and click a free region to reposition it. 承接目前排位；可撤銷後重新放置，或直接去檢查及匯出。'],
  ['Review & Export 匯出', 'Review & Export · 檢查及匯出', 'Play the cutting sequence, inspect the separated pieces, then print or download the cutting guide. 播放切割次序、核對板件，再列印或下載。'],
];
export function installTimberWorkflow({ root, footer, form, results, getState, onEnter, onChange = () => {} }) {
  let step = 1;
  root.innerHTML = `<nav class="timber-step-tabs" role="tablist" aria-label="Timber cutting steps">${steps.map(([label], i) => `<button type="button" role="tab" id="timber-step-${i + 1}" data-timber-tab="${i + 1}" aria-controls="${i === 3 ? results.id : form.id}">${i + 1} · ${label}</button>`).join('')}</nav><section class="timber-step-intro"><h2 id="timber-step-title"></h2><p id="timber-step-help"></p></section>`;
  footer.innerHTML = '<button type="button" id="timber-step-back" class="quiet-button">← Back</button><span id="timber-step-progress" role="status" aria-live="polite"></span><button type="button" id="timber-step-next" class="primary-button"></button>';
  const tabs = [...root.querySelectorAll('[data-timber-tab]')], back = footer.querySelector('#timber-step-back'), next = footer.querySelector('#timber-step-next');
  const canEnter = (target, state) => Number.isInteger(target) && target >= 1 && target <= 4 && (target === 1 || (state.valid && (target === 2 || (target === 3 ? state.canManual : state.hasReview || state.canReview))));
  function render() {
    const state = getState();
    document.body.dataset.timberStep = String(step);
    form.hidden = step === 4; results.hidden = step !== 4 || !state.hasReview;
    form.setAttribute('role', 'tabpanel'); form.setAttribute('aria-labelledby', `timber-step-${step === 4 ? 1 : step}`);
    results.setAttribute('role', 'tabpanel'); results.setAttribute('aria-labelledby', 'timber-step-4');
    tabs.forEach((tab, i) => { const current = step === i + 1; tab.disabled = !canEnter(i + 1, state); tab.setAttribute('aria-selected', String(current)); tab.setAttribute('aria-current', current ? 'step' : 'false'); tab.tabIndex = current ? 0 : -1; });
    root.querySelector('#timber-step-title').textContent = `${step} — ${steps[step - 1][1]}`;
    root.querySelector('#timber-step-help').textContent = steps[step - 1][2];
    back.disabled = step === 1; next.hidden = step === 4; next.disabled = step < 4 && !canEnter(step + 1, state);
    next.textContent = step < 4 ? `Next: ${steps[step][0]} →` : '';
    footer.querySelector('#timber-step-progress').textContent = `Step ${step} / 4${!state.valid ? ' · Complete stock and part sizes to continue.' : step === 2 && !state.canManual ? ' · Waiting for a layout…' : ''}`;
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
  back.onclick = () => select(step - 1); next.onclick = () => select(step + 1);
  onEnter(1); render();
  return { select, refresh() { const state = getState(); if (step === 2 || step === 3) step = state.mode === 'manual' ? 3 : 2; render(); }, inputsChanged() { if (step === 4) step = 1; render(); }, showSetup() { step = 1; render(); }, showReview() { step = 4; render(); }, get step() { return step; } };
}
