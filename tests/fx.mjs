// R004 效果守衛（Node，不開瀏覽器）：畫面只讀世界、池不超過容量、同一串事件畫出同一個狀態、逃生閥關時新池零實例。
import fs from 'node:fs';
import { createWorld, hashWorld, SUB } from '../src/sim/world.ts';
import { step, runLog } from '../src/sim/step.ts';
import { SCRIPT, runScript } from '../src/sim/script.ts';
import { BattleView } from '../src/render/battle.ts';

const fails = [];
function check(ok, name, detail = '') {
  console.log(`${ok ? 'OK' : 'NG'}  ${name}${detail ? '　— ' + detail : ''}`);
  if (!ok) fails.push(name);
}
const sel = new Set();
const sum = p => p.puff + p.glow + p.debris + p.ring + p.ghost;
// 跑腳本戰鬥 900 步，第 600 步加一條射擊指令把 #12 轟成瓦礫；每一步把事件餵給畫面、畫一幀
function play(r004) {
  const w = createWorld(1944), v = new BattleView(w, true, true, true, r004);
  const log = [...SCRIPT, { tick: 600, cmd: { t: 'fireAt', side: 0, ids: [2, 4], x: 18, z: 9 } }].sort((a, b) => a.tick - b.tick);
  let i = 0, maxSeen = 0, over = '';
  const caps = v.poolCaps;
  while (w.tick < 900) {
    const now = []; while (i < log.length && log[i].tick <= w.tick) { if (log[i].tick === w.tick) now.push(log[i].cmd); i++; }
    v.snapshot(); step(w, now); v.onEvents(w.events, w.tick / 20);
    for (let f = 0; f < 3; f++) v.update(f / 3, (w.tick + f / 3) / 20, sel);
    const p = v.pools; maxSeen = Math.max(maxSeen, sum(p));
    if (caps) for (const k of Object.keys(caps)) if (p[k] > caps[k]) over = `${k} ${p[k]} > ${caps[k]}（tick ${w.tick}）`;
  }
  return { w, v, maxSeen, over, log };
}

{ // 1. 畫面只讀世界：同一串指令，有畫面與沒有畫面，世界雜湊相同
  const a = play(true), plain = runLog(createWorld(1944), a.log, 900);
  check(hashWorld(a.w) === hashWorld(plain) && a.maxSeen > 0, '畫面只讀世界：餵事件、畫 2,700 幀，世界雜湊等於沒有畫面', `${hashWorld(a.w)} / ${hashWorld(plain)}；效果實例最多 ${a.maxSeen}`);
  check(!a.over, '腳本戰鬥＋倒塌：每個池的實例數從不超過容量', a.over || JSON.stringify(a.v.poolCaps));
  // 2. 決定性：同一串事件、同一串模擬時間 → 效果池狀態一模一樣
  const b = play(true);
  check(a.v.fxDigest() === b.v.fxDigest() && a.v.fxDigest() !== 'off', '同一串事件畫兩次：效果池摘要相同', `${a.v.fxDigest()} / ${b.v.fxDigest()}`);
  // 3. 逃生閥：r004=false 時新池全程零實例
  const c = play(false);
  check(c.maxSeen === 0 && c.v.fxDigest() === 'off' && hashWorld(c.w) === hashWorld(a.w), '?noR004=1：新效果池全程 0 個實例、世界雜湊相同', `最多 ${c.maxSeen}`);
  a.v.dispose(); b.v.dispose(); c.v.dispose();
}
{ // 4. 壓力：10,000 個事件（彈著、開火、換階段、擊毀、布陣）一口氣灌進去，池照樣不超量、世界不變
  const w = runScript(600), h0 = hashWorld(w), v = new BattleView(w, true, true, true, true), caps = v.poolCaps;
  let over = '', maxSeen = 0, t = 30;
  for (let i = 0; i < 10000; i++) {
    const r = i % 5, x = ((i * 37) % 32) * SUB + 128, z = ((i * 53) % 32) * SUB + 128;
    const e = r === 0 ? { e: 'impact', kind: i % 2, x, z, bld: i % 7 === 0 ? (i % w.blds.length) + 1 : 0 }
      : r === 1 ? { e: 'fire', unit: (i % w.units.length) + 1, x, z }
      : r === 2 ? { e: 'stage', bld: (i % w.blds.length) + 1, stage: (i >> 1) % 3 }
      : r === 3 ? { e: 'kill', unit: (i % w.units.length) + 1 }
      : { e: 'build', bld: (i % w.blds.length) + 1 };
    v.onEvents([e], t);
    if (i % 10 === 9) {
      t += 0.05; v.update(0, t, sel);
      const p = v.pools; maxSeen = Math.max(maxSeen, sum(p));
      for (const k of Object.keys(caps)) if (p[k] > caps[k]) over = `${k} ${p[k]} > ${caps[k]}（第 ${i} 個事件）`;
    }
  }
  check(!over && maxSeen > 0 && hashWorld(w) === h0, '10,000 個事件：池從不超過容量、世界雜湊不變', over || `最多 ${maxSeen} 個實例；雜湊 ${hashWorld(w)}`);
  v.dispose();
}
{ // 5. 效果程式不用 Math.random、現實時間（同一刻截兩次圖要一樣）
  const bad = [];
  for (const f of ['src/render/fx.ts', 'src/render/battle.ts']) {
    fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8').split('\n').forEach((l, n) => {
      const code = l.replace(/\/\/.*$/, '');
      if (/Math\.random|performance\.now|Date\.now|new Date\(/.test(code)) bad.push(`${f}:${n + 1}`);
    });
  }
  check(!bad.length, '效果程式不用 Math.random／performance.now／Date', bad.join(' ') || '乾淨');
}

if (fails.length) { console.log(`NG fx：${fails.join('、')}`); process.exit(1); }
console.log('fx: all OK');
