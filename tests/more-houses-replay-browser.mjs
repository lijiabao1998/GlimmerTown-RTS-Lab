// R087 更多房屋（真的 Chrome）：頁面的雜湊、閥關著重播、喪屍 48 隻的壓力。
// 1. 五張地圖 R087 開著（noR087=0）開戰：開戰那一步與第 600 步的雜湊＝Node 重播頁面自己的紀錄；紀錄的 map 指令帶 more＝1。
// 2. 萊伊那一局的紀錄拿到 ?noR087=1 的頁面重播：同一個雜湊、新房型都在（用替代的樣子畫）、頁面錯誤 0。
// 3. 64 圖喪屍 48 隻的壓力（R045 的夾具，同一個鏡頭）：R087 開著 ≤ 80,000 三角形、≤ 關著 + 5,600、繪製次數一樣。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { withBrowser, shot } from '../tools/cdp.mjs';
import { runOrSkip } from '../tools/net-harness.mjs';
import { createWorld, hashWorld, BK_OAST, BK_MILL, BK_WAREHOUSE } from '../src/sim/world.ts';
import { runLog } from '../src/sim/step.ts';

const root = path.resolve(import.meta.dirname, '..'), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r087-replay-')), shots = path.join(root, 'shots');
fs.mkdirSync(shots, { recursive: true });
// R045 的喪屍壓力夾具（tests/zombies-browser.mjs 的 __r045Stress，照抄）：只在這一份測試的建置裡有
const fixture = { name: 'r087-stress', enforce: 'pre', transform(code, id) {
  if (path.relative(root, id.split('?')[0]).replaceAll('\\', '/') !== 'src/main.ts') return;
  return code + `
    window.__r087Stress = () => {
      paused = true; view.setWorld(w); view.fogOn = false;
      for(const u of w.units) if(u.side===SIDE_PLAYER){u.kind=3;u.hp=60;u.alive=true;}
      const sample = structuredClone(w.units.find(u => u.alive && u.side === SIDE_PLAYER));
      const add = (alive, x, z, side=1, kind=11) => {
        const u = { ...structuredClone(sample), id:w.units.length+1, side, kind, hp:alive?60:0, alive, x:x*SUB, z:z*SUB, path:[], pathIdx:0 };
        w.units.push(u);w.events.push({e:'spawn',unit:u.id,x:u.x,z:u.z});return u;
      };
      while(w.units.filter(u=>u.alive&&u.side===SIDE_PLAYER).length<40)add(true,55,55,0,3);
      while (w.units.length < 520) add(false, 50, 50);
      const dead = []; for(let i=0;i<12;i++) dead.push(add(true,52+i%4,52+Math.floor(i/4),i%2,i%2?11:3));
      view.onEvents(w.events,0);w.events=[];view.update(1,0,selected);
      for(const u of dead) { u.hp=0;u.alive=false; } view.update(1,0,selected);
      for(let i=0;i<48;i++) add(true,50+i%8,50+Math.floor(i/8));
      view.onEvents(w.events,0);w.events=[];view.update(1,0,selected);
      view.target.set(54,0,53);view.zoom=1.6;
      view.update(1,31,selected);return w.units.length;
    };
  `;
} };
const MAPS = [['rye', ''], ['village', 'map=village&'], ['m64', 'map=64&'], ['m96', 'map=96&'], ['hills', 'map=hills&']];
const NEW = [BK_OAST, BK_MILL, BK_WAREHOUSE];

await runOrSkip('more-houses-replay', async () => {
  try {
    await build({ root, logLevel: 'error', plugins: [fixture], build: { outDir: tmp } });
    await withBrowser({ root: tmp, width: 412, height: 860, mobile: true, port: 9993 }, async ({ open, page }) => {
      const E = s => page.evaluate(s), frames = () => E('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r))))');
      let rye = null;
      for (const [name, q] of MAPS) {
        await open(`${q}seed=1944&noR100=1&noR087=0`);
        await E('__rts.startBattle(); __rts.pause(true)');
        const seed = await E('__rts.seed()'), t0 = await E('__rts.tick()'), h0 = await E('__rts.hash()'), log0 = await E('__rts.log()');
        assert.equal(log0.find(e => e.cmd.t === 'map')?.cmd.more, 1, `page: a new battle's map command carries more 1 (${name})`);
        assert.equal(hashWorld(runLog(createWorld(seed), log0, t0)), h0, `page: at the start of the battle the page equals the Node replay of its own log (${name}, tick ${t0})`);
        await E(`__rts.stepN(${600 - t0})`);
        const log = await E('__rts.log()'), h600 = await E('__rts.hash()');
        assert.equal(hashWorld(runLog(createWorld(seed), log, 600)), h600, `page: at tick 600 the page equals the Node replay of its own log (${name})`);
        await frames(); const battle = await E('__rts.info()');   // 第 600 步的戰場（開局的鏡頭）
        assert(battle.calls <= 22 && battle.triangles <= 80000, `budget: the battle at tick 600 stays within 22 calls and 80,000 triangles (${name}: ${battle.calls}/${battle.triangles})`);
        assert.equal(page.errors.length, 0, `page: no page errors (${page.errors.join(' | ').slice(0, 300)})`);
        console.log(`r087 ${name}: tick ${t0} ${h0}, tick 600 ${h600} = Node`);
        if (!q) rye = { seed, log, h600 };
      }
      // 閥關著的新開的局：map 指令不帶 more、沒有新房型、頁面＝Node（跟 R087 之前逐位一樣是在 139f2fb 的建置上對過的，見卡面驗收第 9 條）
      for (const [name, q] of MAPS) {
        await open(`${q}seed=1944&noR100=1&noR087=1`);
        await E('__rts.startBattle(); __rts.pause(true)');
        const seed = await E('__rts.seed()'), t0 = await E('__rts.tick()'), log = await E('__rts.log()');
        assert.equal(log.find(e => e.cmd.t === 'map')?.cmd.more, undefined, `valve: with ?noR087=1 a new battle's map command has no more (${name})`);
        assert(!(await E('__rts.blds()')).some(b => NEW.includes(b.kind)), `valve: with ?noR087=1 there are no new kinds (${name})`);
        assert.equal(hashWorld(runLog(createWorld(seed), log, t0)), await E('__rts.hash()'), `valve: with ?noR087=1 the page equals the Node replay (${name})`);
      }
      // 閥關著的頁面重播 R087 的紀錄
      await open('seed=1944&noR100=1&noR087=1');
      await E(`__rts.playLog(${rye.seed}, ${JSON.stringify(rye.log)}, 600)`); await E('__rts.pause(true)'); await frames();
      assert.equal(await E('__rts.hash()'), rye.h600, 'valve: with ?noR087=1 an R087 log replays to the same hash');
      const kinds = new Set((await E('__rts.blds()')).map(b => b.kind));
      assert(NEW.filter(k => k !== BK_OAST).every(k => kinds.has(k)), 'valve: the replayed world still has the new kinds (drawn in their stand-in looks)');
      assert.equal(page.errors.length, 0, `valve: no page errors while replaying (${page.errors.join(' | ').slice(0, 300)})`);
      await E('__rts.focus(27, 12, 2.4)'); await frames();
      await shot(page, path.join(shots, 'r087-rye-replay-noR087.png'));
      // 64 圖喪屍 48 隻
      const stress = {};
      for (const on of [false, true]) {
        await open(`map=64&mode=zombies&seed=1944&noR100=1&noR087=${on ? 0 : 1}`);
        await E('__r087Stress()'); await frames(); await frames();
        stress[on] = await E('__rts.info()');
        if (on) await shot(page, path.join(shots, 'r087-m64-cap48-on.png'));
      }
      console.log(`r087 cap48: off ${stress.false.calls}/${stress.false.triangles}, on ${stress.true.calls}/${stress.true.triangles}`);
      assert(stress.true.triangles <= 80000 && stress.true.triangles <= stress.false.triangles + 5600, `budget: the 64-map zombie cap48 stress stays within 80,000 and the R087-off count + 5,600 (${stress.true.triangles} vs ${stress.false.triangles})`);
      assert.equal(stress.true.calls, stress.false.calls, 'budget: the cap48 stress has the same draw calls with R087');
      assert.equal(page.errors.length, 0, `page: no page errors (${page.errors.join(' | ').slice(0, 300)})`);
    });
    console.log('more-houses replay browser: all OK');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
