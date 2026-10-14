// Browser integration contract, deliberately exercising the real game document.
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const root = path.resolve(__dirname,'..');
const {repository} = require('./about-manifest.json');
const output = process.env.EVIDENCE_DIR || path.join(__dirname,'about-evidence');
fs.mkdirSync(output,{recursive:true});
const types = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.webp':'image/webp','.png':'image/png','.wasm':'application/wasm'};
async function waitForGame(page) {
  const ready = {
    gemstogether:()=>window.__jewel?.ready,
    deadends:()=>window.DEAD_ENDS && !document.getElementById('playBtn').disabled,
    tinytreads:()=>!!window.POCKET,
    breakmass:()=>window.BREAKMASS && getComputedStyle(document.getElementById('loading')).display==='none',
    tinyrise:()=>window.tinyrise?.ready,
    terrainlab:()=>window.__surfaceWorld && document.getElementById('loading').hidden,
    tunnelrat:()=>window.TR?.ready,
    vibecraft:()=>document.querySelector('canvas') && /FPS:/.test(document.getElementById('info').textContent),
    vibespace:()=>document.getElementById('space-canvas').width>0,
    vibemaze:()=>document.getElementById('gameScreen').textContent!=='Loading...'
  };
  await page.waitForFunction(ready[repository],{},{timeout:90000});
}
async function resumedPlay(page) {
  await waitForGame(page);
  if(repository==='gemstogether') {
    const move=await page.evaluate(()=>__jewel.state().legalMoves[0]);
    const points=await page.evaluate(m=>m.map(i=>__jewel.project(i)),move);
    const before=await page.evaluate(()=>__jewel.state().moves);
    await page.mouse.move(...points[0]); await page.mouse.down(); await page.mouse.move(...points[1],{steps:8}); await page.mouse.up();
    await page.waitForFunction(n=>__jewel.state().moves>n,before);
  } else if(repository==='tinytreads') {
    await page.locator('#quickPlay').click(); await page.waitForTimeout(500);
    await page.locator('#fire').click(); await page.waitForTimeout(1500);
    assert.ok(await page.locator('#hud').isVisible());
  } else if(repository==='deadends') {
    await page.evaluate(()=>DEAD_ENDS.start()); await page.waitForTimeout(500);
    await page.evaluate(()=>document.activeElement.blur());
    const before=await page.evaluate(()=>({x:DEAD_ENDS.state.players[0].x,y:DEAD_ENDS.state.players[0].y}));
    await page.keyboard.down('d'); await page.waitForTimeout(400); await page.keyboard.up('d');
    const after=await page.evaluate(()=>({x:DEAD_ENDS.state.players[0].x,y:DEAD_ENDS.state.players[0].y}));
    assert.notDeepEqual(after,before,'survivor moves after closing About');
  } else if(repository==='tinyrise') {
    await page.evaluate(()=>document.activeElement.blur());
    const before=await page.evaluate(()=>tinyrise.city.stats.overview);
    await page.keyboard.press('m');
    assert.notEqual(await page.evaluate(()=>tinyrise.city.stats.overview),before,'city controls resume');
  } else if(repository==='breakmass') {
    await page.evaluate(()=>document.activeElement.blur());
    const before=await page.evaluate(()=>BREAKMASS.cameraState.position);
    await page.keyboard.down('w');await page.waitForTimeout(400);await page.keyboard.up('w');
    assert.notDeepEqual(await page.evaluate(()=>BREAKMASS.cameraState.position),before,'flight resumes');
  } else {
    const target={terrainlab:'#scene',tunnelrat:'#app',vibecraft:'#instructions',vibespace:'#space-canvas',vibemaze:'#gameScreen'}[repository];
    if(repository==='terrainlab') await page.evaluate(()=>__surfaceWorld.home());
    await page.locator(target).click({position:{x:200,y:200}});
    await page.waitForFunction(()=>!!document.pointerLockElement,{},{timeout:10000});
    const before=await page.screenshot();
    await page.keyboard.down('w'); await page.waitForTimeout(350); await page.keyboard.up('w');
    const after=await page.screenshot();
    assert.notDeepEqual(after,before,'rendered game continues after reacquiring pointer');
    await page.evaluate(()=>document.exitPointerLock());
    await page.waitForFunction(()=>!document.pointerLockElement);
    await page.waitForTimeout(1300);
    await page.locator('#trontAbout > summary').click();
    assert.equal(await page.evaluate(()=>!!document.pointerLockElement),false);
    await page.locator('[data-tront-about-close]').click();
    await page.locator(target).click({position:{x:200,y:200}});
    await page.waitForFunction(()=>!!document.pointerLockElement,{},{timeout:10000});
    await page.evaluate(()=>document.exitPointerLock());
    await page.waitForFunction(()=>!document.pointerLockElement);
  }
  await page.screenshot({path:path.join(output,`${repository}-resumed-game.png`)});
  const audioBefore = await page.evaluate(()=>window.__aboutAudioContexts.map(c=>c.state));
  // Fullscreen stays active through About open/close; no forced exit or reentry.
  await page.locator('#trontAbout > summary').click();
  await page.evaluate(()=>document.documentElement.requestFullscreen());
  assert.equal(await page.evaluate(()=>!!document.fullscreenElement),true);
  await page.locator('[data-tront-about-close]').click();
  assert.equal(await page.evaluate(()=>!!document.fullscreenElement),true);
  await page.evaluate(()=>document.exitFullscreen());
  const audioAfter = await page.evaluate(()=>window.__aboutAudioContexts.map(c=>c.state));
  audioBefore.forEach((state,i)=>{if(state==='running')assert.equal(audioAfter[i],'running','About must preserve running game audio');});
  return {input:'resumed',pointer:'no About capture; original play gesture reacquires',fullscreen:'preserved',audioBefore,audioAfter};
}
const server = http.createServer((req,res)=>{
  let name = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  if (name.startsWith('/games/media/')) {res.writeHead(302,{Location:'https://tront.xyz'+name});return res.end();}
  let file = path.resolve(root, '.'+name+(name.endsWith('/')?'index.html':''));
  if (!file.startsWith(root+path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {res.writeHead(404);return res.end();}
  res.setHeader('Content-Type',types[path.extname(file)] || 'application/octet-stream');fs.createReadStream(file).pipe(res);
});
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base = process.env.TEST_URL || `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({headless:true,executablePath:process.env.CHROME || undefined,args:['--enable-unsafe-swiftshader','--mute-audio']});
  const results = [];
  try {
    for(const mode of ['desktop','reduced-motion','save-data','touch']) {
      const context = await browser.newContext({viewport:mode==='touch'?{width:390,height:844}:{width:1280,height:800},hasTouch:mode==='touch',isMobile:mode==='touch',reducedMotion:mode==='reduced-motion'?'reduce':'no-preference'});
      await context.addInitScript(()=>{
        window.__aboutAudioContexts=[];
        for(const name of ['AudioContext','webkitAudioContext'])if(window[name]){
          const Original=window[name];
          window[name]=class extends Original {constructor(...args){super(...args);window.__aboutAudioContexts.push(this);}};
        }
      });
      if(mode==='save-data')await context.addInitScript(()=>Object.defineProperty(navigator,'connection',{value:{saveData:true},configurable:true}));
      const page = await context.newPage(); const mp4=[]; const errors=[];
      page.on('request',r=>{if(/\.mp4(?:\?|$)/.test(r.url()))mp4.push(r.url());});
      page.on('pageerror',e=>errors.push(e.message));
      await page.goto(base+(repository==='gemstogether'?'#solo=1':''),{waitUntil:'domcontentloaded',timeout:90000});
      await page.waitForFunction(()=>!!window.TrontAboutDiscovery);
      await waitForGame(page);
      await page.waitForTimeout(500);
      assert.equal(await page.locator('[data-tront-discovery-game]').count(),0,'cards must wait for open');
      assert.equal(mp4.length,0,'no eager MP4');
      const summary=page.locator('#trontAbout > summary');
      await page.screenshot({path:path.join(output,`${repository}-${mode}-initial.png`),timeout:10000});
      console.log(repository,mode,'initial',await summary.boundingBox());
      if(mode==='touch')console.log('viewport',await page.evaluate(()=>({w:innerWidth,h:innerHeight,cw:document.documentElement.clientWidth,ch:document.documentElement.clientHeight,vw:visualViewport.width,vh:visualViewport.height,scale:visualViewport.scale})));
      if(mode==='touch') await summary.tap(); else await summary.click();
      await page.waitForSelector('[data-tront-discovery-game]');
      assert.equal(await page.evaluate(()=>!!document.pointerLockElement),false,'About must not capture the pointer');
      assert.equal(await page.locator('[data-tront-discovery-game="'+repository+'"]').count(),0,'no self promotion');
      assert.equal(await page.locator('[data-tront-discovery-game="smear"] video').count(),0);
      if(mode==='desktop') {
        const card=page.locator('[data-tront-discovery-game="craftmine"]');
        await card.scrollIntoViewIfNeeded(); await card.hover();
        await page.waitForFunction(()=>!!document.querySelector('[data-tront-discovery-video][src]'));
        assert.equal(await page.locator('[data-tront-discovery-video]').count(),1);
      } else {
        await page.locator('[data-tront-discovery-game="craftmine"]').scrollIntoViewIfNeeded();
        if(mode!=='touch')await page.locator('[data-tront-discovery-game="craftmine"]').hover();
        await page.waitForTimeout(200); assert.equal(mp4.length,0,'fallback must stay poster only');
      }
      // Real keyboard Tab must move through native links instead of game bindings.
      await summary.focus(); await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(()=>document.activeElement.matches('[data-tront-about-close]')),true);
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(()=>document.activeElement.tagName),'A');
      await page.locator('.tront-discovery').evaluate(e=>e.scrollTop=0);
      // Screenshots show decoded current posters, never an empty lazy-image slot.
      await page.waitForFunction(()=>[...document.querySelectorAll('.tront-discovery__poster')].every(i=>i.complete&&i.naturalWidth>0));
      await page.evaluate(()=>{window.__aboutKeyLeak=0;window.addEventListener('keydown',()=>window.__aboutKeyLeak++,true);});
      await summary.focus();await page.keyboard.press('w');
      assert.equal(await page.evaluate(()=>window.__aboutKeyLeak),0,'About keystrokes do not enter game handlers');
      await page.screenshot({path:path.join(output,`${repository}-${mode}-open.png`)});
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#trontAbout').evaluate(e=>e.open),false);
      await page.waitForTimeout(100);
      assert.equal(await page.locator('[data-tront-discovery-video][src]').count(),0,'closed preview released');
      await summary.press('Enter');
      await page.locator('[data-tront-about-close]').click();
      assert.equal(await page.locator('#trontAbout').evaluate(e=>e.open),false);
      await page.screenshot({path:path.join(output,`${repository}-${mode}-closed.png`)});
      const bounds=await summary.boundingBox();
      assert.ok(bounds.x>=0 && bounds.y>=0 && bounds.x+bounds.width<=page.viewportSize().width+1);
      const gameplay=mode==='desktop'?await resumedPlay(page):null;
      results.push({mode,mp4Requests:mp4.length,errors,gameplay});
      await context.close();
    }
    fs.writeFileSync(path.join(output,`${repository}-results.json`),JSON.stringify(results,null,2));
    console.log(JSON.stringify({repository,passed:true,results}));
  } finally {await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exit(1);});
