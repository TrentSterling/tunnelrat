import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import * as THREE from 'three';
import { Ship as Candidate } from '../src/ship.js';
const baselineSource=execFileSync('git',['show','0a5b66fbc1c8e6c5a900b03d06f29c1b17f6fd61:src/ship.js'],{encoding:'utf8'});
const {Ship:Baseline}=await import('data:text/javascript;base64,'+Buffer.from(baselineSource).toString('base64'));
import { CONFIG } from '../src/config.js';
import { generateLevelGraph } from '../src/procgen/graph.js';
import { createDensityField } from '../src/procgen/density.js';
const rates=[30,60,144,'jitter',59.94,237], jitter=[1/20,1/144,1/90,1/240,1/30,1/75,1/60];
const dist=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
const unaligned=process.argv.includes('--unaligned'),transitions=unaligned?[1.137,3.193,6.011]:[2,4,6];
const seeds=[...Array.from({length:40},(_,i)=>i+1),1337,1338,1339], results=[];
for(const seed of seeds){
  const graph=generateLevelGraph(seed,CONFIG),field=createDensityField(graph,seed,CONFIG);
  const spawn=graph.nodes.find(n=>n.id===graph.spawnId).pos;
  const result={seed};
  for(const [version,Ship] of [['baseline',Baseline],['candidate',Candidate]]){
    const states=[];
    for(const rate of rates){
      const ship=new Ship(CONFIG,field); ship.reset(spawn,new THREE.Quaternion());
      let t=0,index=0,minClearance=Infinity,hits=0; ship.onImpact=()=>hits++;
      while(t<transitions[2]-1e-10){
        const boundary=t<transitions[0]-1e-9?transitions[0]:t<transitions[1]-1e-9?transitions[1]:transitions[2];
        const dt=Math.min(rate==='jitter'?jitter[index++%jitter.length]:1/rate,boundary-t);
        const side=t<transitions[0]-1e-9?1:t<transitions[1]-1e-9?-1:0;
        ship.update(dt,{axis:{x:side,y:.5*side,z:side,roll:side},mouseDX:side?12*dt:0,mouseDY:side?5*dt:0,boost:false});t+=dt;
        minClearance=Math.min(minClearance,-field.sample(...ship.object3d.position.toArray()));
      }
      states.push({rate,position:ship.object3d.position.toArray(),quaternion:ship.object3d.quaternion.toArray(),velocity:ship.velocity.toArray(),shields:ship.shields,alive:ship.alive,minClearance,hits});
    }
    result[version]={spread:Math.max(...states.flatMap(a=>states.map(b=>dist(a.position,b.position)))),healthSpread:Math.max(...states.map(s=>s.shields))-Math.min(...states.map(s=>s.shields)),states};
  }
  results.push(result);
}
const summary={seeds:seeds.length,candidateWorse:results.filter(r=>r.candidate.spread>r.baseline.spread+.001).map(r=>({seed:r.seed,baseline:r.baseline.spread,candidate:r.candidate.spread})),worstCandidate:[...results].sort((a,b)=>b.candidate.spread-a.candidate.spread).slice(0,5).map(r=>({seed:r.seed,baseline:r.baseline.spread,candidate:r.candidate.spread,healthSpread:r.candidate.healthSpread})),newDeaths:results.filter(r=>r.candidate.states.some((s,i)=>!s.alive&&r.baseline.states[i].alive)),candidateMinimumClearance:Math.min(...results.flatMap(r=>r.candidate.states.map(s=>s.minClearance))),baselineMinimumClearance:Math.min(...results.flatMap(r=>r.baseline.states.map(s=>s.minClearance))),maxHealthSpreadBefore:Math.max(...results.map(r=>r.baseline.healthSpread)),maxHealthSpreadAfter:Math.max(...results.map(r=>r.candidate.healthSpread))};
const maxVelocitySpread=Math.max(...results.flatMap(r=>r.candidate.states.flatMap(a=>r.candidate.states.map(b=>dist(a.velocity,b.velocity)))));
const maxAngle=Math.max(...results.flatMap(r=>r.candidate.states.flatMap(a=>r.candidate.states.map(b=>new THREE.Quaternion(...a.quaternion).angleTo(new THREE.Quaternion(...b.quaternion))))));
Object.assign(summary,{transitions,maxVelocitySpread,maxAngle});
fs.writeFileSync(new URL(`./out/contact-${unaligned?'unaligned':'corrected'}.json`,import.meta.url),JSON.stringify({summary,results},null,2));
assert.equal(summary.candidateWorse.length,0,'every procedural seed is non-regressing');
assert.equal(summary.newDeaths.length,0,'no new deaths');
assert(summary.worstCandidate[0].candidate<1e-6,'contact endpoints within one micrometre across six schedules');
assert(summary.maxHealthSpreadAfter<1e-6,'impact damage independent of render frame grouping');
assert(maxVelocitySpread<1e-6&&maxAngle<1e-6,'contact velocity and orientation agree');
assert(summary.candidateMinimumClearance>CONFIG.ship.radius-.001,'projected sphere clearance within 1 mm');
console.log(JSON.stringify(summary,null,2));

