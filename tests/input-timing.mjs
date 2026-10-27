// R037 手勢計時守衛：拖曳慣性的 80 毫秒、雙擊的 350 毫秒，量的是事件自己的時間戳（手指真的動、真的放的時刻），
// 不是程式處理到事件的時間。拿 main.ts 裡真的輸入處理程式（跟 tests/gestures.mjs 同一段）在 Node 跑，
// 假時鐘＝「處理當下的時間」，事件的 timeStamp＝手指的時間；兩個分開調，就能重現「畫面卡一下才處理到」（手機掉幀、CI 機器忙）。
// 加 --mutations：把生產程式改壞幾種，確認這支每一種都會紅。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createWorld, SIDE_PLAYER, SIDE_ENEMY, SUB, UK_TANK } from '../src/sim/world.ts';
import { routeBattleOrder } from '../src/ui/smoke.ts';
import { bombardCommand, bombardTarget } from '../src/ui/commandMenu.ts';

let main = fs.readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const gesturesSrc = fs.readFileSync(new URL('../src/ui/gestures.ts', import.meta.url), 'utf8');
const mutations = {
  // 事件時間整個不看：處理得晚就吃掉慣性與雙擊
  handlerTime: { group: 'late', from: 'e.timeStamp > 0 && V.r037 ? e.timeStamp : performance.now()', to: 'performance.now()' },
  // 放手只有慣性那一行改回處理時間
  releaseClock: { group: 'late', from: 't - dragV.t < 80', to: 'performance.now() - dragV.t < 80' },
  // 雙擊沒把放手的事件時間傳進去
  tapClock: { group: 'late', from: 'else tap(e.clientX, e.clientY, e.shiftKey, t);', to: 'else tap(e.clientX, e.clientY, e.shiftKey);' },
  // 時間窗被放寬：手指真的停了才放，也滑出去
  window: { group: 'finger', from: 't - dragV.t < 80', to: 't - dragV.t < 200' },
  // 滑過去的動畫改用事件時間起算（事件時間可能早於現在，鏡頭會跳）
  glideClock: { group: 'glide', from: 'u.z / SUB, performance.now() / 1000);', to: 'u.z / SUB, t / 1000);' },
  // 逃生閥失效
  valve: { group: 'valve', from: 'e.timeStamp > 0 && V.r037 ?', to: 'e.timeStamp > 0 ?' },
};
const mutant = process.argv.find(a => a.startsWith('--mutant='))?.slice(9);
if (mutant) { const m = mutations[mutant]; assert.ok(m, mutant); assert.ok(main.includes(m.from), `${mutant}: production anchor`); main = main.replace(m.from, m.to); }
const plain = stripTypeScriptTypes(main);
const { Gestures, inSelectionRect } = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(gesturesSrc)).toString('base64')}`);

function fakeClock() {
  let now = 0, next = 0; const timers = new Map();
  return {
    now: () => now, set: (fn, delay) => { const id = ++next; timers.set(id, { fn, at: now + delay }); return id; }, clear: id => timers.delete(id),
    to(t) { for (;;) { const due = [...timers].filter(([, x]) => x.at <= t).sort((a, b) => a[1].at - b[1].at)[0]; if (!due) break; now = due[1].at; timers.delete(due[0]); due[1].fn(); } now = t; },
  };
}
// 跟遊戲一樣的輸入處理段（gestures 開著），r037 可以切
function fixture(r037 = true) {
  const clock = fakeClock(), canvasEvents = new Map(), flings = [], glides = [], issued = [];
  const canvas = { addEventListener: (t, f) => canvasEvents.set(t, f), setPointerCapture() {} };
  const view = { target: { x: 16, z: 16 }, zoom: 1, visibleUnit: () => true, unitHeight: () => 0,
    screenOf: (x, y, z) => [x * 10, z * 10 - y * 10], groundAt: (x, y) => ({ x: x / 10, z: y / 10 }), buildingAt: () => null,
    pan: (x, y) => { view.target.x += x / 10; view.target.z += y / 10; }, zoomAt() {}, zoomBy() {}, setMarker() {}, dispose() {}, setWorld() {} };
  let menuOpen = false;
  const c = vm.createContext({
    V: { r109: true, r012: true, r037 }, Gestures: class extends Gestures { constructor(a) { super(a, clock); } }, inSelectionRect,
    commandMenu: undefined, battleHint: undefined,
    document: { createElement: () => ({ id: '', hidden: false, style: {} }), body: { appendChild() {} }, addEventListener() {} },
    addEventListener() {}, canvas, performance: { now: clock.now },
    view, w: createWorld(1944), selected: new Set(), phase: 'battle', fireMode: false, ammo: 'he', paused: false,
    battleAudio: undefined, syncBattleAudio() {}, hud: { update() {} }, prodBar: { update() {} },
    help: { visible: () => false }, reportView: { visible: () => false, hide() {} },
    fling: { stop() {}, start: (...a) => flings.push(a) }, glide: { stop() {}, start: (...a) => glides.push(a) },
    dragV: { vx: 0, vy: 0, t: 0 }, lastTap: { id: 0, t: -1e9 },
    innerWidth: 412, innerHeight: 860, SIDE_PLAYER, SIDE_ENEMY, SUB, routeBattleOrder, bombardCommand, bombardTarget,
    issue: cmd => issued.push(cmd), simT: () => 0, planner: { placeAt() {} },
    initCommandMenu: () => ({ open() { menuOpen = true; }, close() { menuOpen = false; }, isOpen: () => menuOpen, contains: () => false }),
  });
  vm.runInContext(plain.slice(plain.indexOf('const pointers ='), plain.indexOf('\nreset();')), c);
  // at＝程式處理到事件的時間（假時鐘）；ts＝事件自己的時間戳（undefined＝沒有時間戳的假事件）
  const send = (name, at, x, y, ts) => { clock.to(at); const e = { pointerId: 1, pointerType: 'touch', button: 0, shiftKey: false, clientX: x, clientY: y, ...(ts === undefined ? {} : { timeStamp: ts }) }; canvasEvents.get(name)?.(e); if (name === 'pointerup') canvasEvents.get('lostpointercapture')?.(e); };
  const tank = c.w.units.find(u => u.side === SIDE_PLAYER && u.kind === UK_TANK), [tx, ty] = view.screenOf(tank.x / SUB, 0.15, tank.z / SUB);
  return { c, clock, send, flings, glides, issued, tank, tx, ty, menu: () => menuOpen };
}
// 往上拖 20 像素：按下、移一次、放手。handled＝三個事件各自被處理到的時間，finger＝事件時間戳
function drag(f, handled, finger) {
  f.send('pointerdown', handled[0], 200, 620, finger?.[0]);
  f.send('pointermove', handled[1], 200, 600, finger?.[1]);
  f.send('pointerup', handled[2], 200, 600, finger?.[2]);
}
// 點同一台坦克兩下：按下／放手各兩次
function doubleTap(f, handled, finger) {
  const names = ['pointerdown', 'pointerup', 'pointerdown', 'pointerup'];
  names.forEach((n, i) => f.send(n, handled[i], f.tx, f.ty, finger?.[i]));
}

const groups = {
  late() {
    // 手指：0 按、16 移、24 放（放手時還在動）；程式：處理到移動晚了 100、處理到放手又晚了 100（畫面卡住）
    const on = fixture(true); drag(on, [1000, 1100, 1200], [1000, 1016, 1024]);
    assert.equal(on.flings.length, 1, '畫面卡住才處理到放手：照樣滑出去');
    assert.ok(Math.abs(on.flings[0][1] + 400) < 1e-6 && on.flings[0][0] === 0, `初速用手指時間算（20 像素／16 毫秒，平滑後 −400）：${JSON.stringify(on.flings[0])}`);
    const off = fixture(false); drag(off, [1000, 1100, 1200], [1000, 1016, 1024]);
    assert.equal(off.flings.length, 0, '?noR037=1：回到處理時間，100 毫秒才處理到放手＝不滑（舊行為）');
    // 雙擊：手指 0／60／180／240（兩次放手相隔 180）；程式處理第二次晚到 500、560（兩次放手相隔 500）
    const d = fixture(true); doubleTap(d, [1000, 1060, 1500, 1560], [1000, 1060, 1180, 1240]);
    assert.deepEqual([...d.c.selected], [d.tank.id]); assert.equal(d.glides.length, 1, '畫面卡住才處理到第二下：照樣算雙擊、鏡頭跟過去');
    const dOff = fixture(false); doubleTap(dOff, [1000, 1060, 1500, 1560], [1000, 1060, 1180, 1240]);
    assert.deepEqual([...dOff.c.selected], [dOff.tank.id]); assert.equal(dOff.glides.length, 0, '?noR037=1：處理時間相隔 500＝不算雙擊（舊行為）');
  },
  finger() {
    // 手指真的停了才放（最後一次移動到放手 80 毫秒）：不滑；79 毫秒：滑。處理時間故意很準時，確認看的是手指時間
    for (const [gap, n] of [[79, 1], [80, 0]]) { const f = fixture(true); drag(f, [1000, 1016, 1016 + gap], [1000, 1016, 1016 + gap]); assert.equal(f.flings.length, n, `手指停 ${gap} 毫秒才放：${n ? '滑' : '不滑'}`); }
    // 處理得很準時、但手指時間顯示停了 100 毫秒才放：不滑（不會因為處理得快就亂滑）
    const f = fixture(true); drag(f, [1000, 1016, 1030], [1000, 1016, 1116]); assert.equal(f.flings.length, 0, '手指停了 100 毫秒才放：不滑');
    // 雙擊：兩次放手相隔 349 算、350 不算（手指時間）；處理時間故意都很準時
    for (const [gap, n] of [[349, 1], [350, 0]]) { const t = fixture(true); doubleTap(t, [1000, 1060, 1000 + gap, 1060 + gap], [1000, 1060, 1000 + gap, 1060 + gap]); assert.equal(t.glides.length, n, `兩次放手相隔 ${gap}：${n ? '算雙擊' : '不算'}`); }
    // 處理得很快、但手指其實隔了 400：不算雙擊
    const s = fixture(true); doubleTap(s, [1000, 1060, 1100, 1160], [1000, 1060, 1400, 1460]); assert.equal(s.glides.length, 0, '手指隔 400 毫秒才點第二下：不算雙擊');
  },
  glide() {
    // 鏡頭滑過去的動畫照樣從「現在」（處理當下）起算，不從事件時間起算，不然會一開始就跳一段
    const d = fixture(true); doubleTap(d, [1000, 1060, 1500, 1560], [1000, 1060, 1180, 1240]);
    assert.equal(d.glides.length, 1); assert.equal(d.glides[0][4], 1.56, `動畫起點＝處理當下 1.56 秒：${d.glides[0][4]}`);
  },
  fallback() {
    // 沒有時間戳的假事件（舊的 Node 守衛）：退回處理當下的時間，跟 ?noR037=1 一樣；r037 根本不會被讀到
    const f = fixture(true); drag(f, [1000, 1100, 1200], [undefined, undefined, undefined]); assert.equal(f.flings.length, 0, '沒有時間戳：照處理時間，不滑');
    const g = fixture(true); drag(g, [1000, 1016, 1030], [undefined, undefined, undefined]); assert.equal(g.flings.length, 1, '沒有時間戳、處理準時：滑');
    const c = fixture(true); delete c.c.V.r037; doubleTap(c, [1000, 1060, 1180, 1240], [undefined, undefined, undefined, undefined]); assert.equal(c.glides.length, 1, '沒有時間戳：照處理時間算雙擊，不需要 r037');
  },
  valve() {
    assert.match(fs.readFileSync(new URL('../src/valves.ts', import.meta.url), 'utf8'), /get r037\(\) \{ return on\('037'\); \}/, '逃生閥 ?noR037=1（R060 閥表）');
    assert.match(main, /e\.timeStamp > 0 && V\.r037 \?/, '輸入時間讀閥表的 R037');
    // 閥關著時，就算事件有時間戳也照處理時間（上面 late 已經測了慣性與雙擊）；閥開著，準時處理的結果跟關著一樣
    for (const r037 of [true, false]) { const f = fixture(r037); drag(f, [1000, 1016, 1024], [1000, 1016, 1024]); assert.equal(f.flings.length, 1, `處理準時：開關 ${r037} 都滑`); }
    const off = fixture(false); drag(off, [1000, 1100, 1200], [1000, 1016, 1024]); assert.equal(off.flings.length, 0, '?noR037=1 不看事件時間');
  },
};
for (const [name, test] of Object.entries(groups)) {
  if (mutant && mutations[mutant].group !== name) continue;
  try { test(); console.log(`OK input-timing: ${name}`); } catch (e) { console.error(`NG input-timing: ${name}`); throw e; }
}
if (process.argv.includes('--mutations')) for (const [name, m] of Object.entries(mutations)) {
  const p = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--mutant=${name}`], { encoding: 'utf8' });
  assert.equal(p.status, 1, `${name}: 改壞的生產程式要紅\n${p.stdout}\n${p.stderr}`);
  assert.ok(p.stderr.includes(`NG input-timing: ${m.group}`), `${name}: 紅在預期的那一組\n${p.stdout}\n${p.stderr}`);
  assert.ok(p.stderr.includes('AssertionError'), `${name}: 紅的是斷言，不是載入錯誤\n${p.stderr}`);
  console.log(`OK input-timing 改壞：${name} → 紅在 ${m.group}`);
}
console.log('input-timing: all OK（假時鐘＋真的輸入處理程式；真 Chrome 的部分在 smoke）');
