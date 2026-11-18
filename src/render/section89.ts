// R089 更大規模的步兵（畫面）：一班畫成十個人——行進兩路縱隊、停下兩列、趴下散兵線、屋頂上縮小；
// 看不到的不畫；人多時整個小兵網格自動降級（完整＋陰影 → 完整 → 密集），守住手機預算。
// 只讀世界、不改世界、不用亂數；狀態只跟著畫面的更新走（同一串更新得到同一份實例）。開關照 R086–R088：模組的 setter，預設關。
import * as THREE from 'three';
import { SUB, cellIdx, inGrid, UNIT_KINDS, UK_INFANTRY, UK_MG, UK_MORTAR, UK_ZOMBIE, moraleState, MORALE_PINNED, type Unit, type World } from '../sim/world.ts';
import { SIDE_PLAYER } from '../side.ts';
import { soldier } from './unitArt.ts';

let on89 = false;
export function setSection89(on: boolean): void { on89 = on; }
export const section89On = (): boolean => on89;
// R096 T3：畫面上想畫的人超過 LIVE96 時每班少畫幾個（最少 MIN96 個），班的人寫到「LIVE96 − 喪屍與砲手」就停；?noR096=1 關掉（回到 R089）
let on96 = false;
export function setCrowd96(on: boolean): void { on96 = on; }
export const LIVE96 = 800, MIN96 = 3;

export const SECTION_MEN = 10;          // 1940 年英軍的步兵班、德軍的 Gruppe 都是十人上下
export const MEN_TRIS89 = 32_000;       // 小兵網格的預算（照 info() 數：本體＋陰影那一趟）
export const BLEND89 = 0.4;             // 換隊形幾秒（模擬時間）
export const TURN89 = 4;                // 隊形最快轉多少（弧度／秒）
export const MARGIN89 = 1.5;            // 畫面外還畫幾格
export const BACK89 = 60;               // 回到比較好的段要連續幾幀（約 1 秒；用幀不用模擬時間：暫停時也回得來）
// 跟 battle.ts 一樣的數（tests/section89.mjs 對照）：鏡頭上下各看幾格、仰角；趴下的姿勢
export const HALF_H89 = 9, ELEV89 = Math.PI / 6, PRONE_TILT89 = -1.45, PRONE_LIFT89 = 0.03;
const SIN_E = Math.sin(ELEV89), COS_E = Math.cos(ELEV89);

// 隊形表：[x 前進方向, z 右手邊]（格）。號碼 0 班長、1 布倫機槍手、2 副射手、3 副班長、4–9 步槍兵；少人從號碼大的先少
type Lay = [number, number][];
const MOVE: Lay = [[0, 0.07], [0.24, 0.07], [0.12, 0.07], [0, -0.07], [-0.12, 0.07], [-0.24, 0.07], [0.24, -0.07], [0.12, -0.07], [-0.12, -0.07], [-0.24, -0.07]];
// 停下、趴下＝行進轉 90°（右路→前列、最前→最左：換隊形時每個人走直線、不互相穿過）；前列往左錯、後列往右錯
const line = (rank: number, file: number, stag: number): Lay => MOVE.map(([x, z]): [number, number] => z > 0 ? [rank, -x * file / 0.12 - stag] : [-rank, -x * file / 0.12 + stag]);
const HALT = line(0.07, 0.13, 0.0325), PRONE = line(0.15, 0.12, 0.03);
const scaled = (l: Lay, s: number): Lay => l.map(([x, z]): [number, number] => [x * s, z * s]);
export const L_MOVE = 0, L_HALT = 1, L_PRONE = 2, L_ROOF = 3, L_ROOF_PRONE = 4;
// 屋頂上：站著的整個縮 0.75；趴著的只縮橫向（躺著的人長 0.30，前後兩列不能再近）
export const LAYOUTS89: readonly Lay[] = [MOVE, HALT, PRONE, scaled(HALT, 0.75), PRONE.map(([x, z]): [number, number] => [x, z * 0.75])];
// 哪一種單位畫成大班（R091 加新的步兵種類只加這張表）
export const CROWD89: Record<number, { men: number; lay: readonly Lay[] }> = { [UK_INFANTRY]: { men: SECTION_MEN, lay: LAYOUTS89 } };

// BattleView 裡這個模組要讀寫的東西（BattleView 用 `this as never` 交過來；改名的話 tests/section89.mjs 會紅）
export interface Host89 {
  w: World; men: THREE.InstancedMesh; menNormal: THREE.BufferGeometry; menDense: THREE.BufferGeometry | null;
  bodies: { n: number; next: number; x: Float32Array; z: Float32Array; y: Float32Array; yaw: Float32Array; side: Uint8Array };
  zombieBodies: Uint8Array; bodyBorn: Float32Array; lastT: number; yaw: Float64Array;
  menDbg: { alive: number; prone: number; crew: number };
  target: THREE.Vector3; zoom: number; cam: THREE.OrthographicCamera;
  unitHeight(u: Unit): number; visibleAt(x: number, z: number): boolean; visibleUnit(u: Unit): boolean;
}

// Ry(yaw)·Rz(tilt)·縮放，跟 Object3D 的 rotation.set(0, yaw, tilt)（XYZ）、scale.set(sx, sy, sz) 一樣，直接寫進實例矩陣
export function put89(a: Float32Array | number[], n: number, x: number, y: number, z: number, yaw: number, tilt: number, sx: number, sy: number, sz: number): void {
  const ca = Math.cos(yaw), sa = Math.sin(yaw), ct = Math.cos(tilt), st = Math.sin(tilt), o = n * 16;
  a[o] = ca * ct * sx; a[o + 1] = st * sx; a[o + 2] = -sa * ct * sx; a[o + 3] = 0;
  a[o + 4] = -ca * st * sy; a[o + 5] = ct * sy; a[o + 6] = sa * st * sy; a[o + 7] = 0;
  a[o + 8] = sa * sz; a[o + 9] = 0; a[o + 10] = ca * sz; a[o + 11] = 0;
  a[o + 12] = x; a[o + 13] = y; a[o + 14] = z; a[o + 15] = 1;
}

const UNSET = 255, SNAP = 254;   // SNAP：換隊形時還在混，起點是那一刻混到一半的位置（存在 snap）
const ease = (k: number) => k >= 1 || k < 0 ? 1 : k * k * (3 - 2 * k);   // 時間倒退（換世界）當作已經換好

export class Section89 {
  // 每個單位 id 一格，用到才長（每張圖都不會越界）
  private last = new Int8Array(0); private lay = new Uint8Array(0); private from = new Uint8Array(0);
  private t0 = new Float64Array(0); private ori = new Float32Array(0); private oriT = new Float64Array(0);   // 時間用 Float64：Float32 存的時間常比真的大一點點，換隊形的第一幀會先跳到終點
  private snap = new Float32Array(0); private show = new Uint8Array(0);
  private tier = -1; private okFrames = 0; private tris0 = 0; private tris2 = 0;
  private live = 0; private culled = 0; private drawn = 0;
  // R096 T3：每一幀第一個班要畫之前先數一遍這一幀的（不是上一幀的：鏡頭一跳、拉遠也不會有一幀少掉整班）——
  // 畫面上的班各想畫幾個人（照人數分堆）、喪屍與砲手總共幾個；每班最多畫 cap96 個（降馬上降、升要連續 BACK89 幀），班的人最多寫 secBudget 個
  private pre = false; private hist = new Int32Array(SECTION_MEN + 1); private want = 0; private others = 0;
  private cap96 = SECTION_MEN; private ok96 = 0; private secBudget = Infinity; private secDrawn = 0;
  private px = 0; private pz = 0;
  dbg = { live: 0, bodies: 0, culled: 0, F: 0, tier: 0, tris: 0, want: 0, others: 0, cap: SECTION_MEN };
  private readonly host: Host89;
  constructor(host: Host89) { this.host = host; }

  has(kind: number): boolean { return on89 && !!CROWD89[kind]; }

  private grow(id: number) {
    if (id < this.last.length) return;
    const size = Math.max(64, id + 1, this.last.length * 2);
    const g = <T extends Int8Array | Uint8Array | Float32Array | Float64Array>(a: T, fill: number, k = 1): T => { const b = new (a.constructor as { new(n: number): T })(size * k); b.fill(fill); b.set(a); return b; };
    this.last = g(this.last, -1); this.lay = g(this.lay, UNSET); this.from = g(this.from, UNSET);
    this.t0 = g(this.t0, 0); this.ori = g(this.ori, 0); this.oriT = g(this.oriT, 0); this.snap = g(this.snap, 0, 2 * SECTION_MEN);
  }

  // 第 i 個人在班的本地座標（兩個隊形之間照 s 混）→ 世界座標（格），落在別棟房子或牆的格子裡就往中心拉（最多 3 步、每步 0.1）
  private place(lay: readonly Lay[], id: number, i: number, s: number, x: number, z: number, c: number, sn: number, own: number, ground: boolean) {
    const B = lay[this.lay[id]][i], f = this.from[id], o = (id * SECTION_MEN + i) * 2;
    const ax = f === SNAP ? this.snap[o] : lay[f][i][0], az = f === SNAP ? this.snap[o + 1] : lay[f][i][1];
    const lx = ax + (B[0] - ax) * s, lz = az + (B[1] - az) * s;
    let fx = x + lx * c + lz * sn, fz = z - lx * sn + lz * c;
    const w = this.host.w;
    for (let k = 0; ground && k < 3; k++) {
      const cx = Math.floor(fx), cz = Math.floor(fz);
      if (!inGrid(w, cx, cz)) break;
      const b = w.occ[cellIdx(w, cx, cz)];
      if (!b || b === own || w.blds[b - 1].hp <= 0) break;
      const dx = x - fx, dz = z - fz, d = Math.hypot(dx, dz);
      if (d < 1e-6) break;
      const f = Math.min(1, 0.1 / d); fx += dx * f; fz += dz * f;
    }
    this.px = fx; this.pz = fz;
  }

  // 畫面範圍（鏡頭自己的軸：右＝(1,0,−1)/√2、上＝(−sinE, √2·cosE, −sinE)/√2），外面再加 MARGIN89 格。
  // 寬高比照視窗（main.ts 的 render 也是用視窗的寬高排鏡頭）；鏡頭要到 render() 才排，剛建好的畫面、剛換大小的視窗不能用鏡頭上一次的寬高。沒有視窗（Node）才用鏡頭的
  onScreen(x: number, y: number, z: number): boolean {
    const H = this.host, hh = HALF_H89 / H.zoom, g = globalThis as { innerWidth?: number; innerHeight?: number };
    const aspect = g.innerWidth && g.innerHeight ? g.innerWidth / g.innerHeight : H.cam.top > 0 ? H.cam.right / H.cam.top : 1;
    const rx = x - H.target.x, ry = y - H.target.y, rz = z - H.target.z;
    const sx = (rx - rz) * Math.SQRT1_2, sy = (Math.SQRT2 * COS_E * ry - SIN_E * (rx + rz)) * Math.SQRT1_2;
    return Math.abs(sx) <= hh * aspect + MARGIN89 && Math.abs(sy) <= hh + MARGIN89;
  }

  // 一個班：人數、少了的人躺下（畫面外也記）、隊形、方向；畫面外的不寫實例
  draw(u: Unit, x: number, z: number, t: number, col: THREE.Color, n: number): number {
    const H = this.host, w = H.w, crowd = CROWD89[u.kind], k = UNIT_KINDS[u.kind], id = u.id;
    this.grow(id);
    const men = u.alive ? Math.min(crowd.men, Math.ceil((u.hp * crowd.men) / k.hp)) : 0;
    const y = H.unitHeight(u), moving = u.pathIdx < u.path.length, aim = Math.atan2(-u.aimZ, u.aimX), heading = Number.isFinite(H.yaw[id]) ? H.yaw[id] : aim;
    const prone = !u.rout && w.rules?.morale === 2 && moraleState(u) >= MORALE_PINNED;   // 跟 R075 同一條規則
    const want = y > 0 ? (prone ? L_ROOF_PRONE : L_ROOF) : prone ? L_PRONE : moving ? L_MOVE : L_HALT;
    // 隊形的方向：走的時候（沒趴下）跟著路；停下、趴下時轉向瞄準的方向（人也朝那裡）。最快 TURN89 弧度／秒
    const goal = moving && !prone ? heading : aim;
    if (this.lay[id] === UNSET) {   // 第一次看到：直接就位；走著的照下一格的方向（讀回存檔時 yaw 還是瞄準的方向）
      const next = moving ? u.path[u.pathIdx] : -1, nx = next >= 0 ? (next % w.n) + 0.5 : x, nz = next >= 0 ? Math.floor(next / w.n) + 0.5 : z;
      this.lay[id] = this.from[id] = want; this.t0[id] = t - BLEND89; this.oriT[id] = t;
      this.ori[id] = moving && !prone && (nx !== x || nz !== z) ? Math.atan2(-(nz - z), nx - x) : goal;
    } else if (this.lay[id] !== want) {   // 換隊形：還在混的話從混到一半的位置開始（不瞬移）
      const s0 = ease((t - this.t0[id]) / BLEND89);
      if (s0 < 1) { for (let i = 0; i < crowd.men; i++) { this.place(crowd.lay, id, i, s0, 0, 0, 1, 0, 0, false); const o = (id * SECTION_MEN + i) * 2; this.snap[o] = this.px; this.snap[o + 1] = this.pz; } this.from[id] = SNAP; }
      else this.from[id] = this.lay[id];
      this.lay[id] = want; this.t0[id] = t;
    } else if (t < this.t0[id]) this.t0[id] = t - BLEND89;   // 時間倒退（重播、換世界）：當作已經換好，不要等時間追上來再混一次
    const dt = Math.max(0, t - this.oriT[id]);
    let d = goal - this.ori[id]; d = Math.atan2(Math.sin(d), Math.cos(d));
    const o = this.ori[id] + (Math.abs(d) <= TURN89 * dt ? d : Math.sign(d) * TURN89 * dt); this.ori[id] = Math.atan2(Math.sin(o), Math.cos(o)); this.oriT[id] = t;
    const s = ease((t - this.t0[id]) / BLEND89), c = Math.cos(this.ori[id]), sn = Math.sin(this.ori[id]);
    const own = inGrid(w, Math.floor(x), Math.floor(z)) ? w.occ[cellIdx(w, Math.floor(x), Math.floor(z))] : 0;
    // 少了的人：留一個躺著的在他當時的位置（畫面外也記，鏡頭轉回去看得到）
    const last = this.last[id] < 0 ? men : this.last[id], B = H.bodies, cap = B.x.length;
    for (let i = men; i < last; i++) {
      this.place(crowd.lay, id, i, s, x, z, c, sn, own, y <= 0);
      const j = B.next;
      B.x[j] = this.px; B.z[j] = this.pz; B.y[j] = y; B.yaw[j] = this.ori[id] + (i - 4.5) * 0.7; B.side[j] = u.side;
      H.zombieBodies[j] = 0; H.bodyBorn[j] = t;
      B.next = (B.next + 1) % cap; B.n = Math.min(cap, B.n + 1);
    }
    this.last[id] = men;
    if (!men) return n;
    if (!this.onScreen(x, y, z)) { this.culled += men; return n; }
    if (on96 && !this.pre) this.prepass();
    const shown = on96 ? Math.min(men, this.cap96) : men;   // R096 T3：人太多時每班少畫幾個（少的從號碼大的先少：班長、布倫機槍組留著）
    const a = H.men.instanceMatrix.array as Float32Array, max = H.men.instanceMatrix.count, face = moving || prone ? this.ori[id] : aim, n0 = n;   // 走著、趴著的人朝隊形的方向（躺著的長 0.30，跟隊形不同向會疊在一起）
    for (let i = 0; i < shown && n < max && this.secDrawn < this.secBudget; i++, this.secDrawn++) {
      this.place(crowd.lay, id, i, s, x, z, c, sn, own, y <= 0);
      if (prone) put89(a, n, this.px, y + PRONE_LIFT89, this.pz, face, PRONE_TILT89, 1, 1, 1);
      else {
        const bob = moving ? 0.012 * Math.abs(Math.sin(t * 11 + i * 1.7)) : 0, big = i === 0 ? 1.05 : 1, kneel = i === 1 && !moving ? 0.8 : 1;   // 班長大一點點；停下的布倫機槍手跪著
        put89(a, n, this.px, y + bob, this.pz, face, 0, big, big * kneel, big);
      }
      H.men.setColorAt(n, col); n++;
    }
    this.live += n - n0; H.menDbg.alive += n - n0; if (prone) H.menDbg.prone += n - n0;
    return n;
  }

  // R096 T3 的那一遍：跟 battle.ts 的畫法同一套條件（看得到的、活著的；班照位置看在不在畫面上，喪屍與砲手不管在不在畫面上都畫）
  private prepass() {
    const H = this.host; let want = 0, others = 0;
    this.pre = true; this.hist.fill(0);
    for (const u of H.w.units) {
      if (!u.alive || !H.visibleUnit(u)) continue;
      const k = UNIT_KINDS[u.kind], crowd = CROWD89[u.kind];
      if (crowd) {
        const men = Math.min(crowd.men, Math.ceil((u.hp * crowd.men) / k.hp));
        if (men > 0 && this.onScreen(u.x / SUB, H.unitHeight(u), u.z / SUB)) { this.hist[Math.min(men, SECTION_MEN)]++; want += men; }
      } else if (u.kind === UK_MORTAR || u.kind === UK_MG) others += k.men ? Math.ceil((u.hp * k.men) / k.hp) : u.hp * 2 > k.hp ? 2 : 1;   // 跟 battle.ts 的 crew22 一樣
      else if (u.kind === UK_ZOMBIE) others += Math.min(k.men, Math.ceil((u.hp * k.men) / k.hp));   // 跟 squad21 一樣
    }
    const budget = Math.max(0, LIVE96 - others);
    let cap = SECTION_MEN;
    if (want > budget) {   // 最大的 c（MIN96..10），每班畫 min(人數, c) 加起來放得進；本來就不到 c 個人的班不會少（所以不能照比例算）
      cap = MIN96;
      for (let c = SECTION_MEN - 1; c >= MIN96; c--) { let sum = 0; for (let m = 1; m <= SECTION_MEN; m++) sum += this.hist[m] * Math.min(m, c); if (sum <= budget) { cap = c; break; } }
    }
    if (cap < this.cap96) { this.cap96 = cap; this.ok96 = 0; }   // 要少畫：馬上
    else if (cap > this.cap96) { if (++this.ok96 >= BACK89) { this.cap96 = cap; this.ok96 = 0; } }   // 可以多畫：連續 BACK89 幀才放（一班進出畫面邊緣不會讓全部的班一閃一閃）
    else this.ok96 = 0;
    this.want = want; this.others = others; this.secBudget = budget; this.secDrawn = 0;
  }

  private trisOf(g: THREE.BufferGeometry) { return (g.index ? g.index.count : g.attributes.position.count) / 3; }
  private dense(): THREE.BufferGeometry { return this.host.menDense ??= soldier(false); }
  // 每一段每個人幾個三角形（T0 有陰影那一趟）、最多幾個人
  trisPer(tier: number): number {
    if (!this.tris0) { this.tris0 = this.trisOf(this.host.menNormal); this.tris2 = this.trisOf(this.dense()); }
    return tier >= 2 ? this.tris2 : tier === 0 ? 2 * this.tris0 : this.tris0;
  }
  limit(tier: number): number { return Math.floor(MEN_TRIS89 / this.trisPer(tier)); }

  // 人一多馬上降；回到比較好的段，人數要在那一段上限的九成以下連續 BACK89 幀。喪屍模式不用 T0
  private decide(F: number) {
    const floor = this.host.w.zombies ? 1 : 0;
    const need = Math.max(floor, F <= this.limit(0) ? 0 : F <= this.limit(1) ? 1 : 2);
    if (this.tier < 0 || need > this.tier) { this.tier = need; this.okFrames = 0; return; }
    if (need < this.tier && F <= 0.9 * this.limit(this.tier - 1)) {
      if (++this.okFrames >= BACK89) { this.tier--; this.okFrames = 0; }
    } else this.okFrames = 0;
  }

  // 躺著的人（取代 bodies21）：喪屍與 96 圖的淡出照舊、敵方的在霧裡不畫、畫面外不畫；最後決定這一幀的段，T2 時躺著的人最多 min(64, 上限 − 活著的)，留最新的
  bodies(n: number): number {
    const H = this.host, B = H.bodies, cap = B.x.length, fade = !!H.w.zombies || H.w.n >= 96, live = n;
    if (this.show.length < cap) this.show = new Uint8Array(cap);
    let on = 0;
    for (let k = 0; k < B.n; k++) {
      const j = (B.next - B.n + k + cap) % cap, age = H.lastT - H.bodyBorn[j];
      let ok = !(fade && (k < B.n - 64 || age >= 30));
      if (ok && B.side[j] !== SIDE_PLAYER && !H.visibleAt(B.x[j] * SUB, B.z[j] * SUB)) ok = false;
      if (ok && !this.onScreen(B.x[j], B.y[j], B.z[j])) { ok = false; this.culled++; }
      this.show[k] = ok ? 1 : 0; if (ok) on++;
    }
    this.decide(live + on);
    let skip = this.tier >= 2 ? Math.max(0, on - Math.max(0, Math.min(64, this.limit(2) - live))) : 0;
    const a = H.men.instanceMatrix.array as Float32Array, max = H.men.instanceMatrix.count;
    this.drawn = 0;
    for (let k = 0; k < B.n && n < max; k++) {
      if (!this.show[k]) continue;
      if (skip > 0) { skip--; continue; }
      const j = (B.next - B.n + k + cap) % cap, age = H.lastT - H.bodyBorn[j];
      const sc = fade ? Math.min(1, (30 - age) / 10, (k - Math.max(0, B.n - 64) + 1) / 8) : 1;
      put89(a, n, B.x[j], B.y[j] + 0.03, B.z[j], B.yaw[j], Math.PI / 2, sc, sc, sc);
      H.men.setColorAt(n, H.zombieBodies[j] ? C_ZOMBIE_BODY89 : C_BODY89[B.side[j]]); n++; this.drawn++;
    }
    return n;
  }

  // 這一幀的網格與陰影（battle.ts 把回傳的網格設給 men）；記下守衛看的數字
  finish(n: number): THREE.BufferGeometry {
    const H = this.host;
    if (this.tier < 0) this.decide(n);
    H.men.castShadow = this.tier === 0;
    this.dbg = { live: this.live, bodies: this.drawn, culled: this.culled, F: n, tier: this.tier, tris: n * this.trisPer(this.tier), want: this.want, others: this.others, cap: this.cap96 };
    this.live = this.culled = this.drawn = this.want = this.others = 0; this.pre = false; this.secBudget = Infinity; this.secDrawn = 0;
    return this.tier >= 2 ? this.dense() : H.menNormal;
  }
}
// 躺著的人的顏色（跟 battle.ts 的 C_BODY、C_ZOMBIE_BODY 一樣）
const C_BODY89 = [new THREE.Color(0x3c4526), new THREE.Color(0x4a4944)], C_ZOMBIE_BODY89 = new THREE.Color(0x5c6650);
