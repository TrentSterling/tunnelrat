import * as THREE from 'three';
import {makeRng} from '../src/util/rng.js';
// Geometry-only Node check: the shared grunge texture is irrelevant to vertex measurements.
globalThis.document={createElement:()=>({width:0,height:0,getContext:()=>({fillRect(){}})})};
const {buildRobot}=await import('../src/robots.js');
const {group}=buildRobot('ship',makeRng(1337^0x5451));group.updateMatrixWorld(true);
let triangles=0,draws=0,maxRadius=0,outside=0;const p=new THREE.Vector3(),box=new THREE.Box3();
group.traverse(o=>{if(!o.isMesh)return;draws++;const g=o.geometry;triangles+=(g.index?.count||g.attributes.position.count)/3;for(let i=0;i<g.attributes.position.count;i++){p.fromBufferAttribute(g.attributes.position,i).applyMatrix4(o.matrixWorld);box.expandByPoint(p);maxRadius=Math.max(maxRadius,p.length());if(p.length()>1.4)outside++;}});
console.log(JSON.stringify({triangles,draws,maxRadius,outsideCollisionSphereVertices:outside,bounds:box.getSize(new THREE.Vector3()).toArray()},null,2));
