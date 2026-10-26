import test from 'node:test';
import assert from 'node:assert/strict';
import { CutTimeline } from '../dist/timber-playback.js';
import { timberCutOverlay } from '../dist/timber-cut-overlay.js';

const cuts = [{step:1,axis:'x',x:0,y:0,w:1000,h:600,offset:400}, {step:2,axis:'y',x:0,y:0,w:400,h:600,offset:300}];
function clock(options = {}) {
  let time = 0, id = 0; const frames = new Map(), seen = [], traces = [];
  const player = new CutTimeline({ onStep(cut, state) { seen.push({step:cut?.step,...state}); }, onFrame(cut,state) { traces.push({...state}); }, requestFrame(fn) { frames.set(++id,fn);return id; }, cancelFrame(n) {frames.delete(n);}, ...options });
  const advance = (count = 1) => { for(let i=0;i<count;i++){time+=100;const ready=[...frames.values()];frames.clear();ready.forEach(fn=>fn(time));} };
  player.setCuts(cuts);
  return {player,advance,frames,seen,traces};
}
test('play traces each cut in order, marks completion and replays from the start', () => {
  const {player,advance,seen,frames}=clock();player.play();advance(5);
  assert.equal(player.state.step,1);assert.ok(player.state.progress>0 && player.state.progress<1);
  advance(10);assert.equal(player.state.step,2);assert.equal(player.state.completedThrough,1);
  advance(15);assert.equal(player.state.finished,true);assert.equal(player.state.completedThrough,2);assert.equal(frames.size,0);
  assert.deepEqual(seen.filter(s=>s.playing).map(s=>s.step),[1,2]);
  player.play();assert.equal(player.state.step,1);assert.equal(player.state.progress,0);player.pause();
});
test('fixed 2x playback preserves the stroke position when paused and resumed', () => {
  const {player,advance,frames}=clock();player.play();advance(5);const p=player.state.progress;
  assert.equal(player.state.speed,2);assert.equal(p,800/1800);
  player.pause();advance(20);assert.equal(player.state.progress,p);assert.equal(frames.size,0);
  player.play();advance(3);assert.ok(player.state.progress>p);player.pause();
});
test('clicking a cut starts it immediately and replaces any previous animation', () => {
  const {player,advance,frames}=clock();player.setCuts(Array.from({length:5},(_,i)=>({...cuts[0],step:i+1})));
  player.playFrom(4);assert.equal(player.state.step,4);assert.equal(player.state.playing,true);assert.equal(player.state.progress,0);assert.equal(player.state.completedThrough,3);
  advance(4);assert.ok(player.state.progress>0);player.playFrom(2);
  assert.equal(player.state.step,2);assert.equal(player.state.progress,0);assert.equal(frames.size,1,'only one animation loop may be active');
  player.pause();
});
test('seeking pauses playback, and changing or clearing a sheet cancels old frames', () => {
  const {player,advance,frames}=clock();player.play();advance(5);player.seek(2);
  assert.equal(player.state.playing,false);assert.equal(player.state.step,2);assert.equal(player.state.progress,0);
  player.play();player.setCuts([{...cuts[0],step:1}]);assert.equal(frames.size,0);assert.equal(player.state.active,false);assert.equal(player.state.step,1);
  player.play();player.setCuts([]);advance(30);assert.equal(player.state.total,0);assert.equal(player.state.playing,false);
  player.play();assert.equal(frames.size,0);
});
test('playback overlay retains all numbers, traces the current workpiece and prints without motion', () => {
  const sheet={stock:{length:1000,width:600},cuts};
  const animated=timberCutOverlay(sheet,2,{active:true,completedThrough:1,progress:.5,finished:false,reducedMotion:false});
  assert.match(animated.markup,/data-cut-number="1"/);assert.match(animated.markup,/data-cut-number="2"/);
  assert.match(animated.markup,/data-cut-line="1"[^>]*stroke="#4f805e"/);
  assert.match(animated.markup,/data-cut-trace="2"[^>]*x1="0" y1="300" x2="200" y2="300"/);
  assert.match(animated.markup,/data-cut-head="2"/);
  const reduced=timberCutOverlay(sheet,2,{active:true,completedThrough:1,progress:.5,reducedMotion:true});assert.doesNotMatch(reduced.markup,/data-cut-head/);
  const printed=timberCutOverlay(sheet);assert.doesNotMatch(printed.markup,/data-cut-head|data-cut-trace/);assert.match(printed.markup,/data-cut-number="2"/);
});
