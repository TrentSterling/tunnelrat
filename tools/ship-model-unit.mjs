import assert from 'node:assert/strict';
import * as THREE from 'three';
import {CONFIG} from '../src/config.js';
import {SHIP_MODEL,buildPlayerShip} from '../src/ship-model.js';
import {makeRng} from '../src/util/rng.js';
import {Ship} from '../src/ship.js';
globalThis.document={createElement:()=>({width:0,height:0,getContext:()=>({fillRect(){}})})};
const {buildRobot,scorch}=await import('../src/robots.js');
const a=buildPlayerShip(),b=buildRobot('ship',makeRng(7));
let checks=0;const check=(value,message)=>{assert(value,message);checks++;};
const vertices=[];let triangles=0,draws=0;const p=new THREE.Vector3();a.group.updateMatrixWorld(true);
check(SHIP_MODEL.radius===CONFIG.ship.radius,'model constraint matches current collider');
a.group.traverse(o=>{
 if(!o.isMesh)return;draws++;const g=o.geometry;triangles+=(g.index?.count||g.attributes.position.count)/3;
 check(g.attributes.position.count===g.attributes.normal.count,'complete normals');
 for(let i=0;i<g.attributes.position.count;i++){
  p.fromBufferAttribute(g.attributes.position,i).applyMatrix4(o.matrixWorld);
  check(p.toArray().every(Number.isFinite),'finite vertex');check(p.length()<=SHIP_MODEL.maxVertexRadius,'visible hull inside budget');vertices.push(p.clone());
  const n=new THREE.Vector3().fromBufferAttribute(g.attributes.normal,i);check(Math.abs(n.length()-1)<1e-5,'unit normal');
 }
});
check(draws<=SHIP_MODEL.maxDraws,'draw budget');check(triangles<=SHIP_MODEL.maxTriangles,'triangle budget');
check(a.refs.pilotEye.getWorldPosition(new THREE.Vector3()).length()===0,'unchanged pilot-eye anchor');
check(a.group.getObjectByName('painted-hull').geometry.attributes.position.array.every((v,i)=>v===b.group.getObjectByName('painted-hull').geometry.attributes.position.array[i]),'stable player silhouette across wreck seeds');
// Rotate the real airframe through banks, inverted attitudes and sloped contact
// planes. Translate the sphere to contact, then test every visible vertex.
let worstClearance=Infinity;
for(const normal of [new THREE.Vector3(1,0,0),new THREE.Vector3(0,1,0),new THREE.Vector3(1,2,-1).normalize()]){
 for(const pitch of [0,.5,Math.PI/2])for(const roll of [0,.4,Math.PI/2,Math.PI]){
  const q=new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch,.8,roll));
  for(const v of vertices){const clearance=CONFIG.ship.radius-v.clone().applyQuaternion(q).dot(normal);worstClearance=Math.min(worstClearance,clearance);check(clearance>=0,'transformed vertex clear of tangent wall');}
 }
}
// Actual collision integration followed by the transformed airframe check.
const wall={sample:x=>x,collisionNormal:(x,y,z,out)=>out.set(-1,0,0)};
for(const hz of [30,60,144]){const ship=new Ship(CONFIG,wall);ship.reset(new THREE.Vector3(-10,0,0),new THREE.Quaternion());for(let i=0;i<hz;i++)ship.update(1/hz,{axis:{x:1,y:0,z:0,roll:1},mouseDX:0,mouseDY:0,boost:true});for(const v of vertices)check(v.clone().applyQuaternion(ship.object3d.quaternion).add(ship.object3d.position).x<0,'moving rotated hull clear of wall');}
const original=a.group.getObjectByName('painted-hull').material;scorch(b.group);
check(a.group.getObjectByName('painted-hull').material===original,'wreck does not scorch live ship');
check(b.group.getObjectByName('painted-hull').material!==original,'wreck material independent');
check(b.group.getObjectByName('painted-hull').material.emissiveIntensity!==1.8,'solid hull does not become one glowing ember');
console.log(JSON.stringify({pass:true,checks,triangles,draws,maxRadius:Math.max(...vertices.map(v=>v.length())),worstTangentPlaneClearance:worstClearance},null,2));
