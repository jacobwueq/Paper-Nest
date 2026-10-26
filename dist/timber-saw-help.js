import { t, onLanguageChange } from './locale.js?v=0.25.4';

// A floating explainer beside the Saw setting: why a panel saw and a table saw get different
// cut orders. Each card can also choose that saw, which updates the real <select>.
const panelArt = `<svg viewBox="0 0 140 84" aria-hidden="true" focusable="false">
  <rect x="8" y="74" width="124" height="4" rx="1" class="saw-art-rail"/>
  <rect x="22" y="12" width="96" height="62" class="saw-art-board"/>
  <line x1="22" y1="40" x2="118" y2="40" class="saw-art-line"/>
  <line x1="70" y1="12" x2="70" y2="74" class="saw-art-line saw-art-later"/>
  <circle cx="96" cy="40" r="7" class="saw-art-blade"/>
  <path d="M84 30h22m-5-4 5 4-5 4" class="saw-art-move"/>
</svg>`;
const tableArt = `<svg viewBox="0 0 140 84" aria-hidden="true" focusable="false">
  <rect x="8" y="58" width="124" height="6" rx="1" class="saw-art-rail"/>
  <rect x="18" y="30" width="56" height="28" class="saw-art-board"/>
  <rect x="18" y="22" width="56" height="6" class="saw-art-fence"/>
  <circle cx="92" cy="58" r="12" class="saw-art-blade"/>
  <line x1="18" y1="44" x2="74" y2="44" class="saw-art-line"/>
  <path d="M30 70h30m-5-4 5 4-5 4" class="saw-art-move"/>
</svg>`;

export function installSawHelp(select) {
  const label = select.closest('label');
  const wrap = document.createElement('div');
  wrap.className = 'saw-field';
  label.replaceWith(wrap); wrap.append(label);
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'saw-help-button';
  button.setAttribute('aria-haspopup', 'dialog'); button.setAttribute('aria-expanded', 'false'); button.setAttribute('aria-controls', 'saw-help');
  button.textContent = 'i';
  wrap.append(button);
  const panel = document.createElement('div');
  panel.id = 'saw-help'; panel.className = 'saw-help'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-labelledby', 'saw-help-title'); panel.hidden = true;
  document.body.append(panel);

  function render() {
    button.setAttribute('aria-label', t('How the two saws differ', '兩種鋸機有咩分別'));
    const card = (value, art, title, lead, points) => `<section class="saw-card${select.value === value ? ' is-current' : ''}">
      <div class="saw-art">${art}</div><h4>${title}</h4><p class="saw-lead">${lead}</p><ul>${points.map((p) => `<li>${p}</li>`).join('')}</ul>
      <button type="button" class="${select.value === value ? 'quiet-button' : 'primary-button'}" data-choose-saw="${value}" ${select.value === value ? 'aria-pressed="true"' : ''}>${select.value === value ? t('Selected ✓', '已選擇 ✓') : t('Use this saw', '用呢部鋸機')}</button></section>`;
    panel.innerHTML = `<div class="saw-help-head"><h3 id="saw-help-title">${t('Why the cut order depends on the saw', '點解切割次序要睇鋸機')}</h3><button type="button" class="saw-help-close" aria-label="${t('Close', '關閉')}">×</button></div>
      <p class="saw-help-intro">${t('On a panel saw the board stays still and the blade moves. On a table saw the blade stays still and the board moves. Everything below follows from that.', '立式板鋸係板唔郁、鋸片郁；檯鋸係鋸片唔郁、板郁。以下所有分別都由呢點而嚟。')}</p>
      <div class="saw-cards">${card('panel', panelArt, t('Panel saw', '立式板鋸'), t('The board stands on the rail; the saw runs along a full-length guide.', '板企喺滑軌上；鋸頭沿全長導軌行。'), [
        t('Long straight lines are the easiest cuts, so they are cut while the board is still one piece.', '長直線最易切，所以趁板仍然完整時先切。'),
        t('Cut pieces stay where they are, so one pass can go through several pieces held in line.', '切開嘅板件留喺原位，所以一刀可以切穿幾件對齊嘅板件。'),
        t('Measurements are positions on the original sheet.', '量度以原板上嘅位置為準。'),
      ])}${card('table', tableArt, t('Table saw', '檯鋸'), t('The blade is fixed; you push each piece past it along the fence.', '鋸片固定；每件板沿鋸導尺推過去。'), [
        t('A full sheet is hard to handle, so it is ripped into strips along the grain first, then each strip is crosscut.', '整張板難處理，所以先順紋直切成條，再逐條橫切。'),
        t('One piece per feed, so nothing needs holding in line.', '每次推一件，唔使對齊。'),
        t('Pieces that need the same fence distance share a step; the piece you keep goes between the fence and the blade.', '同一鋸導尺距離嘅板件放喺同一步；要保留嗰件放喺鋸導尺同鋸片之間。'),
      ])}</div>
      <p class="saw-help-foot">${t('The parts stay the same. The cut order and grouping change, and the automatic layout may change to suit the saw.', '零件不變；改變嘅係切割次序同分組，自動排位亦可能按鋸機調整。')}</p>`;
    panel.querySelector('.saw-help-close').onclick = () => close(true);
    for (const choice of panel.querySelectorAll('[data-choose-saw]')) choice.onclick = () => {
      if (select.value !== choice.dataset.chooseSaw) { select.value = choice.dataset.chooseSaw; select.dispatchEvent(new Event('change', { bubbles: true })); }
      render(); panel.querySelector('[data-choose-saw][aria-pressed="true"]')?.focus();
    };
  }
  function place() {
    const r = button.getBoundingClientRect(), width = Math.min(640, window.innerWidth - 32);
    panel.style.width = width + 'px';
    panel.style.left = Math.max(16, Math.min(r.left + r.width / 2 - width / 2, window.innerWidth - width - 16)) + 'px';
    panel.style.maxHeight = '';
    const below = r.bottom + 10, height = panel.offsetHeight, above = r.top - 10 - height;
    const top = below + height > window.innerHeight - 16 && above > 16 ? above : below;
    panel.style.top = top + 'px';
    // On short screens the panel scrolls inside itself instead of running off the bottom.
    panel.style.maxHeight = Math.max(160, window.innerHeight - top - 16) + 'px';
  }
  function open() { render(); panel.hidden = false; button.setAttribute('aria-expanded', 'true'); place(); panel.querySelector('.saw-help-close').focus(); }
  function close(returnFocus = false) { if (panel.hidden) return; panel.hidden = true; button.setAttribute('aria-expanded', 'false'); if (returnFocus) button.focus(); }
  button.onclick = () => panel.hidden ? open() : close();
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !panel.hidden) close(true); });
  document.addEventListener('pointerdown', (event) => { if (!panel.hidden && !panel.contains(event.target) && event.target !== button) close(); });
  window.addEventListener('resize', () => { if (!panel.hidden) place(); });
  window.addEventListener('scroll', () => { if (!panel.hidden) place(); }, { passive: true });
  select.addEventListener('change', () => { if (!panel.hidden) render(); });
  onLanguageChange(() => { render(); if (!panel.hidden) place(); });
  render();
}
