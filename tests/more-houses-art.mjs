// R087 更多房屋（畫法）：src/render/moreArt.ts 的烘房、風車、倉庫。長相、佔地與點選、顏色、三角形、替代的樣子、沒有 more 的世界一點不動。
// 用法：node tests/more-houses-art.mjs            全部跑，另外故意弄壞幾次（隔離副本），確認第一個紅燈落在指定的斷言上
//       node tests/more-houses-art.mjs <群組名>   只跑那一群（隔離副本裡用）
// 模擬在 tests/more-houses.mjs；真的 Chrome 在 tests/more-houses-browser.mjs。
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import * as W from '../src/sim/world.ts';
import { step } from '../src/sim/step.ts';
import * as B from '../src/render/buildings.ts';
import * as M from '../src/render/moreArt.ts';
import { Geo } from '../src/render/geo.ts';
import { luma } from '../src/render/houseArt.ts';

const { BK_OAST, BK_MILL, BK_WAREHOUSE, BK_HOUSE, BK_COTTAGE, BK_BARN, STAGE_INTACT, STAGE_ROOFLESS, STAGE_RUBBLE } = W;
const NEW = [BK_OAST, BK_MILL, BK_WAREHOUSE], MAPS = [0, 1, 2, 3, 4];
const prod = (art = true, more = true) => { B.setWalls(true); B.setWireDetail(true); B.setMaterials(true); B.setBuildingDetails(true); B.setDamageDetails(true); B.setFacades(true); B.setHouseArt(art); B.setMoreArt(more); };
const ECO = { t: 'eco', inf: 1, guns: 1, tanks: 1, armor2: 1 };
const world = (map, more, seed = 1944) => { const w = W.createWorld(seed); step(w, [{ t: 'map', id: map, vegetation: 1, ...(more ? { more: 1 } : {}) }, ECO]); return w; };
const fp = g => { const h = createHash('sha256'); for (const a of [g.pos, g.nor, g.col]) h.update(Buffer.from(new Float32Array(a).buffer)); return h.digest('hex').slice(0, 16); };
const hexAt = (g, i) => new THREE.Color(g.col[i], g.col[i + 1], g.col[i + 2]).getHex();
const rgb = hex => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const tris = g => { const out = []; for (let i = 0; i < g.pos.length; i += 9) out.push({ p: [g.pos.slice(i, i + 3), g.pos.slice(i + 3, i + 6), g.pos.slice(i + 6, i + 9)], n: g.nor.slice(i, i + 3), c: hexAt(g, i) }); return out; };
const geoOf = (b, stage = STAGE_INTACT) => B.buildingGeo(new Geo(), b, stage);
const area = t => { const [a, b, c] = t.p, u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]; return Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2; };
const VOID = 0x1e1c1a, SAIL = 0xd8d4c8, OAKD = 0x3a2a1f, TAR = 0x2f2b28, QUAY_DOOR = 0xa89a80, COWL = 0xe0dacb;
// 在動 src/sim 之前（139f2fb、R086 開著）量的整鎮指紋：[整鎮, 三角形, 三段損壞]（96 圖另有遠景一、二）
const FROZEN = { 0: ['1d8d66490814ecc7', 5692, '5ff3a3840e7ea0eb'], 1: ['c5a2b480b2860c07', 8166, 'f0ac4b9a393f1fca'], 2: ['bc5364f90a382504', 16830, '25f73fd0f7612819'], 3: ['e3475b040f42a3b0', 57816, 'b716221fe54fba34', '234aac64be272d11', 7084, 'eb9bdc868d1fb346', 4206], 4: ['41c14070da586c79', 2452, '091237211fcebe2e'] };
const CAPS = { 0: 1400, 1: 700, 2: 2800, 3: 4600, 4: 900 }, LOD_CAPS = [900, 400];
const PER = { [BK_OAST]: [260, 40, 16], [BK_MILL]: [160, 32, 16], [BK_WAREHOUSE]: [240, 24, 12] };
const worlds = Object.fromEntries(MAPS.map(m => [m, world(m, true)]));
const fresh = m => worlds[m].blds.filter(b => NEW.includes(b.kind));
const all = () => MAPS.flatMap(m => fresh(m));

const groups = {
  // 模組預設關著（main.ts 照閥打開）；沒有 more 的世界開著 R087 的模組，每一個指紋都等於 R086 開著時凍結的
  inert() {
    assert.match(readFileSync(new URL('../src/render/buildings.ts', import.meta.url), 'utf8'), /let moreArtOn = false;/, 'inert: the module starts off (main.ts turns it on from the valve)');
    prod(true, true);
    for (const m of MAPS) {
      const w = world(m, false), town = B.buildTown(w), stages = new Geo();
      for (const b of w.blds) for (const st of [STAGE_INTACT, STAGE_ROOFLESS, STAGE_RUBBLE]) B.buildingGeo(stages, b, st);
      const got = [fp(town), town.triangles, fp(stages)];
      if (m === 3) { const l1 = B.buildTown(w, undefined, 1), l2 = B.buildTown(w, undefined, 2); got.push(fp(l1), l1.triangles, fp(l2), l2.triangles); }
      assert.deepEqual(got, FROZEN[m], `inert: a world without more draws exactly what R086 drew (map ${m})`);
    }
  },
  // 長相：烘房的風帽頂、看得到的暗開口；風車四片帆；倉庫牆高、吊貨小屋、三扇裝貨門；高出牆加屋頂的東西；空殼少掉的東西
  shape() {
    prod();
    for (const b of all()) {
      const t = tris(geoOf(b)), ys = t.flatMap(x => x.p.map(p => p[1])), top = Math.max(...ys);
      if (b.kind === BK_OAST) {
        const cowl = t.filter(x => x.c === COWL), cowlTop = Math.max(...cowl.flatMap(x => x.p.map(p => p[1])));
        assert(cowlTop >= 1.40 && cowlTop <= 1.50, `shape: the oast cowl tops out at 1.40-1.50 (building ${b.id}: ${cowlTop.toFixed(3)})`);
        assert(t.some(x => x.c === VOID && (x.n[0] > 0.9 || x.n[2] > 0.9)), `shape: the cowl's dark mouth faces the camera (building ${b.id})`);
        assert(top >= M.OAST.stowWall + M.OAST.stowRise + 0.10, `shape: the oast has something at least 0.10 above its walls and roof (building ${b.id})`);
      } else if (b.kind === BK_MILL) {
        // 帆分成四組：在軸頭的上或下、左或右（橫向是 B＝(1,0,−1)/√2，看 x−z 比軸頭大或小）
        const sails = t.filter(x => x.c === SAIL), groupsOf = new Map(), hub = [b.x + 0.5 + M.MILL.out * Math.SQRT1_2, M.MILL.hub, b.z + 0.5 + M.MILL.out * Math.SQRT1_2];
        for (const x of sails) { const c = x.p.reduce((s, p) => [s[0] + p[0] / 3, s[1] + p[1] / 3, s[2] + p[2] / 3], [0, 0, 0]); const k = `${c[1] > hub[1] ? 'up' : 'down'}-${c[0] - c[2] > hub[0] - hub[2] ? 'right' : 'left'}`; groupsOf.set(k, [...(groupsOf.get(k) ?? []), x]); }
        assert.equal(groupsOf.size, 4, `shape: the mill has four sails (building ${b.id})`);
        for (const [k, g] of groupsOf) {   // 長度：沿那一片的方向（軸頭到那一片中心）量頭尾
          const ps = g.flatMap(x => x.p), c = ps.reduce((s, p) => [s[0] + p[0] / ps.length, s[1] + p[1] / ps.length, s[2] + p[2] / ps.length], [0, 0, 0]);
          const d = [c[0] - hub[0], c[1] - hub[1], c[2] - hub[2]], l = Math.hypot(...d), proj = ps.map(p => ((p[0] - hub[0]) * d[0] + (p[1] - hub[1]) * d[1] + (p[2] - hub[2]) * d[2]) / l);
          assert(Math.max(...proj) - Math.min(...proj) >= 0.55, `shape: every sail is at least 0.55 long (building ${b.id}, sail ${k}: ${(Math.max(...proj) - Math.min(...proj)).toFixed(3)})`);
        }
        const low = Math.min(...sails.flatMap(x => x.p.map(p => p[1])));
        assert(low >= 0.95, `shape: the lowest sail tip stays at 0.95 or higher (building ${b.id}: ${low.toFixed(3)})`);
        assert(top >= M.MILL.bodyTop + M.MILL.capRise + 0.10, `shape: the mill has something at least 0.10 above its tower and cap (building ${b.id})`);
      } else {
        const h = B.wallHeight(b), wallTop = Math.max(...t.filter(x => x.c === TAR && Math.abs(x.n[1]) < 0.1).flatMap(x => x.p.map(p => p[1])).filter(y => y <= h + 0.001));
        assert(Math.abs(wallTop - 1.18) <= 0.01 && Math.abs(h - 1.18) <= 0.01, `shape: the warehouse walls stand 1.18 high (building ${b.id})`);
        const alongX = b.w >= b.d, out = x => alongX ? x.p.every(p => p[2] > b.z + b.d - 0.1 + 0.02) : x.p.every(p => p[0] > b.x + b.w - 0.1 + 0.02);
        assert(t.some(x => x.c === TAR && out(x) && x.p.every(p => p[1] >= 0.95)), `shape: the warehouse has a lucam out from its visible long side (building ${b.id})`);
        const doors = new Set(t.filter(x => x.c === QUAY_DOOR).map(x => Math.round(Math.min(...x.p.map(p => p[1])) * 100)));
        assert(doors.size >= 3, `shape: the warehouse has at least three stacked loading doors (building ${b.id}: ${doors.size})`);
      }
      const shell = tris(geoOf(b, STAGE_ROOFLESS)), look = M.moreLook(b), colors = new Set(shell.map(x => x.c));
      if (b.kind === BK_OAST) assert(!colors.has(COWL) && !colors.has(look.cone.getHex()), `shape: a roofless oast has no cowl and no cone (building ${b.id})`);
      if (b.kind === BK_MILL) assert(!colors.has(SAIL) && !colors.has(look.roof.getHex()), `shape: a roofless mill has no cap and no sails (building ${b.id})`);
      if (b.kind === BK_WAREHOUSE) assert(!colors.has(look.roof.getHex()), `shape: a roofless warehouse has no roof (building ${b.id})`);
    }
  },
  // 佔地與點選：每個頂點都在佔地裡（風帆最多伸出 0.15）；格子中心與中心 ±0.35 往下打不會打到帆；倒塌殘影＝整鎮網格裡那一段
  footprint() {
    prod();
    const hit = (t, x, z) => { const [a, b, c] = t.p, d = (b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0]); if (Math.abs(d) < 1e-9) return false; const u = ((x - a[0]) * (c[2] - a[2]) - (z - a[2]) * (c[0] - a[0])) / d, v = ((b[0] - a[0]) * (z - a[2]) - (b[2] - a[2]) * (x - a[0])) / d; return u >= 0 && v >= 0 && u + v <= 1; };
    for (const m of MAPS) for (const b of fresh(m)) for (const st of [STAGE_INTACT, STAGE_ROOFLESS, STAGE_RUBBLE]) {
      for (const t of tris(geoOf(b, st))) for (const p of t.p) {
        const out = Math.max(b.x - p[0], p[0] - (b.x + b.w), b.z - p[2], p[2] - (b.z + b.d), 0), sail = t.c === SAIL || t.c === OAKD;
        assert(out <= (sail && b.kind === BK_MILL ? 0.15 : 1e-6), `footprint: every vertex stays on the footprint (sails at most 0.15 out; map ${m}, building ${b.id} kind ${b.kind}, stage ${st}, ${out.toFixed(3)} out)`);
      }
      if (b.kind === BK_MILL && st === STAGE_INTACT) {
        const sails = tris(geoOf(b)).filter(t => t.c === SAIL || (t.c === OAKD && t.p.some(p => p[1] > 1.2)));
        for (const [dx, dz] of [[0, 0], [0.35, 0], [-0.35, 0], [0, 0.35], [0, -0.35]]) assert(!sails.some(t => hit(t, b.x + 0.5 + dx, b.z + 0.5 + dz)), `footprint: a ray straight down at the cell centre or 0.35 off it misses the sails (building ${b.id}, ${dx},${dz})`);
      }
    }
    for (const m of [0, 3]) { const w = worlds[m]; for (const b of fresh(m)) { const one = B.buildTown(w, o => o.id !== b.id); assert.equal(fp(one), fp(geoOf(b, W.stageOf(b))), `footprint: the collapse ghost is that building's slice of the town mesh (map ${m}, building ${b.id})`); } }
  },
  // 顏色：照 R086 的規矩
  look() {
    prod();
    const blue = [rgb(0x3b6fb6), rgb(0x3b7fd6)], red = rgb(0xc9452f);
    for (const b of all()) {
      const l = M.moreLook(b), wall = rgb(l.wall.getHex()), roof = rgb(l.roof.getHex()), door = rgb(l.door.getHex());
      assert(Math.abs(luma(wall) - luma(roof)) >= 18, `look: wall and roof differ in lightness by at least 18 (building ${b.id})`);
      const doorWall = b.kind === BK_WAREHOUSE ? wall : rgb(l.brick.getHex());
      assert(dist(door, doorWall) >= 45, `look: the doors stand out from the wall they are on (building ${b.id})`);
      if (b.kind === BK_OAST) { const br = rgb(l.brick.getHex()); assert(br[0] / br[1] >= 1.55, `look: the oast brick reads as brick (r/g >= 1.55; building ${b.id})`); }
      else assert(wall[0] / wall[1] <= 1.45, `look: the mill and the warehouse read as wood (r/g <= 1.45; building ${b.id})`);
      for (const t of tris(geoOf(b))) {
        if (t.c === VOID) continue;   // 風帽的開口：故意的暗
        const v = rgb(t.c);
        assert(v.every(x => x >= 30 && x <= 235), `look: every colour drawn is within 30-235 (building ${b.id}, ${t.c.toString(16)})`);
        assert(blue.every(c => dist(v, c) >= 40) && dist(v, red) >= 45, `look: nothing is close to the team colours (building ${b.id}, ${t.c.toString(16)})`);
      }
      if (b.kind === BK_OAST) {   // 看得到的牆（朝 +x、+z 的直立面）至少一半是磚
        let brick = 0, total = 0;
        for (const t of tris(geoOf(b))) if (Math.abs(t.n[1]) < 0.3 && t.n[0] + t.n[2] > 0.3 && t.c !== VOID) { const a = area(t); total += a; const v = rgb(t.c); if (v[0] / v[1] >= 1.55) brick += a; }
        assert(brick >= total / 2, `look: at least half of the oast's visible wall is brick (building ${b.id}: ${(brick / total * 100).toFixed(0)}%)`);
      }
    }
    for (const k of NEW) { const p = B.bldColors(k); assert(p && p.wall && p.roof, `look: bldColors has a palette for kind ${k}`); }
  },
  // 三角形：每一棟、遠景、整鎮的增加
  budget() {
    prod();
    for (const b of all()) {
      const lim = PER[b.kind], cap0 = b.kind === BK_WAREHOUSE && b.w === 2 && b.d === 2 ? 300 : lim[0];
      assert(geoOf(b).triangles <= cap0, `budget: an intact ${b.kind} stays within ${cap0} triangles (building ${b.id}: ${geoOf(b).triangles})`);
      for (const lod of [1, 2]) { const n = B.buildTown({ blds: [b], wires: { segments: [] } }, undefined, lod).triangles; assert(n <= lim[lod], `budget: the distant level ${lod} of a ${b.kind} stays within ${lim[lod]} (building ${b.id}: ${n})`); }
    }
    for (const m of MAPS) {
      const more = B.buildTown(worlds[m]).triangles, base = FROZEN[m][1];
      console.log(`  map ${m}: town +${more - base} triangles`);
      assert(more - base <= CAPS[m], `budget: the town grows by at most ${CAPS[m]} triangles (map ${m}: +${more - base})`);
    }
    for (const lod of [1, 2]) { const d = B.buildTown(worlds[3], undefined, lod).triangles - FROZEN[3][lod === 1 ? 4 : 6]; assert(d <= LOD_CAPS[lod - 1], `budget: the 96 distant level ${lod} grows by at most ${LOD_CAPS[lod - 1]} (+${d})`); }
  },
  // 替代的樣子：閥關著時新房型照看起來像的舊種類畫（完好、三段、遠景）；開關兩邊顏色查表一致
  fallback() {
    const like = { [BK_OAST]: BK_HOUSE, [BK_MILL]: BK_COTTAGE, [BK_WAREHOUSE]: BK_BARN };
    for (const art of [true, false]) {
      prod(art, false);
      for (const b of all()) {
        const as = { ...b, kind: like[b.kind] };
        for (const st of [STAGE_INTACT, STAGE_ROOFLESS, STAGE_RUBBLE]) assert.equal(fp(geoOf(b, st)), fp(geoOf(as, st)), `fallback: with the valve off a ${b.kind} draws exactly like a ${like[b.kind]} (building ${b.id}, stage ${st}, R086 ${art})`);
        for (const lod of [1, 2]) assert.equal(fp(B.buildTown({ blds: [b], wires: { segments: [] } }, undefined, lod)), fp(B.buildTown({ blds: [as], wires: { segments: [] } }, undefined, lod)), `fallback: the distant levels follow the same old kind (building ${b.id}, level ${lod})`);
        assert.equal(B.bldColorsOf(b).wall.getHex(), B.bldColorsOf(as).wall.getHex(), `fallback: debris colours follow the old kind too (building ${b.id})`);
        assert.equal(B.roofRise(b.kind), B.roofRise(like[b.kind]), `fallback: the health bar height follows the old kind (kind ${b.kind})`);
      }
    }
    prod(true, true);
    for (const k of NEW) assert.equal(B.roofRise(k), M.MORE_RISE[k], `fallback: with the module on the new kinds have their own height (kind ${k})`);
  },
};

const only = process.argv[2];
if (only) { assert(groups[only], `unknown group ${only}`); groups[only](); console.log(`more-houses-art/${only}: OK`); process.exit(0); }
for (const [name, run] of Object.entries(groups)) { const t0 = performance.now(); run(); console.log(`OK more-houses-art/${name} (${((performance.now() - t0) / 1000).toFixed(1)} s)`); }

// ---- 故意弄壞 ----
const root = resolve(fileURLToPath(new URL('..', import.meta.url))), temp = mkdtempSync(join(tmpdir(), 'r087-art-negative-'));
const mutants = [
  ['sail_over_centre', 'footprint', 'src/render/moreArt.ts', 'hub: 1.45, out: 0.40,', 'hub: 1.45, out: 0.0,', 'footprint: a ray straight down'],
  ['no_fallback', 'fallback', 'src/render/buildings.ts', '  if (!moreArtOn && isMoreKind(b.kind)) b = { ...b, kind: MORE_LIKE[b.kind] };   // R087 閥關著：照看起來像的舊種類畫\n', '', 'fallback: with the valve off'],
  ['stone_quay', 'look', 'src/render/moreArt.ts', 'TAR = C(0x2f2b28)', 'TAR = C(0xb2aea0)', 'look:'],
  ['fat_mill', 'budget', 'src/render/moreArt.ts', '  for (const y of [0.62, 0.95]) {', '  for (const y of [0.62, 0.95, 0.4, 0.42, 0.45, 0.48, 0.5, 0.52, 0.55, 0.58, 0.7, 0.72, 0.75, 0.78, 0.8, 0.85, 0.9, 1.0, 1.05, 1.1, 0.35]) {', 'budget: an intact 12 stays within 160'],
  ['low_sails', 'shape', 'src/render/moreArt.ts', 'sail1: 0.62,', 'sail1: 0.72,', 'shape: the lowest sail tip'],
  ['no_lucam', 'shape', 'src/render/moreArt.ts', "    g.box(x1 - 0.12, ly0, m - lw, x1 + ld, ly1, m + lw, TAR, null); g.gable(x1 - 0.12, m - lw - 0.01, x1 + ld + 0.01, m + lw + 0.01, ly1, 0.08, true, look.roof, TAR);", "    void ly1;", 'shape: the warehouse has a lucam'],
  ['leaks', 'inert', 'src/render/buildings.ts', 'const moreShown = (b: Building) => moreArtOn && isMoreKind(b.kind);', 'const moreShown = (b: Building) => moreArtOn && (isMoreKind(b.kind) || b.kind === BK_BARN);', 'inert: a world without more draws exactly what R086 drew'],
];
try {
  for (const [name, group, file, from, to, wanted] of mutants) {
    const dir = join(temp, name);
    for (const d of ['src', 'tests']) mkdirSync(join(dir, d), { recursive: true });
    cpSync(join(root, 'src'), join(dir, 'src'), { recursive: true });
    cpSync(join(root, 'tests/more-houses-art.mjs'), join(dir, 'tests/more-houses-art.mjs'));
    writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
    if (!existsSync(join(dir, 'node_modules'))) symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'), 'junction');
    const path = join(dir, file), source = readFileSync(path, 'utf8');
    assert.equal(source.split(from).length, 2, `${name}: unique mutation anchor`);
    writeFileSync(path, source.replace(from, to));
    const r = spawnSync(process.execPath, [join(dir, 'tests/more-houses-art.mjs'), group], { encoding: 'utf8', timeout: 120000 }), output = `${r.stdout}\n${r.stderr}`;
    assert.equal(r.error, undefined, `${name}: child starts and completes`);
    assert.notEqual(r.status, 0, `${name}: mutation must fail`);
    const first = /AssertionError \[ERR_ASSERTION\]: ([^\r\n]+)/.exec(output)?.[1] ?? '';
    assert(first.startsWith(wanted), `${name}: intended assertion must fail first (wanted "${wanted}"), got ${first || output.slice(-1500)}`);
    console.log(`OK more-houses-art-negative/${name}: ${first}`);
  }
} finally { rmSync(temp, { recursive: true, force: true }); }
console.log(`more-houses-art: all groups OK, ${mutants.length} isolated mutants rejected`);
