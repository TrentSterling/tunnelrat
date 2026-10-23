// Exercise the public Ship/GameState boundary with the real generated door.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {Ship} from '../src/ship.js';
import {GameState} from '../src/gamestate.js';
import {CONFIG} from '../src/config.js';
import {generateLevelGraph} from '../src/procgen/graph.js';
import {createDensityField} from '../src/procgen/density.js';
globalThis.document={createElement:()=>({getContext:()=>({fillRect(){}})})};
const input={axis:{x:0,y:0,z:1,roll:0},mouseDX:0,mouseDY:0,boost:false};
const results=[];
for(const seed of [1337,1338,1339,83,91,107,165])for(const hz of [30,60,144]){
  const graph=generateLevelGraph(seed,CONFIG),field=createDensityField(graph,seed,CONFIG),scene=new THREE.Scene();
  const game=new GameState(scene,CONFIG),ship=new Ship(CONFIG,field);game.startLevel(graph,field,1);
  const normal=game.doorNormal.clone(),start=game.doorPos.clone().addScaledVector(normal,3);
  const q=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,-1),normal.clone().negate());
  ship.reset(start,q);let blocked=false;
  for(let i=0;i<hz/2;i++){ship.update(1/hz,input);const events=game.update(1/hz,ship);blocked||=events.includes('doorBlocked');
    assert(ship.object3d.position.clone().sub(game.doorPos).dot(normal)>=CONFIG.ship.radius+.5-1e-8,'locked door blocks approach');}
  assert(blocked&&game.doorLocked&&!game.hasKey,'locked-door contract');
  ship.reset(game.keyBasePos.clone(),q);assert(game.update(0,ship).includes('keyPickup'));assert(game.hasKey);
  ship.reset(start,q);assert(game.update(0,ship).includes('doorOpen'));assert(!game.doorLocked);
  for(let i=0;i<hz;i++){ship.update(1/hz,input);game.update(1/hz,ship);}
  const crossed=ship.object3d.position.clone().sub(game.doorPos).dot(normal);assert(crossed<0,'key permits actual flight across gate');
  game.reactorDestroyed();assert(game.update(0,ship).includes('escapeStart'));
  ship.reset(game.exitPos.clone(),q);assert(game.update(0,ship).includes('escaped'));assert.equal(game.phase,'won');
  game.startLevel(graph,field,1);ship.takeDamage(9999);assert(game.update(0,ship).includes('died'));assert.equal(game.phase,'dead');
  game.startLevel(graph,field,1);ship.reset(start,q);assert.equal(ship.rollVel,0);assert(game.doorLocked&&!game.hasKey);assert.equal(game.phase,'playing');
  game.reactorDestroyed();game.escapeRemaining=.001;assert(game.update(.01,ship).includes('timeUp'));assert(!ship.alive);
  game.clearProps();assert.equal(scene.children.length,0,'level cleanup removes all objective props');
  results.push({seed,hz,crossed,pass:true});
}
console.log(JSON.stringify({pass:true,results},null,2));

