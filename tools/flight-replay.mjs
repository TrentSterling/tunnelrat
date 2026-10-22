// CPU-only flight contract probe. This intentionally reports existing timestep
// variation rather than silently tuning movement as part of a visual change.
import * as THREE from 'three';
import {Ship} from '../src/ship.js';
import {CONFIG} from '../src/config.js';
import {generateLevelGraph} from '../src/procgen/graph.js';
import {createDensityField} from '../src/procgen/density.js';
import assert from 'node:assert/strict';
function replay(hz){const ship=new Ship(CONFIG,null),input={axis:{x:0,y:0,z:0,roll:0},mouseDX:0,mouseDY:0,boost:false};for(const side of [1,-1]){let elapsed=0;for(let i=0;elapsed<2-1e-9;i++){const dt=Math.min(typeof hz==='number'?1/hz:[1/30,1/144,1/60,1/90][i%4],2-elapsed);input.axis={x:side,y:side*.5,z:side,roll:side};input.mouseDX=12*dt;input.mouseDY=5*dt;ship.update(dt,input);elapsed+=dt;}}return {position:ship.object3d.position.toArray(),quaternion:ship.object3d.quaternion.toArray(),speed:ship.velocity.length(),shields:ship.shields};}
const rates=[30,60,144,'jitter'],results=rates.map(hz=>({hz,...replay(hz)}));
for(const r of results){assert(r.position.every(Number.isFinite));assert(Math.abs(Math.hypot(...r.quaternion)-1)<1e-9);}
const divergence=Math.hypot(...results[0].position.map((v,i)=>v-results[2].position[i]));
// Unchanged collision resolves fast translation against an analytic wall.
const wall={sample:(x)=>x,collisionNormal:(x,y,z,out)=>out.set(-1,0,0)};
let closest=-Infinity;for(const hz of [30,60,144]){const ship=new Ship(CONFIG,wall);ship.reset(new THREE.Vector3(-12,0,0),new THREE.Quaternion());for(let i=0;i<hz;i++){ship.update(1/hz,{axis:{x:1,y:0,z:0,roll:0},mouseDX:0,mouseDY:0,boost:true});closest=Math.max(closest,ship.object3d.position.x);assert(ship.object3d.position.x<=-CONFIG.ship.radius+1e-6);}}
// Procedural graph + scalar field are exercised on three consecutive seeds without GPU.
const generation=[1337,1338,1339].map(seed=>{const graph=generateLevelGraph(seed,CONFIG),field=createDensityField(graph,seed,CONFIG);const spawn=graph.nodes.find(n=>n.id===graph.spawnId);assert(field.sample(...spawn.pos.toArray())< -CONFIG.ship.radius);return {seed,nodes:graph.nodes.length,edges:graph.edges.length,spawnClearance:-field.sample(...spawn.pos.toArray())};});
console.log(JSON.stringify({pass:true,results,reversal30vs144m:divergence,analyticWallClosestX:closest,generation,note:'Movement baseline is recorded, not retuned. Compare exact JSON across the visual change.'},null,2));
