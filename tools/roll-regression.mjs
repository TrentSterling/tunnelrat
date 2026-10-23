// Black-box trajectories and lifecycle checks for the 6DOF integration fix.
// The fixture was recorded from approved model commit 0a5b66f, before physics edits.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import * as THREE from 'three';
import {CONFIG} from '../src/config.js';
import {buildPlayerShip} from '../src/ship-model.js';
import {generateLevelGraph} from '../src/procgen/graph.js';
import {createDensityField} from '../src/procgen/density.js';
const arg=name=>{const i=process.argv.indexOf(name);return i<0?null:process.argv[i+1];};
const {Ship}=await import(arg('--ship-module')?pathToFileURL(path.resolve(arg('--ship-module'))):new URL('../src/ship.js',import.meta.url));
const zero=()=>({axis:{x:0,y:0,z:0,roll:0},mouseDX:0,mouseDY:0,boost:false});
const plans={
  translation:{x:1,y:.5,z:1,roll:0},
  strafe:{x:1,y:0,z:0,roll:0},
  roll:{x:0,y:0,z:0,roll:1},
  translationRoll:{x:1,y:.5,z:1,roll:1},
  combined:{x:1,y:.5,z:1,roll:1,look:true},
  boost:{x:1,y:.5,z:1,roll:1,look:true,boost:true},
};
const rates=[30,60,144,'jitter'];
const jitter=[1/20,1/144,1/90,1/240,1/30,1/75,1/60];
const pose=ship=>({position:ship.object3d.position.toArray(),velocity:ship.velocity.toArray(),quaternion:ship.object3d.quaternion.toArray(),rollVel:ship.rollVel,shields:ship.shields,energy:ship.energy,alive:ship.alive});
const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
const angle=(a,b)=>2*Math.acos(Math.min(1,Math.abs(a.reduce((sum,v,i)=>sum+v*b[i],0))));
function control(plan,t,dt){
  const side=t<2-1e-9?1:t<4-1e-9?-1:0,input=zero();
  for(const axis of ['x','y','z','roll'])input.axis[axis]=side*plan[axis];
  input.mouseDX=plan.look&&side?12*dt:0;input.mouseDY=plan.look&&side?5*dt:0;
  input.boost=!!plan.boost&&side!==0;return input;
}
function replay(plan,hz){
  const ship=new Ship(CONFIG,null),samples=[];let t=0,index=0;
  for(let mark=.5;mark<=6;mark+=.5){
    while(t<mark-1e-10){const dt=Math.min(hz==='jitter'?jitter[index++%jitter.length]:1/hz,mark-t);ship.update(dt,control(plan,t,dt));t+=dt;}
    const state=pose(ship);assert(state.position.every(Number.isFinite));assert(Math.abs(Math.hypot(...state.quaternion)-1)<1e-10);
    samples.push({time:mark,...state});
  }
  return samples;
}
const trajectories=Object.fromEntries(Object.entries(plans).map(([name,plan])=>[name,Object.fromEntries(rates.map(hz=>[hz,replay(plan,hz)]))]));
if(arg('--record')){
  const record={sourceRevision:'0a5b66fbc1c8e6c5a900b03d06f29c1b17f6fd61',shipConfig:CONFIG.ship,plans,
    sixtyHz:Object.fromEntries(Object.keys(plans).map(name=>[name,trajectories[name][60]])),
    reversal30vs144:Object.fromEntries(Object.keys(plans).map(name=>[name,distance(trajectories[name][30][7].position,trajectories[name][144][7].position)]))};
  fs.writeFileSync(arg('--record'),JSON.stringify(record,null,2)+'\n');
  console.log('Recorded approved pre-fix trajectories.');process.exit(0);
}
const baseline=JSON.parse(fs.readFileSync(new URL('fixtures/roll-before.json',import.meta.url)));
assert.deepEqual(plans,baseline.plans);assert.deepEqual(CONFIG.ship,baseline.shipConfig,'flight tuning unchanged');
const summary={};
for(const name of Object.keys(plans)){
  let maxPosition=0,maxAngle=0,maxVelocity=0,maxRollVelocity=0,legacy60Position=0,legacy60Angle=0;
  for(let i=0;i<12;i++){
    const reference=trajectories[name][60][i],old=baseline.sixtyHz[name][i];
    legacy60Position=Math.max(legacy60Position,distance(reference.position,old.position));legacy60Angle=Math.max(legacy60Angle,angle(reference.quaternion,old.quaternion));
    for(const a of rates)for(const b of rates){
      const one=trajectories[name][a][i],two=trajectories[name][b][i];
      maxPosition=Math.max(maxPosition,distance(one.position,two.position));maxAngle=Math.max(maxAngle,angle(one.quaternion,two.quaternion));
      maxVelocity=Math.max(maxVelocity,distance(one.velocity,two.velocity));maxRollVelocity=Math.max(maxRollVelocity,Math.abs(one.rollVel-two.rollVel));
    }
  }
  summary[name]={maxPosition,maxAngle,maxVelocity,maxRollVelocity,legacy60Position,legacy60Angle,
    reversalBefore30vs144:baseline.reversal30vs144[name],
    reversalAfter30vs144:distance(trajectories[name][30][7].position,trajectories[name][144][7].position)};
}
for(const [name,result] of Object.entries(summary)){
  assert(result.maxPosition<.12,`${name}: trajectories within 12 cm across frame rates`);
  assert(result.maxAngle<.001,`${name}: orientation within .001 rad across frame rates`);
  assert(result.maxVelocity<.12,`${name}: velocity within .12 m/s across frame rates`);
  assert(result.maxRollVelocity<1e-9,`${name}: identical elapsed-time roll response`);
  assert(result.legacy60Position<(name==='boost'?1.5:.8),`${name}: original 60 Hz trajectory retained within stated bound`);
  assert(result.legacy60Angle<.001,`${name}: original 60 Hz orientation retained`);
}
assert(summary.strafe.legacy60Position<1e-8,'uncapped straight flight retains exact 60 Hz path');
assert(summary.roll.legacy60Angle<.00005,'roll/release retains the 60 Hz angular response');

// JSON snapshots include the unfinished simulation tick as well as public state.
const first=new Ship(CONFIG,null);first.update(.137,control(plans.combined,0,.137));
const saved=JSON.parse(JSON.stringify(first.captureFlightState())),restored=new Ship(CONFIG,null);
restored.restoreFlightState(saved);
for(const dt of jitter){first.update(dt,control(plans.combined,0,dt));restored.update(dt,control(plans.combined,0,dt));}
assert.deepEqual(pose(first),pose(restored),'snapshot continuation');
assert.deepEqual(first.captureFlightState(),restored.captureFlightState(),'pending tick also resumes exactly');
// Save while a partial-tick preview touches a wall: restoring must neither lose
// nor double-count that contact when the next complete tick is committed.
const plane={sample:x=>x,collisionNormal:(x,y,z,out)=>out.set(-1,0,0)};
const contacting=new Ship(CONFIG,plane);contacting.reset(new THREE.Vector3(-1.45,0,0),new THREE.Quaternion());contacting.velocity.set(25,0,0);
contacting.update(.003,zero());const contactCopy=new Ship(CONFIG,plane);
contactCopy.restoreFlightState(JSON.parse(JSON.stringify(contacting.captureFlightState())));
for(const dt of jitter){contacting.update(dt,zero());contactCopy.update(dt,zero());assert.deepEqual(contacting.captureFlightState(),contactCopy.captureFlightState(),'contact snapshot continuation');}
// Public writers are part of the existing game contract. A preview must never
// restore over knockback, a door push, teleport, field swap or external roll.
for(const edit of [s=>s.velocity.add(new THREE.Vector3(3,2,-1)),s=>s.object3d.position.add(new THREE.Vector3(30,20,10)),
 s=>s.object3d.rotateX(.7),s=>s.rollVel=.4,s=>s.noclip=true,s=>s.field={sample:()=>-999,collisionNormal:(x,y,z,o)=>o.set(1,0,0)}]){
 const changed=new Ship(CONFIG,null);changed.update(.013,control(plans.combined,0,.013));edit(changed);
 const fresh=new Ship(CONFIG,changed.field);fresh.restoreFlightState({...changed.captureFlightState(),integration:null});
 changed.update(.019,zero());fresh.update(.019,zero());assert.deepEqual(pose(changed),pose(fresh),'public mutation rebases pending tick');
}
const frozen=pose(first);for(let i=0;i<30;i++)first.update(0,{...control(plans.combined,0,0),mouseDX:20,mouseDY:10});
assert.deepEqual(pose(first),frozen,'zero-time pause consumes no motion or mouse input');
first.takeDamage(9999);const dead=pose(first);first.update(.05,control(plans.combined,0,.05));assert.deepEqual(pose(first),dead,'dead flight remains frozen');
first.noclip=true;const inverted=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),Math.PI);
first.reset(new THREE.Vector3(4,5,6),inverted);assert(first.noclip);assert.equal(first.rollVel,0);assert.equal(first.velocity.length(),0);assert(first.alive&&first.shields===100&&first.energy===100);
const settled=pose(first);for(let i=0;i<144;i++)first.update(1/144,zero());assert.deepEqual(pose(first),settled,'free inversion is stable without a world-up correction');
// No render-rate quantization: both cameras inherit a fresh pose every update.
const moving=new Ship(CONFIG,null),rig=new THREE.Group(),camera=new THREE.PerspectiveCamera();moving.object3d.add(rig);rig.add(camera);
let previous=moving.object3d.quaternion.clone();
for(let i=0;i<144;i++){
  moving.update(1/144,control(plans.roll,0,1/144));moving.object3d.updateMatrixWorld(true);
  assert(previous.angleTo(moving.object3d.quaternion)>0,'144 Hz roll advances every frame');
  assert(camera.getWorldQuaternion(new THREE.Quaternion()).angleTo(moving.object3d.quaternion)<1e-7,'camera inherits ship roll');
  previous.copy(moving.object3d.quaternion);
}
// Mouse is a frame delta, not a rate. Substeps must not repeat or drop it.
for(const hz of rates.filter(Number.isFinite)){
  const ship=new Ship(CONFIG,null),input=zero();input.mouseDX=100;ship.update(1/hz,input);
  assert(ship.object3d.quaternion.angleTo(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),-.22))<1e-7,'mouse pixels applied once');
}

// Exercise the configured angular cap and the zero-damping limit as well as
// the normal response; neither may introduce NaNs or exceed the velocity caps.
for(const damping of [0,4.5,60])for(const hz of rates){
  const config={...CONFIG,ship:{...CONFIG.ship,rollDamping:damping,damping:damping===0?0:CONFIG.ship.damping,rollAccel:30}};
  const ship=new Ship(config,null);let t=0,index=0;
  while(t<3-1e-10){const dt=Math.min(hz==='jitter'?jitter[index++%jitter.length]:1/hz,3-t);ship.update(dt,control(plans.boost,t,dt));t+=dt;
    assert(Math.abs(ship.rollVel)<=config.ship.rollSpeed+1e-12);assert(ship.velocity.length()<=config.ship.maxSpeed*config.ship.boostMult+1e-12);assert(Number.isFinite(ship.object3d.position.length()));
  }
}

globalThis.document={createElement:()=>({width:0,height:0,getContext:()=>({fillRect(){}})})};
const vertices=[];buildPlayerShip().group.traverse(o=>{if(o.isMesh){const p=o.geometry.attributes.position;for(let i=0;i<p.count;i++)vertices.push(new THREE.Vector3().fromBufferAttribute(p,i));}});
let minMeshClearance=Infinity;const contacts=[];
for(const slope of [0,.4,-.65])for(const hz of rates){
  const gradient=new THREE.Vector3(1,slope,.2).normalize();
  const field={sample:(x,y,z)=>gradient.dot(new THREE.Vector3(x,y,z)),collisionNormal:(x,y,z,out)=>out.copy(gradient).negate()};
  const ship=new Ship(CONFIG,field);ship.reset(gradient.clone().multiplyScalar(-8),inverted);ship.velocity.copy(gradient).multiplyScalar(45);
  let t=0,index=0,hits=0;
  ship.onImpact=()=>hits++;
  while(t<1-1e-10){const dt=Math.min(hz==='jitter'?jitter[index++%jitter.length]:1/hz,1-t),oldHits=hits;ship.update(dt,{...zero(),axis:{x:0,y:0,z:0,roll:1},boost:true});t+=dt;
    assert(hits-oldHits<=1,'at most one impact callback per update');assert(field.sample(...ship.object3d.position.toArray())<=-CONFIG.ship.radius+1e-8,'sphere remains outside slope');
    for(const vertex of vertices){const world=vertex.clone().applyQuaternion(ship.object3d.quaternion).add(ship.object3d.position);const clearance=-field.sample(...world.toArray());minMeshClearance=Math.min(minMeshClearance,clearance);assert(clearance>=0,'actual rolled ship vertices clear the wall');}
  }
  assert.equal(hits,1,'single approach has one impact');assert(ship.alive&&ship.shields<100);contacts.push({slope,hz,shields:ship.shields,...pose(ship)});
}
for(const slope of [0,.4,-.65]){const health=contacts.filter(c=>c.slope===slope).map(c=>c.shields);assert(Math.max(...health)-Math.min(...health)<.25,'impact damage consistent across frame rates');}
const procedural=[];
for(const seed of [1337,1338,1339]){
  const graph=generateLevelGraph(seed,CONFIG),field=createDensityField(graph,seed,CONFIG),spawn=graph.nodes.find(n=>n.id===graph.spawnId).pos,states=[];
  for(const hz of rates){
    const ship=new Ship(CONFIG,field);ship.reset(spawn,new THREE.Quaternion());let t=0,index=0,minClearance=Infinity;
    while(t<6-1e-10){const boundary=t<2-1e-9?2:t<4-1e-9?4:6,dt=Math.min(hz==='jitter'?jitter[index++%jitter.length]:1/hz,boundary-t);ship.update(dt,control(plans.combined,t,dt));t+=dt;
      const clearance=-field.sample(...ship.object3d.position.toArray());minClearance=Math.min(minClearance,clearance);assert(clearance>CONFIG.ship.radius-.001,'procedural SDF sphere clearance');
    }
    states.push({hz,minClearance,...pose(ship)});
  }
  const spread=Math.max(...states.flatMap(a=>states.map(b=>distance(a.position,b.position))));procedural.push({seed,spread,states});
}
// Long wall-sliding paths through this approximate SDF are still sensitive to
// collision sampling. Keep their measured residual visible, and require an
// improvement over the recorded original rather than claiming lockstep physics.
const originalProcedural=JSON.parse(fs.readFileSync(new URL('fixtures/roll-procedural-before.json',import.meta.url)));
for(const result of procedural){
  result.previousSpread=originalProcedural.find(r=>r.seed===result.seed).spread;
  assert(result.spread<result.previousSpread,'procedural wall-contact trajectory improves on baseline');
}
console.log(JSON.stringify({pass:true,trajectories:summary,lifecycle:['snapshot continuation','pause','death','retry reset','inversion','camera inheritance','mouse delta'],minMeshClearance,contacts,procedural},null,2));
