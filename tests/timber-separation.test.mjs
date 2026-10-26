import { cutSegments } from '../dist/timber-cut-passes.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { planTimber, manualTimber } from '../dist/timber-planner.js';
import { timberSeparationLayout } from '../dist/timber-separation.js';
import { CutTimeline } from '../dist/timber-playback.js';
const project = {settings:{kerf:3.2,trim:5,direction:'auto',rotate:true},stocks:[{label:'Sheet',material:'Plywood',thickness:18,length:2440,width:1220,qty:2}],parts:[{label:'Side',material:'Plywood',thickness:18,length:720,width:450,qty:2,grain:true,priority:1},{label:'Shelf',material:'Plywood',thickness:18,length:760,width:420,qty:3,grain:false,priority:1}]};
const state = (step, extra = {}) => ({active:true,finished:false,step,completedThrough:step-1,splitReady:false,separation:0,...extra});
function validateFrontier(sheet, layout, completedThrough) {
  const visible=[...layout.pieces.values()].filter(p=>p.visible);
  const expected=sheet.root.w*sheet.root.h-cutSegments(sheet).filter(c=>c.step<=completedThrough).reduce((n,c)=>n+c.kerf*(c.axis==='x'?c.h:c.w),0);
  const area=visible.reduce((n,p)=>n+p.node.w*p.node.h,0);assert.ok(Math.abs(area-expected)<1e-4,'separation preserves all uncut material except actual kerf');
  for(let i=0;i<visible.length;i++){
    const a=visible[i];assert.ok(a.x>=sheet.root.x-1e-6 && a.y>=sheet.root.y-1e-6);
    assert.ok(a.x+a.node.w<=sheet.root.x+layout.width+1e-6 && a.y+a.node.h<=sheet.root.y+layout.height+1e-6);
    for(let j=i+1;j<visible.length;j++){const b=visible[j];assert.ok(a.x+a.node.w<=b.x+1e-6 || b.x+b.node.w<=a.x+1e-6 || a.y+a.node.h<=b.y+1e-6 || b.y+b.node.h<=a.y+1e-6,'separated siblings never overlap');}
  }
  return visible;
}
test('pieces stay joined until the stroke finishes, then separate without overlap',()=>{
  const sheet=planTimber(project).sheets[0], snapshot=JSON.stringify(sheet);
  for(const c of sheet.cuts){
    validateFrontier(sheet,timberSeparationLayout(sheet,state(c.step)),c.step-1);
    for(const fraction of [0,.5,1]){
      const layout=timberSeparationLayout(sheet,state(c.step,{splitReady:true,separation:fraction}));validateFrontier(sheet,layout,c.step);
      for(const member of c.segments || [c]) if(member.second){const c=member;const first=layout.pieces.get(c.first),second=layout.pieces.get(c.second);const actual=c.axis==='x'?second.x-first.x-first.w:second.y-first.y-first.h;assert.ok(Math.abs(actual-c.kerf-layout.gap*fraction)<1e-5);}
    }
  }
  const final=timberSeparationLayout(sheet,state(sheet.cuts.length,{finished:true,completedThrough:sheet.cuts.length,splitReady:true,separation:1}));
  assert.equal(validateFrontier(sheet,final,sheet.cuts.length).length,sheet.parts.length+sheet.offcuts.length);
  assert.equal(JSON.stringify(sheet),snapshot,'simulation cannot mutate the manufacturing plan');
  const reset=timberSeparationLayout(sheet,state(1));assert.equal([...reset.pieces.values()].filter(p=>p.visible).length,1);
});
test('later cuts inherit the offset of their separated parent workpiece',()=>{
  const p={...project,settings:{...project.settings,direction:'cross'},parts:[{...project.parts[0],length:800,width:400,qty:1},{...project.parts[0],length:800,width:350,qty:1}]};
  const first={partId:'P1.1',board:0,x:5,y:5,rotated:false};
  const sheet=manualTimber(p,[first,{partId:'P2.1',board:0,x:808.2,y:5,rotated:false}]).sheets[0];
  const rightCut=sheet.cuts.find(c=>c.x>800);assert.ok(rightCut);
  const layout=timberSeparationLayout(sheet,state(rightCut.step));
  assert.ok(layout.cutOffsets.get(rightCut.workpiece).x>=layout.gap-1e-6);
  validateFrontier(sheet,layout,rightCut.step-1);
});
test('timeline exposes a separate pulling phase, and reduced motion snaps that phase',()=>{
  const player=new CutTimeline();player.setCuts([{step:1}]);player.active=true;player.progress=.99;player.elapsed=1799;
  assert.equal(player.state.splitReady,false);assert.equal(player.state.separation,0);
  player.progress=1;player.elapsed=2050;assert.equal(player.state.splitReady,true);assert.ok(player.state.separation>0 && player.state.separation<1);
  player.reducedMotion=true;assert.equal(player.state.separation,1);
  player.setSeparations(false);assert.equal(player.state.separatePieces,false);
});
