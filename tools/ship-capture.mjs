import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const phase=process.argv[2]||'before',url=process.argv[3]||'http://127.0.0.1:8134/';
const out=new URL(`out/ship-${phase}/`,import.meta.url);mkdirSync(out,{recursive:true});
const port=9654,profile=mkdtempSync(join(tmpdir(),'tunnelrat-ship-'));
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new',`--remote-debugging-port=${port}`,`--user-data-dir=${profile}`,'--window-size=1280,720','--no-first-run','--no-default-browser-check','--mute-audio','about:blank'],{stdio:'ignore',windowsHide:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let ws,sessionId,seq=0;const pending=new Map(),errors=[],stages=[];let failure=null;
const send=(method,params={},session=sessionId)=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params,...(session?{sessionId:session}:{})}));});
const ev=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
const key=(code,down)=>send('Input.dispatchKeyEvent',{type:down?'keyDown':'keyUp',code,key:code==='Tab'?'Tab':code==='Backquote'?'`':code.slice(3).toLowerCase()});
const tap=async code=>{await key(code,true);await sleep(80);await key(code,false);};
const shot=async name=>writeFileSync(new URL(name+'.png',out),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
const snap=()=>ev('({position:TR.ship.object3d.position.toArray(),quaternion:TR.ship.object3d.quaternion.toArray(),shields:TR.ship.shields,energy:TR.ship.energy,speed:TR.ship.velocity.length(),phase:TR.gamestate.phase,clearance:-TR.field.sample(...TR.ship.object3d.position.toArray())})');
try{
 let info;for(let i=0;i<80;i++){try{info=await(await fetch(`http://127.0.0.1:${port}/json/version`)).json();break;}catch{await sleep(200);}}
 assert(info,'Chrome started');ws=new WebSocket(info.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));
 ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);});
 const {targetId}=await send('Target.createTarget',{url:'about:blank'},null);({sessionId}=await send('Target.attachToTarget',{targetId,flatten:true},null));
 await send('Page.enable');await send('Runtime.enable');await send('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false});await send('Page.navigate',{url});
 for(let i=0;i<120&&!await ev('!!window.TR?.ready');i++)await sleep(250);assert(await ev('!!window.TR?.ready'),'game ready');await send('Page.bringToFront');
 await shot('spawn');stages.push({name:'spawn',state:await snap()});
 await send('Input.dispatchMouseEvent',{type:'mousePressed',x:640,y:360,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:640,y:360,button:'left',clickCount:1});
 const pointerLocked=await ev('!!document.pointerLockElement');
 await tap('KeyV');await sleep(400);await shot('chase');
 await ev(`(()=>{window.chunks=[];window.recorder=new MediaRecorder(document.querySelector('canvas').captureStream(30),{mimeType:'video/webm;codecs=vp9',videoBitsPerSecond:3000000});recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};recorder.start();})()`);
 for(const [keys,ms,name] of [[['KeyW'],1400,'forward'],[['KeyD','KeyR'],700,'strafe-up'],[['KeyQ'],700,'roll'],[['KeyA','KeyF','KeyS'],750,'reverse'],[[],1200,'release']]){for(const k of keys)await key(k,true);await sleep(ms);for(const k of keys)await key(k,false);stages.push({name,keys,ms,state:await snap()});await shot(name);}
 const video=await ev(`new Promise(resolve=>{recorder.onstop=()=>{recorder.stream.getTracks().forEach(t=>t.stop());const r=new FileReader();r.onload=()=>resolve(r.result.split(',')[1]);r.readAsDataURL(new Blob(chunks,{type:'video/webm'}));};recorder.stop();})`);writeFileSync(new URL('selfplay.webm',out),Buffer.from(video,'base64'));
 await tap('Tab');await sleep(100);await shot('automap');await tap('Tab');
 // Fixed seeded showcase pose with the normal game renderer. No motion/combat claim for this fixture.
 await ev(`TR.ship.object3d.position.copy(TR.graph.nodes.find(n=>n.id===TR.graph.spawnId).pos);TR.ship.object3d.quaternion.identity();TR.ship.velocity.set(0,0,0);TR.ship.rollVel=0;TR.ship.shields=100;true`);
 await tap('KeyV');await tap('KeyV'); // reset chase rig via the real camera toggle
 await ev(`TR.ship.object3d.quaternion.identity();TR.gamestate.phase='inspection';true`);await sleep(180);await shot('matched-chase');
 stages.push({name:'matched-chase',state:await snap()});
 // Exercise the exact shared ship builder through the death cinematic and retry.
 await ev(`window.originalRandom=Math.random;Math.random=()=>.65;TR.gamestate.phase='playing';TR.ship.takeDamage(9999);true`);await sleep(800);await shot('death-tumble');assert.equal(await ev('TR.gamestate.phase'),'dead');
 await sleep(1400);await shot('wreck');await ev('Math.random=originalRandom;true');await tap('Enter');await sleep(5000);assert.equal(await ev('TR.gamestate.phase'),'playing','retry restored play');await shot('retry');
 stages.push({name:'retry',state:await snap()});
 assert(pointerLocked,'trusted pointer-lock entry');assert(stages[1].state.position.some((x,i)=>Math.abs(x-stages[0].state.position[i])>3),'forward movement');
 assert(stages[5].state.speed<stages[4].state.speed,'release damps drift');
 const gpu=await ev(`(()=>{const g=document.querySelector('canvas').getContext('webgl2'),x=g.getExtension('WEBGL_debug_renderer_info');return x?g.getParameter(x.UNMASKED_RENDERER_WEBGL):'unknown';})()`);
 await send('Page.navigate',{url:new URL('tools/ship-lab.html',url).href});for(let i=0;i<120&&!await ev('!!window.LAB?.ready');i++)await sleep(200);assert(await ev('!!window.LAB?.ready'),'lab ready');await shot('reference');
 const model=await ev('LAB.report');writeFileSync(new URL('measurements.json',out),JSON.stringify(model,null,2));
 assert.equal(errors.length,0,'browser exceptions');writeFileSync(new URL('system.json',out),JSON.stringify({browser:info.Browser,gpu,pointerLocked},null,2));console.log(JSON.stringify({phase,model,pointerLocked,stages}));
}catch(e){failure=String(e);console.error(e);process.exitCode=1;await shot('failure').catch(()=>{});}
finally{writeFileSync(new URL('receipt.json',out),JSON.stringify({phase,url,pass:!failure,failure,method:'Headless hardware Chromium 1280x720; CDP keyboard and pointer-lock click; real game frames. Matched chase is debug positioned and paused. Video is canvas-only and omits DOM HUD. Muted, no audio claim.',stages,errors},null,2));if(ws){await send('Browser.close',{},null).catch(()=>{});ws.close();}chrome.kill();}
