import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as T from 'three';
import {ChaseCamera, CHASE_OFFSET} from '../src/chase-camera.js';

const air={sample:()=>-100}, origin=new T.Vector3(), identity=new T.Quaternion(), zero=new T.Vector3();
let assertions=0;const check=(value,message)=>{assert(value,message);assertions++;};
function plate(z=3){const m=new T.Mesh(new T.BoxGeometry(8,8,.02));m.position.z=z;return m;}
function near(a,b,message,tolerance=1e-9){check(a.distanceTo(b)<tolerance,message);}
const thin=plate(),solver=new ChaseCamera(air,[thin]);
for(const sign of [-1,1]){
 const start=new T.Vector3(0,0,sign<0?6:0),offset=new T.Vector3(0,0,sign*6);
 solver.constrain(start,identity,offset,.25);
 check(offset.length()>2.73&&offset.length()<2.741,'thin surfaces block from either side');
}
// A center ray misses this box, but the camera volume grazes its edge.
const edge=new T.Mesh(new T.BoxGeometry(1,1,.02));edge.position.set(.7,0,3);
const edgeSolver=new ChaseCamera(air,[edge]),edgeOffset=new T.Vector3(0,0,6);
edgeSolver.constrain(origin,identity,edgeOffset,.25);
check(edgeOffset.length()<3&&edgeOffset.length()>2.7,'near-plane edge is protected');
// Empty space inside a rib must remain usable; an inflated object AABB alone
// would incorrectly turn this ring into a solid cap.
const ring=new T.Mesh(new T.TorusGeometry(4,.4,4,12));ring.position.z=3;
const ringSolver=new ChaseCamera(air,[ring]),ringOffset=new T.Vector3(0,0,6);
ringSolver.constrain(origin,identity,ringOffset,.25);near(ringOffset,new T.Vector3(0,0,6),'ring aperture stays open');
// Thin rock slab between two valid endpoints, a case the old endpoint ladder misses.
const rock={sample:(x,y,z)=>.01-Math.abs(z-3)},rockSolver=new ChaseCamera(rock);
const rockOffset=new T.Vector3(0,0,6);rockSolver.constrain(origin,identity,rockOffset,.25);
check(rockOffset.z<2.2,'intervening rock is checked, not only the endpoint');

// Exact free-space exponential response at multiple rates, including full
// inversion and release; constraining a clear path must not alter the camera.
const schedules=[30,60,144,1000],trajectories=[];
for(const hz of schedules){
 const free=new ChaseCamera(air),actual=new T.Vector3(),expected=new T.Vector3();
 const q=new T.Quaternion().setFromAxisAngle(new T.Vector3(0,0,1),Math.PI);
 const velocity=new T.Vector3(2,-1,3),localVelocity=velocity.clone().applyQuaternion(q.clone().invert()).negate().setLength(.6);
 for(let i=0;i<hz*2;i++){
  const v=i<hz?velocity:zero,target=CHASE_OFFSET.clone().add(i<hz?localVelocity:zero);
  expected.lerp(target,1-Math.exp(-8/hz));free.update(actual,1/hz,origin,q,v);
  near(actual,expected,`clear chase preserves smoothing at ${hz}Hz`);
 }
 trajectories.push({hz,position:actual.toArray()});
}
for(const hz of [30,60,144]){
 const actual=CHASE_OFFSET.clone(),camera=new ChaseCamera(air,[thin]);
 for(let i=0;i<hz*3;i++){
  const dt=i%3===0?.7/hz:i%3===1?1.3/hz:1/hz;
  // Reversal/roll, extreme velocity lean and a previously distant camera.
  const q=new T.Quaternion().setFromEuler(new T.Euler(.2*Math.sin(i/hz),0,Math.PI*2*i/hz));
  camera.update(actual,dt,origin,q,new T.Vector3(i<hz?40:-40,20,0),.6);
  const world=actual.clone().applyQuaternion(q);
  check(world.z<2.391,'final smoothed/leaned volume retracts before thin wall');
 }
}
// Pause is not permission to leave a stale offset through geometry.
const paused=CHASE_OFFSET.clone();solver.update(paused,0,origin,identity,zero);check(paused.z<2.741,'stale paused offset constrained');
// New level instances rebuild obstacle poses; no dependency on disposed old geometry.
const reset=new ChaseCamera(air);const offset=CHASE_OFFSET.clone();reset.update(offset,1/60,origin,identity,zero);near(offset,CHASE_OFFSET,'retry rebuild clears old obstacles');
const inside=new T.Vector3(0,0,.5);solver.constrain(new T.Vector3(0,0,2.9),identity,inside,.25);check(inside.length()===0,'overlapping near-camera falls back to ship');
const report={pass:true,assertions,schedules,trajectories,checks:['thin front/back','near-plane edge','open rib','intervening rock','free follow/inversion/release','roll/reversal/jitter/lean','pause','retry','overlap fallback']};
fs.mkdirSync('tools/out',{recursive:true});fs.writeFileSync('tools/out/camera-regression.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
