import test from 'node:test';
import assert from 'node:assert/strict';
import { identifyParts, parseDXF } from '../dist/importers.js';
import { transform, entityPoints, area, clearance } from '../dist/geometry.js';
import { evaluateLayout, searchSeed } from '../dist/search.js';
import { exportSVG, exportDXF } from '../dist/exporters.js';
import { rectanglePoints, checkedOffcuts } from '../dist/offcut-export.js';
const rect=(x,y,w,h)=>[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}];
const entities=[{kind:'poly',closed:true,layer:'CUT',vertices:rect(0,0,80,80)},
 {kind:'circle',closed:true,layer:'CUT',cx:15,cy:20,r:3},
 {kind:'arc',closed:false,layer:'SCORE',cx:40,cy:40,r:10,start:0.2,sweep:1.3}];
const settings={width:200,height:200,margin:5,gap:2,allowMirror:true,scale:1};
const parts=identifyParts(entities);
const placements=[{id:parts[0].id,x:5,y:5,angle:0,sheet:0}];
const report=evaluateLayout(parts,placements,settings).sheets[0];

test('two reusable offcuts are disjoint and each meets the minimum short edge',()=>{
 assert.equal(report.rectangles.length,2);
 for(const r of report.rectangles) assert.ok(Math.min(r.w,r.h)>=20);
 const [a,b]=report.rectangles.map(rectanglePoints);
 assert.ok(clearance(a,b,settings.gap));
 assert.equal(checkedOffcuts(parts,placements,0,settings,{offcuts:report.rectangles}).length,2);
 const tiny=evaluateLayout([{id:'a',outer:rect(0,0,170,170)}],[{id:'a',x:5,y:5,angle:0,sheet:0}],settings).sheets[0];
 assert.equal(tiny.rectangles.length,0);
});
test('offcut exports are opt-in and contain only the selected recovery rectangle',()=>{
 for(const exporter of [exportDXF,exportSVG]) {
  assert.ok(!exporter(parts,placements,0,settings).includes('OFFCUT_CUT'));
  const out=exporter(parts,placements,0,settings,{offcuts:[report.rectangles[1]]});
  assert.ok(out.includes('OFFCUT_CUT'));
  if(exporter===exportDXF) {
   const lines=out.split('\n');
   let count=0;
   for(let i=0;i<lines.length-1;i+=2) if(lines[i]==='8'&&lines[i+1]==='OFFCUT_CUT')count++;
   assert.equal(count,1);
   const back=parseDXF(out).parts;
   assert.equal(back.length,2); // one original part and one independent recovery frame
  } else {
   assert.equal((out.match(/id="offcut-/g)||[]).length,1);
   assert.match(out,/width="200mm" height="200mm"/);
  }
 }
});
test('offcut cuts crossing parts, duplicated frames and sub-threshold scraps are rejected',()=>{
 assert.throws(()=>checkedOffcuts(parts,placements,0,settings,{offcuts:[{x:5,y:5,w:100,h:100}]}),/overlap/);
 assert.throws(()=>checkedOffcuts(parts,placements,0,settings,{offcuts:[report.rectangles[0],report.rectangles[0]]}),/overlap/);
 assert.throws(()=>checkedOffcuts(parts,placements,0,settings,{offcuts:[{x:100,y:100,w:19,h:20}]}),/dimensions/);
});
test('a pre-existing OFFCUT_CUT layer is preserved and the recovery layer gets a unique name',()=>{
 const ps=identifyParts(entities.map(e=>({...e,layer:'OFFCUT_CUT'})));
 const out=exportDXF(ps,[{...placements[0],id:ps[0].id}],0,settings,{offcuts:[report.rectangles[0]]});
 assert.ok(out.includes('\nOFFCUT_CUT_2\n'));
});
test('scale and reflection preserve attached circle and arc geometry through DXF export',()=>{
 const t={id:parts[0].id,x:160,y:10,angle:23,scale:1.5,mirrored:true,sheet:0};
 const out=exportDXF(parts,[t],0,{...settings,width:300,height:300});
 const back=parseDXF(out).parts[0];
 const arc=back.entities.find(e=>e.kind==='arc');
 const sourceArc=parts[0].entities.find(e=>e.kind==='arc');
 assert.ok(Math.abs(arc.r-15)<1e-9);
 assert.ok(Math.abs(Math.abs(arc.sweep)-1.3)<1e-6);
 assert.equal(back.entities.find(e=>e.kind==='circle').r,4.5);
 const endpoints=e=>[entityPoints(e)[0],entityPoints(e).at(-1)];
 const expected=endpoints(sourceArc).map(p=>transform({x:p.x-parts[0].origin.x,y:p.y-parts[0].origin.y},t));
 const actual=endpoints(arc).map(p=>({x:p.x,y:p.y+300}));
 for(const p of expected) assert.ok(actual.some(q=>Math.hypot(p.x-q.x,p.y-q.y)<1e-5));
 const svg=exportSVG(parts,[t],0,{...settings,width:300,height:300});
 assert.match(svg,/rotate\(23\) scale\(-1.5 1.5\)/);
});
test('mirroring reverses polyline bulges while scaling retains curvature magnitude',()=>{
 const polygon={kind:'poly',closed:true,layer:'CUT',vertices:rect(0,0,100,80)};
 polygon.vertices[0].bulge=-0.414213562373095;
 const ps=identifyParts([polygon]);
 const out=exportDXF(ps,[{id:ps[0].id,x:200,y:5,angle:0,scale:2,mirrored:true,sheet:0}],0,{...settings,width:500,height:500});
 const back=parseDXF(out).parts[0].entities[0];
 assert.ok(Math.abs(back.vertices[0].bulge+polygon.vertices[0].bulge)<1e-6);
 assert.ok(Math.abs(Math.hypot(back.vertices[1].x-back.vertices[0].x,back.vertices[1].y-back.vertices[0].y)-200)<1e-6);
});
test('continued optimisation retains each part’s handedness',()=>{
 assert.deepEqual(searchSeed([{id:'a',angle:23,mirrored:true}]),[{id:'a',angle:383}]);
});
