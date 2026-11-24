// R089 瀏覽器守衛共用的夾具（只在測試的建置裡）：tests/section89-browser.mjs、tests/section89-shots-browser.mjs。
// 夾具直接在世界裡放步兵班、扣血、擺鏡頭——只為了量畫面與拍照，不是玩法；正式的入口與產物沒有這些掛勾。
import path from 'node:path';

export const fixture89 = root => ({ name: 'r089-fixture', enforce: 'pre', transform(code, id) {
  if (path.relative(root, id.split('?')[0]).replaceAll('\\', '/') !== 'src/main.ts') return;
  return code + `
import { air93Armed as __air93Armed } from './ui/air93.ts';   // R1004：守衛讀空中鍵、建造模式的武裝狀態（暫停中提示列不一定刷新）
import { armed50 as __armed50 } from './ui/tech50.ts';
window.__r089 = (() => {
  const key = (x, z) => x + ',' + z;
  const taken = () => new Set(w.units.filter(u => u.alive).map(u => key(Math.floor(u.x / 256), Math.floor(u.z / 256))));
  const free = (t, x, z) => x >= 0 && z >= 0 && x < w.n && z < w.n && !w.occ[z * w.n + x] && !t.has(key(x, z));
  const put = (t, side, x, z, extra) => {
    const d = side ? 256 : -256, id = w.units.length + 1;
    w.units.push({ id, side, kind: 3, x: x * 256 + 128, z: z * 256 + 128, hp: 60, alive: true, order: 0, target: 0, tx: 0, tz: 0, path: [], pathIdx: 0, cooldown: 1e9, aimX: d, aimZ: d, ...extra });
    t.add(key(x, z)); return id;
  };
  const spawned = ids => view.onEvents(ids.map(id => ({ e: 'spawn', unit: id })), view.lastT ?? 0);
  return {
    cam: (x, z, zoom) => { paused = true; view.target.set(x, 0, z); view.zoomBy(zoom / view.zoom); },
    clean: () => document.querySelectorAll('#start-order,#start-banner').forEach(e => e.remove()),
    // 每邊 per 個班擺在 (cx, cz) 附近的空格（我方在南、敵方在北、各 20 格寬）；fight＝會開火（不然 cooldown 擋著只量畫面）；sides＝1 只放我方；霧關掉＝最壞的情況
    crowd: (per, cx, cz, fight, sides = 2, tanks = 0, teams91 = 0, cars92 = 0) => {   // tanks（R095）：每邊有幾個是坦克（放在最後）；teams91（R091）：每邊再多幾組狙擊手、反戰車小組；cars92（R092）：每邊再多幾台車（前 3 台卡車各載一班，其餘半履帶車）（預設 0＝跟以前一樣）
      paused = true; view.fogOn = false;
      const t = taken(), ids = [];
      for (const side of sides === 2 ? [0, 1] : [0]) for (let r = 0, n = 0; n < per && r < 8000; r++) {
        const row = Math.floor(r / 20), x = cx - 10 + (r % 20), z = side ? cz - 2 - row : cz + 2 + row;
        if (free(t, x, z)) { ids.push(put(t, side, x, z, { ...(fight ? { cooldown: 0 } : {}), ...(n >= per - tanks ? { kind: 0, hp: 100, hullX: side ? 256 : -256, hullZ: side ? 256 : -256 } : {}) })); n++; }
      }
      for (const side of sides === 2 ? [0, 1] : [0]) for (let r = 0, n = 0; n < teams91 && r < 8000; r++) {   // R091
        const row = Math.floor(r / 20), x = cx - 10 + (r % 20), z = side ? cz - 2 - row : cz + 2 + row, kind = n % 2 ? 43 : 42;
        if (free(t, x, z)) { ids.push(put(t, side, x, z, { kind, hp: kind === 42 ? 20 : 30, ...(fight ? { cooldown: 0 } : {}) })); n++; }
      }
      for (const side of sides === 2 ? [0, 1] : [0]) {   // R092
        const mine = w.units.filter(u => u.alive && u.side === side && u.kind === 3 && !u.ride);
        for (let r = 0, n = 0; n < cars92 && r < 8000; r++) {
          const row = Math.floor(r / 20), x = cx - 10 + (r % 20), z = side ? cz - 12 - row : cz + 12 + row, kind = n < 3 ? 44 : 45;
          if (!free(t, x, z)) continue;
          const id = put(t, side, x, z, { kind, hp: kind === 44 ? 40 : 70, ...(kind === 45 ? { hullX: side ? 256 : -256, hullZ: side ? 256 : -256 } : {}) }); ids.push(id); n++;
          const rider = kind === 44 ? mine.shift() : null; if (rider) { rider.ride = id; rider.x = x * 256 + 128; rider.z = z * 256 + 128; }
        }
      }
      spawned(ids); return ids.length;
    },
    // R092：在 (cx, cz) 附近第一個空格放一個 kind，回傳 id；ride(id)＝坐在哪一台車上（0＝沒有）
    place: (side, kind, cx, cz) => { const t = taken(); for (let r = 0; r < 12; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) if (Math.max(Math.abs(dx), Math.abs(dz)) === r && free(t, cx + dx, cz + dz)) { const id = put(t, side, cx + dx, cz + dz, { kind, hp: UNIT_KINDS[kind].hp, cooldown: 0 }); spawned([id]); return id; } return 0; },
    ride: id => w.units[id - 1]?.ride ?? 0,
    sky93: list => { w.sky = { version: 1, next: list.length + 1, ready: [0, 0, 0, 0], planes: list.map((p, i) => ({ id: i + 1, ...p })) }; return list.length; },   // R093：直接把飛機放進天上（量預算、拍照用）
    hp: (id, hp) => { w.units[id - 1].hp = hp; },   // R091：把一個單位的血設成 hp（量少一個人的畫法）
    bld50: (side, kind, x, z, hp) => { const id = w.blds.length + 1, maxHp = kind === 14 ? 500 : kind === 15 ? 600 : 400; w.blds.push({ id, kind, x, z, w: 2, d: 2, floors: 1, hp: hp || maxHp, maxHp, builtBy: side }); for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) w.occ[(z + dz) * w.n + x + dx] = id; view.onEvents([{ e: 'build', bld: id }], view.lastT || 0); return id; },   // R050：直接擺一棟兵營、車廠或補給站（量預算、拍照用；hp 給 1 就是工地的樣子）
    bags: () => JSON.parse(JSON.stringify(w.bags ?? null)),   // R1007：沙包清單
    bag1007: list => { const g = (w.bags ??= { version: 1, segments: [] }).segments; for (const [side, x, z, hp, left] of list) g.push({ id: g.length + 1, kind: 17, x, z, w: 1, d: 1, floors: 1, hp, maxHp: 120, builtBy: side, left }); view.onEvents([{ e: 'wire' }], view.lastT || 0); return g.length; },   // R1007：直接擺沙包 [方, x, z, 血, 還差的工作量]（量預算、拍照用）；送一個 wire 事件，城鎮網格才會重建
    bagsOff: () => { window.__bags1007 = w.bags; delete w.bags; view.onEvents([{ e: 'wire' }], view.lastT || 0); return view.townTriangles; },   // R1007：暫時把沙包拿掉、城鎮網格重建（量沙包佔幾個三角形；暫停中用，之後一定要 bagsOn）
    bagsOn: () => { if (window.__bags1007) w.bags = window.__bags1007; view.onEvents([{ e: 'wire' }], view.lastT || 0); return view.townTriangles; },
    programs: () => renderer.info.programs ? renderer.info.programs.length : -1,   // R1003：已經編過的著色程式有幾個（R093 補驗：飛機上天不該多編）
    hqDown: side => { const b = w.blds[w.eco.hq[side] - 1]; b.hp = 0; },
    armed: () => [__air93Armed(), __armed50()],   // R1004：[空中鍵（0 沒選、1 轟炸、2 偵察）, 建造（0 或建築種類）]   // R1003：讓這一方的指揮部倒下（下一步分出勝負）
    hurt: dhp => { for (const u of w.units) if (u.kind === 3 && u.alive) u.hp = Math.max(1, u.hp - dhp); },
    count: () => w.units.filter(u => u.kind === 3 && u.alive).length,
    // 處理器時間：在頁面裡直接叫 view.update n 次（同一個模擬時間），回平均毫秒
    bench: n => { const t0 = performance.now(); for (let i = 0; i < n; i++) view.update(1, view.lastT, selected); return (performance.now() - t0) / n; },
    // 近拍：一棟住宅的屋頂上一班、旁邊停下的一班、行進的一班、趴下的一班（士氣第二版、釘住；只為了拍照）
    states: () => {
      paused = true; view.fogOn = false;
      w.rules = { ...(w.rules ?? {}), morale: 2 };
      const c = w.n / 2, b = w.blds.filter(b => b.hp > 0 && b.kind === 0 && b.w === 1 && b.d === 1).sort((a, e) => Math.hypot(a.x - c, a.z - c) - Math.hypot(e.x - c, e.z - c) || a.id - e.id)[0];
      // 拍得到：那一格沒有樹，鏡頭那一側（x、z 大的那邊）兩格內沒有房子擋著
      const occ = (x, z) => x >= 0 && z >= 0 && x < w.n && z < w.n && (!!w.occ[z * w.n + x] || !!w.vegetation?.cells[z * w.n + x]);
      const clear = (x, z) => !w.vegetation?.cells[z * w.n + x] && ![[1, 0], [0, 1], [1, 1], [2, 1], [1, 2], [2, 2], [2, 0], [0, 2]].some(([dx, dz]) => occ(x + dx, z + dz));
      const t = taken(), near = (x0, z0) => { for (let r = 0; r < 14; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) if (Math.max(Math.abs(dx), Math.abs(dz)) === r && free(t, x0 + dx, z0 + dz) && clear(x0 + dx, z0 + dz)) return [x0 + dx, z0 + dz]; return [x0, z0]; };
      const out = {}, ids = [];
      ids.push(put(t, 0, b.x, b.z, {}));
      const k = view.unitHeight(w.units[w.units.length - 1]) * 1.2247;   // 屋頂上的點在畫面上＝往遠處退 高 × cot30°／√2 的地面點：鏡頭對準那裡
      out.roof = [b.x + 0.5 - k, b.z + 0.5 - k];
      let p = near(b.x + 3, b.z); ids.push(put(t, 0, p[0], p[1], {})); out.halt = [p[0] + 0.5, p[1] + 0.5];
      p = near(b.x + 3, b.z + 3); ids.push(put(t, 0, p[0], p[1], { path: [p[1] * w.n + Math.min(w.n - 1, p[0] + 6)], pathIdx: 0 })); out.move = [p[0] + 0.5, p[1] + 0.5];
      p = near(b.x, b.z + 3); ids.push(put(t, 0, p[0], p[1], { sup: 70 })); out.prone = [p[0] + 0.5, p[1] + 0.5];
      spawned(ids); return out;
    },
  };
})();
`;
} });

// 量一個情況：鏡頭、等幾幀、讀 info() 與 men()
export const measure = async (E, frames) => { await frames(); const info = await E('__rts.info()'), men = await E('__rts.men()'); return { calls: info.calls, triangles: info.triangles, men }; };

// 五個開頁（萊伊開局與 smoke 的步兵特寫同一頁）：每一個回傳 [名字, 量到的]；on＝R089 開著
export async function cases(open, E, frames, on) {
  const q = s => `${s}seed=1944&noR100=1&noR089=${on ? 0 : 1}`, out = [];
  // 萊伊開局；smoke 的「步兵特寫（開戰 30 秒）」：分段跑 600 步、中間畫幀，鏡頭對著我方第一個活著的班、zoom 2.6
  await open(q('')); await E('__rts.pause(true)'); out.push(['rye-opening', await measure(E, frames)]);
  await E('__rts.startBattle(); __rts.pause(true); 0');
  for (let k = 0; k < 20; k++) { await E('__rts.stepN(30)'); await frames(); }
  const us = await E('__rts.units()'), inf = us.find(u => u.side === 0 && u.kind === 3 && u.alive) ?? us.find(u => u.side === 0 && u.kind === 3);
  await E(`__rts.focus(${inf.x / 256}, ${inf.z / 256}, 2.6); 0`); out.push(['smoke-infantry', await measure(E, frames)]);
  // 假局 A：村莊（32 格）每邊 16 個班，會開火，跑 200 步
  await open(q('map=village&')); await E('__rts.startBattle(); __rts.pause(true); 0');
  await E('__r089.crowd(16, 16, 16, true); __r089.cam(16, 16, 1)');
  for (let k = 0; k < 10; k++) { await E('__rts.stepN(20)'); await frames(); }
  out.push(['A-village-16', await measure(E, frames)]);
  // 假局 B：64 圖每邊 40 個班、扣四次血（每次 6 點，中間畫幀）→ 躺下 300 個人；zoom 1 與 0.55
  await open(q('map=64&')); await E('__rts.startBattle(); __rts.pause(true); 0');
  await E('__r089.crowd(40, 32, 32, false); __r089.cam(32, 32, 1)'); await frames();
  for (let k = 0; k < 4; k++) { await E('__r089.hurt(6)'); await frames(); }
  out.push(['B-64-40-z1', await measure(E, frames)]);
  await E('__r089.cam(32, 32, 0.55)'); out.push(['B-64-40-z055', await measure(E, frames)]);
  // 96 圖每邊 40 個班，zoom 0.55
  await open(q('map=96&')); await E('__rts.startBattle(); __rts.pause(true); 0');
  await E('__r089.crowd(40, 48, 48, false); __r089.cam(48, 48, 0.55)'); out.push(['m96-40-z055', await measure(E, frames)]);
  // 喪屍壓力：萊伊喪屍模式、我方加 40 個班，分段跑 900 步，取三角形最多的那一刻
  await open(q('mode=zombies&')); await E('__rts.startBattle(); __rts.pause(true); 0');
  await E('__r089.crowd(40, 16, 16, true, 1); __r089.cam(16, 16, 1)');
  let worst = null;
  for (let k = 0; k < 9; k++) { await E('__rts.stepN(100)'); const m = await measure(E, frames); if (!worst || m.triangles > worst.triangles) worst = m; }
  out.push(['zombies-40', worst]);
  return out;
}
