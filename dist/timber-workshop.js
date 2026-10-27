import { t } from './locale.js?v=0.32.1';
import { cutHeadline, cutDescription, cutDetail, cutRetain } from './timber-text.js?v=0.32.1';
// Workshop view (roadmap 2.2): full screen, one step at a time, readable from the saw.
// Step 0 of each sheet is edge preparation; Next runs on into the following sheet.
// The screen is kept awake while the view is open, where the browser allows it.

// Each cut step plays once when shown: the saw line runs along the cut, then the
// pieces part (the same drawing and timing as Review's playback, at half its speed so
// it can be followed from the saw). "Replay" runs it again; reduced motion shows the
// result straight away.
const STROKE_MS = 1800, PART_MS = 500, RATE = 1;
export function installWorkshop({ getPlan, drawSheet, prepareText, animateFrame = () => {}, onClose = () => {} }) {
  const root = document.createElement('div');
  root.className = 'workshop'; root.hidden = true;
  root.dataset.localized = ''; // texts come from t(); the page translator must leave them alone
  root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-labelledby', 'workshop-title');
  root.innerHTML = `<header class="workshop-bar"><div><strong id="workshop-title"></strong><span id="workshop-machine" class="workshop-machine"></span></div><button type="button" class="workshop-close" data-workshop="close"></button></header>
<div class="workshop-progress" aria-hidden="true"><i id="workshop-progress"></i></div>
<main class="workshop-body"><div class="workshop-stage"><div class="workshop-drawing" id="workshop-drawing"></div><button type="button" class="workshop-replay" data-workshop="replay" hidden></button></div><section class="workshop-text" aria-live="polite"><p class="workshop-measure" id="workshop-measure"></p><p class="workshop-how" id="workshop-how"></p><p class="workshop-detail" id="workshop-detail"></p><p class="workshop-retain" id="workshop-retain"></p></section></main>
<footer class="workshop-nav"><button type="button" class="workshop-back" data-workshop="back"></button><button type="button" class="workshop-next" data-workshop="next"></button></footer>`;
  document.body.append(root);
  const $ = (id) => root.querySelector('#' + id);
  let sheet = 0, step = 0, lock = null, returnFocus = null, frame = null;
  const reduced = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  function stop() { if (frame !== null) cancelAnimationFrame(frame); frame = null; }
  // The playback state Review's drawing code expects, for one cut at `elapsed` ms.
  function playState(s, c, elapsed) {
    const progress = Math.min(1, elapsed / STROKE_MS), linear = Math.max(0, Math.min(1, (elapsed - STROKE_MS) / PART_MS));
    const done = elapsed >= STROKE_MS + PART_MS;
    return { active: true, playing: !done, finished: false, step: c.step, index: s.cuts.indexOf(c), total: s.cuts.length, progress, speed: RATE,
      completedThrough: c.step - 1, reducedMotion: false, separatePieces: true, splitReady: progress >= 1, separation: progress < 1 ? 0 : linear * linear * (3 - 2 * linear) };
  }
  function animate() {
    stop();
    const s = plan().sheets[sheet], c = step ? s.cuts[step - 1] : null, box = $('workshop-drawing'), replay = root.querySelector('[data-workshop="replay"]');
    replay.hidden = !c; replay.textContent = t('↻ Replay', '↻ 重播');
    if (!c) { box.innerHTML = drawSheet(s, 0); return; }
    if (reduced()) { box.innerHTML = drawSheet(s, c.step, playState(s, c, STROKE_MS + PART_MS)); return; }
    box.innerHTML = drawSheet(s, c.step, playState(s, c, 0));
    const svg = box.querySelector('svg'); let start = null;
    const tick = (now) => {
      start ??= now;
      const elapsed = (now - start) * RATE, state = playState(s, c, elapsed);
      animateFrame(svg, s, c, state);
      frame = state.playing ? requestAnimationFrame(tick) : null;
    };
    frame = requestAnimationFrame(tick);
  }

  const plan = () => getPlan();
  const steps = (i) => plan().sheets[i].cuts.length; // plus step 0, preparation
  const totalSteps = () => plan().sheets.reduce((n, s) => n + s.cuts.length + 1, 0);
  const position = () => plan().sheets.slice(0, sheet).reduce((n, s) => n + s.cuts.length + 1, 0) + step + 1;

  async function keepAwake() {
    try { if (!root.hidden && 'wakeLock' in navigator && !lock) { lock = await navigator.wakeLock.request('screen'); lock.addEventListener('release', () => { lock = null; }); } } catch { lock = null; }
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') keepAwake(); });

  function render() {
    const p = plan(), s = p.sheets[sheet], c = step ? s.cuts[step - 1] : null;
    $('workshop-title').textContent = c
      ? t(`S${s.number} · Step ${step} of ${s.cuts.length}`, `S${s.number} · 第 ${step} / ${s.cuts.length} 刀`)
      : t(`S${s.number} · Prepare the sheet`, `S${s.number} · 準備板材`);
    const head = c ? cutHeadline(c) : null, machine = c && s.saw === 'hybrid' ? c.saw : s.saw === 'table' ? 'table' : 'panel';
    root.dataset.machine = machine; root.dataset.hybrid = String(s.saw === 'hybrid');
    $('workshop-machine').textContent = machine === 'table' ? t('Table saw', '檯鋸') : t('Panel saw', '板鋸');
    $('workshop-measure').textContent = head ? head.measure ?? t('See each workpiece below', '各板件量度見下') : `${s.stock.length} × ${s.stock.width} mm`;
    $('workshop-how').textContent = head ? head.how : `${s.stock.material} · ${s.stock.thickness} mm`;
    $('workshop-detail').textContent = c ? `${cutDescription(c)} — ${cutDetail(c)}` : prepareText(s);
    $('workshop-retain').textContent = c ? cutRetain(c) : '';
    $('workshop-progress').style.width = `${(position() / totalSteps()) * 100}%`;
    const first = sheet === 0 && step === 0, last = sheet === p.sheets.length - 1 && step === s.cuts.length;
    root.querySelector('[data-workshop="back"]').textContent = t('← Back', '← 上一步');
    root.querySelector('[data-workshop="back"]').disabled = first;
    root.querySelector('[data-workshop="next"]').textContent = last ? t('Done ✓', '完成 ✓') : step === s.cuts.length ? t(`Next sheet · S${p.sheets[sheet + 1].number} →`, `下一張 · S${p.sheets[sheet + 1].number} →`) : t('Next →', '下一步 →');
    root.querySelector('[data-workshop="close"]').textContent = t('Close ✕', '關閉 ✕');
    root.querySelector('[data-workshop="close"]').setAttribute('aria-label', t('Close workshop view', '關閉工場模式'));
    animate();
  }
  function move(delta) {
    const p = plan();
    if (delta > 0) {
      if (step < steps(sheet)) step++;
      else if (sheet < p.sheets.length - 1) { sheet++; step = 0; }
      else return close();
    } else {
      if (step > 0) step--;
      else if (sheet > 0) { sheet--; step = steps(sheet); }
    }
    render();
  }
  function open(sheetIndex = 0, startStep = 0) {
    if (!plan()?.sheets.length) return;
    sheet = Math.min(sheetIndex, plan().sheets.length - 1); step = Math.min(startStep, steps(sheet));
    returnFocus = document.activeElement; root.hidden = false; document.body.classList.add('workshop-open');
    render(); keepAwake();
    try { root.requestFullscreen?.().catch(() => {}); } catch { /* full screen is optional */ }
    root.querySelector('[data-workshop="next"]').focus();
  }
  function close() {
    stop(); root.hidden = true; document.body.classList.remove('workshop-open');
    lock?.release().catch(() => {}); lock = null;
    try { if (document.fullscreenElement === root) document.exitFullscreen().catch(() => {}); } catch { /* ignore */ }
    onClose(sheet, Math.max(1, step)); returnFocus?.focus?.();
  }
  root.addEventListener('click', (event) => {
    const action = event.target.closest('[data-workshop]')?.dataset.workshop;
    if (action === 'next') move(1); else if (action === 'back') move(-1); else if (action === 'close') close(); else if (action === 'replay') animate();
  });
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    else if (['ArrowRight', 'PageDown'].includes(event.key) || (event.key === ' ' && !event.target.closest('button'))) { event.preventDefault(); move(1); }
    else if (['ArrowLeft', 'PageUp'].includes(event.key)) { event.preventDefault(); move(-1); }
    else if (event.key === 'Tab') { // keep focus inside the dialog
      const items = [...root.querySelectorAll('button:not(:disabled)')], i = items.indexOf(document.activeElement);
      if (event.shiftKey && i <= 0) { event.preventDefault(); items.at(-1).focus(); } else if (!event.shiftKey && i === items.length - 1) { event.preventDefault(); items[0].focus(); }
    }
  });
  return { open, close, refresh: () => { if (!root.hidden) render(); }, get isOpen() { return !root.hidden; } };
}
