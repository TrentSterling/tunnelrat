// CPU replay of the actual main.js chase update, including visibility and the
// shaken camera near plane. The reviewer supplied these two immutable fixtures.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import * as T from 'three';
import {CONFIG} from '../src/config.js';
import {ChaseCamera, CHASE_OFFSET} from '../src/chase-camera.js';
import {GameState} from '../src/gamestate.js';
globalThis.document={createElement:()=>({getContext:()=>({fillRect(){}})})};
const {buildLevel}=await import('../src/procgen/levelbuilder.js');
const baseline=process.argv.includes('--baseline'),full=process.argv.includes('--full');
const rejected='9b55e4a8c43d9278d4ca703d04125f5964853ab0';
const source=file=>baseline?execFileSync('git',['show',`${rejected}:src/${file}`],{encoding:'utf8'}):fs.readFileSync(new URL(`../src/${file}`,import.meta.url),'utf8');
const main=source('main.js'),body=main.slice(main.indexOf('function updateChaseCam(dt)'),main.indexOf('function startDeathCinematic'));
const Camera=baseline?(await import('data:text/javascript;base64,'+Buffer.from(source('chase-camera.js')).toString('base64'))).ChaseCamera:ChaseCamera;
const fixtures=JSON.parse(fs.readFileSync(new URL('fixtures/camera-production-reproductions.json',import.meta.url)));
const levels=new Map(),timings=[];
function fixture(seed,depth){
 const key=`${seed}/${depth}`;if(levels.has(key))return levels.get(key);
 const level=buildLevel(seed,CONFIG,depth),game=new GameState(new T.Scene(),CONFIG);game.startLevel(level.graph,level.field,depth);
 level.caveGroup.updateMatrixWorld(true);
 const solver=new Camera(level.field,[level.caveGroup.getObjectByName('decorGroup'),level.caveGroup.getObjectByName('propsGroup'),game.doorAssembly]);
 const scope={THREE:T,CONFIG,chaseCamera:solver,camera:{near:.1,fov:78,aspect:16/9},shake:0,ship:{object3d:{position:new T.Vector3(),quaternion:new T.Quaternion()},velocity:new T.Vector3()},camRig:{position:CHASE_OFFSET.clone()},playerShipModel:{visible:true}};
 const update=vm.runInNewContext(body+';updateChaseCam;',scope),f={level,game,solver,scope,update,rocks:level.caveGroup.children.filter(o=>o.isMesh)};levels.set(key,f);return f;
}
function setPose(f,c){
 const s=f.scope;s.ship.object3d.position.fromArray(c.origin);s.ship.object3d.quaternion.fromArray(c.quaternion);
 s.ship.velocity.set(0,0,0);s.camera.aspect=c.aspect;s.shake=c.shake;s.camRig.position.copy(CHASE_OFFSET);s.playerShipModel.visible=true;
}
const ray=new T.Raycaster(),direction=new T.Vector3(),point=new T.Vector3();
function probe(f,worldPoint){
 const s=f.scope;direction.copy(s.camRig.position).applyQuaternion(s.ship.object3d.quaternion);const distance=direction.length();
 if(distance<1e-9)return null;
 point.copy(s.ship.object3d.position).add(worldPoint);ray.set(point,direction.divideScalar(distance));ray.far=distance;
 const hit=ray.intersectObjects(f.rocks,false)[0];return hit?{distance,hit:hit.distance,penetration:distance-hit.distance,mesh:hit.object.name}:null;
}
const reproductions=[];
for(const r of fixtures.results){
 const c=r.case,f=fixture(c.seed,c.depth);setPose(f,c);f.update(1/60);
 const hit=probe(f,new T.Vector3(...c.localPoint));reproductions.push({seed:c.seed,depth:c.depth,aspect:c.aspect,beforePenetration:r.penetrationAlongBoom,cameraDistance:f.scope.camRig.position.length(),hit});
}
// Same legal 5cm peak-to-peak oscillation, real velocity lean and production
// hide/show decision. Follow with a retreat into open space and another approach.
const visibility=[];
for(const hz of [30,60,144]){
 const f=fixture(1,1),s=f.scope,base=new T.Vector3(30.497745741158724,-109.70903677502648,6.5872895903885365);
 const q=new T.Quaternion(-Math.SQRT1_2,0,0,Math.SQRT1_2),axis=CHASE_OFFSET.clone().applyQuaternion(q).normalize();
 s.camera.aspect=16/9;s.shake=0;s.ship.object3d.quaternion.copy(q);s.camRig.position.copy(CHASE_OFFSET);s.playerShipModel.visible=true;
 let toggles=0,prior=true,minDistance=Infinity,maxDistance=0,minClearance=Infinity;
 for(let i=0;i<hz*6;i++){
  const t=i/hz,d=1.0288243108216193+.025*Math.sin(t*Math.PI*4),speed=.025*Math.PI*4*Math.cos(t*Math.PI*4);
  s.ship.object3d.position.copy(base).addScaledVector(axis,-d);s.ship.velocity.copy(axis).multiplyScalar(-speed);f.update(1/hz);
  if(i>hz&&s.playerShipModel.visible!==prior)toggles++;prior=s.playerShipModel.visible;
  minDistance=Math.min(minDistance,s.camRig.position.length());maxDistance=Math.max(maxDistance,s.camRig.position.length());minClearance=Math.min(minClearance,-f.level.field.sample(...s.ship.object3d.position));
 }
 s.ship.velocity.set(0,0,0);s.ship.object3d.position.copy(base).addScaledVector(axis,-3);
 for(let i=0;i<hz;i++)f.update(1/hz);const restored=s.playerShipModel.visible;
 s.ship.object3d.position.copy(base);f.update(1/hz);const immediatelyHidden=!s.playerShipModel.visible;
 visibility.push({hz,togglesAfterFirstSecond:toggles,minDistance,maxDistance,minClearance,restored,immediatelyHidden});
}
const expanded=[];
if(full){
 const q=new T.Quaternion(),near=.1,nearH=near*Math.tan(T.MathUtils.degToRad(39)),dt=1/144;
 for(const seed of [1,16,18,83,91,107,165,1337])for(const depth of [1,2,3]){
  const f=fixture(seed,depth),s=f.scope,failures=[];let poses=0,probes=0;
  for(const room of f.level.field.decor.rooms)for(const delta of [new T.Vector3(),new T.Vector3(room.radius*.7,0,0),new T.Vector3(0,room.radius*.7,0),new T.Vector3(0,0,room.radius*.7)]){
   const origin=room.pos.clone().add(delta);if(f.level.field.sample(...origin)>-1.4)continue;
   for(const yaw of [0,Math.PI/2,Math.PI,Math.PI*1.5])for(const pitch of [0,Math.PI/2,-Math.PI/2])for(const aspect of [9/16,16/9,32/9])for(const shake of [0,1.5]){
    q.setFromEuler(new T.Euler(pitch,yaw,yaw/2));setPose(f,{origin:origin.toArray(),quaternion:q.toArray(),aspect,shake});
    const start=performance.now();f.update(dt);timings.push(performance.now()-start);poses++;
    const amp=Math.max(0,shake-dt*2.2)*.2*(1-1e-6);
    for(const sx of [-1,1])for(const sy of [-1,1])for(const cx of [-1,1])for(const cy of [-1,1]){
     const local=new T.Vector3(sx*amp+cx*nearH*aspect,sy*amp+cy*nearH,-near).applyQuaternion(q),hit=probe(f,local);probes++;
     if(hit)failures.push({room:room.id,origin:origin.toArray(),quaternion:q.toArray(),aspect,shake,...hit});
    }
   }
  }
  expanded.push({seed,depth,poses,probes,failures});console.log(JSON.stringify({seed,depth,poses,probes,failures:failures.length}));
 }
}
timings.sort((a,b)=>a-b);
const report={baseline,reproductions,visibility,expanded,costFullUpdate:timings.length?{meanMs:timings.reduce((a,b)=>a+b,0)/timings.length,p95Ms:timings[Math.floor(timings.length*.95)],maxMs:timings.at(-1)}:null};
fs.mkdirSync('tools/out',{recursive:true});fs.writeFileSync(`tools/out/camera-production-${baseline?'baseline':full?'full':'corrected'}.json`,JSON.stringify(report,null,2));
for(const f of levels.values()){f.level.caveGroup.traverse(o=>o.geometry?.dispose());f.game.clearProps();}
console.log(JSON.stringify({...report,expanded:expanded.map(r=>({...r,failures:r.failures.length}))},null,2));
if(baseline){assert(reproductions.every(r=>r.hit),'review mesh failures reproduce');assert.equal(visibility.find(r=>r.hz===60).togglesAfterFirstSecond,20,'review flicker reproduces');}
else {assert(reproductions.every(r=>!r.hit),'both production near-plane fixtures clear');assert(visibility.every(r=>r.togglesAfterFirstSecond===0&&r.restored&&r.immediatelyHidden),'stable visibility and safe immediate hiding');assert(expanded.every(r=>!r.failures.length),'expanded shaken near-plane coverage');}
