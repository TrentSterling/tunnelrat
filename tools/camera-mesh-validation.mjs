// CPU-only verification against generated render triangles, no WebGL/browser.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import * as T from 'three';
import {CONFIG} from '../src/config.js';
import {ChaseCamera,CHASE_OFFSET} from '../src/chase-camera.js';
globalThis.document={createElement:()=>({getContext:()=>({fillRect(){}})})};
const {buildLevel}=await import('../src/procgen/levelbuilder.js');
const results=[],ray=new T.Raycaster(),q=new T.Quaternion(),direction=new T.Vector3(),point=new T.Vector3();
const sampleOffsets=[new T.Vector3(),...[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]].map(v=>new T.Vector3(...v).multiplyScalar(.24))];
for(const seed of [1,1337]){
 const start=performance.now(),level=buildLevel(seed,CONFIG,1),buildMs=performance.now()-start;
 level.caveGroup.updateMatrixWorld(true);
 const roots=[level.caveGroup.getObjectByName('decorGroup'),level.caveGroup.getObjectByName('propsGroup')];
 const solver=new ChaseCamera(level.field,roots),rocks=level.caveGroup.children.filter(o=>o.isMesh);
 let poses=0,probes=0;const failures=[];
 for(const r of level.field.decor.rooms)for(const delta of [zero(),new T.Vector3(r.radius*.7,0,0),new T.Vector3(0,r.radius*.7,0),new T.Vector3(0,0,r.radius*.7)]){
  const origin=r.pos.clone().add(delta);if(level.field.sample(...origin)>-1.4)continue;
  for(const yaw of [0,Math.PI/2,Math.PI,Math.PI*1.5])for(const pitch of [0,Math.PI/2,-Math.PI/2]){
   q.setFromEuler(new T.Euler(pitch,yaw,yaw/2));const offset=CHASE_OFFSET.clone();solver.constrain(origin,q,offset,.25);poses++;
   direction.copy(offset).applyQuaternion(q);const distance=direction.length();if(distance<1e-5)continue;direction.normalize();ray.far=distance;
   for(const local of sampleOffsets){
    point.copy(origin).add(local);ray.set(point,direction);const hit=ray.intersectObjects(rocks,false)[0];probes++;
    if(hit)failures.push({seed,room:r.id,yaw,pitch,distance,hit:hit.distance,mesh:hit.object.name});
   }
  }
 }
 results.push({seed,buildMs,poses,probes,failures});level.caveGroup.traverse(o=>o.geometry?.dispose());
}
function zero(){return new T.Vector3();}
fs.mkdirSync('tools/out',{recursive:true});fs.writeFileSync('tools/out/camera-mesh-validation.json',JSON.stringify({results},null,2));console.log(JSON.stringify({results},null,2));assert(results.every(r=>!r.failures.length),'rendered rock clearance');
