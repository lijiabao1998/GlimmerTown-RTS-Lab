// R114: real native input and hit testing of the fixed help footer. No production test hooks.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { withBrowser, sleep, touchTap } from '../tools/cdp.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'r114-help-'));
const strictCI = process.env.GITHUB_ACTIONS === 'true' || !!process.env.GITHUB_RUN_ID || !!process.env.CI;
const summary = [], record = x => { summary.push(x); console.log(x); };
// Exact approved copy frozen from origin/main@172dd372, rather than inferred from the code under test.
// R044（Claude）在「戰術」最後加一句剋制（textContent 照樣讀得到；?noR044=1 時只是 CSS 藏起來），兩種版本各補在「知道了」前面。
// R043（Claude）再加一句大地圖（?noR043=1 時一樣只是 CSS 藏起來），兩種版本各補在剋制那一句後面。
const EXPECTED_COPY = {"legacy": "怎麼玩布陣：開局先停著。點藍色的我方半場蓋房子（農舍1、磚房2、穀倉3，建材共8）。房子擋子彈、也擋敵人的視線；點蓋好的房子可以拿掉。開戰：按「開戰」。敵人也會在他那半邊蓋房子。選取：點我方單位（藍圈）；「全選」選全部。受傷或選中的單位頭上有血條。下指令：點地面＝移動；點敵人＝攻擊；點房子＝轟它；「砲擊」模式下點地面＝榴彈砲對那一格開火。選中的單位地上會畫出路線、攻擊線與準星。看戰報：一方全滅時慢動作、鏡頭移到最後一擊，接著出戰報；「再來一局」回到布陣。手勢單指拖曳平移（放手會滑一段）；雙指捏合縮放（對準手指）；雙擊我方單位＝鏡頭跟過去。桌機：右鍵下指令、滾輪縮放、空白鍵暫停、Esc取消選取。戰術坦克被房子擋住時，砲彈打在房子上——先把掩體轟塌，視線就通了。榴彈砲射程遠，但要有友軍看得到目標才打得準；觀測員視野最遠，可以進駐房子。同一個目標連打、看得到落點，會越打越準。車會互相擠開；瓦礫可以走、不擋射線。剋制：驅逐戰車射程遠、專打坦克，但要停下來才能開火、車頂開放，怕步兵貼近；突擊砲拆房子最快；裝甲車跑得快、看得遠，拿來偵察、追打步兵與砲，碰到坦克就退。大地圖：布陣時左上的「地圖」鍵可以換成64×64的英格蘭東南鄉間：一條河穿過中間的市鎮，十字大街就是橋；雙方各一個裝甲連起手，同時活著的兵最多40。知道了", "gestures": "怎麼玩布陣：開局先停著。點藍色的我方半場蓋房子（農舍1、磚房2、穀倉3，建材共8）。房子擋子彈、也擋敵人的視線；點蓋好的房子可以拿掉。開戰：按「開戰」。敵人也會在他那半邊蓋房子。選取：點我方單位（藍圈）；「全選」選全部。受傷或選中的單位頭上有血條。下指令：點地面＝移動；點敵人＝攻擊；點房子＝轟它；「砲擊」模式下點地面＝榴彈砲對那一格開火。選中的單位地上會畫出路線、攻擊線與準星。看戰報：一方全滅時慢動作、鏡頭移到最後一擊，接著出戰報；「再來一局」回到布陣。手勢單指拖曳平移（放手會滑一段）；雙指捏合縮放（對準手指）；雙擊我方單位＝鏡頭跟過去。桌機：右鍵下指令、滾輪縮放、空白鍵暫停、Esc取消選取。桌機按住Shift＋左鍵拖曳，追加框內我方單位；普通拖曳仍平移。手機長按地圖半秒，放手後選「高爆砲擊」或「煙幕」；選單只下這一次指令，不改工具列模式。高爆限間接射擊單位，煙幕限榴彈砲；其他混選單位不動。戰術坦克被房子擋住時，砲彈打在房子上——先把掩體轟塌，視線就通了。榴彈砲射程遠，但要有友軍看得到目標才打得準；觀測員視野最遠，可以進駐房子。同一個目標連打、看得到落點，會越打越準。車會互相擠開；瓦礫可以走、不擋射線。剋制：驅逐戰車射程遠、專打坦克，但要停下來才能開火、車頂開放，怕步兵貼近；突擊砲拆房子最快；裝甲車跑得快、看得遠，拿來偵察、追打步兵與砲，碰到坦克就退。大地圖：布陣時左上的「地圖」鍵可以換成64×64的英格蘭東南鄉間：一條河穿過中間的市鎮，十字大街就是橋；雙方各一個裝甲連起手，同時活著的兵最多40。知道了"};
// R045 新增的固定文案；前面的既有全文仍逐字保留。
for (const key of Object.keys(EXPECTED_COPY)) EXPECTED_COPY[key] = EXPECTED_COPY[key].replace('知道了', '喪屍模式：布陣時按「喪屍」切換。喪屍一波波從邊緣湧來，只會近身攻擊；用掩體與火力守住指揮部，撐越多波越好。戰報會記波次、擊倒數與最佳紀錄；一般對戰仍是預設。知道了');
for (const key of Object.keys(EXPECTED_COPY)) EXPECTED_COPY[key] = EXPECTED_COPY[key].replace('知道了', '河鎮：布陣時按「96×96河鎮」進入更大的密集市街、村莊與田野；原本「地圖」鍵仍能切換萊伊與鄉間大圖。喪屍模式也能使用新圖。知道了');
const hits = new Set();
const plugin = {
  name: 'r114-isolated-help-mutants', enforce: 'pre',
  transform(code, id) {
    if (path.relative(ROOT,id.split('?')[0]).replaceAll('\\','/') !== 'src/ui/help.ts') return;
    for (const [from,to] of [
      ['root.hidden = true; on.close();', "root.hidden = true; if (mutant114 !== 'pause') on.close();"],
      ['  const close = () =>', "  if (mutant114 === 'content') root.innerHTML = root.innerHTML.replace('車會互相擠開；瓦礫可以走、不擋射線。', '');\n  const close = () =>"],
    ]) {
      assert.equal(code.split(from).length-1,1,'unique help semantic mutant anchor');
      code=code.replace(from,to); hits.add(from);
    }
    return "const mutant114 = new URLSearchParams(location.search).get('__r114mutant'); document.documentElement.dataset.r114Mutant = mutant114 ?? '';\n" + code;
  },
  transformIndexHtml: { order:'pre', handler(html) {
    const anchor='</style>'; assert.equal(html.split(anchor).length-1,1,'unique stylesheet anchor'); hits.add('css');
    return html.replace(anchor, `
      html[data-r114-mutant="legacy"] #help .panel { display:block; overflow:auto; }
      html[data-r114-mutant="legacy"] #help .help-copy { display:contents; }
      html[data-r114-mutant="scroll"] #help .help-copy { overflow:hidden; }
    </style>`);
  } },
};

async function main() {
  const started=Date.now(), baseline=path.join(temp,'baseline'), broken=path.join(temp,'broken');
  await build({root:ROOT,logLevel:'error',build:{outDir:baseline}});
  await build({root:ROOT,logLevel:'error',plugins:[plugin],build:{outDir:broken}});
  assert.equal(hits.size,3,'all isolated help mutations applied');
  const overlay={};
  await withBrowser({root:baseline,overlay,port:8437,width:412,height:860,mobile:true,chromeWaitMs:20000,readyMs:8000,settle:70},async({open,page})=>{
    const bounded=async(p,label)=>{
      const left=Math.min(8000,112000-(Date.now()-started)); if(left<=0)throw Error('R114 browser operational deadline exceeded');
      let timer; try{return await Promise.race([p,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('CDP timeout: '+label)),left);})]);}finally{clearTimeout(timer);}
    };
    const rawSend=page.send.bind(page),rawEvaluate=page.evaluate.bind(page);
    page.send=(method,args)=>bounded(rawSend(method,args),method); page.evaluate=e=>bounded(rawEvaluate(e),'evaluate');
    const E=e=>page.evaluate(e), frames=()=>E('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    let mobile=true;
    const viewport=async(width,height,touch=true)=>{mobile=touch;await page.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:touch});await page.send('Emulation.setTouchEmulationEnabled',{enabled:touch,maxTouchPoints:5});await frames();};
    const state=()=>E('({tick:__rts.tick(),hash:__rts.hash(),log:__rts.log(),selected:__rts.selected(),cam:__rts.cam(),paused:__rts.paused(),plan:__rts.plan()})');
    const draws=()=>E('({calls:__rts.info().calls,triangles:__rts.info().triangles})');
    const visible=()=>E('!document.getElementById("help").hidden');
    const geometry=()=>E(`(()=>{const p=document.querySelector('#help .panel'),c=document.querySelector('#help .help-copy'),b=document.getElementById('help-ok'),a=document.querySelector('#help .acts');const rect=e=>e.getBoundingClientRect().toJSON(),r=rect(b),points=[[r.x+r.width/2,r.y+r.height/2],[r.left+5,r.top+5],[r.right-5,r.top+5],[r.left+5,r.bottom-5],[r.right-5,r.bottom-5]];return {panel:rect(p),copy:rect(c),button:r,acts:rect(a),width:innerWidth,height:innerHeight,hits:points.map(([x,y])=>b.contains(document.elementFromPoint(x,y))),scroll:c.scrollTop,scrollHeight:c.scrollHeight,clientHeight:c.clientHeight,scrollWidth:c.scrollWidth,clientWidth:c.clientWidth};})()`);
    const checkFooter=g=>{
      const b=g.button,p=g.panel;
      assert(b.width>=44&&b.height>=44&&b.left>=p.left&&b.right<=p.right&&b.top>=p.top&&b.bottom<=p.bottom&&b.left>=0&&b.top>=0&&b.right<=g.width&&b.bottom<=g.height&&g.hits.every(Boolean),'layout: complete close button is inside the panel and all five points hit it');
      assert(g.copy.bottom<=g.acts.top+0.5&&g.scrollWidth<=g.clientWidth+1,'layout: scroll copy does not cover the footer or overflow horizontally');
      assert(p.height<=g.height*0.84+1&&p.width<=Math.min(g.width*.92,520)+1,'layout: original help size limits are retained');
    };
    const click=async(x,y)=>{
      if(mobile)await touchTap(page,x,y);else{await page.send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',buttons:1,clickCount:1});await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',buttons:0,clickCount:1});}await frames();
    };
    const button=async id=>{
      const p=await E(`(()=>{const e=document.getElementById(${JSON.stringify(id)}),r=e.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2,e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))];})()`);
      assert(p[2],'fixture: actual button center is not intercepted');await click(p[0],p[1]);
    };
    const fresh=async extra=>{await open('noR018=1&noR016=1&'+(extra??''));await frames();};
    const openHelp=async()=>{await button('b-help');assert(await visible(),'fixture: native question-mark opens help');};
    const closeHelp=async()=>{
      await E("window.__r114ButtonClicks=0;document.getElementById('help-ok').addEventListener('click',()=>window.__r114ButtonClicks++,{once:true})");
      await button('help-ok');assert.equal(await E('window.__r114ButtonClicks'),1,'close: real close-button listener receives exactly one click');assert(!(await visible()),'close: actual button dismisses help');
    };
    const shot=async name=>{const s=await page.send('Page.captureScreenshot',{format:'png'});fs.mkdirSync(path.join(ROOT,'shots'),{recursive:true});fs.writeFileSync(path.join(ROOT,'shots',name),Buffer.from(s.data,'base64'));};
    const layout=async mutant=>{
      for(const [width,height,touch] of [[412,860,true],[412,640,true],[860,412,true],[1280,800,false]]){
        await viewport(width,height,touch);await fresh(mutant?'__r114mutant=legacy':'');const before=await state(),oldDraws=await draws();await openHelp();
        if(width===412&&height===860)await shot(mutant?'r114-help-before.png':'r114-help-mobile.png');
        const g=await geometry();checkFooter(g);
        if(width===860)await shot('r114-help-landscape.png');
        assert.deepEqual(await state(),before,'layout: build help never changes world or commands');assert.deepEqual(await draws(),oldDraws,'layout: help never adds WebGL calls or triangles');assert(oldDraws.calls<=20&&oldDraws.triangles<=80000,'layout: unchanged opening budget');
        if(width===412&&height===860){await viewport(860,412,true);checkFooter(await geometry());await viewport(412,860,true);checkFooter(await geometry());}
        await closeHelp();assert.deepEqual(await state(),before,'layout: repeated native close preserves paused build state');await openHelp();checkFooter(await geometry());await closeHelp();
        record(`R114 ${width}x${height}: footer ${g.button.width}x${g.button.height}, five hit points, WebGL ${oldDraws.calls}/${oldDraws.triangles}`);
      }
    };
    const scroll=async mutant=>{
      for(const touch of [true,false]){
        await viewport(touch?412:1280,touch?640:440,touch);await fresh('noR006=1'+(mutant?'&__r114mutant=scroll':''));
        await E("__rts.runScript(1);__rts.pause(true);__rts.focus(28,28,1);__rts.select([4]);__rts.issue({t:'move',side:0,ids:[4],x:28,z:28})");await frames();
        const before=await state();assert(before.selected.length===1&&before.log.length===1,'fixture: scroll protects an existing selection and queued command');
        await openHelp();const g=await geometry();checkFooter(g);
        assert(g.scrollHeight>g.clientHeight+20,'fixture: help copy really overflows');
        if(touch){
          const x=g.copy.x+g.copy.width/2,y0=g.copy.bottom-16,y1=g.copy.top+16;
          for(let pass=0;pass<4;pass++){
            await page.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y:y0,id:1}]});
            for(let i=1;i<=10;i++){await page.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y0+(y1-y0)*i/10,id:1}]});await sleep(16);}
            await page.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await sleep(140);await frames();
            if((await geometry()).scroll>g.scrollHeight-g.clientHeight-3)break;
          }
        }else{
          await page.send('Input.dispatchMouseEvent',{type:'mouseWheel',x:g.copy.x+g.copy.width/2,y:g.copy.y+g.copy.height/2,deltaX:0,deltaY:g.scrollHeight*2});await sleep(180);await frames();
        }
        const after=await geometry();
        assert(after.scroll>0&&after.scroll+after.clientHeight>=after.scrollHeight-3,'scroll: native input reaches the end of the copy');
        checkFooter(after);assert.deepEqual(after.button,g.button,'scroll: footer does not move with text');assert.deepEqual(await state(),before,'scroll: text gestures do not move camera or alter paused world');
        assert(await E("(()=>{const a=[...document.querySelectorAll('#help .help-copy li')].at(-1).getBoundingClientRect(),b=document.querySelector('#help .help-copy').getBoundingClientRect();return a.bottom<=b.bottom+1&&a.top>=b.top;})()"),'scroll: final existing tactical instruction is visible');
        if(touch&&!mutant)await shot('r114-help-scrolled.png');await closeHelp();
      }
    };
    const pause=async mutant=>{
      await viewport(412,860,true);await fresh('noR006=1'+(mutant?'&__r114mutant=pause':''));
      await E('__rts.runScript(1);__rts.pause(true);__rts.focus(28,28,1)');await frames();const frozen=await state();
      await openHelp();await sleep(180);assert.deepEqual(await state(),frozen,'pause: opening help preserves already-paused battle');await closeHelp();assert.deepEqual(await state(),frozen,'pause: close restores already-paused state');
      // Actual game button unpauses; opening the dialog must suspend it again.
      await button('b-pause');await sleep(120);assert(!(await E('__rts.paused()')),'fixture: native pause toggle starts the battle');await openHelp();const held=await state();await sleep(180);assert.deepEqual(await state(),held,'pause: visible help freezes the running battle');
      await closeHelp();await sleep(220);await frames();
      assert(!(await E('__rts.paused()'))&&(await E('__rts.tick()'))>held.tick,'pause: running battle resumes after the actual button click');
      await E('__rts.pause(true)');await frames();const p=await E('__rts.screenOf(4)');assert(await E(`document.elementFromPoint(${p[0]},${p[1]})===document.querySelector('body>canvas')`),'pause: hidden help does not intercept the canvas');await click(p[0],p[1]);assert.deepEqual(await E('__rts.selected()'),[4],'pause: ordinary selection works after help closes');
      await openHelp();const paused=await state();await click(4,4);assert(!(await visible()),'pause: original backdrop close remains available');assert.deepEqual(await state(),paused,'pause: backdrop close preserves previously paused state');
    };
    const content=async mutant=>{
      for(const gestures of [true,false]){
        await viewport(412,860,true);await fresh((gestures?'':'noR109=1&')+(mutant?'__r114mutant=content':''));await openHelp();
        const text=await E("document.querySelector('#help .panel').textContent.replace(/\\s/g,'')");
        assert.equal(text,EXPECTED_COPY[gestures?'gestures':'legacy'],'content: every existing instruction and its order remain unchanged');await closeHelp();
      }
    };
    const cases={layout,scroll,pause,content};
    for(const [name,run] of Object.entries(cases)){const errors=page.errors.length;await run(false);assert.equal(page.errors.length,errors,`${name}: no runtime errors`);record('OK real Chrome help '+name);}
    overlay['index.html']=fs.readFileSync(path.join(broken,'index.html'));
    const messages={layout:'layout: complete close button is inside the panel and all five points hit it',scroll:'scroll: native input reaches the end of the copy',pause:'pause: running battle resumes after the actual button click',content:'content: every existing instruction and its order remain unchanged'};
    for(const [name,run] of Object.entries(cases)){
      const errors=page.errors.length;let failure;try{await run(true);}catch(e){failure=e;}
      assert(failure instanceof assert.AssertionError&&failure.message.startsWith(messages[name]),`negative ${name}: first red must be intended semantic assertion, got ${failure?.stack??'no failure'}`);
      assert.equal(page.errors.length,errors,`negative ${name}: no unrelated runtime errors`);record('RED real Chrome help '+name+': '+messages[name]);
    }
  });
}
try{
  await main();if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,'\n### R114 real help guards\n'+summary.map(s=>'- '+s).join('\n')+'\n');
}catch(error){
  const message=String(error?.stack??error);
  if(/listen (?:EPERM|EACCES).*127\.0\.0\.1|socket\(\) failed: Operation not permitted/.test(message)&&!strictCI){console.error('NOT RUN R114 real Chrome guards: local socket permission restriction; CI must execute them.');console.error(error.message);process.exitCode=77;}
  else{console.error(error);console.error('R114 browser FAIL: '+String(error.message).split('\n')[0]);process.exitCode=1;}
}finally{fs.rmSync(temp,{recursive:true,force:true});}
