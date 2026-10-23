// Replays the reviewer's excessive-retraction fixture through production code.
// Geometry is unchanged; rock is checked as rock and frames as real triangles.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import * as T from 'three';
import {CONFIG} from '../src/config.js';
import {ChaseCamera,CHASE_OFFSET} from '../src/chase-camera.js';
import {GameState} from '../src/gamestate.js';
globalThis.document={createElement:()=>({getContext:()=>({fillRect(){}})})};
const {buildLevel}=await import('../src/procgen/levelbuilder.js');
const fixtures=JSON.parse(fs.readFileSync(new URL('fixtures/camera-gate-retraction.json',import.meta.url)));
const baseline=process.argv.includes('--baseline');
const source=file=>baseline?execFileSync('git',['show',`${fixtures.rejectedCommit}:src/${file}`],{encoding:'utf8'}):fs.readFileSync(new URL(`../src/${file}`,import.meta.url),'utf8');
const main=source('main.js'),body=main.slice(main.indexOf('function updateChaseCam(dt)'),main.indexOf('function startDeathCinematic'));
const Camera=baseline?(await import('data:text/javascript;base64,'+Buffer.from(source('chase-camera.js')).toString('base64'))).ChaseCamera:ChaseCamera;
const level=buildLevel(165,CONFIG,1),game=new GameState(new T.Scene(),CONFIG);
game.startLevel(level.graph,level.field,1);game.hasKey=true;game.doorLocked=false;game.doorMesh.visible=false;game.doorAssembly.userData.setOpenFraction(1);
level.caveGroup.updateMatrixWorld(true);
const roots=[level.caveGroup.getObjectByName('decorGroup'),level.caveGroup.getObjectByName('propsGroup'),game.doorAssembly];
const solver=new Camera(level.field,roots),results=[],ray=new T.Raycaster(),triangle=new T.Triangle(),closest=new T.Vector3();
function surfaceDistance(point){
 let distance=Infinity;
 for(const o of solver.obstacles){
  if(o.box.distanceToPoint(point)>distance)continue;
  const a=o.geo.attributes.position,index=o.geo.index,n=index?index.count:a.count;
  for(let i=0;i<n;i+=3){
   triangle.a.fromBufferAttribute(a,index?index.getX(i):i).applyMatrix4(o.matrix);
   triangle.b.fromBufferAttribute(a,index?index.getX(i+1):i+1).applyMatrix4(o.matrix);
   triangle.c.fromBufferAttribute(a,index?index.getX(i+2):i+2).applyMatrix4(o.matrix);
   triangle.closestPointToPoint(point,closest);distance=Math.min(distance,point.distanceTo(closest));
  }
 }
 return distance;
}
for(const c of fixtures.cases){
 const origin=new T.Vector3(...c.fixture.p),q=new T.Quaternion(...c.fixture.q),velocity=new T.Vector3(...c.fixture.velocity);
 const rig={position:CHASE_OFFSET.clone()},model={visible:true};
 const update=vm.runInNewContext(body+';updateChaseCam;',{THREE:T,CONFIG,chaseCamera:solver,camera:{near:.1,fov:78,aspect:c.aspect},shake:c.shake,ship:{object3d:{position:origin,quaternion:q},velocity},camRig:rig,playerShipModel:model});
 update(1/60);const distance=rig.position.length(),dir=rig.position.clone().applyQuaternion(q).normalize();
 let hits=0,minStatic=Infinity,minRock=Infinity;const nearH=.1*Math.tan(T.MathUtils.degToRad(39)),amp=Math.max(0,c.shake-1/60*2.2)*.2*.999;
 for(let sx=-1;sx<=1;sx++)for(let sy=-1;sy<=1;sy++)for(let cx=-1;cx<=1;cx++)for(let cy=-1;cy<=1;cy++){
  const local=new T.Vector3(sx*amp+cx*nearH*c.aspect,sy*amp+cy*nearH,-.1).applyQuaternion(q);
  ray.set(origin.clone().add(local),dir);ray.far=distance;if(ray.intersectObjects([...level.caveGroup.children,game.doorAssembly],true).length)hits++;
 }
 for(let d=0;d<=distance;d+=.025){const p=origin.clone().addScaledVector(dir,d);minStatic=Math.min(minStatic,surfaceDistance(p));minRock=Math.min(minRock,-level.field.renderField.sample(...p));}
 results.push({aspect:c.aspect,shake:c.shake,beforeDistance:c.productionDistance,distance,modelVisible:model.visible,probes:81,hits,minStatic,minRock});
 assert.equal(hits,0,'near-plane and shake probes clear rock and authored frames');
 assert(minStatic>=c.radius,'exact static geometry clears camera volume');
 if(baseline)assert(Math.abs(distance-c.productionDistance)<1e-9,'rejected production retraction reproduces');
 else {assert(Math.abs(distance-c.rockFieldWithSameExactMeshIndexDistance)<1e-9,'safe full chase distance restored');assert(model.visible,'ship remains visible in clear gate opening');}
}
// Positive contact case: removing the approximate frame envelope must not allow
// a camera through the actual jamb. Both variants share identical rock sampling.
const gate=level.field.architecture.find(s=>s.kind==='gate'),offset=new T.Vector3(7,0,0),noMesh=offset.clone();
solver.constrain(gate.position,gate.quaternion,offset,.25);
new Camera(level.field,[]).constrain(gate.position,gate.quaternion,noMesh,.25);
const actualJamb={withTriangles:offset.length(),withoutTriangles:noMesh.length()};
if(!baseline)assert(offset.length()+.2<noMesh.length(),'actual frame triangles still retract camera');
const report={baseline,results,actualJamb};fs.mkdirSync('tools/out',{recursive:true});fs.writeFileSync(`tools/out/camera-gate-${baseline?'baseline':'corrected'}.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
level.caveGroup.traverse(o=>o.geometry?.dispose());game.clearProps();
