import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import * as T from 'three';
import {CONFIG} from '../src/config.js';
import {generateLevelGraph} from '../src/procgen/graph.js';
import {createDensityField as after} from '../src/procgen/density.js';
import {frameGeometries} from '../src/architecture-model.js';
import {Ship} from '../src/ship.js';
import {GameState} from '../src/gamestate.js';
const baseline=execFileSync('git',['show','dc6fcec4785f121bb88761b3dac368b2b11754d2:src/procgen/density.js'],{encoding:'utf8'})
 .replaceAll("'../util/rng.js'",JSON.stringify(new URL('../src/util/rng.js',import.meta.url).href))
 .replaceAll("'../util/noise.js'",JSON.stringify(new URL('../src/util/noise.js',import.meta.url).href));
const {createDensityField:before}=await import('data:text/javascript;base64,'+Buffer.from(baseline).toString('base64'));
globalThis.document={createElement:()=>({getContext:()=>({fillRect(){}})})};
const bad=[],nearOverlaps=[];let points=0,entries=0,smallestPass=Infinity;
const p=new T.Vector3(),q=new T.Vector3(),ab=new T.Vector3(),ap=new T.Vector3();
for(let seed=1;seed<=200;seed++){
  const graph=generateLevelGraph(seed,CONFIG),base=before(graph,seed,CONFIG),field=after(graph,seed,CONFIG);
  entries+=field.architecture.filter(s=>s.kind==='entry').length;
  for(const edge of field.decor.edges)for(let k=1;k<edge.polyline.length;k++){
    const a=edge.polyline[k-1],b=edge.polyline[k];const n=Math.ceil(a.distanceTo(b)/.5);
    for(let i=0;i<=n;i++){
      p.lerpVectors(a,b,i/n);const prev=-base.sample(p.x,p.y,p.z),next=-field.sample(p.x,p.y,p.z);points++;
      if(prev>=1.4){smallestPass=Math.min(smallestPass,next);if(next<1.399)bad.push({seed,edge:[edge.a,edge.b],position:p.toArray(),prev,next});}
    }
  }
  // Analytic segment distance, rather than only the layout's vertex distances.
  for(const s of field.architecture.filter(s=>s.kind==='entry'))for(const e of field.decor.edges){
    if(e.a===s.edge.a&&e.b===s.edge.b)continue;
    let distance=Infinity;
    for(let k=1;k<e.polyline.length;k++){
      const a=e.polyline[k-1],b=e.polyline[k];ab.subVectors(b,a);ap.subVectors(s.position,a);
      q.copy(a).addScaledVector(ab,Math.max(0,Math.min(1,ap.dot(ab)/ab.lengthSq())));distance=Math.min(distance,q.distanceTo(s.position));
    }
    if(distance<s.recessRadius+e.radius+2)nearOverlaps.push({seed,entry:s.position.toArray(),edge:[e.a,e.b],distance,required:s.recessRadius+e.radius+2});
  }
}
const geos=frameGeometries(5.2,true),shell=geos['load-bearing-shell'].attributes.position,fast=geos['liner-and-fasteners'].attributes.position;
const zFloat=new Float32Array([1.1])[0];let frontCoplanarFastenerTriangles=0;
// The liner occupies 96 triangles; remaining cylinder geometry contains cap triangles.
for(let i=96*3;i<fast.count;i+=3)if([0,1,2].every(j=>fast.getZ(i+j)===zFloat))frontCoplanarFastenerTriangles++;
const reproductions=[],crossings=[];
const idle={axis:{x:0,y:0,z:0,roll:0},mouseDX:0,mouseDY:0,boost:false};
for(const [seed,position] of [[83,[-37.180085120296994,-30.70476708897917,-79.84495526020059]],
 [91,[1.795125105231197,-89.62808721144066,-3.9236055944850894]],
 [107,[82.39034667837038,-73.26458073223455,24.963659437802715]],
 [165,[80.98582610884098,-99.9765862602641,-4.631610787903356]]]){
 const graph=generateLevelGraph(seed,CONFIG),field=after(graph,seed,CONFIG),base=before(graph,seed,CONFIG);
 const game=new GameState(new T.Scene(),CONFIG);game.startLevel(graph,field,1);
 const spec=field.architecture.find(s=>s.kind==='gate');assert(spec,'regression seed retains a modeled frame');
 assert(game.doorPos.equals(spec.position)&&game.doorNormal.equals(spec.normal),'visual, collision and blocking plane share relocated pose');
 const moves=[];
 for(const opened of [false,true]){
  if(opened){game.doorLocked=false;game.doorAssembly.userData.setOpenFraction(1);}
  const ship=new Ship(CONFIG,field);ship.reset(new T.Vector3(...position),new T.Quaternion());ship.update(1/60,idle);
  const displacement=ship.object3d.position.distanceTo(new T.Vector3(...position));assert(displacement<1e-10,'stationary ship is not pushed by architecture');moves.push({opened,displacement});
 }
 const midpoint=graph.nodes.find(n=>n.id===graph.lockedEdge.a).pos.clone().add(graph.nodes.find(n=>n.id===graph.lockedEdge.b).pos).multiplyScalar(.5);
 const affected={83:[2,4],91:[4,12],107:[0,7],165:[3,12]}[seed];
 const route=field.decor.edges.find(e=>e.a===affected[0]&&e.b===affected[1]||e.b===affected[0]&&e.a===affected[1]);
 const center=new T.Vector3(...position);let nearest=Infinity,tangent;
 for(let i=1;i<route.polyline.length;i++){
  const line=new T.Line3(route.polyline[i-1],route.polyline[i]),point=line.closestPointToPoint(center,true,new T.Vector3()),distance=point.distanceTo(center);
  if(distance<nearest){nearest=distance;tangent=line.delta(new T.Vector3()).normalize();}
 }
 for(const sign of [-1,1])for(const roll of [0,Math.PI/2,Math.PI]){
  const direction=tangent.clone().multiplyScalar(sign),ship=new Ship(CONFIG,field);
  ship.reset(center.clone().addScaledVector(direction,-2),new T.Quaternion().setFromUnitVectors(new T.Vector3(0,0,-1),direction));
  ship.object3d.rotateZ(roll);ship.velocity.copy(direction).multiplyScalar(8);let t=0,clearance=Infinity;
  while(t<1&&ship.object3d.position.clone().sub(center).dot(direction)<2){
   ship.update(1/144,{...idle,axis:{...idle.axis,z:1}});t+=1/144;clearance=Math.min(clearance,-field.sample(...ship.object3d.position.toArray()));
  }
  assert(ship.object3d.position.clone().sub(center).dot(direction)>=2,'actual ship crosses neighboring route');
  assert(ship.shields===100&&clearance>CONFIG.ship.radius-.001,'neighboring traversal has no snag or impact');
  crossings.push({seed,sign,roll,clearance,time:t});
 }
 reproductions.push({seed,originalClearance:-base.sample(...position),currentClearance:-field.sample(...position),gateShift:spec.position.distanceTo(midpoint),moves});game.clearProps();
 // The exceptional no-safe-seat path cannot reintroduce an unchecked model.
 game.startLevel(graph,{...field,architecture:[]},1);assert.equal(game.doorAssembly,null);
 game.doorLocked=false;game.doorFadeTimer=1;game.update(1,new Ship(CONFIG,field));game.clearProps();
}
const output={seeds:200,entries,points,bad,smallestPass,nearOverlaps,frontCoplanarFastenerTriangles,frontZFloat:zFloat,reproductions,crossings};
fs.writeFileSync(new URL('./out/architecture-path-corrected.json',import.meta.url),JSON.stringify(output,null,2));
assert.equal(bad.length,0,'all previously traversable centerline samples retain sphere clearance');
assert.equal(nearOverlaps.length,0,'static entry rejection uses whole segments');
assert.equal(frontCoplanarFastenerTriangles,0,'no fastener caps on the flange plane');
console.log(JSON.stringify(output,null,2));
