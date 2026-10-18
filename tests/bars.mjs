// R009 血條守衛（Node，不開瀏覽器）：誰該有血條、長度與顏色、扣血白色殘影、建築耐久條、畫面只讀世界、閥關時不畫。
import { createWorld, hashWorld, UNIT_KINDS, UK_TANK, SIDE_PLAYER, SIDE_ENEMY, ORD_FIRE_AT } from '../src/sim/world.ts';
import { step, runLog } from '../src/sim/step.ts';
import { SCRIPT } from '../src/sim/script.ts';
import { BattleView } from '../src/render/battle.ts';

const fails = [];
function check(ok, name, detail = '') {
  console.log(`${ok ? 'OK' : 'NG'}  ${name}${detail ? '　— ' + detail : ''}`);
  if (!ok) fails.push(name);
}
const drawn = v => { const d = v.barDbg, out = []; for (let i = 0; i < d.n; i++) out.push({ id: d.id[i], frac: d.frac[i], ghost: d.ghost[i], r: d.r[i], g: d.g[i] }); return out; };
const mk = (r009 = true) => { const w = createWorld(1944), v = new BattleView(w, true, true, true, true, true, r009); return { w, v }; };
const tank = w => w.units.find(u => u.kind === UK_TANK && u.side === SIDE_PLAYER);
const MAX = UNIT_KINDS[UK_TANK].hp;

{ // 1. 誰有血條：滿血沒選＝沒有；選一台＝1 條；扣血後沒選也有；看不到的敵人沒有
  const { w, v } = mk(), t = tank(w);
  v.update(0, 1, new Set()); const none = drawn(v).length;
  v.update(0, 1.1, new Set([t.id])); const one = drawn(v).map(b => b.id);
  t.hp -= 30; v.update(0, 1.2, new Set()); const hurt = drawn(v).map(b => b.id);
  const foe = w.units.find(u => u.side === SIDE_ENEMY && u.kind === UK_TANK);
  foe.hp -= 30; v.update(0, 1.3, new Set()); const hidden = drawn(v).some(b => b.id === foe.id) || v.visibleUnit(foe);
  check(none === 0 && one.length === 1 && one[0] === t.id && hurt.length === 1 && hurt[0] === t.id && !hidden && v.bars.bg === 1,
    '滿血沒選取 0 條；選一台 1 條；扣血後沒選也畫；看不到的敵人不畫', `0：${none}；選取：${one}；扣血：${hurt}；看不到的敵人有畫 ${hidden}`);
  v.dispose();
}
{ // 2. 長度與血量成正比、顏色綠 → 黃 → 紅；扣血白色殘影 0.25 秒在新舊之間、0.6 秒等於新血量
  const { w, v } = mk(), t = tank(w), sel = new Set([t.id]);
  const at = (hp, time) => { t.hp = hp; v.update(0, time, sel); return drawn(v)[0]; };
  const full = at(MAX, 1), mid = at(Math.round(MAX / 2), 3), low = at(Math.round(MAX * 0.1), 5);
  const lenOk = Math.abs(full.frac - 1) < 0.02 && Math.abs(mid.frac - 0.5) < 0.02 && Math.abs(low.frac - 0.1) < 0.02;
  const colOk = full.g > full.r && low.r > low.g && mid.r > 0.5 && mid.g > 0.4;
  at(MAX, 10);                                  // 回滿（守衛直接改血量）
  const before = at(MAX, 11), hit = at(Math.round(MAX * 0.4), 11.0001);
  const g25 = at(Math.round(MAX * 0.4), 11.25), g60 = at(Math.round(MAX * 0.4), 11.6);
  const ghostOk = Math.abs(hit.ghost - before.frac) < 0.02 && g25.ghost > g25.frac + 0.05 && g25.ghost < before.frac - 0.05 && Math.abs(g60.ghost - g60.frac) < 1e-6;
  check(lenOk && colOk && ghostOk, '血條長度與血量成正比、顏色綠到紅；扣血白色殘影 0.25 秒在新舊之間、0.6 秒等於新血量',
    `長度 ${full.frac.toFixed(2)}/${mid.frac.toFixed(2)}/${low.frac.toFixed(2)}；綠 r${full.r.toFixed(2)} g${full.g.toFixed(2)}、紅 r${low.r.toFixed(2)} g${low.g.toFixed(2)}；殘影 ${hit.ghost.toFixed(2)} → ${g25.ghost.toFixed(2)} → ${g60.ghost.toFixed(2)}（新 ${g60.frac.toFixed(2)}）`);
  v.dispose();
}
{ // 3. 砲擊目標的建築：耐久條長度 = hp/maxHp；瓦礫不畫
  const { w, v } = mk(), t = tank(w), b = w.blds.find(x => x.w === 1 && x.d === 1);
  t.order = ORD_FIRE_AT; t.tx = b.x; t.tz = b.z; t.target = 0;
  b.hp = Math.round(b.maxHp * 0.6); v.update(0, 1, new Set());
  const bar = drawn(v).find(x => x.id === -b.id);
  b.hp = 0; v.update(0, 1.1, new Set());
  const gone = !drawn(v).some(x => x.id === -b.id);
  check(!!bar && Math.abs(bar.frac - b.maxHp * 0.6 / b.maxHp) < 0.02 && gone, '砲擊目標的建築畫耐久條（長度＝hp/maxHp）；倒成瓦礫就不畫', `#${b.id}：${bar?.frac.toFixed(2)}；瓦礫後還畫 ${!gone}`);
  v.dispose();
}
{ // 4. 畫面只讀世界（整場腳本戰鬥、全選我方）；?noR009 時 0 條
  const run = r009 => {
    const w = createWorld(1944), v = new BattleView(w, true, true, true, true, true, r009), sel = new Set(w.units.filter(u => u.side === SIDE_PLAYER).map(u => u.id));
    let i = 0, most = 0;
    while (w.tick < 1200) {
      const now = []; while (i < SCRIPT.length && SCRIPT[i].tick <= w.tick) { if (SCRIPT[i].tick === w.tick) now.push(SCRIPT[i].cmd); i++; }
      v.snapshot(); step(w, now); v.onEvents(w.events, w.tick / 20); v.update(0, w.tick / 20, sel);
      most = Math.max(most, v.bars.bg);
    }
    v.dispose();
    return { h: hashWorld(w), most };
  };
  const on = run(true), off = run(false), plain = hashWorld(runLog(createWorld(1944), SCRIPT, 1200));
  check(on.h === plain && off.h === plain && on.most > 0 && off.most === 0, '畫面只讀世界（整場、全選我方）；?noR009 時 0 條', `${on.h}／${off.h}／${plain}；最多 ${on.most} 條，閥關 ${off.most} 條`);
}

if (fails.length) { console.log(`NG bars：${fails.join('、')}`); process.exit(1); }
console.log('bars: all OK');
