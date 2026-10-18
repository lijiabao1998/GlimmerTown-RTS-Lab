// 世界狀態：純資料，只用整數。模擬不 import three、不碰 DOM、不用現實時間（AGENTS.md 規則 2、3）。
import { Fnv, nextU32, randInt, type RngState } from './rng.ts';

export const N = 32;            // 地圖邊長（格）
export const SUB = 256;         // 1 格＝256 個位置單位
export const HALF = SUB >> 1;
export const TICK_HZ = 20;      // 每秒 20 步

// 地形碼
export const TER_GRASS = 0;
export const TER_ROAD = 1;
export const TER_FIELD = 2;     // 農田（比草地慢）
export const TER_MUD = 3;       // R026 泥灘（潮間帶、河道）：走得過但很慢、不擋視線、不能蓋房子

// 雙方
export const SIDE_PLAYER = 0;
export const SIDE_ENEMY = 1;

// 建築種類（本線自己的編號，跟 GlimmerTown 系列的建築種類表無關）
export const BK_HOUSE = 0;
export const BK_COTTAGE = 1;
export const BK_BARN = 2;
export const BK_CHURCH = 3;
export const BK_SHOP = 4;
export const BK_HQ = 5;          // R019 指揮部（eco 指令放的；打成瓦礫那一方輸）
export const BK_PILLBOX = 6;     // R024 Type 22 碉堡（混凝土；裡面的人只吃四分之一傷害；直射只刮掉四分之一，怕榴彈砲）

// R105 材質由種類推導，不往世界或指令加欄位；舊存檔保留已存的 hp／maxHp。
export const BM_WOOD = 0;
export const BM_BRICK = 1;
export const BM_STONE = 2;
export const BM_CONCRETE = 3;
export const BLD_MATERIAL_NAMES = ['木造', '磚造', '石造', '混凝土'] as const;
export function bldMaterial(kind: number): number {
  if (kind === BK_BARN) return BM_WOOD;
  if (kind === BK_CHURCH) return BM_STONE;
  if (kind === BK_PILLBOX) return BM_CONCRETE;
  return BM_BRICK;
}

// 單位種類
export const UK_TANK = 0;
export const UK_HOWITZER = 1;
export const UK_OBSERVER = 2;
export const UK_INFANTRY = 3;   // R021 步兵班（6 人，每 10 血一個人）
export const UK_ATGUN = 4;      // R022 反戰車砲（直射、要架好才能打、專打裝甲）
export const UK_MORTAR = 5;     // R022 迫擊砲（短程間接射擊、兩個砲手）
export const UK_LIGHT = 6;      // R023 輕坦克（快、看得遠、皮薄、主砲穿甲低）
export const UK_HEAVY = 7;      // R023 重坦克（慢、裝甲只吃七成傷害、火力稍強）

export interface UnitKind {
  name: string;
  hp: number;
  speed: number;        // 每 tick 走幾個位置單位（在路上；其他地形再乘地形倍率）
  range: number;        // 最大射程（位置單位）
  minRange: number;     // 最小射程（位置單位；直射是 0）
  reload: number;       // 裝填 tick 數
  indirect: boolean;    // 間接射擊（拋物線，不需要直線射界）
  dmgUnit: number;      // 命中單位的傷害
  dmgBld: number;       // 命中建築的傷害
  splash: number;       // 爆炸半徑（位置單位；0＝只打中一個東西）
  sight: number;        // 視野半徑（位置單位；算「有沒有友軍看得到」用）
  armor: number;        // 承受傷害的百分比（100＝全吃）
  radius: number;       // 碰撞半徑（位置單位；0＝不參與碰撞，例如步兵）（R005）
  cost: number;         // R019 生產要花多少補給
  buildTicks: number;   // R019 生產要幾步
  garrison: boolean;    // R021 能進駐房子（觀測員、步兵）
  armored: boolean;     // R021 有裝甲（坦克）：只吃穿甲率那一部分的傷害
  pierce: number;       // R021 打裝甲目標時剩幾 %（100＝全吃）
  men: number;          // R021 畫成幾個人（0＝一個模型）
  soft: number;         // R022 打非裝甲目標時剩幾 %（100＝全吃）
  setup: boolean;       // R022 要停下來（架好）才能開火（間接射擊的砲本來就是）
}

// 數字都是暫定，玩家看得到的數字由業主定（AGENTS.md 規則 6）。
export const UNIT_KINDS: UnitKind[] = [
  { name: 'tank', hp: 100, speed: 20, range: 9 * SUB, minRange: 0, reload: 60, indirect: false, dmgUnit: 34, dmgBld: 25, splash: 0, sight: 10 * SUB, armor: 100, radius: 80, cost: 40, buildTicks: 300, garrison: false, armored: true, pierce: 100, men: 0, soft: 100, setup: false },
  { name: 'howitzer', hp: 60, speed: 10, range: 28 * SUB, minRange: 6 * SUB, reload: 140, indirect: true, dmgUnit: 70, dmgBld: 60, splash: 384, sight: 6 * SUB, armor: 100, radius: 72, cost: 50, buildTicks: 400, garrison: false, armored: false, pierce: 100, men: 0, soft: 100, setup: false },
  { name: 'observer', hp: 30, speed: 16, range: 0, minRange: 0, reload: 0, indirect: false, dmgUnit: 0, dmgBld: 0, splash: 0, sight: 14 * SUB, armor: 100, radius: 0, cost: 15, buildTicks: 120, garrison: true, armored: false, pierce: 100, men: 0, soft: 100, setup: false },
  { name: 'infantry', hp: 60, speed: 12, range: 6 * SUB, minRange: 0, reload: 24, indirect: false, dmgUnit: 12, dmgBld: 2, splash: 0, sight: 7 * SUB, armor: 100, radius: 0, cost: 25, buildTicks: 120, garrison: true, armored: false, pierce: 10, men: 6, soft: 100, setup: false },
  { name: 'atgun', hp: 50, speed: 8, range: 10 * SUB, minRange: 0, reload: 70, indirect: false, dmgUnit: 48, dmgBld: 15, splash: 0, sight: 7 * SUB, armor: 100, radius: 64, cost: 35, buildTicks: 260, garrison: false, armored: false, pierce: 100, men: 0, soft: 30, setup: true },
  { name: 'mortar', hp: 40, speed: 12, range: 12 * SUB, minRange: 2 * SUB, reload: 60, indirect: true, dmgUnit: 30, dmgBld: 12, splash: 256, sight: 6 * SUB, armor: 100, radius: 0, cost: 30, buildTicks: 200, garrison: false, armored: false, pierce: 50, men: 0, soft: 100, setup: false },
  { name: 'light', hp: 70, speed: 26, range: 8 * SUB, minRange: 0, reload: 45, indirect: false, dmgUnit: 24, dmgBld: 15, splash: 0, sight: 12 * SUB, armor: 100, radius: 72, cost: 30, buildTicks: 220, garrison: false, armored: true, pierce: 70, men: 0, soft: 100, setup: false },
  { name: 'heavy', hp: 160, speed: 13, range: 9 * SUB, minRange: 0, reload: 70, indirect: false, dmgUnit: 40, dmgBld: 30, splash: 0, sight: 9 * SUB, armor: 70, radius: 88, cost: 65, buildTicks: 480, garrison: false, armored: true, pierce: 100, men: 0, soft: 100, setup: false },
];

export const ORD_IDLE = 0;
export const ORD_MOVE = 1;
export const ORD_ATTACK = 2;    // 攻擊一個單位
export const ORD_FIRE_AT = 3;   // 射擊一格（建築或地面）

export interface Building {
  id: number;           // 從 1 起；跟 occ 裡的值相同
  kind: number;
  x: number; z: number; // 左上角格
  w: number; d: number; // 佔地（格）
  floors: number;
  hp: number;
  maxHp: number;
  builtBy?: number;     // R006：玩家／敵方在第 0 步蓋的才有（0／1）；地圖生成的沒有這個欄位
}

export interface Ranging {
  x: number; z: number; ax: number; az: number; target: number; epoch: number; seen: number;
}

export interface Unit {
  id: number;           // 從 1 起，永不重用
  side: number;
  kind: number;
  x: number; z: number; // 位置（位置單位）
  hp: number;
  alive: boolean;
  order: number;
  target: number;       // ORD_ATTACK 的單位 id；沒有是 0
  tx: number; tz: number; // ORD_MOVE／ORD_FIRE_AT 的目標格
  path: number[];       // 路徑（格索引），從下一格到終點
  pathIdx: number;
  cooldown: number;
  ranging?: Ranging; // optional so earlier saved worlds can still advance
  aimX: number; aimZ: number; // 最後一次開火的方向（位置單位的向量；渲染轉砲塔用）
}

export const SHELL_AP = 0;      // 穿甲彈（直射）
export const SHELL_HE = 1;      // 高爆彈（榴彈砲）
export const SHELL_SMALL = 2;   // R021 步槍子彈（只打一個目標、幾乎不傷房子）

export interface Shell {
  id: number;
  side: number;
  kind: number;
  shooter: number;
  sx: number; sz: number;   // 起點
  ex: number; ez: number;   // 落點
  t: number; T: number;     // 已飛 tick／總飛行 tick
  target: number;           // 穿甲彈瞄準的單位 id（0＝沒有）
  rangingEpoch?: number; // identifies the exact stationary firing solution
  hitBld: number;           // 穿甲彈會打中的建築 id（0＝沒有）
}

// 給渲染看的事件：每一步開頭清空，不進雜湊
export type SimEvent =
  | { e: 'fire'; unit: number; x: number; z: number }
  | { e: 'impact'; kind: number; x: number; z: number; bld: number; r?: number }   // R022 r：爆炸半徑（只有迫擊砲這種小號的才帶；畫面用）
  | { e: 'kill'; unit: number }
  | { e: 'stage'; bld: number; stage: number }
  | { e: 'build'; bld: number };

// R018 電腦對手的記憶：只有開了電腦的那一方才有（沒有電腦的世界雜湊不變）
// R019 補給與生產：只有送過 eco 指令的世界才有（沒有的世界雜湊不變）
export interface EcoState { supply: number[]; hq: number[]; queue: number[][]; prog: number[]; inf?: number; guns?: number; tanks?: number }

export interface AiState { side: number; level: number; next: number; ox: number; oz: number; seen: number; wp: number }

export interface World extends RngState {
  seed: number;
  tick: number;
  n: number;
  ter: Uint8Array;
  occ: Int32Array;        // 每格的建築 id（0＝空）
  crater: Uint8Array;     // 每格的彈坑深度 0–3
  blds: Building[];
  units: Unit[];
  shells: Shell[];
  nextShell: number;
  winner: number;         // -1＝還在打；0／1＝勝方；2＝同歸於盡
  events: SimEvent[];
  ai?: AiState[];         // R018：哪一方由電腦指揮（ai 指令設定）
  eco?: EcoState;         // R019：補給、指揮部、生產佇列
  map?: number;           // R026：套過哪一張手排地圖（map 指令；沒有＝亂數村莊）
}

export const idx = (x: number, z: number) => z * N + x;
export const inMap = (x: number, z: number) => x >= 0 && z >= 0 && x < N && z < N;
export const cellOf = (p: number) => Math.floor(p / SUB);
export const center = (c: number) => c * SUB + HALF;

// 損壞三段：門檻沿用 3D-lab 三百年示範（src/render/scene.ts:216-217：dmg≥0.3 沒屋頂、dmg≥1 瓦礫），改成整數比較
export const STAGE_INTACT = 0;
export const STAGE_ROOFLESS = 1;
export const STAGE_RUBBLE = 2;
export function stageOf(b: Building): number {
  if (b.hp <= 0) return STAGE_RUBBLE;
  if (b.hp * 10 <= b.maxHp * 7) return STAGE_ROOFLESS;
  return STAGE_INTACT;
}

export function bldAt(w: World, x: number, z: number): Building | null {
  if (!inMap(x, z)) return null;
  const id = w.occ[idx(x, z)];
  return id ? w.blds[id - 1] : null;
}

// 擋路、擋射線：還沒倒成瓦礫的建築
export function blocks(w: World, x: number, z: number): boolean {
  const b = bldAt(w, x, z);
  return !!b && b.hp > 0;
}

// 地形速度倍率（百分比）：路最快，瓦礫、彈坑最慢
export function speedPct(w: World, x: number, z: number): number {
  const i = idx(x, z);
  let p = w.ter[i] === TER_ROAD ? 100 : w.ter[i] === TER_FIELD ? 70 : w.ter[i] === TER_MUD ? 40 : 85;
  if (w.occ[i]) p = 45;                      // 走得進來的建築格一定是瓦礫
  if (w.crater[i]) p = Math.min(p, 75 - w.crater[i] * 10);
  return p;
}

export function bldMaxHp(kind: number, w: number, d: number, floors: number): number {
  if (kind === BK_HQ) return 1200;
  if (kind === BK_PILLBOX) return 400;
  const material = bldMaterial(kind);
  const base = material === BM_WOOD ? 30 : material === BM_STONE ? 120 : 50;
  const perCell = material === BM_WOOD ? 30 : material === BM_STONE ? 50 : 40;
  return base + perCell * floors * w * d;
}

// ---- 地圖：程序生成的二戰村莊街區 ----
// 十字路口在中間，一條小路往東北；房子沿路排、教堂靠路口；兩方出生角落留空。
export function createWorld(seed: number): World {
  const w: World = {
    seed: seed >>> 0, tick: 0, rng: seed >>> 0, n: N,
    ter: new Uint8Array(N * N), occ: new Int32Array(N * N), crater: new Uint8Array(N * N),
    blds: [], units: [], shells: [], nextShell: 1, winner: -1, events: [],
  };
  nextU32(w);   // 讓種子 0 也有像樣的開頭

  // 道路：東西向大路（z=15,16）、南北向大路（x=15,16）、斜向小路
  const roadZ = 14 + randInt(w, 3), roadX = 14 + randInt(w, 3);
  for (let i = 0; i < N; i++) {
    w.ter[idx(i, roadZ)] = TER_ROAD; w.ter[idx(i, roadZ + 1)] = TER_ROAD;
    w.ter[idx(roadX, i)] = TER_ROAD; w.ter[idx(roadX + 1, i)] = TER_ROAD;
  }
  for (let x = roadX + 2, z = roadZ - 1; x < N && z >= 0; x += 1, z -= 1) {   // 小路：往右上斜出去
    w.ter[idx(x, z)] = TER_ROAD;
    if (x + 1 < N) w.ter[idx(x + 1, z)] = TER_ROAD;
  }
  // 農田：左下、右上兩塊
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
    const i = idx(x, z);
    if (w.ter[i] !== TER_GRASS) continue;
    if ((x < 9 && z > 19 && z < 26) || (x > 22 && z > 8 && z < 13)) w.ter[i] = TER_FIELD;
  }

  const reserved = (x: number, z: number) => (x >= 22 && z >= 22) || (x <= 9 && z <= 9);   // 出生角落
  const free = (x: number, z: number, bw: number, bd: number) => {
    for (let dz = -1; dz <= bd; dz++) for (let dx = -1; dx <= bw; dx++) {
      const cx = x + dx, cz = z + dz, inner = dx >= 0 && dz >= 0 && dx < bw && dz < bd;
      if (!inMap(cx, cz)) { if (inner) return false; continue; }
      if (inner && (w.ter[idx(cx, cz)] === TER_ROAD || reserved(cx, cz))) return false;
      if (w.occ[idx(cx, cz)]) return false;     // 建築之間至少隔一格（巷子）
    }
    return true;
  };
  const place = (kind: number, x: number, z: number, bw: number, bd: number, floors: number) => {
    const id = w.blds.length + 1, maxHp = bldMaxHp(kind, bw, bd, floors);
    w.blds.push({ id, kind, x, z, w: bw, d: bd, floors, hp: maxHp, maxHp });
    for (let dz = 0; dz < bd; dz++) for (let dx = 0; dx < bw; dx++) w.occ[idx(x + dx, z + dz)] = id;
  };

  // 教堂：路口西北角
  if (free(roadX - 4, roadZ - 4, 3, 3)) place(BK_CHURCH, roadX - 4, roadZ - 4, 3, 3, 2);
  // 沿路的房子：從路邊往外一格開始試
  const tries: [number, number][] = [];
  for (let i = 1; i < N - 1; i++) {
    tries.push([i, roadZ - 2], [i, roadZ + 2], [roadX - 2, i], [roadX + 2, i]);
  }
  for (const [x, z] of tries) {
    if (randInt(w, 100) < 35) continue;
    const r = randInt(w, 10);
    const kind = r < 4 ? BK_HOUSE : r < 7 ? BK_COTTAGE : r < 9 ? BK_SHOP : BK_BARN;
    const bw = kind === BK_BARN ? 2 : 1 + randInt(w, 2), bd = kind === BK_BARN ? 2 : 1 + randInt(w, 2);
    const ox = x < roadX ? x - bw + 1 : x, oz = z < roadZ ? z - bd + 1 : z;    // 往遠離路的方向長
    const floors = kind === BK_COTTAGE || kind === BK_BARN ? 1 : 1 + randInt(w, 2);
    if (free(ox, oz, bw, bd)) place(kind, ox, oz, bw, bd, floors);
  }
  // 零散農舍
  for (let k = 0; k < 6; k++) {
    const x = 2 + randInt(w, N - 4), z = 2 + randInt(w, N - 4);
    if (free(x, z, 2, 2)) place(k % 2 ? BK_BARN : BK_COTTAGE, x, z, 2, 2, 1);
  }

  // 兵力：玩家在右下角（靠鏡頭），敵人在左上角
  const spawn = (side: number, kind: number, cx: number, cz: number) => {
    const k = UNIT_KINDS[kind];
    w.units.push({ id: w.units.length + 1, side, kind, x: center(cx), z: center(cz), hp: k.hp, alive: true, order: ORD_IDLE, target: 0, tx: 0, tz: 0, path: [], pathIdx: 0, cooldown: 0, aimX: side === SIDE_PLAYER ? -SUB : SUB, aimZ: side === SIDE_PLAYER ? -SUB : SUB });
  };
  spawn(SIDE_PLAYER, UK_TANK, 24, 26); spawn(SIDE_PLAYER, UK_TANK, 26, 24); spawn(SIDE_PLAYER, UK_TANK, 26, 27);
  spawn(SIDE_PLAYER, UK_HOWITZER, 29, 29);
  spawn(SIDE_ENEMY, UK_TANK, 7, 5); spawn(SIDE_ENEMY, UK_TANK, 5, 7); spawn(SIDE_ENEMY, UK_TANK, 5, 4);
  spawn(SIDE_ENEMY, UK_HOWITZER, 2, 2);
  // Append only: original command IDs 1–8 remain stable.
  spawn(SIDE_PLAYER, UK_OBSERVER, 24, 24);
  spawn(SIDE_ENEMY, UK_OBSERVER, 7, 7);
  return w;
}

// 世界雜湊：所有跨 tick 的狀態都要折進來（events 只給渲染看，不算）
export function hashWorld(w: World): string {
  const f = new Fnv();
  f.int(w.seed).int(w.tick).int(w.rng).int(w.nextShell).int(w.winner);
  for (let i = 0; i < w.ter.length; i++) f.int(w.ter[i] | (w.crater[i] << 8)).int(w.occ[i]);
  f.int(w.blds.length);
  for (const b of w.blds) {
    f.int(b.id).int(b.kind).int(b.x).int(b.z).int(b.w).int(b.d).int(b.floors).int(b.hp).int(b.maxHp);
    if (b.builtBy !== undefined) f.int(b.builtBy);   // R006：只有布陣蓋的才折，沒布陣的世界雜湊不變
  }
  f.int(w.units.length);
  for (const u of w.units) {
    f.int(u.id).int(u.side).int(u.kind).int(u.x).int(u.z).int(u.hp).int(u.alive ? 1 : 0).int(u.order).int(u.target)
      .int(u.tx).int(u.tz).int(u.pathIdx).int(u.cooldown).int(u.aimX).int(u.aimZ).int(u.path.length);
    for (const c of u.path) f.int(c);
    const r = u.ranging;
    f.int(r ? 1 : 0);
    if (r) f.int(r.x).int(r.z).int(r.ax).int(r.az).int(r.target).int(r.epoch).int(r.seen);
  }
  if (w.map) f.int(0x4d50).int(w.map);   // R026 只在有時折
  if (w.eco) { const e = w.eco; for (let s = 0; s < 2; s++) { f.int(e.supply[s]).int(e.hq[s]).int(e.prog[s]).int(e.queue[s].length); for (const k of e.queue[s]) f.int(k); } if (e.inf) f.int(e.inf); if (e.guns) f.int(0x4755).int(e.guns); if (e.tanks) f.int(0x544b).int(e.tanks); }   // R019（R021 步兵旗、R022 砲旗只在有時折；砲旗前面加標記，跟步兵旗分得開）
  if (w.ai) for (const a of w.ai) f.int(a.side).int(a.level).int(a.next).int(a.ox).int(a.oz).int(a.seen).int(a.wp);   // R018：只有開了電腦才折
  f.int(w.shells.length);
  for (const s of w.shells) f.int(s.id).int(s.side).int(s.kind).int(s.shooter).int(s.sx).int(s.sz).int(s.ex).int(s.ez).int(s.t).int(s.T).int(s.target).int(s.hitBld).int(s.rangingEpoch ?? 0);
  return f.hex();
}
