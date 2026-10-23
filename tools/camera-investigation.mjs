// CPU-only reproduction using generated levels and actual decorative triangles.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import * as T from 'three';
import {CONFIG, getBiome} from '../src/config.js';
import {generateLevelGraph} from '../src/procgen/graph.js';
import {createDensityField} from '../src/procgen/density.js';
import {buildDecor} from '../src/procgen/decor.js';
import {buildProps} from '../src/procgen/props.js';
import {ChaseCamera} from '../src/chase-camera.js';
globalThis.document={createElement:()=>({getContext:()=>({fillRect(){}})})};
const BOOM=new T.Vector3(0,1.9,6.2),p=new T.Vector3(),q=new T.Quaternion();
const cam=new T.Vector3(),dir=new T.Vector3(),s=new T.Vector3();
const ray=new T.Raycaster();const cases=[];let poses=0,rockBlocked=0,decorBlocked=0,afterRock=0,afterDecor=0,afterSphereOverlap=0,originOverlapFallbacks=0;const times=[];
const triangle=new T.Triangle(),closest=new T.Vector3();
function surfaceDistance(point,obstacles){
 let distance=Infinity;
 for(const {geo,matrix,box} of obstacles){
  if(box.distanceToPoint(point)>.26)continue;
  const a=geo.attributes.position,index=geo.index,n=index?index.count:a.count;
  for(let i=0;i<n;i+=3){
   triangle.a.fromBufferAttribute(a,index?index.getX(i):i).applyMatrix4(matrix);
   triangle.b.fromBufferAttribute(a,index?index.getX(i+1):i+1).applyMatrix4(matrix);
   triangle.c.fromBufferAttribute(a,index?index.getX(i+2):i+2).applyMatrix4(matrix);
   triangle.closestPointToPoint(point,closest);distance=Math.min(distance,point.distanceTo(closest));
  }
 }
 return distance;
}
const full=process.argv.includes('--full'),seeds=full?[...Array.from({length:43},(_,i)=>i+1),83,91,107,165,1337]:[1,2,3,4,5,16,18,83,91,107,165,1337];
const depths=full?[1,2,3]:[1];
for(const depth of depths)for(const seed of seeds){
 const biome=getBiome(depth),graph=generateLevelGraph(seed,CONFIG),field=createDensityField(graph,seed,CONFIG,biome);
 const decor=new T.Group();decor.add(buildDecor(field,graph,CONFIG),buildProps(field,graph,CONFIG,biome,seed));decor.updateMatrixWorld(true);
 const chase=new ChaseCamera(field,[decor]);
 const points=field.decor.rooms.flatMap(r=>[r.pos.clone(),r.pos.clone().add(new T.Vector3(r.radius*.7,0,0)),r.pos.clone().add(new T.Vector3(0,r.radius*.7,0)),r.pos.clone().add(new T.Vector3(0,0,r.radius*.7))]);
 for(let k=0;k<points.length;k++){
  p.copy(points[k]);if(field.sample(...p)<-1.4)for(const angle of [0,Math.PI/2,Math.PI,Math.PI*1.5])for(const pitch of [0,Math.PI/2,-Math.PI/2]){
   q.setFromEuler(new T.Euler(pitch,angle,angle/2));
   let t=1;for(const tt of [1,.75,.5,.32]){t=tt;cam.copy(BOOM).multiplyScalar(tt).applyQuaternion(q).add(p);if(field.sample(...cam)<-.8)break;}
   dir.subVectors(cam,p);const length=dir.length();dir.normalize();let worst=-Infinity,firstRock=null;
   for(let d=0;d<=length;d+=.05){s.copy(p).addScaledVector(dir,d);const sd=field.sample(...s);worst=Math.max(worst,sd);if(sd>-.25&&firstRock===null)firstRock=d;}
   ray.set(p,dir);ray.far=length;const hits=ray.intersectObject(decor,true);const hit=hits.find(h=>h.distance>.001);
   poses++;if(firstRock!==null)rockBlocked++;if(hit)decorBlocked++;
   const corrected=BOOM.clone(),start=performance.now();chase.constrain(p,q,corrected,.25);times.push(performance.now()-start);
   const afterLength=corrected.length(),afterPosition=corrected.applyQuaternion(q).add(p);let afterWorst=-Infinity;
   assert(Number.isFinite(afterLength)&&afterLength<=BOOM.length()+1e-9,'finite bounded camera result');
   const endClearance=surfaceDistance(afterPosition,chase.obstacles);
   if(endClearance<.249){if(afterLength===0&&surfaceDistance(p,chase.obstacles)<.249)originOverlapFallbacks++;else afterSphereOverlap++;}
   for(let d=0;d<=afterLength;d+=.025){s.copy(p).addScaledVector(dir,d);afterWorst=Math.max(afterWorst,field.sample(...s));}
   if(afterWorst>-.79)afterRock++;
   ray.far=afterLength;const afterHit=ray.intersectObject(decor,true).find(h=>h.distance>.001);if(afterHit)afterDecor++;
   if((firstRock!==null||hit)&&cases.length<80)cases.push({seed,depth,k,angle,pitch,ship:p.toArray(),quaternion:q.toArray(),camera:cam.toArray(),t,length,worst,firstRock,mesh:hit?.object.name,instance:hit?.instanceId,hit:hit?.distance,afterLength,afterPosition:afterPosition.toArray(),afterWorst});
  }
 }
 decor.traverse(o=>o.geometry?.dispose());
}
times.sort((a,b)=>a-b);const cost={meanMs:times.reduce((a,b)=>a+b,0)/times.length,p95Ms:times[Math.floor(times.length*.95)],maxMs:times.at(-1)};
const report={seeds,depths,poses,rockBlocked,decorBlocked,afterRock,afterDecor,afterSphereOverlap,originOverlapFallbacks,cost,cases};fs.mkdirSync('tools/out',{recursive:true});fs.writeFileSync(`tools/out/camera-${full?'full':'before-after'}.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({...report,cases:cases.slice(0,2)},null,2));
if(afterRock||afterDecor||afterSphereOverlap)process.exitCode=1;
