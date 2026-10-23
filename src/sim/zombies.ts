// R045 可選波次防守。只有 World 有狀態，亂數只抽 World.rng；舊世界不走這裡。
import { SUB, SIDE_PLAYER, SIDE_ENEMY, UK_ZOMBIE, UNIT_KINDS, BK_WIRE, ORD_IDLE, ORD_MOVE, cellOf, cellIdx, center, blocks, bldAt, wireBlocks, type World, type Unit, type Building } from './world.ts';
import { findPath } from './path.ts';
import { randInt } from './rng.ts';
import { dist } from './math.ts';

export const ZOMBIE_CAP = 48, ZOMBIE_PERIOD = 900, ZOMBIE_BREAK = 200;
export type ZombieVision = (u: Unit, target: Unit) => boolean;
export interface ZombieAim { x: number; z: number; unit: Unit | null; bld: Building | null; wire?: boolean }

export function startZombies(w: World): void {
  if (w.tick !== 0 || w.zombies || w.sandbox || w.eco) return;
  // id 是 units[id-1] 的穩定位址（萊伊的兩方 id 交錯），不能壓縮或重用。
  // 敵方起手從對局移除，留下不渲染、不當目標的空槽，玩家 id 與後續生產都維持正確。
  for (const u of w.units) if (u.side === SIDE_ENEMY) { u.alive = false; u.hp = 0; u.path = []; u.pathIdx = 0; u.order = ORD_IDLE; }
  if (w.ai) { w.ai = w.ai.filter(a => a.side === SIDE_PLAYER); if (!w.ai.length) delete w.ai; }
  w.zombies = { version: 1, wave: 0, next: ZOMBIE_PERIOD, pending: 0, spawned: 0, killed: 0, lost: 0 };
}

const headquarters = (w: World) => { const id = w.eco?.hq[SIDE_PLAYER] ?? 0; return id ? w.blds[id - 1] : undefined; };
const destination = (w: World): [number, number] => { const b = headquarters(w); return b ? [center(b.x), center(b.z)] : [center(w.n - 6), center(w.n - 6)]; };
const near = (b: Building, u: Unit): [number, number] => [center(Math.max(b.x, Math.min(b.x + b.w - 1, cellOf(u.x)))), center(Math.max(b.z, Math.min(b.z + b.d - 1, cellOf(u.z))))];

function target(w: World, u: Unit, sees: ZombieVision): Unit | null {
  let best: Unit | null = null, distance = UNIT_KINDS[UK_ZOMBIE].sight + 1;
  for (const t of w.units) if (t.alive && t.side === SIDE_PLAYER) {
    const d = dist(u.x, u.z, t.x, t.z);
    if (d < distance && sees(u, t)) { best = t; distance = d; }
  }
  return best;
}

// 喪屍只對真正近身的目標出手；隔牆的單位要先繞路或拆牆。
export function zombieAim(w: World, u: Unit, sees: ZombieVision): ZombieAim | null {
  const t = target(w, u, sees), reach = UNIT_KINDS[UK_ZOMBIE].range;
  if (t && dist(u.x, u.z, t.x, t.z) <= reach) {
    const home = bldAt(w, cellOf(t.x), cellOf(t.z));
    if (home && home.hp > 0) { const [x, z] = near(home, u); if (dist(u.x, u.z, x, z) <= reach) return { x, z, unit: null, bld: home }; }
    else return { x: t.x, z: t.z, unit: t, bld: null };
  }
  const hq = headquarters(w), [gx, gz] = destination(w);
  let best: ZombieAim | null = null, score = Number.MAX_SAFE_INTEGER;
  for (const b of [...w.blds, ...(w.wires?.segments ?? [])]) {
    if (b.hp <= 0) continue;
    const [x, z] = near(b, u);
    if (dist(u.x, u.z, x, z) > reach) continue;
    // 先拆指揮部；否則只打往目標方向真正擋路的障礙，不在路過時無故拆房。
    const blocked = u.pathIdx >= u.path.length && (u.tx !== 0 || u.tz !== 0);
    if (b !== hq && !blocked) continue;
    const d = b === hq ? -1 : dist(x, z, t?.x ?? gx, t?.z ?? gz);
    if (d < score) { score = d; best = { x, z, unit: null, bld: b, ...(b.kind === BK_WIRE ? { wire: true } : {}) }; }
  }
  return best;
}

export function zombiesStep(w: World, sees: ZombieVision): void {
  const state = w.zombies;
  if (!state || w.winner >= 0) return;
  if (w.tick >= state.next) { state.wave++; state.pending += 4 + 2 * state.wave; state.next = (state.wave + 1) * ZOMBIE_PERIOD; }
  let living = w.units.filter(u => u.alive && u.kind === UK_ZOMBIE).length;
  if (state.pending && living < ZOMBIE_CAP) {
    const [hx, hz] = destination(w), edge: number[] = [], far = (w.n * SUB) >> 1;
    for (let z = 0; z < w.n; z++) for (let x = 0; x < w.n; x++) {
      if (x !== 0 && z !== 0 && x !== w.n - 1 && z !== w.n - 1) continue;
      if (blocks(w, x, z) || wireBlocks(w, x, z, UK_ZOMBIE) || dist(center(x), center(z), hx, hz) < far) continue;
      edge.push(cellIdx(w, x, z));
    }
    const entry = edge.length ? edge[randInt(w, edge.length)] : -1;
    const front = edge.filter(p => dist(center(p % w.n), center(Math.floor(p / w.n)), center(entry % w.n), center(Math.floor(entry / w.n))) <= 3 * SUB);
    while (front.length && state.pending && living < ZOMBIE_CAP) {
      const p = front[randInt(w, front.length)], x = p % w.n, z = Math.floor(p / w.n), id = w.units.length + 1;
      w.units.push({ id, side: SIDE_ENEMY, kind: UK_ZOMBIE, x: center(x), z: center(z), hp: 60, alive: true, order: ORD_IDLE, target: 0, tx: 0, tz: 0, path: [], pathIdx: 0, cooldown: 0, aimX: SUB, aimZ: SUB });
      w.events.push({ e: 'spawn', unit: id, x: center(x), z: center(z) });
      state.pending--; state.spawned++; living++;
    }
  }
  // 路線只在需要時重算；固定的錯開步序讓 48 群不在同一步一起做 A*。
  for (const u of w.units) if (u.alive && u.kind === UK_ZOMBIE) {
    if (u.pathIdx < u.path.length && (w.tick + u.id) % 20 !== 0) continue;
    const t = target(w, u, sees), [gx, gz] = t ? [t.x, t.z] : destination(w);
    u.target = t?.id ?? 0;
    const aim = zombieAim(w, u, sees);
    if (aim) { u.order = aim.bld ? ORD_MOVE : ORD_IDLE; u.path = []; u.pathIdx = 0; continue; }
    u.order = ORD_MOVE; u.tx = cellOf(gx); u.tz = cellOf(gz);
    u.path = findPath(w, cellOf(u.x), cellOf(u.z), u.tx, u.tz, 0, 0, UK_ZOMBIE); u.pathIdx = 0;
    // A* 已在最近可達格也可能尚未走到格心；先走完，否則會停在近身距離外幾個位置單位。
    if (!u.path.length && (u.x !== center(cellOf(u.x)) || u.z !== center(cellOf(u.z)))) u.path = [cellIdx(w, cellOf(u.x), cellOf(u.z))];
  }
}

export function finishZombiesStep(w: World): void {
  const s = w.zombies;
  if (!s) return;
  let alive = 0, men = 0, lost = 0;
  for (const u of w.units) {
    if (u.kind === UK_ZOMBIE && u.alive) { alive++; men += Math.floor((u.hp + 9) / 10); }
    else if (u.side === SIDE_PLAYER && !u.alive) lost++;
  }
  s.killed = s.spawned * 6 - men; s.lost = lost;
  if (s.wave && !alive && !s.pending) s.next = Math.min(s.next, w.tick + ZOMBIE_BREAK);
}
