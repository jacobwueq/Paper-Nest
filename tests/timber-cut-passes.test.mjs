import test from 'node:test';
import assert from 'node:assert/strict';
import { manualTimber, planTimber } from '../dist/timber-planner.js';
import { cutSegments } from '../dist/timber-cut-passes.js';
import { cutDetail } from '../dist/timber-text.js';
import { cutTracePoint, timberCutOverlay } from '../dist/timber-cut-overlay.js';
import { timberSeparationLayout } from '../dist/timber-separation.js';
import { sharedHeightProject, sharedHeightCommands } from './fixtures/timber-shared-height.mjs';
const close = (a,b) => assert.ok(Math.abs(a-b)<1e-5, `${a} differs from ${b}`);
function verifyPasses(sheet) {
  const active = new Map([[sheet.root.id,sheet.root]]);
  let removed = 0;
  for (const operation of sheet.cuts) {
    const members = operation.segments, targets = new Set(members.map(c=>c.workpiece));
    const axis = operation.axis, across = axis==='x'?'y':'x', dimension = axis==='x'?'w':'h', extent = axis==='x'?'h':'w';
    const position = members[0][axis]+members[0].offset;
    const start = Math.min(...members.map(c=>c[across])), end = Math.max(...members.map(c=>c[across]+c[extent]));
    const kerf = Math.max(...members.map(c=>c.kerf));
    for (const node of active.values()) {
      if (node.kind!=='cut'||targets.has(node.id)) continue;
      const crossed = position < node[axis]+node[dimension]-1e-7 && position+kerf > node[axis]+1e-7 && start < node[across]+node[extent]-1e-7 && end > node[across]+1e-7;
      assert.equal(crossed,false,'a shared pass may not cross an uncut workpiece outside its target list');
    }
    for (const c of members) {
      assert.equal(c.axis,axis);close(c[axis]+c.offset,position);assert.ok(!c.prerequisite||c.prerequisite<operation.step);
      const node=active.get(c.workpiece);assert.ok(node,'all members are available before the shared pass');
      assert.equal(node.kind,'cut');close(node.amount,c.offset);
    }
    for(const c of members){const node=active.get(c.workpiece);active.delete(c.workpiece);active.set(node.first.id,node.first);if(node.second)active.set(node.second.id,node.second);removed+=c.kerf*c[extent];}
    close([...active.values()].reduce((n,r)=>n+r.w*r.h,0)+removed,sheet.root.w*sheet.root.h);
  }
  assert.equal([...active.values()].filter(n=>n.kind==='part').length,sheet.parts.length);
}
test('the screenshot uses right-strip removal then one 450 mm cut before column separation, in eight passes',()=>{
  const sheet=manualTimber(sharedHeightProject(),sharedHeightCommands()).sheets[0];
  assert.equal(sheet.cuts.length,8);assert.equal(sheet.parts.length,8);
  assert.equal(sheet.cuts[0].axis,'x');close(sheet.cuts[0].offset,2298.4);assert.equal(sheet.cuts[0].h,1220);
  assert.equal(sheet.cuts[1].axis,'y');assert.equal(sheet.cuts[1].offset,450);close(sheet.cuts[1].w,2298.4);
  for(const id of ['P2.1','P2.3','P2.4'])assert.ok(sheet.cuts[1].edgeParts.includes(id));
  assert.equal(cutSegments(sheet).filter(c=>c.axis==='y'&&Math.abs(c.y+c.offset-450)<1e-5).length,1,'the upper row is cut once across all three panels');
  assert.ok(sheet.cuts.some(c=>c.segments.length>1));verifyPasses(sheet);
});
test('every shared pass opens all its member workpieces together without losing material',()=>{
  const sheet=manualTimber(sharedHeightProject(),sharedHeightCommands()).sheets[0];
  for(const operation of sheet.cuts){
    const layout=timberSeparationLayout(sheet,{active:true,finished:false,step:operation.step,completedThrough:operation.step-1,splitReady:true,separation:1});
    for(const c of operation.segments){assert.equal(layout.pieces.get(c.workpiece).visible,false);assert.equal(layout.pieces.get(c.first).visible,true);if(c.second)assert.equal(layout.pieces.get(c.second).visible,true);}
    const actual=[...layout.pieces.values()].filter(p=>p.visible).reduce((n,p)=>n+p.node.w*p.node.h,0);
    const removed=cutSegments(sheet).filter(c=>c.step<=operation.step).reduce((n,c)=>n+c.kerf*(c.axis==='x'?c.h:c.w),0);close(actual+removed,sheet.root.w*sheet.root.h);
  }
});
test('an intervening workpiece is finished before outer pieces share a straight pass',()=>{
  const p=sharedHeightProject();p.stocks[0].length=96;p.stocks[0].width=100;p.settings.kerf=3;
  p.parts=[[30,40],[30,60],[30,40]].map(([length,width])=>({...p.parts[1],length,width,qty:1}));
  const sheet=manualTimber(p,[0,33,66].map((x,i)=>({partId:`P${i+1}.1`,board:0,x,y:0,rotated:false,direction:'cross'}))).sheets[0];
  verifyPasses(sheet);
  const shared=sheet.cuts.find(c=>c.segments.length>1);assert.ok(shared);
  const middle=sheet.cuts.find(c=>c.axis==='y'&&Math.abs(c.y+c.offset-60)<1e-5);assert.ok(middle.step<shared.step);
  assert.match(cutDetail(shared,'en'),/Set aside finished parts and offcuts/);assert.match(cutDetail(shared,'zh-Hant'),/先移開/);
});
test('one number labels a shared pass while every segment is drawn and traced sequentially',()=>{
  const sheet=manualTimber(sharedHeightProject(),sharedHeightCommands()).sheets[0],op=sheet.cuts.find(c=>c.segments.length>1);
  const overlay=timberCutOverlay(sheet,op.step,{active:true,progress:.3,completedThrough:op.step-1});
  assert.equal([...overlay.markup.matchAll(/data-cut-number=/g)].length,sheet.cuts.length);
  assert.equal([...overlay.markup.matchAll(/data-cut-line=/g)].length,sheet.cutSegments.length);
  assert.equal([...overlay.markup.matchAll(/data-cut-trace=/g)].length,op.segments.length);
  for(const progress of [.1,.3,.6,.9])assert.ok(op.segments.filter(c=>cutTracePoint(op,c,progress).head).length<=1,'one saw head advances across the shared pass');
});
test('an exact four-part grid takes two registered straight passes',()=>{
  const p=sharedHeightProject();p.stocks[0].length=83;p.stocks[0].width=83;p.settings.kerf=3;p.parts=[{...p.parts[1],length:40,width:40,qty:4}];
  const result=planTimber(p);assert.equal(result.fitness.cutCount,2);assert.equal(result.sheets[0].cutSegments.length,3);verifyPasses(result.sheets[0]);
});
