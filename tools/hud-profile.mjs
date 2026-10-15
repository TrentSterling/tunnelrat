// Browser HUD profiling: real animation frames and CDP keyboard input.
// Debug setup is reserved for the separately labelled escape stage.
import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync,mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';

const url=process.argv[2]||'http://127.0.0.1:8135/';
const out=process.argv[3]||'tools/out/hud-profile';
const headless=process.env.HEADED!=='1';
mkdirSync(out,{recursive:true});
const port=9515,profile=mkdtempSync(join(tmpdir(),'tunnelrat-hud-'));
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',[
  ...(headless?['--headless=new']:[]),`--remote-debugging-port=${port}`,`--user-data-dir=${profile}`,
  '--window-size=1280,720','--no-first-run','--no-default-browser-check','--mute-audio','about:blank'
],{stdio:'ignore',windowsHide:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let ws,sessionId,seq=0;const pending=new Map(),errors=[],stages=[];let failure=null;
const send=(method,params={},session=sessionId)=>new Promise((resolve,reject)=>{
  const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params,...(session?{sessionId:session}:{})}));
});
const ev=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
const key=(code,down)=>send('Input.dispatchKeyEvent',{type:down?'keyDown':'keyUp',code,key:code==='Space'?' ':code==='Tab'?'Tab':code.slice(3).toLowerCase(),windowsVirtualKeyCode:code==='Space'?32:code==='Tab'?9:undefined});
const shot=async name=>writeFileSync(join(out,name+'.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
const stats=a=>{const s=a.toSorted((a,b)=>a-b);return {n:a.length,meanMs:a.reduce((s,v)=>s+v,0)/a.length,p95Ms:s[Math.floor(s.length*.95)],maxMs:s.at(-1)};};
try{
  let info;for(let i=0;i<80;i++){try{info=await(await fetch(`http://127.0.0.1:${port}/json/version`)).json();break;}catch{await sleep(200);}}
  assert(info,'Chrome started');ws=new WebSocket(info.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));
  ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);});
  const {targetId}=await send('Target.createTarget',{url:'about:blank'},null);
  ({sessionId}=await send('Target.attachToTarget',{targetId,flatten:true},null));
  await send('Page.enable');await send('Runtime.enable');await send('Performance.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url});
  for(let i=0;i<120&&!await ev('!!window.TR?.ready');i++)await sleep(250);
  assert(await ev('!!window.TR?.ready'),'game ready');await send('Page.bringToFront');await sleep(1000);
  await ev(`(()=>{window.trace={frames:[],mutations:{},active:false};new MutationObserver(ms=>{if(!trace.active)return;for(const m of ms){const k=m.target.className+':'+m.type+':'+(m.attributeName||'');trace.mutations[k]=(trace.mutations[k]||0)+1;}}).observe(document.querySelector('#hud'),{subtree:true,childList:true,attributes:true,characterData:true});let last;function frame(t){if(trace.active&&last)trace.frames.push(t-last);last=t;requestAnimationFrame(frame);}requestAnimationFrame(frame);window.snapshot=()=>({position:TR.ship.object3d.position.toArray(),shields:TR.ship.shields,energy:TR.ship.energy,phase:TR.gamestate.phase,enemies:TR.enemies.list().length,hud:document.querySelector('#hud').innerText});})()`);
  const infoGpu=await ev(`(()=>{const c=document.querySelector('canvas'),g=c.getContext('webgl2')||c.getContext('webgl'),x=g.getExtension('WEBGL_debug_renderer_info');return {vendor:x?g.getParameter(x.UNMASKED_VENDOR_WEBGL):null,renderer:x?g.getParameter(x.UNMASKED_RENDERER_WEBGL):null};})()`);
  await ev(`(()=>{window.chunks=[];window.recorder=new MediaRecorder(document.querySelector('canvas').captureStream(30),{mimeType:'video/webm;codecs=vp9',videoBitsPerSecond:1800000});recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};recorder.start();})()`);
  for(const phase of ['stationary','firing','recharge','escape']){
    if(phase==='escape')await ev("TR.debug.god();TR.debug.giveKey();TR.debug.teleport('reactor');TR.debug.killReactor();true");
    await ev('trace.frames=[];trace.mutations={};trace.active=true');
    const before=await ev('snapshot()'),metricsBefore=await send('Performance.getMetrics');
    if(phase==='firing')await key('Space',true);
    await sleep(4000);
    if(phase==='firing')await key('Space',false);
    const trace=await ev('trace.active=false;({frames:trace.frames,mutations:trace.mutations})'),after=await ev('snapshot()'),metricsAfter=await send('Performance.getMetrics');
    await shot(phase);
    const stage={phase,input:phase==='firing'?'CDP Space held 4s':phase==='escape'?'Debug reactor setup, 4s ordinary frames':'No input, 4s ordinary frames',before,after,trace,frameTiming:stats(trace.frames),metricsBefore,metricsAfter};stages.push(stage);
    console.log(JSON.stringify({phase,frameTiming:stage.frameTiming,mutations:trace.mutations,energy:after.energy,enemies:after.enemies,phaseResult:after.phase}));
  }
  const data=await ev(`new Promise(resolve=>{recorder.onstop=()=>{recorder.stream.getTracks().forEach(t=>t.stop());const r=new FileReader();r.onload=()=>resolve(r.result.split(',')[1]);r.readAsDataURL(new Blob(chunks,{type:'video/webm'}));};recorder.stop();})`);
  writeFileSync(join(out,'gameplay.webm'),Buffer.from(data,'base64'));
  await key('Tab',true);await key('Tab',false);await sleep(150);await shot('automap');
  await key('Tab',true);await key('Tab',false);
  assert(stages[1].after.energy<stages[1].before.energy,'real fire input consumed energy');
  assert(stages[2].after.energy>stages[1].after.energy,'energy recharged');
  assert.equal(stages[3].after.phase,'escape');assert.equal(errors.length,0,'browser exceptions');
  if(process.argv[4]){
    // Compare real DOM against the supplied historical HUD module, including every
    // rounded value boundary and timer hide/show transitions. No simulated game loop.
    const baselineModule='data:text/javascript;base64,'+readFileSync(process.argv[4]).toString('base64');
    const equivalence=await ev(`(async()=>{
      const {HUD:Before}=await import(${JSON.stringify(baselineModule)});
      const {HUD:After}=await import(new URL('src/hud.js',location.href));
      const ca=document.createElement('div'),cb=document.createElement('div');
      const a=new Before(ca),b=new After(cb);let checks=0;
      const compare=(method,...args)=>{a[method](...args);b[method](...args);if(ca.innerHTML!==cb.innerHTML)throw Error('HUD mismatch '+method+' '+JSON.stringify(args));checks++;};
      for(const max of [100,150])for(let i=-4;i<=max*4+4;i++){compare('setShields',i/4,max);compare('setEnergy',i/4,max);}
      for(const v of [undefined,null,70,69.999,60.001,60,59.999,10.001,10,9.999,9,8.999,0.001,0,-1,null,9,null,70])compare('setTimer',v);
      compare('setKey',true);compare('setKey',false);compare('setDepth',2);compare('setObjective','REACH THE EXIT BEACON');compare('setXP',500);compare('showDeath',true);compare('showDeath',false);compare('showWin',true,2);compare('showWin',false,2);
      b.setShields(100,100);b.setEnergy(100,100);b.setTimer(10);
      const observer=new MutationObserver(()=>{});observer.observe(cb,{subtree:true,childList:true});
      for(let i=0;i<240;i++){b.setShields(100,100);b.setEnergy(100,100);b.setTimer(9.1);}
      const redundantTextMutations=observer.takeRecords().length;observer.disconnect();
      return {checks,redundantTextMutations,pass:redundantTextMutations===0};
    })()`);
    writeFileSync(join(out,'hud-equivalence.json'),JSON.stringify(equivalence,null,2));assert(equivalence.pass,'unchanged formatted labels produce no text mutations');
    console.log(JSON.stringify({equivalence}));
  }
  writeFileSync(join(out,'system.json'),JSON.stringify({browser:info.Browser,webgl:infoGpu,headless},null,2));
}catch(e){failure=String(e);console.error(e);process.exitCode=1;await shot('failure').catch(()=>{});}
finally{
  writeFileSync(join(out,'profile.json'),JSON.stringify({date:new Date().toISOString(),url,pass:!failure,failure,method:'1280x720 desktop Chromium; default GPU; normal animation frames; CDP input is scripted browser input, not human play. Escape is debug-assisted. Muted; no audio listening. Canvas WebM omits DOM HUD; full-page PNGs include it. Frame intervals are browser cadence, not GPU timestamps.',stages,errors},null,2));
  if(ws){await send('Browser.close',{},null).catch(()=>{});ws.close();}chrome.kill();
}
