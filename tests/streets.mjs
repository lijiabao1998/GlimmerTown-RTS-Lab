// R027 人行道與黑白路緣守衛：Rye 貼著房子的路有人行道與黑白路緣、路中間仍是石板、不貼房子的路沒有；關掉時逐像素跟 R027 之前相同；亂數村莊不變；畫面只讀世界。
import { createWorld, hashWorld } from '../src/sim/world.ts';
import { applyMap, MAP_RYE } from '../src/sim/maps.ts';
import { BattleView, setStreets } from '../src/render/battle.ts';

const fails = [];
function check(ok, name, detail = '') {
  console.log(`${ok ? 'OK' : 'NG'}  ${name}${detail ? '　— ' + detail : ''}`);
  if (!ok) fails.push(name);
}
const ORIG_FP = ['eabbe8a0', 'e619892e'];   // R027 之前的地面貼圖（亂數村莊、Rye）
const PX = 8, W = 32 * PX;
const ground = (map, on) => { setStreets(on); const w = createWorld(1944); if (map) applyMap(w, MAP_RYE); const h0 = hashWorld(w); const v = new BattleView(w, true, true, true, true, true, true, true, true, true); const px = v.groundPx.slice(), kids = v.scene.children.length; v.dispose(); setStreets(true); return { px, kids, same: hashWorld(w) === h0 }; };
const fp = a => { let h = 2166136261; for (let i = 0; i < a.length; i++) { h ^= a[i]; h = Math.imul(h, 16777619) >>> 0; } return h.toString(16); };
const cell = (px, x, z) => { const out = []; for (let py = 0; py < PX; py++) { const row = []; for (let qx = 0; qx < PX; qx++) { const o = ((z * PX + py) * W + x * PX + qx) * 4; row.push(px[o]); } out.push(row); } return out; };

const ryeOn = ground(1, true), ryeOff = ground(1, false), vilOn = ground(0, true), vilOff = ground(0, false);
{ // 1. High Street (12,15)：北邊 (12,14) 是房子、南邊 (12,16) 是店面——兩側人行道、路緣黑白、中間石板；往 Camber 的路 (3,10) 沒有
  const c = cell(ryeOn.px, 12, 15), kerbN = c[2], kerbS = c[5], mid = [...c[3], ...c[4]], walk = [...c[0], ...c[1]];
  const camber = cell(ryeOn.px, 3, 10).flat();
  const bw = row => row.some(v => v < 70) && row.some(v => v > 200);
  check(bw(kerbN) && bw(kerbS) && walk.every(v => v >= 140 && v <= 200) && mid.every(v => v >= 70 && v <= 200) && camber.every(v => v >= 70 && v <= 200),
    'Rye：High Street 兩側有人行道與黑白路緣、路中間是石板；不貼房子的路沒有', `北路緣 ${kerbN}；南路緣 ${kerbS}；人行道 ${Math.min(...walk)}–${Math.max(...walk)}；中間 ${Math.min(...mid)}–${Math.max(...mid)}；Camber 路 ${Math.min(...camber)}–${Math.max(...camber)}`);
}
{ // 2. 關掉＝R027 之前逐像素相同；亂數村莊開關都一樣
  const offFp = [fp(vilOff.px), fp(ryeOff.px)];
  check(offFp[0] === ORIG_FP[0] && offFp[1] === ORIG_FP[1] && fp(vilOn.px) === fp(vilOff.px) && fp(ryeOn.px) !== fp(ryeOff.px), '關掉時跟 R027 之前逐像素相同；亂數村莊開著關掉都一樣；Rye 開著不一樣', `${offFp}（原樣 ${ORIG_FP}）`);
}
{ // 3. 畫面只讀世界；場景物件數不變
  check(ryeOn.same && ryeOff.same && ryeOn.kids === ryeOff.kids, '畫面只讀世界；場景物件數不變', `${ryeOn.kids} / ${ryeOff.kids}`);
}
if (fails.length) { console.log(`NG streets：${fails.join('、')}`); process.exit(1); }
console.log('streets: all OK');
