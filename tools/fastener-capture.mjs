// Reviewed isolated headless asset renderer. No input, focus, audio or pointer calls.
// Browser starts muted with its own temporary profile; never attaches to a user browser.
import fs from 'node:fs';import path from 'node:path';import http from 'node:http';
import {spawn} from 'node:child_process';import {tmpdir} from 'node:os';
const here=path.dirname(new URL(import.meta.url).pathname.replace(/^\//,''));
const root='C:/Users/trent/Documents/Codex/2026-10-22/task-4/tunnelrat-entries';
const deps='C:/Users/trent/Documents/Codex/2026-10-22/task-4/validation-deps/node_modules/three';
const owner='codex-tunnelrat-fastener-correction-task4',coord='C:/trontstack/.agentcoord';
const out=path.join(here,'out','fastener-corrected');fs.mkdirSync(out,{recursive:true});
const acquired=[];let server,chrome,ws,sessionId,seq=0;const pending=new Map();
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const log=r=>fs.appendFileSync(coord+'/journal.ndjson',JSON.stringify(r)+'\n');
const send=(method,params={},session=sessionId)=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params,...(session?{sessionId:session}:{})}));});
const ev=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
let timer;
try{
  for(const id of ['pc1-browser-gpu-capture','gpu-game-validation']){
    const file=coord+'/claims/'+id+'.json';const rec={owner,heartbeatUtc:new Date().toISOString(),ttlMinutes:3,task:'Static fastener geometry in muted isolated headless asset lab; no game runtime, input, focus, media or audio.'};
    fs.writeFileSync(file,JSON.stringify(rec),{flag:'wx'});acquired.push(file);log({...rec,event:'acquire',file});
  }
  server=http.createServer((req,res)=>{try{
    const name=new URL(req.url,'http://127.0.0.1').pathname;let file;
    if(name==='/')file=here+'/fastener-lab.html';
    else if(name.startsWith('/src/'))file=path.resolve(root,'.'+name);
    else if(name.startsWith('/three/'))file=path.resolve(deps,'.'+name.slice(6));
    else throw Error('unmapped');
    if(![here,root,deps].some(base=>file.replaceAll('\\','/').startsWith(base+'/')))throw Error('outside');
    res.setHeader('Content-Type',file.endsWith('.html')?'text/html':'text/javascript');res.end(fs.readFileSync(file));
  }catch{res.statusCode=404;res.end('not found');}});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(8147,'127.0.0.1',resolve);});
  const profile=fs.mkdtempSync(path.join(tmpdir(),'tunnelrat-static-review-'));
  chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--remote-debugging-port=9697',`--user-data-dir=${profile}`,'--window-size=1000,700','--no-first-run','--no-default-browser-check','--mute-audio','about:blank'],{windowsHide:true,stdio:'ignore'});
  timer=setTimeout(()=>chrome.kill(),60000);let info;
  for(let i=0;i<50;i++){try{info=await(await fetch('http://127.0.0.1:9697/json/version')).json();break;}catch{await pause(100);}}
  if(!info)throw Error('own headless browser did not start');
  ws=new WebSocket(info.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));
  ws.addEventListener('message',e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}});
  const {targetId}=await send('Target.createTarget',{url:'about:blank'},null);({sessionId}=await send('Target.attachToTarget',{targetId,flatten:true},null));
  await send('Page.enable');await send('Runtime.enable');await send('Emulation.setDeviceMetricsOverride',{width:1000,height:700,deviceScaleFactor:1,mobile:false});await send('Page.navigate',{url:'http://127.0.0.1:8147/'});
  for(let i=0;i<60&&!await ev('!!window.ready');i++)await pause(100);
  if(!await ev('!!window.ready'))throw Error('asset lab did not load');
  const states=[];
  for(const [name,angle,diag] of [['fastener-front',.2,false],['fastener-angle',.8,false],['fastener-cap-only',.8,true]]){
    const state=await ev(`window.renderView(${angle},${diag})`);if(state.pointerLocked)throw Error('unexpected pointer lock');states.push(state);
    fs.writeFileSync(path.join(out,name+'.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
  }
  fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify({states,headless:true,mutedBeforeLaunch:true,isolatedProfile:profile,inputCommands:[],gameRuntimeLoaded:false},null,2));
}finally{
  if(ws?.readyState===WebSocket.OPEN){try{await Promise.race([send('Browser.close',{},null),pause(1000)]);}catch{}ws.close();}
  if(chrome&&!chrome.killed)chrome.kill();if(timer)clearTimeout(timer);
  if(server)await new Promise(r=>server.close(r));
  for(const file of acquired){const rec=JSON.parse(fs.readFileSync(file));if(rec.owner===owner){fs.unlinkSync(file);log({...rec,event:'release',file,time:new Date().toISOString()});}}
  console.log(JSON.stringify({owner,claimsReleased:acquired.length,ownBrowserClosed:true,serverClosed:true}));
}
