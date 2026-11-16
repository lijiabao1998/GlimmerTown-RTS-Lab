// R057 電腦對手 v2：ai 指令帶 v＝2 才用。先照第一版想一遍（ai.ts 的 aiThink，內容不動），再照下面四件事改寫它下的指令：
// 分波次（集結、殘兵撤回）、懂穿甲（rules.ap）、懂壓制（rules.morale）、砲兵（打三發換陣地、反砲兵射擊）。
// 整數、決定性、不抽 World.rng。不偷看：敵人只用自己這一方現在看得到的（看得到的單位頭上的壓制標記也算看得到；手上的攻擊指令如果目標已經看不到，就當作沒有目標）；
// 聲測只用 R115 的報告。數字都是遊戲設計（暫定），出處與量測在 docs/tasks/R057-電腦對手v2.md。
import { dist } from './math.ts';
import { hqAlive } from './eco.ts';
import { apHit, penetration, ARMOR_MM, PEN_MM } from './ballistics.ts';
import { coverPct } from './morale.ts';
import { counterbatteryAreas, COUNTERBATTERY_TTL } from './counterbattery.ts';
import { freeNear, type AiCmd } from './ai.ts';
import { produce3, machineGuns3, mgTargetFor, mgBusy } from './ai3.ts';
import {
  SUB, center, cellOf, inGrid, blocks, UNIT_KINDS, UK_OBSERVER, UK_INFANTRY, UK_HOWITZER, UK_MORTAR, UK_ATGUN, UK_MG, ORD_ATTACK, ORD_MOVE, ORD_FIRE_AT, SIDE_PLAYER,
  moraleState, MORALE_SHAKEN, MORALE_PINNED, type World, type Unit, type AiState,
} from './world.ts';

type Spotted = (w: World, side: number, x: number, z: number) => boolean;

export const WAVE = [0, 3, 4, 5];        // 難度 1／2／3：一波湊幾台才出發（暫定）
export const WAVE_WAIT = 900;            // 集結最久等幾步（45 秒，暫定）；到了沒湊滿也出發
export const WAVE_GO = 400;              // 出發之後這麼多步內，基地裡的單位不再被留住（夠它們走出基地）
export const RALLY_CELLS = 4;            // 集結點在自己指揮部往對方那一角幾格
export const BASE_CELLS = 7;             // 離集結點幾格以內算「在基地」
export const DEFEND_CELLS = 3;           // 在基地等的時候，看得到的敵人進到射程再加幾格以內就還手
export const FLANK_CELLS = 3;            // 繞到目標側面幾格的地方
export const FLANK_ALONE = 6;            // 目標周圍幾格內沒有別的敵人才繞（繞的時候自己的側面是露出來的；量過：不管這個就繞，勝率少 6 個百分點）
export const COVER_CELLS = 4;            // 受壓時找幾格以內的房子
export const ASSAULT_EXTRA = 4;          // 對方被釘住時，步兵比平常多走幾格去打
export const GUN_SHOTS = 3;              // 同一個 2×2 小格打滿幾發就換陣地（R115：三發被定位到那一小格）
export const GUN_SAFE = 4;               // 反砲兵射擊：瞄的那一格幾格內有自己人就不打
const SOUND_ZONE = 8, SOUND_CELL = 2;    // R115 聲測的粗區與小格邊長（counterbattery.ts 的 ZONE_CELLS、CELL_CELLS；守衛拿真的報告對過）

// R115 聲測把 (x, z) 記成哪個粗區、哪個小格（跟 counterbattery.ts updateCounterbattery 同一個算法）
export function soundCell(w: World, x: number, z: number): { zone: number; cell: number } {
  const gx = Math.floor(x / SUB), gz = Math.floor(z / SUB), zones = Math.ceil(w.n / SOUND_ZONE), per = SOUND_ZONE / SOUND_CELL;
  return { zone: Math.floor(gz / SOUND_ZONE) * zones + Math.floor(gx / SOUND_ZONE), cell: Math.floor((gz % SOUND_ZONE) / SOUND_CELL) * per + Math.floor((gx % SOUND_ZONE) / SOUND_CELL) };
}

// 同一次想裡「這個位置看不看得到」只算一次：第一版先算過的，第二版直接拿（答案一樣，只省時間；想的過程中世界不會變）
export function memoSpotted(spotted: Spotted): Spotted {
  const memo = new Map<number, boolean>();
  return (w, side, x, z) => {
    if (x < 0 || z < 0 || x >= 32768 || z >= 32768) return spotted(w, side, x, z);
    const key = (side * 32768 + x) * 32768 + z;
    let v = memo.get(key);
    if (v === undefined) { v = spotted(w, side, x, z); memo.set(key, v); }
    return v;
  };
}

const clampCell = (w: World, v: number) => Math.max(0, Math.min(w.n - 1, v));
// 從 (x, z) 往 (tx, tz) 走 cells 格的那一格（位置單位進、格出）
function toward(w: World, x: number, z: number, tx: number, tz: number, cells: number): [number, number] {
  const d = Math.max(1, dist(x, z, tx, tz)), step = Math.min(d, cells * SUB);
  return [clampCell(w, cellOf(x + Math.trunc(((tx - x) * step) / d))), clampCell(w, cellOf(z + Math.trunc(((tz - z) * step) / d)))];
}

// 第二版：base＝第一版這一次想出來的指令。回傳改寫後的指令
export function aiThink2(w: World, st: AiState, spotted: Spotted, base: AiCmd[]): AiCmd[] {
  const side = st.side, lv = st.level, n = w.n;
  const mine = w.units.filter(u => u.alive && u.side === side);
  const seen = w.units.filter(u => u.alive && u.side !== side && spotted(w, side, u.x, u.z)), seenIds = new Set(seen.map(u => u.id));
  const kind = (u: Unit) => UNIT_KINDS[u.kind];
  const ownCorner = side === SIDE_PLAYER ? n - 6 : 5, hq = w.eco ? hqAlive(w, side) : null, foeHq = w.eco ? hqAlive(w, 1 - side) : null;
  const homeX = hq ? Math.floor(((hq.x * 2 + hq.w) * SUB) / 2) : center(ownCorner), homeZ = hq ? Math.floor(((hq.z * 2 + hq.d) * SUB) / 2) : center(ownCorner);
  // 第一版給每個單位的指令（找得到的最後一條）；override＝第二版要改掉的（null＝這一次不下指令）
  const given = new Map<number, AiCmd>(), override = new Map<number, AiCmd | null>();
  for (const c of base) if (c.t !== 'produce') for (const id of c.ids) given.set(id, c);
  const planned = (u: Unit): AiCmd | null | undefined => (override.has(u.id) ? override.get(u.id) : given.get(u.id));
  // 這個單位這一次之後打算打誰（這一次的指令優先，沒有就看它手上的攻擊指令）。目標現在看不到就當作沒有：不拿看不到的單位的位置做任何決定
  const targetOf = (u: Unit): Unit | null => {
    const c = planned(u);
    if (c === null) return null;
    const id = c ? (c.t === 'attack' ? c.target : 0) : u.order === ORD_ATTACK ? u.target : 0;
    const t = id ? w.units[id - 1] : null;
    return t && t.alive && seenIds.has(t.id) ? t : null;
  };
  const movingTo = (u: Unit, x: number, z: number) => u.order === ORD_MOVE && u.pathIdx < u.path.length && Math.abs(u.tx - x) <= 2 && Math.abs(u.tz - z) <= 2;
  const nearest = (from: Unit, list: Unit[]): Unit | undefined => list.slice().sort((a, b) => dist(from.x, from.z, a.x, a.z) - dist(from.x, from.z, b.x, b.z) || a.id - b.id)[0];
  const freeToward = (x: number, z: number, tx: number, tz: number, cells: number): [number, number] => { const c = toward(w, x, z, tx, tz, cells); return freeNear(w, c[0], c[1]) ?? c; };
  const moveTo = (u: Unit, x: number, z: number) => { override.set(u.id, movingTo(u, x, z) ? null : { t: 'move', side, ids: [u.id], x, z }); };

  // ---- 1. 分波次（有補給、指揮部還在）：在基地的先等，湊滿一波或等夠久才放行；前面剩太少就撤回 ----
  if (hq) {
    const enemyCorner = n - 1 - ownCorner, [rx0, rz0] = toward(w, homeX, homeZ, center(enemyCorner), center(enemyCorner), RALLY_CELLS);
    const at = freeNear(w, rx0, rz0) ?? [rx0, rz0], rallyX = center(at[0]), rallyZ = center(at[1]);
    const waveKind = (u: Unit) => kind(u).armored || u.kind === UK_INFANTRY, held = (u: Unit) => waveKind(u) || u.kind === UK_MORTAR || u.kind === UK_ATGUN || (st.v === 3 && u.kind === UK_MG && !mgBusy(w, u, seen));   // R081：射程內有打得到的目標的機槍組留下來打
    // 還沒出發過第一波之前，所有人都算在基地（大地圖開局的部隊散在基地外面；不這樣算，一半先走、一半等人，被各個擊破）
    const atBase = (u: Unit) => st.go === undefined || dist(u.x, u.z, rallyX, rallyZ) <= BASE_CELLS * SUB;
    const wave = mine.filter(waveKind), home = wave.filter(atBase);
    // 前面的車（殘兵撤回只管車：進了房子的步兵第一版不會再動它）
    const forward = wave.filter(u => kind(u).armored && !atBase(u));
    const going = st.go !== undefined && w.tick - st.go <= WAVE_GO;
    // 殘兵：前面的車剩不到出發時的三分之一，而且看得到的敵人比自己多 → 撤回集結點。
    const retreat = !going && st.size !== undefined && forward.length > 0 && forward.length * 3 < st.size && seen.length > forward.length;
    // 前面還有一組人、而且不是殘兵（打贏了、或還在打）：新出的直接去會合，不在基地等。只有前面沒人了、或殘兵撤回來，才在基地湊下一波
    // （量過：鄉間 64 經典規則對第一版，一律在基地等 36%、完全不等 52%——打贏第一場之後還把援軍留在家裡，會把贏面等掉）
    // 「一組人」＝至少一台車，或至少兩個單位：一個班自己蹲在前面的房子裡不算（不然新出的永遠一台一台送上去）。
    // 量過（鄉間 64、兩條規則、種子 21–80 對調共 120 局）：只算車 → 援軍常被留在家裡，對第一版的勝率掉二三十個百分點；這樣算是 88%
    const support = st.go !== undefined && !retreat && (forward.length > 0 || wave.filter(u => !atBase(u)).length >= 2);
    if (support || !home.length) delete st.gather;   // 沒有人在等（都出去了、或等的人都陣亡了）：不算在集結
    else if (!going && st.gather === undefined) st.gather = w.tick;
    if (!going && !support && st.gather !== undefined && (home.length >= WAVE[lv] || w.tick - st.gather >= WAVE_WAIT)) {   // 放行（一定有人在基地：沒有人的話上面已經把 gather 拿掉了）
      st.go = w.tick; st.size = wave.filter(u => kind(u).armored).length; delete st.gather;
    } else if (!going && !support) {
      const rally: number[] = [];
      for (const u of mine.filter(held)) {
        const here = atBase(u);
        if (!here && !(retreat && kind(u).armored)) continue;
        const t = targetOf(u);
        if (here && t && dist(u.x, u.z, t.x, t.z) <= kind(u).range + DEFEND_CELLS * SUB) continue;   // 看得到的敵人打到附近：照第一版還手
        if (dist(u.x, u.z, rallyX, rallyZ) > RALLY_CELLS * SUB && !movingTo(u, at[0], at[1])) rally.push(u.id);
        else override.set(u.id, null);   // 已經在集結點附近（或正在去）：這一次不動
      }
      if (rally.length) { const cmd: AiCmd = { t: 'move', side, ids: rally, x: at[0], z: at[1] }; for (const id of rally) override.set(id, cmd); }
    }
  }

  // ---- 2. 懂穿甲（rules.ap）：手上的目標打不穿 → 換打得穿的（射程內優先，其次射程外看得到的）→ 落單的繞側面 → 都不行就不打、退開 ----
  const shooters = mine.filter(u => PEN_MM[u.kind] !== undefined && !kind(u).indirect && kind(u).men === 0);
  const hopeless = new Set<number>();   // 看得到、有裝甲、我方沒有任何一門直射砲在一格的距離打得穿它正面的（給砲兵優先打）
  if (w.rules?.ap) {
    for (const t of seen) { const plate = ARMOR_MM[t.kind]; if (kind(t).armored && plate && !shooters.some(u => penetration(u.kind, SUB) >= plate[0])) hopeless.add(t.id); }
    const flankers = new Map<number, { u: Unit; cell: [number, number] }[]>();   // 目標 id → 想繞它的車與繞到哪
    const giveUp = (u: Unit, t: Unit) => {   // 不對它下攻擊指令；人在它的射程裡就背對它退開
      if (dist(u.x, u.z, t.x, t.z) <= kind(t).range) { const [bx, bz] = freeToward(u.x, u.z, 2 * u.x - t.x, 2 * u.z - t.z, FLANK_CELLS); moveTo(u, bx, bz); }
      else override.set(u.id, null);
    };
    for (const u of shooters) {
      const t = targetOf(u), k = kind(u);
      if (!t || !kind(t).armored || apHit(u.kind, u.x, u.z, t) !== 0) continue;
      const worth = (e: Unit) => !kind(e).armored || apHit(u.kind, u.x, u.z, e) === 1;   // 從現在的位置打得穿、或根本沒有裝甲
      const reachable = seen.filter(e => e !== t && worth(e)), inRange = reachable.filter(e => dist(u.x, u.z, e.x, e.z) <= k.range);
      const better = nearest(u, inRange.filter(e => kind(e).armored)) ?? nearest(u, inRange);
      if (better) { override.set(u.id, { t: 'attack', side, ids: [u.id], target: better.id }); continue; }
      const plate = ARMOR_MM[t.kind], mobile = k.armored && !k.setup;   // 會自己開過去的車（砲、要架起來才能打的不追）
      // （試過「靠近一點就打得穿這一面 → 開近了再打」：大地圖兩條規則對第一版 160 局，有它 83%、沒有 86%，沒有留）
      // 射程外看得到打得穿的、或沒有裝甲的：改打那個（攻擊指令會自己開進射程）
      const far = mobile ? nearest(u, reachable) : undefined;
      if (far) { override.set(u.id, { t: 'attack', side, ids: [u.id], target: far.id }); continue; }
      // 繞側面：只有封閉車身的車去；目標要落單；目標車身方向的垂直線上、離它 FLANK_CELLS 格的兩個點，取離自己近的那個
      if (plate && mobile && !k.openTop && penetration(u.kind, FLANK_CELLS * SUB) >= plate[1] && (t.hullX || t.hullZ) && !seen.some(e => e !== t && dist(e.x, e.z, t.x, t.z) <= FLANK_ALONE * SUB)) {
        const hx = t.hullX ?? 0, hz = t.hullZ ?? 0, len = Math.max(1, dist(0, 0, hx, hz)), px = Math.trunc((-hz * FLANK_CELLS * SUB) / len), pz = Math.trunc((hx * FLANK_CELLS * SUB) / len);
        const a: [number, number] = [t.x + px, t.z + pz], b: [number, number] = [t.x - px, t.z - pz], pick = dist(u.x, u.z, a[0], a[1]) <= dist(u.x, u.z, b[0], b[1]) ? a : b;
        const cell = freeNear(w, clampCell(w, cellOf(pick[0])), clampCell(w, cellOf(pick[1])));
        if (cell) { if (!flankers.has(t.id)) flankers.set(t.id, []); flankers.get(t.id)!.push({ u, cell }); continue; }
      }
      giveUp(u, t);
    }
    // 一個目標只派離繞點最近的那一台去繞，其餘的放棄
    for (const [id, list] of flankers) {
      const t = w.units[id - 1], best = list.slice().sort((p, q) => dist(p.u.x, p.u.z, center(p.cell[0]), center(p.cell[1])) - dist(q.u.x, q.u.z, center(q.cell[0]), center(q.cell[1])) || p.u.id - q.u.id)[0];
      for (const f of list) if (f === best) moveTo(f.u, f.cell[0], f.cell[1]); else giveUp(f.u, t);
    }
  }

  // ---- 3. 懂壓制（rules.morale）----
  if (w.rules?.morale) {
    // 找掩體：受壓（還能動）、人在空地上的步兵與觀測員 → 最近的房子；沒有就往自己那一側退兩格
    for (const u of mine) {
      if ((u.kind !== UK_INFANTRY && u.kind !== UK_OBSERVER) || u.rout || moraleState(u) !== MORALE_SHAKEN || coverPct(w, u) < 100) continue;
      let pick: [number, number] | null = null, pd = 0;
      for (const b of w.blds) {
        if (b.hp <= 0 || b.builtBy === 1 - side) continue;
        const bd = dist(center(b.x), center(b.z), u.x, u.z);
        if (bd <= COVER_CELLS * SUB && (!pick || bd < pd)) { pick = [b.x, b.z]; pd = bd; }
      }
      const [gx, gz] = pick ?? toward(w, u.x, u.z, homeX, homeZ, 2);
      if (cellOf(u.x) === gx && cellOf(u.z) === gz) override.set(u.id, null); else moveTo(u, gx, gz);
    }
    // 再突擊：對方步兵或砲組被釘住、潰退的時候，步兵比平常多走幾格過去打
    for (const f of mine) {
      if (f.kind !== UK_INFANTRY || override.has(f.id) || moraleState(f) !== 0 || targetOf(f)) continue;
      const reach = kind(f).range + (2 + ASSAULT_EXTRA) * SUB;
      const down = nearest(f, seen.filter(t => !kind(t).armored && moraleState(t) >= MORALE_PINNED && dist(f.x, f.z, t.x, t.z) <= reach));
      if (down) override.set(f.id, { t: 'attack', side, ids: [f.id], target: down.id });
    }
  }

  // ---- 4. 砲兵 ----
  // 對方聽到的、關於我方砲位的報告：它完全由我方自己的開火事件算出來，等於自己數「同一小格打了幾發」，不是偷看
  const heardOfMe = (w.counterbattery ?? []).filter(r => r.side === 1 - side && r.shots >= GUN_SHOTS && w.tick - r.last < COUNTERBATTERY_TTL);
  const located = counterbatteryAreas(w, side).filter(a => a.level >= 2);
  for (const g of mine) {
    if (!kind(g).indirect) continue;
    const k = kind(g), inReach = (x: number, z: number) => { const d = dist(g.x, g.z, x, z); return d <= k.range && d >= k.minRange; };
    // 打三發換陣地：挪到隔壁的小格（對方對一個粗區只記最後聽到的那一小格，換了小格再開砲，它就得從頭數）。
    // 往哪邊照自己所在小格的奇偶決定，所以是跟同一個 4×4 區塊裡的鄰格來回，不會越走越遠；那兩格都被擋住才往區塊外挪
    const here = soundCell(w, g.x, g.z);
    if (g.pathIdx >= g.path.length && heardOfMe.some(r => r.zone === here.zone && r.cell === here.cell)) {
      const cx = cellOf(g.x), cz = cellOf(g.z), dx = (cx >> 1) & 1 ? -SOUND_CELL : SOUND_CELL, dz = (cz >> 1) & 1 ? -SOUND_CELL : SOUND_CELL;
      const spot = ([[dx, 0], [0, dz], [-dx, 0], [0, -dz]] as const).map(([px, pz]) => [cx + px, cz + pz] as [number, number]).find(([x, z]) => inGrid(w, x, z) && !blocks(w, x, z));
      if (spot) { override.set(g.id, { t: 'move', side, ids: [g.id], x: spot[0], z: spot[1] }); continue; }
    }
    if (override.has(g.id)) continue;   // 在基地等、正要移動：不改它的目標
    const ok = seen.filter(t => inReach(t.x, t.z));
    // 目標：打不穿的車（穿甲規則）→ 對方的機槍組（R080，第三版）→ 迫擊砲先壓還沒被釘住的軟目標（士氣規則）→ 其餘照第一版
    const want = nearest(g, ok.filter(t => hopeless.has(t.id)))
      ?? (st.v === 3 ? nearest(g, ok.filter(t => t.kind === UK_MG)) : undefined)
      ?? (w.rules?.morale && g.kind === UK_MORTAR ? nearest(g, ok.filter(t => !kind(t).armored && moraleState(t) < MORALE_PINNED)) ?? nearest(g, ok.filter(t => !kind(t).armored)) : undefined);
    if (want) { override.set(g.id, g.order === ORD_ATTACK && g.target === want.id ? null : { t: 'attack', side, ids: [g.id], target: want.id }); continue; }
    // 反砲兵射擊：沒有看得到、打得到的目標，手上沒有在打活的目標，也不是正在（或正要）轟對方指揮部 → 朝聽出來的那一區打；那附近有自己人就不打
    const cur = g.order === ORD_ATTACK ? w.units[g.target - 1] : null, c = given.get(g.id);
    const onHq = (x: number, z: number) => !!foeHq && x >= foeHq.x && x < foeHq.x + foeHq.w && z >= foeHq.z && z < foeHq.z + foeHq.d;
    if (ok.length || (cur && cur.alive) || g.kind !== UK_HOWITZER || g.pathIdx < g.path.length) continue;
    if ((c && c.t === 'fireAt' && onHq(c.x, c.z)) || (g.order === ORD_FIRE_AT && onHq(g.tx, g.tz))) continue;
    const area = located.filter(a => inReach(a.x, a.z) && !mine.some(u => dist(u.x, u.z, a.x, a.z) <= GUN_SAFE * SUB))
      .sort((a, b) => b.level - a.level || dist(g.x, g.z, a.x, a.z) - dist(g.x, g.z, b.x, b.z) || a.x - b.x || a.z - b.z)[0];
    if (!area) continue;
    const ax = clampCell(w, cellOf(area.x)), az = clampCell(w, cellOf(area.z));
    override.set(g.id, g.order === ORD_FIRE_AT && g.tx === ax && g.tz === az && g.target > 0 ? null : { t: 'fireAt', side, ids: [g.id], x: ax, z: az });
  }

  // ---- 5. 機槍組（R080；只有第三版。場上沒有機槍組時這一段一條指令都不會下）----
  if (st.v === 3) {
    for (const [u, c] of machineGuns3(w, st, mine, seen, id => override.has(id))) override.set(u.id, c);
    const foeMg = seen.filter(t => t.kind === UK_MG);
    if (foeMg.length) for (const u of mine) {
      if (!kind(u).armored || kind(u).indirect || override.has(u.id)) continue;   // 直射的車；前面的段落已經替它決定的（在基地等、繞側面、退開）不改
      const m = mgTargetFor(u, targetOf(u), foeMg, w);
      if (m) override.set(u.id, { t: 'attack', side, ids: [u.id], target: m.id });
    }
  }

  // ---- 合起來：第一版的指令拿掉被改寫的單位，再接上第二版的。一條群組指令只留「最後還是歸它管」的那些單位（前面的段落排進去、後面的段落又改掉的不算）----
  const out: AiCmd[] = [];
  if (st.v === 3) { const kind = produce3(w, st, mine, seen); if (kind !== null) out.push({ t: 'produce', side, kind }); }   // R078 第三版：生產照 ai3.ts，第一版下的那一條不用
  for (const c of base) {
    if (c.t === 'produce') { if (st.v !== 3) out.push(c); continue; }
    const ids = c.ids.filter(id => !override.has(id));
    if (ids.length) out.push({ ...c, ids });
  }
  const done = new Set<AiCmd>();
  for (const u of mine) {
    const c = override.get(u.id);
    if (!c || c.t === 'produce' || done.has(c)) continue;
    done.add(c);
    const ids = c.ids.filter(id => override.get(id) === c);
    if (ids.length) out.push({ ...c, ids });
  }
  return out;
}
