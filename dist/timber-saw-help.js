import { t, onLanguageChange } from './locale.js?v=0.31.3';

// A floating explainer beside the Saw setting: why a panel saw and a table saw get different
// cut orders. Each card can also choose that saw, which updates the real <select>.
// Drawings are rebuilt on each render so their labels follow the language switch.
// Panel saw, seen from the front: board standing on the rail, saw head travelling along its beam.
const panelArt = () => `<svg viewBox="0 0 240 150" role="img" aria-label="${t('Panel saw seen from the front', '立式板鋸正面')}">
  <rect x="14" y="12" width="212" height="6" class="sa-steel"/><rect x="14" y="12" width="6" height="112" class="sa-steel"/><rect x="220" y="12" width="6" height="112" class="sa-steel"/>
  <rect x="8" y="124" width="224" height="7" rx="1" class="sa-steel"/>
  <rect x="30" y="38" width="150" height="86" class="sa-board"/>
  <path d="M30 60h150M30 82h150M30 104h150" class="sa-grain"/>
  <rect x="117" y="18" width="10" height="106" class="sa-beam"/>
  <line x1="122" y1="38" x2="122" y2="64" class="sa-cut"/><line x1="122" y1="80" x2="122" y2="124" class="sa-cut-next"/>
  <rect x="110" y="62" width="24" height="20" rx="3" class="sa-head"/><circle cx="122" cy="72" r="7" class="sa-blade"/>
  <path d="M198 50v44m-5-6 5 6 5-6" class="sa-move"/>
  <text x="198" y="42" class="sa-label sa-center">${t('saw moves', '鋸頭郁')}</text>
  <text x="38" y="116" class="sa-label">${t('board stays still', '板唔郁')}</text>
  <text x="120" y="145" class="sa-label sa-center">${t('rail', '滑軌')}</text>
</svg>`;
// Table saw, seen from above: fixed blade in the table, fence on the right, board pushed forward.
const tableArt = () => `<svg viewBox="0 0 240 150" role="img" aria-label="${t('Table saw seen from above', '檯鋸俯視')}">
  <rect x="20" y="10" width="200" height="124" rx="4" class="sa-table"/>
  <rect x="166" y="10" width="9" height="124" class="sa-steel"/>
  <rect x="104" y="40" width="10" height="30" rx="2" class="sa-slot"/><line x1="109" y1="38" x2="109" y2="72" class="sa-blade-line"/>
  <rect x="78" y="78" width="88" height="48" class="sa-board"/>
  <path d="M84 92h76M84 106h76M84 120h76" class="sa-grain"/>
  <line x1="109" y1="72" x2="109" y2="126" class="sa-cut-next"/>
  <path d="M138 70V40m-5 6 5-6 5 6" class="sa-move"/>
  <text x="62" y="30" class="sa-label">${t('blade stays', '鋸片唔郁')}</text>
  <text x="180" y="62" class="sa-label">${t('fence', '鋸導尺')}</text>
  <text x="144" y="58" class="sa-label">${t('push', '推')}</text>
  <text x="122" y="146" class="sa-label sa-center">${t('board moves', '板郁')}</text>
</svg>`;
// Hybrid: long lines on the panel saw break the sheet into strips; short cuts on the table saw.
const hybridArt = () => `<svg viewBox="0 0 240 150" role="img" aria-label="${t('Panel saw first, then table saw', '先板鋸，後檯鋸')}">
  <rect x="10" y="26" width="98" height="78" class="sa-board"/>
  <line x1="10" y1="52" x2="108" y2="52" class="sa-cut"/><line x1="10" y1="78" x2="108" y2="78" class="sa-cut"/>
  <text x="59" y="18" class="sa-label sa-center">${t('① panel saw', '① 板鋸')}</text>
  <text x="59" y="120" class="sa-label sa-center">${t('long lines', '長線')}</text>
  <path d="M116 65h16m-5-5 5 5-5 5" class="sa-move"/>
  <rect x="142" y="26" width="88" height="22" class="sa-board"/><rect x="142" y="54" width="88" height="22" class="sa-board"/><rect x="142" y="82" width="88" height="22" class="sa-board"/>
  <path d="M172 26v22M202 26v22M172 54v22M202 54v22M172 82v22M202 82v22" class="sa-cut-next"/>
  <text x="186" y="18" class="sa-label sa-center">${t('② table saw', '② 檯鋸')}</text>
  <text x="186" y="120" class="sa-label sa-center">${t('short cuts', '短刀')}</text>
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
      <p class="saw-help-intro">${t('On a panel saw the board stays still and the blade moves. On a table saw the blade stays still and the board moves. Hybrid uses each saw where it works best.', '立式板鋸係板唔郁、鋸片郁；檯鋸係鋸片唔郁、板郁。混合模式就喺每部機最擅長嘅地方用佢。')}</p>
      <div class="saw-cards">${card('panel', panelArt(), t('Panel saw', '立式板鋸'), t('The board stands on the rail; the saw runs along a full-length guide.', '板企喺滑軌上；鋸頭沿全長導軌行。'), [
        t('Long straight lines are the easiest cuts, so they are cut while the board is still one piece.', '長直線最易切，所以趁板仍然完整時先切。'),
        t('Cut pieces stay where they are, so one pass can go through several pieces held in line.', '切開嘅板件留喺原位，所以一刀可以切穿幾件對齊嘅板件。'),
        t('Measurements are positions on the original sheet.', '量度以原板上嘅位置為準。'),
      ])}${card('table', tableArt(), t('Table saw', '檯鋸'), t('The blade is fixed; you push each piece past it along the fence.', '鋸片固定；每件板沿鋸導尺推過去。'), [
        t('A full sheet is hard to handle, so it is ripped into strips along the grain first, then each strip is crosscut.', '整張板難處理，所以先順紋直切成條，再逐條橫切。'),
        t('One piece per feed, so nothing needs holding in line.', '每次推一件，唔使對齊。'),
        t('Pieces that need the same fence distance share a step; the piece you keep goes between the fence and the blade.', '同一鋸導尺距離嘅板件放喺同一步；要保留嗰件放喺鋸導尺同鋸片之間。'),
      ])}${card('hybrid', hybridArt(), t('Hybrid', '混合'), t('Panel saw for the big pieces, table saw once pieces are easy to handle.', '大件用板鋸，板件易處理之後轉用檯鋸。'), [
        t('The panel saw cuts the long lines that break the sheet down.', '板鋸先切長線，將整張板拆開。'),
        t('Pieces up to the length you set (1,220 mm unless you change it) move to the table saw.', '板件長度喺你設定嘅尺寸以下（預設 1,220 毫米）就搬去檯鋸。'),
        t('On the table saw, pieces that need the same fence distance share a step.', '喺檯鋸上，同一鋸導尺距離嘅板件放喺同一步。'),
      ])}</div>
      <p class="saw-help-foot">${t('The parts stay the same. The cut order and grouping change, and the automatic layout may change to suit the saw.', '零件不變；改變嘅係切割次序同分組，自動排位亦可能按鋸機調整。')}</p>`;
    panel.querySelector('.saw-help-close').onclick = () => close(true);
    for (const choice of panel.querySelectorAll('[data-choose-saw]')) choice.onclick = () => {
      if (select.value !== choice.dataset.chooseSaw) { select.value = choice.dataset.chooseSaw; select.dispatchEvent(new Event('change', { bubbles: true })); }
      render(); panel.querySelector('[data-choose-saw][aria-pressed="true"]')?.focus();
    };
  }
  function place() {
    const r = button.getBoundingClientRect(), width = Math.min(960, window.innerWidth - 32);
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
