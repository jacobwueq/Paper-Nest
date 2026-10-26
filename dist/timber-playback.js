import { t, onLanguageChange } from './locale.js?v=0.22.0';
const PLAYBACK_RATE = 2;

export class CutTimeline {
  constructor({ onStep = () => {}, onFrame = () => {}, onState = () => {}, requestFrame = (fn) => globalThis.requestAnimationFrame ? globalThis.requestAnimationFrame(fn) : setTimeout(() => fn(performance.now()), 16), cancelFrame = (id) => globalThis.cancelAnimationFrame ? globalThis.cancelAnimationFrame(id) : clearTimeout(id), reducedMotion = false, separatePieces = true } = {}) {
    Object.assign(this, { onStep, onFrame, onState, requestFrame, cancelFrame, reducedMotion, separatePieces });
    this.cuts = []; this.index = 0; this.active = false; this.playing = false; this.finished = false; this.elapsed = 0; this.progress = 0; this.frame = null; this.lastTime = null;
  }
  get state() {
    const splitReady = this.progress >= 1;
    const linear = Math.max(0, Math.min(1, (this.elapsed - 1800) / 500));
    const separation = this.finished ? 1 : !splitReady ? 0 : this.reducedMotion ? 1 : linear * linear * (3 - 2 * linear);
    return { active: this.active, playing: this.playing, finished: this.finished, step: this.cuts[this.index]?.step || 0, index: this.index, total: this.cuts.length, progress: this.progress, speed: PLAYBACK_RATE, completedThrough: this.finished ? this.cuts.at(-1)?.step || 0 : this.active ? this.cuts[this.index]?.step - 1 || 0 : 0, reducedMotion: this.reducedMotion, separatePieces: this.separatePieces, splitReady, separation };
  }
  emitStep() { this.onStep(this.cuts[this.index], this.state); this.onState(this.state); }
  cancel() { if (this.frame !== null) this.cancelFrame(this.frame); this.frame = null; this.lastTime = null; }
  setCuts(cuts, step = 1) {
    this.cancel(); this.cuts = [...cuts]; this.index = Math.max(0, this.cuts.findIndex((c) => c.step === step));
    this.active = false; this.playing = false; this.finished = false; this.elapsed = 0; this.progress = 0; this.emitStep();
  }
  play() {
    if (!this.cuts.length || this.playing) return;
    if (this.finished) { this.index = 0; this.elapsed = 0; this.progress = 0; this.finished = false; }
    this.active = true; this.playing = true; this.lastTime = null; this.emitStep(); this.queue();
  }
  pause() { this.playing = false; this.cancel(); this.onState(this.state); }
  seek(step) {
    const index = this.cuts.findIndex((c) => c.step === step); if (index < 0) return;
    this.pause(); this.index = index; this.elapsed = 0; this.progress = 0; this.finished = false; this.emitStep();
  }
  playFrom(step) { if (!this.cuts.some((cut) => cut.step === step)) return; this.seek(step); this.play(); }
  restart() { if (!this.cuts.length) return; this.pause(); this.active = true; this.index = 0; this.elapsed = 0; this.progress = 0; this.finished = false; this.emitStep(); }
  setSeparations(value) { this.separatePieces = Boolean(value); this.emitStep(); }
  queue() { this.frame = this.requestFrame((time) => this.tick(time)); }
  tick(time) {
    this.frame = null; if (!this.playing) return;
    const delta = this.lastTime === null ? 0 : Math.max(0, Math.min(100, time - this.lastTime)); this.lastTime = time;
    this.elapsed += delta * PLAYBACK_RATE; this.progress = Math.min(1, this.elapsed / 1800);
    this.onFrame(this.cuts[this.index], this.state);
    // Finish the stroke, pull the cut pieces apart, then briefly hold the result.
    if (this.elapsed >= 2500) {
      if (this.index === this.cuts.length - 1) { this.playing = false; this.finished = true; this.progress = 1; this.lastTime = null; this.emitStep(); return; }
      this.index++; this.elapsed = 0; this.progress = 0; this.emitStep();
    }
    this.queue();
  }
}

export function installCutPlayback({ root, describe, onStep, onFrame }) {
  root.innerHTML = `<div class="cut-play-controls" role="group" aria-label="Cutting sequence playback"><button id="cut-play-toggle" type="button" class="cut-play-primary" aria-pressed="false">▶ Play cuts · 播放</button><button id="cut-play-prev" type="button" aria-label="Previous cut" title="Previous cut">‹</button><button id="cut-play-next" type="button" aria-label="Next cut" title="Next cut">›</button><button id="cut-play-restart" type="button" title="Restart from the first cut">↶ Restart</button><label class="cut-play-separation"><input id="cut-play-separate" type="checkbox" checked>Separate pieces · 分開板件</label><span id="cut-play-status" role="status" aria-live="polite"></span></div><div class="cut-play-track" role="progressbar" aria-label="Cutting sequence progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span></span></div><p id="cut-play-instruction" class="cut-play-instruction" aria-live="polite"></p><p class="cut-play-note">Start after the edge preparation shown in the cutting guide. Pieces separate after each cut; gaps are exaggerated for clarity. Green = completed; red = current cut. · 先修邊，再跟次序切割。</p>`;
  const $ = (id) => root.querySelector('#' + id);
  const track = root.querySelector('.cut-play-track'), bar = track.querySelector('span');
  const progress = (s) => { const fraction = s.reducedMotion ? s.finished ? 1 : 0 : s.progress; const percent = s.total ? (s.index + fraction) / s.total * 100 : 0; bar.style.width = percent + '%'; track.setAttribute('aria-valuenow', String(Math.round(percent))); };
  const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false;
  const player = new CutTimeline({ reducedMotion,
    onStep(cut, state) { onStep(cut, state); progress(state); $('cut-play-instruction').textContent = cut ? describe(cut) : t('No numbered cuts needed after edge preparation.', '修邊後毋須再切割。'); },
    onFrame(cut, state) { progress(state); onFrame(cut, state); },
    onState(state) {
      $('cut-play-toggle').disabled = !state.total; $('cut-play-prev').disabled = !state.total || state.index === 0; $('cut-play-next').disabled = !state.total || state.index >= state.total - 1; $('cut-play-restart').disabled = !state.total;
      $('cut-play-toggle').textContent = state.playing ? t('❚❚ Pause','❚❚ 暫停') : state.finished ? t('↻ Replay','↻ 重播') : t('▶ Play cuts','▶ 播放切割');
      $('cut-play-toggle').setAttribute('aria-pressed', String(state.playing));
      $('cut-play-separate').checked = state.separatePieces;
      $('cut-play-status').textContent = !state.total ? t('No cuts','毋須切割') : state.finished ? t(`Complete · ${state.total} / ${state.total}`, `已完成 · ${state.total}／${state.total}`) : t(`${state.playing ? 'Playing' : state.active ? 'Paused' : 'Ready'} · Cut ${state.step} / ${state.total}`, `${state.playing ? '播放中' : state.active ? '已暫停' : '準備好'} · 第 ${state.step} 刀／共 ${state.total} 刀`);
    },
  });
  $('cut-play-toggle').onclick = () => player.playing ? player.pause() : player.play();
  $('cut-play-prev').onclick = () => player.seek(player.cuts[player.index - 1]?.step);
  $('cut-play-next').onclick = () => player.seek(player.cuts[player.index + 1]?.step);
  $('cut-play-restart').onclick = () => player.restart();
  $('cut-play-separate').onchange = () => player.setSeparations($('cut-play-separate').checked);
  document.addEventListener('visibilitychange', () => { if (document.hidden) player.pause(); });
  window.addEventListener('pagehide', () => player.pause());
  window.addEventListener('beforeprint', () => player.pause());
  onLanguageChange(() => player.emitStep());
  return { refreshLabels: () => player.emitStep(), setSheet: (sheet, step) => player.setCuts(sheet.cuts, step), selectStep: (step) => player.playFrom(step), clear: () => player.setCuts([]), pause: () => player.pause(), get state() { return player.state; } };
}
