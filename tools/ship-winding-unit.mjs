// Regression for the reviewed ad27de2 engine housings: downward rays used to
// pass through their roofs and hit the underside because every face was inward.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {buildPlayerShip} from '../src/ship-model.js';
globalThis.document={createElement:()=>({width:0,height:0,getContext:()=>({fillRect(){}})})};
const {group}=buildPlayerShip();group.updateMatrixWorld(true);
group.traverse(o=>{if(o.isMesh)assert.equal(o.material.side,THREE.FrontSide,`${o.name} must retain FrontSide culling`);});
const hull=group.getObjectByName('painted-hull'),positions=hull.geometry.attributes.position,normals=hull.geometry.attributes.normal;
// Recover connected shells from actual baked triangles, not hard-coded batch
// offsets or the construction function. Quantization welds coincident cap rims.
const parent=Array.from({length:positions.count/3},(_,i)=>i),seen=new Map();
const root=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
const vertex=i=>new THREE.Vector3().fromBufferAttribute(positions,i);
for(let i=0;i<positions.count;i++){
  const key=vertex(i).toArray().map(v=>Math.round(v*1e6)).join(',');
  const triangle=Math.floor(i/3);
  if(seen.has(key))parent[root(triangle)]=root(seen.get(key));else seen.set(key,triangle);
}
const components=new Map();
for(let i=0;i<parent.length;i++){const r=root(i);if(!components.has(r))components.set(r,[]);components.get(r).push(i);}
const shells=[...components.values()].map(indices=>{
  const bounds=new THREE.Box3();for(const i of indices)for(let k=0;k<3;k++)bounds.expandByPoint(vertex(i*3+k));
  return {indices,bounds};
});
const results=[];
for(const side of [-1,1]){
  const center=new THREE.Vector3(side*.53,-.035,-.72);
  const shell=shells.find(s=>Math.abs(s.bounds.getCenter(new THREE.Vector3()).x-center.x)<1e-5
    &&Math.abs(s.bounds.min.z+.98)<1e-5&&Math.abs(s.bounds.max.z+.40)<1e-5);
  assert(shell,`connected ${side} engine housing found`);
  assert.equal(shell.indices.length,48,'complete closed engine shell');
  let outward=0,volume=0;const data=[];
  for(const t of shell.indices){
    const a=vertex(t*3),b=vertex(t*3+1),c=vertex(t*3+2);
    const face=new THREE.Vector3().crossVectors(b.clone().sub(a),c.clone().sub(a)).normalize();
    for(let k=0;k<3;k++)assert(new THREE.Vector3().fromBufferAttribute(normals,t*3+k).dot(face)>1-1e-6,'stored lighting normals agree with exterior winding');
    const middle=a.clone().add(b).add(c).multiplyScalar(1/3);
    if(face.dot(middle.clone().sub(center))>0)outward++;
    volume+=a.clone().sub(center).dot(new THREE.Vector3().crossVectors(b.clone().sub(center),c.clone().sub(center)))/6;
    for(const p of [a,b,c])data.push(...p.toArray());
  }
  assert.equal(outward,48,`all ${side} engine faces point outward`);
  assert(volume>0,'closed housing has positive signed volume');
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(data,3));g.computeVertexNormals();
  const isolated=new THREE.Mesh(g,hull.material);isolated.updateMatrixWorld(true);
  const rays=[];
  // All six views use real FrontSide ray intersection; each first hit must be
  // an entering surface, before the ray reaches the housing center.
  for(const axis of [new THREE.Vector3(1,0,0),new THREE.Vector3(0,1,0),new THREE.Vector3(0,0,1)])for(const sign of [-1,1]){
    const dir=axis.clone().multiplyScalar(-sign),origin=center.clone().addScaledVector(axis,sign*2);
    const hit=new THREE.Raycaster(origin,dir).intersectObject(isolated)[0];
    assert(hit&&hit.distance<2,'FrontSide ray hits exterior before entering shell');
    assert(hit.face.normal.dot(dir)<0,'hit surface normal opposes incoming ray');
    rays.push({axis:axis.toArray(),sign,distance:hit.distance});
  }
  const roof=new THREE.Raycaster(new THREE.Vector3(side*.53,.8,-.8),new THREE.Vector3(0,-1,0)).intersectObject(hull)[0];
  const belly=new THREE.Raycaster(new THREE.Vector3(side*.53,-.8,-.8),new THREE.Vector3(0,1,0)).intersectObject(hull)[0];
  assert(roof&&Math.abs(roof.point.y-.23115384615384618)<1e-6,'reviewer roof repro hits +0.231154 m');
  assert(belly&&Math.abs(belly.point.y+.30115384615384618)<1e-6,'underside remains outward at -0.301154 m');
  results.push({side,outwardTriangles:outward,signedVolume:volume,roofY:roof.point.y,bellyY:belly.point.y,rays});
  g.dispose();
}
console.log(JSON.stringify({pass:true,frontSide:true,engines:results},null,2));
