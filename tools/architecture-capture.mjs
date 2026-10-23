import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync,mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const phase=process.argv[2]||'after',url=process.argv[3]||'http://127.0.0.1:8136/';
const fixtures=JSON.parse(readFileSync(new URL('fixtures/architecture-views.json',import.meta.url)));
const gate=fixtures.specs.find(s=>s.kind==='gate'),entry=fixtures.specs.find(s=>s.kind==='entry');
const out=new URL(`out/architecture-${phase}/`,import.meta.url);mkdirSync(out,{recursive:true});
const port=9664,profile=mkdtempSync(join(tmpdir(),'tunnelrat-ship-'));
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new',`--remote-debugging-port=${port}`,`--user-data-dir=${profile}`,'--window-size=1280,720','--no-first-run','--no-default-browser-check','--mute-audio','about:blank'],{stdio:'ignore',windowsHide:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let ws,sessionId,seq=0;const pending=new Map(),errors=[],stages=[];let failure=null;
const send=(method,params={},session=sessionId)=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params,...(session?{sessionId:session}:{})}));});
const ev=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
// Page-local synthetic events only. No CDP/OS input, pointer lock or focus calls.
const key=(code,down)=>ev(`window.dispatchEvent(new KeyboardEvent(${JSON.stringify(down?'keydown':'keyup')},{code:${JSON.stringify(code)},key:${JSON.stringify(code==='Tab'?'Tab':code.slice(3).toLowerCase())},bubbles:true}));true`);
const tap=async code=>{await key(code,true);await sleep(80);await key(code,false);};
const shot=async name=>writeFileSync(new URL(name+'.png',out),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
const snap=()=>ev('({position:TR.ship.object3d.position.toArray(),quaternion:TR.ship.object3d.quaternion.toArray(),shields:TR.ship.shields,energy:TR.ship.energy,speed:TR.ship.velocity.length(),phase:TR.gamestate.phase,clearance:-TR.field.sample(...TR.ship.object3d.position.toArray())})');
try{
 let info;for(let i=0;i<80;i++){try{info=await(await fetch(`http://127.0.0.1:${port}/json/version`)).json();break;}catch{await sleep(200);}}
 assert(info,'Chrome started');ws=new WebSocket(info.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));
 ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);});
 const {targetId}=await send('Target.createTarget',{url:'about:blank'},null);({sessionId}=await send('Target.attachToTarget',{targetId,flatten:true},null));
 await send('Page.enable');await send('Runtime.enable');await send('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false});await send('Page.navigate',{url});
 for(let i=0;i<120&&!await ev('!!window.TR?.ready');i++)await sleep(250);assert(await ev('!!window.TR?.ready'),'game ready');
 const pointerLocked=await ev('!!document.pointerLockElement');assert(!pointerLocked,'no pointer lock');
 await ev(`import('three').then(t=>{window.T=t;navigator.getGamepads=()=>[];window.originalTakeDamage=TR.ship.takeDamage;TR.debug.god();TR.gamestate.phase='inspection';return true;})`);
 if(phase==='detail') await ev(`TR.enemies.scene.getObjectByName('buddybot').visible=false;TR.enemies.root.visible=false;true`);
 const pose=async(spec,side=1,offset=0,up=0,distance=12)=>{
   await ev(`(()=>{const s=${JSON.stringify(spec)},n=new T.Vector3(...s.normal),r=new T.Vector3(...s.right),u=new T.Vector3(...s.up),target=new T.Vector3(...s.position);TR.ship.velocity.set(0,0,0);TR.ship.rollVel=0;TR.ship.object3d.position.copy(target).addScaledVector(n,${side*distance}).addScaledVector(r,${offset}).addScaledVector(u,${up});const m=new T.Matrix4().lookAt(TR.ship.object3d.position,target,u);TR.ship.object3d.quaternion.setFromRotationMatrix(m);return true;})()`);await sleep(200);
 };
 for(const [spec,label] of [[gate,'gate'],[entry,'entry']])for(const [view,side,x,y,distance] of [['front',1,0,0,12],['front-quarter',1,2.7,1.3,10],['rear-quarter',-1,-2.7,1.3,10]]){await pose(spec,side,x,y,distance);await shot(label+'-'+view);stages.push({name:label+'-'+view,state:await snap()});}
 // The fixture positions the approach; the crossing itself is real held-key flight.
 await pose(gate,1,0,0,9);await ev(`TR.gamestate.phase='playing';true`);
 await ev(`window.chunks=[];window.recorder=new MediaRecorder(document.querySelector('canvas').captureStream(30),{mimeType:'video/webm;codecs=vp9',videoBitsPerSecond:3000000});recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};recorder.start();true`);
 await key('KeyW',true);await sleep(950);await key('KeyW',false);await sleep(400);await shot('gate-blocked');assert(await ev('TR.gamestate.doorLocked'),'locked remains locked');
 stages.push({name:'locked-approach',state:await snap()});
 if(phase==='detail') await ev('window.flightUpdate=TR.ship.update;TR.ship.update=()=>{};true');
 await pose(gate,1,0,0,9);await ev('TR.debug.giveKey();true');await sleep(450);await shot('gate-half-open');await sleep(700);await shot('gate-open');assert(!await ev('TR.gamestate.doorLocked'),'unlocked');
 if(phase==='detail') await ev('TR.ship.update=flightUpdate;true');
 await key('KeyW',true);await sleep(2100);await key('KeyW',false);await sleep(300);await shot('gate-crossed');
 const along=await ev(`TR.ship.object3d.position.clone().sub(TR.gamestate.doorPos).dot(TR.gamestate.doorNormal)`);assert(along<0,'real forward flight crosses gate');stages.push({name:'gate-crossed',along,state:await snap()});
 await pose(entry,1,0,0,4);await key('KeyW',true);await key('KeyQ',true);await sleep(1400);await key('KeyW',false);await key('KeyQ',false);await shot('entry-roll-crossing');stages.push({name:'entry-roll-crossing',state:await snap()});
 const video=await ev(`new Promise(resolve=>{recorder.onstop=()=>{recorder.stream.getTracks().forEach(t=>t.stop());const r=new FileReader();r.onload=()=>resolve(r.result.split(',')[1]);r.readAsDataURL(new Blob(chunks,{type:'video/webm'}));};recorder.stop();})`);writeFileSync(new URL('mechanism-and-traversal.webm',out),Buffer.from(video,'base64'));
 await tap('Tab');await sleep(100);await shot('automap');await tap('Tab');
 await ev('TR.debug.killReactor();true');await sleep(200);assert.equal(await ev('TR.gamestate.phase'),'escape');
 await ev("TR.debug.teleport('exit');true");await sleep(200);assert.equal(await ev('TR.gamestate.phase'),'won');
 await tap('Enter');await sleep(5000);assert.equal(await ev('TR.gamestate.phase'),'playing','next depth');
 await ev('TR.ship.takeDamage=originalTakeDamage;TR.ship.takeDamage(9999);true');await sleep(2400);assert.equal(await ev('TR.gamestate.phase'),'dead');await shot('death');
 await tap('Enter');await sleep(5000);assert.equal(await ev('TR.gamestate.phase'),'playing','retry');await shot('retry');
 stages.push({name:'mission-next-depth-death-retry',state:await snap()});
 if(phase!=='before') {await send('Page.navigate',{url:new URL('tools/architecture-lab.html',url).href});for(let i=0;i<120&&!await ev('!!window.LAB?.ready');i++)await sleep(200);assert(await ev('!!window.LAB?.ready'),'lab ready');await shot('reference');await ev('LAB.setOpenFraction(.5);true');await shot('reference-half-open');await ev('LAB.setOpenFraction(1);true');await shot('reference-open');}
 assert.equal(errors.length,0,'no browser exceptions');console.log(JSON.stringify({phase,pointerLocked,inputMethod:'page-local synthetic KeyboardEvents; no physical cursor/focus/OS input',stages}));
}catch(e){failure=String(e);console.error(e);process.exitCode=1;await shot('failure').catch(()=>{});}
finally{writeFileSync(new URL('receipt.json',out),JSON.stringify({phase,url,pass:!failure,failure,actorMeshesHidden:phase==='detail',method:'Muted hardware headless Chromium 1280x720. No pointer lock, focus calls or OS input; page-local synthetic keys and gamepads disabled in this page. Matched seed, debug-positioned paused closeups; real Ship gate and roll traversal with invulnerability. Detail phase hides actor meshes and holds the ship still during field deactivation only, then restores flight. Before/after phases retain normal actors. Canvas-only silent video. Lab uses controlled lighting and actual game assets.',stages,errors},null,2));if(ws){await send('Browser.close',{},null).catch(()=>{});ws.close();}chrome.kill();}
