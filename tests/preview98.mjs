// R098 布陣預覽只重畫改到的格（只改效能）：每點一下（放房子、碉堡、牆、鐵絲網、戰壕、拿掉、復原）之後，預覽的 groundPx
// ＝新開一個畫面整張畫出來的，逐位元組；而且真的走了「只重畫改到的格」那一條（不是每次都整張）。染色的那一方換了、換地圖、換 n、同一個世界物件、閥關著：整張。
// 地圖 1、3 與鋪滿的 128；預覽世界跟 buildPlanner.ts 一樣：複製世界、套計畫。
import assert from 'node:assert/strict';
import * as W from '../src/sim/world.ts';
import { step } from '../src/sim/step.ts';
import { applyBuild, buildError, territory, BUILD_KINDS_24, WALL_KINDS, WIRE_KIND } from '../src/sim/build.ts';
import { applyTrench, trenchError, TRENCH_KINDS } from '../src/sim/trenches.ts';
import { BattleView, setView98, setStreets } from '../src/render/battle.ts';
import { tile128 } from '../tools/tile128.mjs';

let rs = 9898; const rnd = m => { rs = (Math.imul(rs, 1103515245) + 12345) >>> 0; return (rs >>> 8) % m; };
const opts = { fog: false, fx: true, r016: true, r118: true };
setStreets(true);   // 跟遊戲一樣（main.ts 的 setStreets(V.r027)）：路緣畫在貼著房子的路格上，所以改到的格要多一圈
const same = (a, b) => a.length === b.length && Buffer.compare(Buffer.from(a.buffer, a.byteOffset, a.length), Buffer.from(b.buffer, b.byteOffset, b.length)) === 0;
function world(map, seed) {
  const w = W.createWorld(seed);
  step(w, [{ t: 'map', id: map === 128 ? 3 : map, vegetation: 1, more: 1, sym: 1 }]);
  const t = map === 128 ? tile128(w) : w; t.tick = 0; t.events = []; return t;
}
const preview = (real, plan) => { const pv = structuredClone(real); for (const c of plan) c.t === 'trench' ? applyTrench(pv, c) : applyBuild(pv, c); pv.events = []; return pv; };
// 一個放得下的計畫項目（照 buildError／trenchError 試到放得下）
function item(real, plan) {
  const kinds = [...BUILD_KINDS_24, ...WALL_KINDS, WIRE_KIND];
  const pv = preview(real, plan);
  for (let t = 0; t < 400; t++) {
    const x = rnd(real.n), z = rnd(real.n), road = (a, b) => a >= 0 && b >= 0 && a < real.n && b < real.n && real.ter[b * real.n + a] === W.TER_ROAD;
    if (!territory(W.SIDE_PLAYER, x, z, real.n) || (t < 200 && !(road(x - 1, z) || road(x + 1, z) || road(x, z - 1) || road(x, z + 1)))) continue;   // 先找貼著路的格（路緣）
    const cmd = rnd(4) === 0 ? { t: 'trench', side: W.SIDE_PLAYER, kind: rnd(TRENCH_KINDS.length), x, z, ...(rnd(2) ? { rot: 1 } : {}) }
      : { t: 'build', side: W.SIDE_PLAYER, kind: kinds[rnd(kinds.length)].kind, x, z, ...(rnd(2) ? { rot: 1 } : {}) };
    if ((cmd.t === 'trench' ? trenchError(pv, cmd) : buildError(pv, cmd)) === null) return cmd;
  }
  return null;
}

let partial = 0, taps = 0, view98on = true;
const NOGPU = { copyTextureToTexture() {} };
for (const map of [1, 3, 128]) {
  setView98(true);
  const real = world(map, 42 + map), v = new BattleView(real, opts), ref = new BattleView(real, opts), plan = [];
  const check = (why, wantPartial) => {
    v['up98'].flush(NOGPU, v.groundTex);   // 上一幀畫完（Node 裡沒有 render）
    const pv = preview(real, plan); v.setWorld(pv, W.SIDE_PLAYER);
    const was = !v['up98'].full98 && v['up98'].pending().length > 0;
    const on = view98on; setView98(false); ref.setWorld(structuredClone(pv), W.SIDE_PLAYER); setView98(on);   // 參照：同一個畫面在閥關著時整張重畫（跟今天一樣）
    assert(same(v.groundPx, ref.groundPx), `preview: map ${map} after ${why} the preview ground equals a full repaint, byte for byte`);
    if (wantPartial !== undefined) assert.equal(was, wantPartial, `preview: map ${map} ${why} takes the ${wantPartial ? 'partial' : 'full'} repaint`);
    taps++; if (was) partial++;
  };
  check('the first preview (side −1 → player)', false);
  for (let k = 0; k < 6; k++) { const c = item(real, plan); if (c) plan.push(c); check(`placing item ${k} (${JSON.stringify(c)})`); }
  for (let k = 0; k < (map === 128 ? 5 : 8); k++) {
    const r = rnd(3);
    if (r === 0 && plan.length) { plan.splice(rnd(plan.length), 1); check('removing an item'); }
    else if (r === 1 && plan.length) { const c = plan.pop(); check('undo'); plan.push(c); check('redo'); }
    else { const c = item(real, plan); if (c) plan.push(c); check(`placing ${JSON.stringify(c)}`); }
  }
  // 整張的情況：同一個世界物件、閥關著、染色的那一方換了
  const pv = preview(real, plan); v.setWorld(pv, W.SIDE_PLAYER); v['up98'].flush(NOGPU, v.groundTex); v.setWorld(pv, W.SIDE_PLAYER);
  assert(v['up98'].full98, `preview: map ${map} the same world object again is a full repaint`);
  setView98(false); view98on = false; check('a tap with ?noR098=1', false); setView98(true); view98on = true;
  v['up98'].flush(NOGPU, v.groundTex); v.setWorld(preview(real, plan), -1); assert(v['up98'].full98, `preview: map ${map} changing the tinted side (battle start) is a full repaint`);
  v.dispose?.(); ref.dispose?.();
}
assert(partial >= 25, `preview: coverage (${partial} of ${taps} taps took the partial repaint)`);
console.log(`OK preview98: ${taps} taps equal a fresh full paint (${partial} partial)`);
