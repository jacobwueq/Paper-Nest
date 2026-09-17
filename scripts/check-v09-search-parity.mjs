import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
// Run in separate processes: the worker-compatible collector uses a global.
function run(root, enabled) {
  const code = `
 import {compactLayout} from './${root}/compaction.js';
 const parts=[30,20].map((w,i)=>({id:String(i),outer:[{x:0,y:0},{x:w,y:0},{x:w,y:10},{x:0,y:10}]}));
 const placements=parts.map((p,i)=>({id:p.id,x:2,y:2+i*30,angle:0,sheet:0,scale:1}));
 const result=compactLayout(parts,placements,{width:100,height:100,margin:2,gap:2,scale:1,rotations:4,commonEdgeMode:${enabled},minOffcutSide:20},{passes:1,now:()=>0,profile:true});
 console.log(JSON.stringify({placements:result.placements,report:result.report,candidates:result.profile.counts.generatedCandidates}));`;
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", code],
    { encoding: "utf8" },
  );
  if (result.status !== 0) throw Error(result.stderr);
  return JSON.parse(result.stdout);
}
for (const enabled of [false, true]) {
  assert.deepEqual(
    run("dist", enabled),
    run("work/perf-v09-baseline/dist", enabled),
  );
  console.log(
    `v0.9 search parity: common-edge ${enabled}, placements, report and generated candidates identical`,
  );
}
