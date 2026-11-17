// R086 房屋細化（不開瀏覽器的部分）。畫面對照在 tests/house-art-browser.mjs。
// 閥（關著＝d5dd980 的凍結指紋）、只在 R134 開著時有作用、損壞階段只換顏色、看不見的面不畫細節（被拿掉的都在背面）、
// 格子中心的屋頂高度不變、遠景、三角形預算、顏色規則、樣式與分佈、碎片與彈痕照那一棟的顏色、接線。
// 用法：node tests/house-art.mjs            全部跑，另外故意弄壞幾次（隔離副本），確認第一個紅燈落在指定的斷言上
//       node tests/house-art.mjs <群組名>   只跑那一群（隔離副本裡用）
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import * as THREE from 'three';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const src = rel => readFileSync(join(root, rel), 'utf8');
const linkModules = dir => symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'), 'junction');   // 隔離副本也找得到 three
const imp = (base, p) => import(pathToFileURL(join(base, p)).href);
const W = await imp(root, 'src/sim/world.ts'), S = await imp(root, 'src/sim/step.ts'), B = await imp(root, 'src/render/buildings.ts'), { Geo } = await imp(root, 'src/render/geo.ts');
const A = await imp(root, 'src/render/houseArt.ts');
const { BK_HOUSE, BK_COTTAGE, BK_BARN, BK_CHURCH, BK_SHOP, BK_HQ, BK_PILLBOX, BK_WALL_BRICK, BK_WALL_STONE, BK_WALL_CONCRETE, STAGE_INTACT, STAGE_ROOFLESS, STAGE_RUBBLE } = W;
const prod = (Bm = B, art = true) => { Bm.setWalls(true); Bm.setWireDetail(true); Bm.setMaterials(true); Bm.setBuildingDetails(true); Bm.setDamageDetails(true); Bm.setFacades(true); Bm.setHouseArt(art); };
const fp = g => { const h = createHash('sha256'); for (const a of [g.pos, g.nor, g.col]) h.update(Buffer.from(new Float32Array(a).buffer)); return h.digest('hex').slice(0, 16); };
const ECO = { t: 'eco', inf: 1, guns: 1, tanks: 1, armor2: 1 };
const world = map => { const w = W.createWorld(1944); S.step(w, [{ t: 'map', id: map, vegetation: 1 }, ECO]); return w; };
const MAPS = [0, 1, 2, 3, 4], worlds = Object.fromEntries(MAPS.map(m => [m, world(m)]));
const CIV = [BK_HOUSE, BK_COTTAGE, BK_BARN, BK_SHOP], civ = b => CIV.includes(b.kind);
const geoOf = (b, st = STAGE_INTACT, Bm = B) => Bm.buildingGeo(new Geo(), b, st);
// 凍結的「關著」指紋（d5dd980，種子 1944、開局補給；卡面同一張表）
const FROZEN = {
  0: { town: '88456568bba7687d', stages: '9cd0fc47ed7915f6', tris: 6864 },
  1: { town: 'acacaffb50843fff', stages: 'f29900e2c9449aa5', tris: 11218 },
  2: { town: '4c971d8eeeb29505', stages: '713220b19591c345', tris: 23604 },
  3: { town: '05202093063be476', stages: 'c043fbeb92648c8d', tris: 79346, lod1: '1fdfa75a6599d906', lod1Tris: 7084, lod2: 'f237aa264b57f279', lod2Tris: 4206 },
  4: { town: '63f100b5fb61294a', stages: 'dba94439bf42841d', tris: 2904 },
};
const stagesGeo = (w, Bm = B) => { const g = new Geo(); for (const b of w.blds) for (const st of [STAGE_INTACT, STAGE_ROOFLESS, STAGE_RUBBLE]) Bm.buildingGeo(g, b, st); return g; };
// 三角形清單（位置、法線、顏色），排序後比
const tris = g => { const out = []; for (let i = 0; i < g.pos.length; i += 9) out.push({ p: g.pos.slice(i, i + 9), n: g.nor.slice(i, i + 3), c: g.col.slice(i, i + 3) }); return out; };
const key = t => [...t.p, ...t.n, ...t.c].map(v => Math.round(v * 1e5)).join(',');
// 往下打：(x, z) 這一點上方最高的三角形
function topAt(g, x, z) {
  let best = -Infinity;
  for (let i = 0; i < g.pos.length; i += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = g.pos.slice(i, i + 9);
    const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(d) < 1e-12) continue;
    const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d, l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d, l3 = 1 - l1 - l2;
    if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
    best = Math.max(best, l1 * ay + l2 * by + l3 * cy);
  }
  return best;
}
// 頂點色存的是線性值（three 的工作色彩空間）；換回網頁上的十六進位
const hexAt = (g, i) => new THREE.Color(g.col[i], g.col[i + 1], g.col[i + 2]).getHex();
const hexes = g => { const s = new Set(); for (let i = 0; i < g.col.length; i += 3) s.add(hexAt(g, i)); return s; };
const rgb = hex => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const groups = {
  // 閥：關著每一個指紋都等於 d5dd980；開著時指揮部、碉堡、圍牆一點不動
  valve() {
    prod(B, false);
    for (const m of MAPS) {
      const w = worlds[m], f = FROZEN[m], town = B.buildTown(w);
      assert.deepEqual([fp(town), town.triangles, fp(stagesGeo(w))], [f.town, f.tris, f.stages], `valve: with R086 off map ${m} is exactly d5dd980 (town and every damage stage)`);
      if (f.lod1) assert.deepEqual([fp(B.buildTown(w, undefined, 1)), fp(B.buildTown(w, undefined, 2))], [f.lod1, f.lod2], 'valve: with R086 off the distant levels of map 3 are exactly d5dd980');
    }
    const others = Object.values(worlds).flatMap(w => w.blds).filter(b => [BK_HQ, BK_PILLBOX, BK_WALL_BRICK, BK_WALL_STONE, BK_WALL_CONCRETE].includes(b.kind));
    const walls = [BK_WALL_BRICK, BK_WALL_STONE, BK_WALL_CONCRETE].map((kind, i) => ({ id: 900 + i, kind, x: 4, z: 4, w: 3, d: 1, floors: 1, hp: 100, maxHp: 100 }));
    const off = [...others, ...walls].flatMap(b => [STAGE_INTACT, STAGE_ROOFLESS, STAGE_RUBBLE].map(st => fp(geoOf(b, st))));
    prod(B, true);
    const on = [...others, ...walls].flatMap(b => [STAGE_INTACT, STAGE_ROOFLESS, STAGE_RUBBLE].map(st => fp(geoOf(b, st))));
    assert(others.length >= 10, 'fixture: headquarters found');
    assert.deepEqual(on, off, 'valve: headquarters, pillboxes and the three walls are the same with R086 on');
  },
  // 只在 R134 開著時有作用；損壞階段只換顏色
  inert() {
    for (const m of MAPS) {
      const w = worlds[m];
      prod(B, false); B.setBuildingDetails(false); const a = fp(B.buildTown(w)), as = fp(stagesGeo(w));
      prod(B, true); B.setBuildingDetails(false); const b = fp(B.buildTown(w)), bs = fp(stagesGeo(w));
      assert.deepEqual([b, bs], [a, as], `inert: with R134 off, R086 changes nothing (map ${m})`);
    }
    prod(B, true);
    for (const m of MAPS) for (const bld of worlds[m].blds) for (const st of [STAGE_ROOFLESS, STAGE_RUBBLE]) {
      B.setHouseArt(false); const a = geoOf(bld, st); B.setHouseArt(true); const b = geoOf(bld, st);
      assert(a.pos.length === b.pos.length && a.pos.every((v, i) => v === b.pos[i]) && a.nor.every((v, i) => v === b.nor[i]), `inert: damaged stages keep their shape, only colours change (map ${m}, building ${bld.id}, stage ${st})`);
    }
  },
  // 看不見的面不畫細節：只開「省面」（新樣子關掉）跟關閥比，拿掉的每一個三角形都在 −x、−z 面，或是 ≤ 0.012 厚的細條端面
  async trim() {
    const temp = mkdtempSync(join(tmpdir(), 'r086-trim-'));
    try {
      cpSync(join(root, 'src'), join(temp, 'src'), { recursive: true });
      writeFileSync(join(temp, 'package.json'), '{"type":"module"}'); linkModules(temp);
      const file = join(temp, 'src/render/buildings.ts'), text = readFileSync(file, 'utf8'), anchor = 'const artOn = () => houseArtOn && buildingDetailsOn; // R086 art';
      assert.equal(text.split(anchor).length, 2, 'fixture: the art gate line is unique');
      writeFileSync(file, text.replace(anchor, 'const artOn = () => false; // R086 art'));
      const T = await imp(temp, 'src/render/buildings.ts'), TW = await imp(temp, 'src/sim/world.ts'), TS = await imp(temp, 'src/sim/step.ts'), { Geo: TG } = await imp(temp, 'src/render/geo.ts');
      let removedAll = 0, caps = 0;
      for (const m of MAPS) {
        const w = TW.createWorld(1944); TS.step(w, [{ t: 'map', id: m, vegetation: 1 }, ECO]);
        prod(T, false); const off = tris(T.buildTown(w)); prod(T, true); const on = tris(T.buildTown(w));
        const count = new Map(); for (const t of on) count.set(key(t), (count.get(key(t)) ?? 0) + 1);
        const removed = []; for (const t of off) { const k = key(t); if (count.get(k)) count.set(k, count.get(k) - 1); else removed.push(t); }
        assert([...count.values()].every(v => v === 0), `trim: nothing is added or moved, only removed (map ${m})`);
        assert(removed.length > 0, `trim: something is removed on every map (map ${m})`);
        for (const t of removed) {
          const [nx, ny, nz] = t.n, xs = [t.p[0], t.p[3], t.p[6]], zs = [t.p[2], t.p[5], t.p[8]];
          const back = nx < -0.99 || nz < -0.99, thin = (Math.abs(nx) > 0.99 && Math.max(...zs) - Math.min(...zs) <= 0.0121) || (Math.abs(nz) > 0.99 && Math.max(...xs) - Math.min(...xs) <= 0.0121);
          assert(ny < 0.5, `trim: nothing facing up is removed (map ${m})`);
          assert(back || thin, `trim: every removed triangle faces -x or -z, or is the thin end of a strip (map ${m}, normal ${t.n.map(v => v.toFixed(2))})`);
          if (!back) caps++;
        }
        removedAll += removed.length;
      }
      console.log(`house-art/trim: removed ${removedAll} triangles on maps 0-4, ${caps} of them thin strip ends (${(100 * caps / removedAll).toFixed(1)}%; whether they show is the browser guard's pixel check)`);
    } finally { rmSync(temp, { recursive: true, force: true }); }
  },
  // 形狀：有限、法線單位長、沒有退化的三角形、在佔地裡面、算兩次一樣、不改世界
  shape() {
    prod(B, true);
    for (const m of MAPS) {
      const w = worlds[m], before = JSON.stringify(w);
      for (const b of w.blds.filter(b => civ(b) || b.kind === BK_CHURCH)) {
        const g = geoOf(b), g2 = geoOf(b);
        assert.equal(fp(g), fp(g2), 'shape: building geometry is deterministic');
        for (let i = 0; i < g.pos.length; i += 9) {
          const p = g.pos.slice(i, i + 9);
          assert(p.every(Number.isFinite), 'shape: every position is finite');
          const e1 = [p[3] - p[0], p[4] - p[1], p[5] - p[2]], e2 = [p[6] - p[0], p[7] - p[1], p[8] - p[2]];
          const area = Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]) / 2;
          assert(area > 1e-9, `shape: no degenerate triangles (map ${m}, building ${b.id})`);
          const e = b.kind === BK_CHURCH ? 0.03 + 1e-9 : 1e-9;   // 1×1 教堂塔頂的飾帶原本就凸出 0.03（R086 之前就這樣）
          for (let k = 0; k < 9; k += 3) assert(p[k] >= b.x - e && p[k] <= b.x + b.w + e && p[k + 2] >= b.z - e && p[k + 2] <= b.z + b.d + e, `shape: everything stays inside the building's footprint (map ${m}, building ${b.id} kind ${b.kind})`);
          const n = g.nor.slice(i, i + 3); assert(Math.abs(Math.hypot(...n) - 1) < 1e-3, 'shape: normals are unit length');
        }
      }
      assert.equal(JSON.stringify(w), before, 'shape: drawing never changes the world');
    }
  },
  // 高度：每個民房格子中心往下打的高度不變（守軍標記、點選照舊）；屋頂顏色的最高點不變
  heights() {
    for (const m of MAPS) for (const b of worlds[m].blds.filter(b => civ(b) || b.kind === BK_CHURCH)) {
      prod(B, false); const off = geoOf(b), roofOff = B.bldColorsOf(b).roof.getHex();
      prod(B, true); const on = geoOf(b), roofOn = B.bldColorsOf(b).roof.getHex();
      for (let i = 0; i < b.w; i++) for (let j = 0; j < b.d; j++) {
        const x = b.x + i + 0.5, z = b.z + j + 0.5, a = topAt(off, x, z), c = topAt(on, x, z);
        assert(a === c || Math.abs(a - c) <= 1e-5, `heights: every civilian cell centre has the same roof height (map ${m}, building ${b.id} kind ${b.kind} ${b.w}x${b.d}, cell ${i},${j}: ${a.toFixed(4)} -> ${c.toFixed(4)})`);
      }
      const roofTop = (g, hex) => { let y = -Infinity; for (let i = 0; i < g.col.length; i += 3) if (hexAt(g, i) === hex) y = Math.max(y, g.pos[i + 1]); return y; };
      if (b.kind !== BK_CHURCH) assert(Math.abs(roofTop(off, roofOff) - roofTop(on, roofOn)) <= 1e-5, `heights: the highest roof point is the same (map ${m}, building ${b.id})`);
    }
  },
  // 遠景（96）：三角形數不變、完整 > 遠景一 > 遠景二、遠景一的顏色都在完整的裡面、四坡與半四坡在遠景是四坡
  lod() {
    const w = worlds[3];
    prod(B, true);
    const full = B.buildTown(w), l1 = B.buildTown(w, undefined, 1), l2 = B.buildTown(w, undefined, 2);
    assert.deepEqual([l1.triangles, l2.triangles], [FROZEN[3].lod1Tris, FROZEN[3].lod2Tris], 'lod: the distant levels have the same triangle counts as with R086 off');
    assert(full.triangles > l1.triangles && l1.triangles > l2.triangles, 'lod: full > level 1 > level 2');
    let hipped = 0;
    for (const b of w.blds.filter(civ)) {
      const one = { blds: [b], wires: { segments: [] } }, near = hexes(geoOf(b));
      for (const c of hexes(B.buildTown(one, undefined, 1))) assert(near.has(c) || c === 0x2a3038, `lod: every colour of a building's level-1 model is in its full model (building ${b.id}, colour ${c.toString(16)})`);
      if (W.stageOf(b) !== STAGE_INTACT) continue;
      // 雙坡在遠景有兩個牆色的山牆三角形（比簷高）；四坡、半四坡在遠景畫四坡，一個都沒有
      const look = B.houseLookOf(b), g = B.buildTown(one, undefined, 2), h = B.wallHeight(b);
      let gableEnds = 0;
      for (let i = 0; i < g.pos.length; i += 9) if (Math.max(g.pos[i + 1], g.pos[i + 4], g.pos[i + 7]) > h + 0.01 && hexAt(g, i) !== look.roof.getHex()) gableEnds++;
      assert.equal(gableEnds, look.form ? 0 : 2, `lod: hipped and half-hipped roofs keep a hipped outline in the distance, gables keep their gable ends (building ${b.id} form ${look.form})`);
      if (look.form) hipped++;
    }
    assert(hipped > 20, `fixture: enough hipped roofs on the 96 map (${hipped})`);
  },
  // 三角形預算（Node，整鎮）
  budget() {
    const ratio = { 0: 0.95, 1: 0.85, 2: 0.85, 3: 0.85, 4: 1.0 };
    for (const m of MAPS) {
      const w = worlds[m];
      prod(B, false); const off = B.buildTown(w).triangles, offMax = Math.max(...w.blds.map(b => geoOf(b).triangles)), offEach = w.blds.map(b => geoOf(b).triangles);
      prod(B, true); const on = B.buildTown(w).triangles, onEach = w.blds.map(b => geoOf(b).triangles);
      assert(on <= off * ratio[m], `budget: town triangles on map ${m} are at most ${ratio[m]} of R086 off (${on} vs ${off})`);
      w.blds.forEach((b, i) => assert(onEach[i] - offEach[i] <= 40, `budget: no building grows by more than 40 triangles (map ${m}, building ${b.id} kind ${b.kind}: ${offEach[i]} -> ${onEach[i]})`));
      assert(Math.max(...onEach) <= offMax, `budget: the largest intact building on map ${m} is not larger than before (${Math.max(...onEach)} vs ${offMax})`);
    }
  },
  // 顏色規則
  look() {
    prod(B, true);
    const blue = rgb(0x3b6fb6), seenWall = (b, l) => (B.facadeStyle(b) === B.FAC_TIMBER ? l.plaster : l.wall);
    for (const m of MAPS) for (const b of worlds[m].blds.filter(civ)) {
      const l = B.houseLookOf(b), wall = rgb(seenWall(b, l).getHex()), roof = rgb(l.roof.getHex()), door = rgb(l.door.getHex());
      assert(Math.abs(A.luma(wall) - A.luma(roof)) >= 18, `look: wall and roof differ in lightness by at least 18 (map ${m}, building ${b.id})`);
      if (b.kind !== BK_BARN) assert(dist(door, wall) >= 45, `look: the door stands out from the wall (map ${m}, building ${b.id})`);
      const brick = rgb(l.wall.getHex());
      if (b.kind === BK_BARN) assert(brick[0] / brick[1] <= 1.45, `look: barn walls still read as wood (r/g <= 1.45; building ${b.id})`);
      else assert(brick[0] / brick[1] >= 1.55, `look: brick walls still read as brick (r/g >= 1.55; building ${b.id})`);
      for (const c of [l.wall, l.roof, l.plaster, l.door, l.livery, ...l.awning].map(c => rgb(c.getHex()))) {
        assert(c.every(v => v >= 30 && v <= 235), `look: every channel is within 30-235 (building ${b.id}, ${c})`);
        assert(dist(c, blue) >= 40, `look: nothing is close to the team blue (building ${b.id})`);
      }
    }
    const church = rgb(B.bldColors(BK_CHURCH).wall.getHex()), chroma = Math.max(...church) - Math.min(...church);
    assert(chroma <= 26, 'look: church stone stays grey');
    assert.deepEqual([BK_HOUSE, BK_COTTAGE, BK_BARN, BK_CHURCH, BK_SHOP].map(k => B.bldColors(k).wall.getHex().toString(16)), ['a5644c', 'a5644c', '866344', 'b2aea0', 'a5644c'], 'look: bldColors(kind) is unchanged');
    // 同種類同部位的變化：彼此至少一個通道差 20
    const variants = new Map();
    for (const w of Object.values(worlds)) for (const b of w.blds.filter(civ)) { const l = B.houseLookOf(b); for (const [role, c] of [['wall', l.wall], ['roof', l.roof]]) { const k = `${b.kind}/${role}`; if (!variants.has(k)) variants.set(k, new Set()); variants.get(k).add(c.getHex()); } }
    for (const [k, set] of variants) { const list = [...set].map(rgb); for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) assert(list[i].some((v, c) => Math.abs(v - list[j][c]) >= 20), `look: same-role variants differ by at least 20 in some channel (${k})`); }
    assert([...variants.values()].every(s => s.size >= 2), 'look: every kind has at least two wall and two roof colours');
  },
  // 樣式與分佈
  variety() {
    prod(B, true);
    const w96 = worlds[3], sigs = new Set(w96.blds.filter(civ).map(b => B.houseLookOf(b).sig));
    assert(sigs.size >= 60, `variety: at least 60 different looks on the 96 map (${sigs.size})`);
    for (const m of [1, 2, 3]) {
      const list = worlds[m].blds.filter(b => [BK_HOUSE, BK_COTTAGE, BK_SHOP].includes(b.kind));
      let pairs = 0, same = 0;
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j], gx = Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w)), gz = Math.max(a.z - (b.z + b.d), b.z - (a.z + a.d));
        if (Math.max(gx, gz) > 1) continue;
        pairs++; if (B.houseLookOf(a).sig === B.houseLookOf(b).sig) same++;
      }
      assert(pairs > 5 && same <= pairs * 0.1, `variety: neighbours rarely look exactly alike on map ${m} (${same} of ${pairs})`);
    }
    const hc = w96.blds.filter(b => (b.kind === BK_HOUSE || b.kind === BK_COTTAGE));
    for (const [form, name] of [[A.ROOF_HIP, 'hip'], [A.ROOF_HALF, 'half-hip']]) {
      const ok = hc.filter(b => A.formAllowed(b, form)), got = ok.filter(b => B.houseLookOf(b).form === form);
      assert(got.length >= ok.length * 0.1, `variety: ${name} roofs on at least 10% of the houses and cottages that can take them (${got.length} of ${ok.length})`);
    }
    const all = Object.values(worlds).flatMap(w => w.blds);
    const potHex = 0x8a4a35;   // 煙囪管（houseArt.ts 的 POT）
    for (const b of all.filter(b => [BK_HOUSE, BK_COTTAGE, BK_SHOP].includes(b.kind))) assert(hexes(geoOf(b)).has(potHex), `variety: every house, shop and cottage has a chimney (building ${b.id})`);
    const eligible = all.filter(b => b.kind === BK_HOUSE && Math.max(b.w, b.d) >= 2), two = eligible.filter(b => B.houseLookOf(b).stack2).length;
    assert(two >= eligible.length * 0.45 && two <= eligible.length * 0.75, `variety: a second chimney on 45-75% of the houses that can take one (${two} of ${eligible.length})`);
    const hoodable = all.filter(b => b.kind === BK_HOUSE || b.kind === BK_COTTAGE), hoods = hoodable.filter(b => B.houseLookOf(b).hood).length;
    assert(hoods >= hoodable.length * 0.35 && hoods <= hoodable.length * 0.65, `variety: door hoods on 35-65% of houses and cottages (${hoods} of ${hoodable.length})`);
    for (const b of all.filter(b => b.kind === BK_SHOP)) {
      const l = B.houseLookOf(b), g = geoOf(b), cols = hexes(g);
      assert(cols.has(l.awning[0].getHex()) && cols.has(l.awning[1].getHex()), `variety: every shop has a striped awning (building ${b.id})`);
      let panes = 0; for (let i = 0; i < g.pos.length; i += 9) { const ys = [g.pos[i + 1], g.pos[i + 4], g.pos[i + 7]]; if (Math.min(...ys) === 0.06 && Math.max(...ys) === 0.19) panes++; }
      assert(panes >= 4, `variety: every shop has two display windows (building ${b.id}: ${panes / 2})`);
    }
    for (const b of all.filter(b => b.kind === BK_BARN)) {
      const g = geoOf(b); let tall = 0; for (let i = 0; i < g.pos.length; i += 9) { const ys = [g.pos[i + 1], g.pos[i + 4], g.pos[i + 7]], zs = [g.pos[i + 2], g.pos[i + 5], g.pos[i + 8]]; if (Math.min(...ys) === 0 && Math.max(...ys) >= 0.3 && Math.min(...zs) > b.z + b.d - 0.1) tall = Math.max(tall, Math.max(...ys)); }
      assert(tall >= 0.3, `variety: every barn has a cart door at least 0.30 tall (building ${b.id})`);
    }
    const churches = all.filter(b => b.kind === BK_CHURCH && b.w >= 2 && b.d >= 2);
    assert(churches.length >= 2, 'fixture: churches with room for the details');
    for (const b of churches) {
      const g = geoOf(b), glass = 0x2a3038; let lancets = 0, buttresses = 0;
      for (let i = 0; i < g.pos.length; i += 9) {
        const c = hexAt(g, i), nx = g.nor[i];
        if (c === glass && nx > 0.99) lancets++;
        if (nx > 0.99 && g.pos[i] > b.x + b.w - 0.1 + 0.06) buttresses++;
      }
      assert(lancets >= 2 * 3 && buttresses >= 2 * 2, `variety: every church with w, d >= 2 has lancet windows and buttresses (building ${b.id}: ${lancets / 3} lancet faces, ${buttresses / 2} buttress faces)`);
    }
  },
  // 碎片與彈痕照那一棟的顏色；關著時跟原本一樣
  consumers() {
    for (const w of Object.values(worlds)) for (const b of w.blds) {
      prod(B, false); assert.equal(B.bldColorsOf(b).wall.getHex(), B.bldColors(b.kind).wall.getHex(), 'consumers: with R086 off a building has its kind colours');
      prod(B, true); const l = B.houseLookOf(b); if (l) assert.equal(B.bldColorsOf(b).wall.getHex(), l.wall.getHex(), 'consumers: with R086 on a building has its own colours');
    }
    assert(/const wall = bldColorsOf\(b\)\.wall\.getHex\(\);/.test(src('src/render/battle.ts')) && /col = bldColorsOf\(b\);/.test(src('src/render/battle.ts')), 'consumers: debris and collapse colours come from that building (battle.ts)');
    assert(/const wall = bldColorsOf\(b\)\.wall;/.test(src('src/render/wallMarks.ts')), 'consumers: impact marks take that building colour (wallMarks.ts)');
  },
  // 接線
  wiring() {
    assert.match(src('src/main.ts'), /setBuildingDetails\(V\.r134 && V\.r131\); setHouseArt\(V\.r086\);/, 'wiring: the hub turns R086 on unless ?noR086=1');
    assert.match(src('src/valves.ts'), /get r086\(\) \{ return on\('086'\); \}/, 'wiring: the valve is on the table');
    assert.match(src('src/render/buildings.ts'), /\nlet houseArtOn = false;\n/, 'wiring: R086 is off at module level (old fingerprints in other guards stay valid)');
    assert.match(src('README.md'), /\| `\?noR086=1` \| R086 房屋細化/, 'wiring: the README valve table has R086');
  },
};

const only = process.argv[2];
if (only) { assert(groups[only], `unknown group ${only}`); await groups[only](); console.log(`house-art/${only}: OK`); process.exit(0); }
for (const [name, run] of Object.entries(groups)) { await run(); console.log(`OK house-art/${name}`); }

// ---- 故意弄壞（隔離的副本）----
const temp = mkdtempSync(join(tmpdir(), 'r086-negative-'));
const mutants = [
  ['default_on', 'valve', 'src/render/buildings.ts', '\nlet houseArtOn = false;\n', '\nlet houseArtOn = true;\n', 'valve: with R086 off'],
  ['no_r134_gate', 'inert', 'src/render/buildings.ts', 'const artOn = () => houseArtOn && buildingDetailsOn; // R086 art', 'const artOn = () => houseArtOn; // R086 art', 'inert: with R134 off'],
  ['shell_geometry', 'inert', 'src/render/buildings.ts', '  const p = paletteOf(b), colors = rubbleColors(b.kind), t = 0.09;', '  const p = paletteOf(b), colors = rubbleColors(b.kind), t = artOn() ? 0.1 : 0.09;', 'inert: damaged stages keep their shape'],
  ['trim_flip', 'trim', 'src/render/buildings.ts', 'if (trimOn() && dir < 0) continue;   // R086 trim facade', 'if (trimOn() && dir > 0) continue;   // R086 trim facade', 'trim: every removed triangle'],
  ['awning_deep', 'shape', 'src/render/houseArt.ts', 'zf = z + 0.095;', 'zf = z + 0.2;', 'shape: everything stays inside'],
  ['stack_middle', 'heights', 'src/render/houseArt.ts', 'return end ? Math.min(hi, r1 - 0.12) : Math.max(lo, r0 + 0.12);', 'return end ? Math.min(hi, r1 - 0.12) : (lo + hi) / 2;', 'heights: every civilian cell centre'],
  ['hip_anywhere', 'heights', 'src/render/houseArt.ts', '  if (form === ROOF_HIP) return lo === 1 && hi > 1;', '  if (form === ROOF_HIP) return hi > 1;', 'heights: every civilian cell centre'],
  ['lod_palette', 'lod', 'src/render/buildings.ts', '  const p = paletteOf(b), x0 = b.x + 0.1, z0 = b.z + 0.1,', '  const p = palette(b.kind), x0 = b.x + 0.1, z0 = b.z + 0.1,', 'lod: every colour'],
  ['lod_outline', 'lod', 'src/render/buildings.ts', '  if (artOn() && civilian(b.kind) && lookOf(b).form) g.hip(', '  if (false && artOn() && civilian(b.kind) && lookOf(b).form) g.hip(', 'lod: hipped and half-hipped roofs'],
  ['flat_colour', 'look', 'src/render/houseArt.ts', 'const BRICK_VARIANTS: RGB[] = [[1, 1, 1], [1.19, 1.2, 1.16], [0.86, 0.63, 0.67]];', 'const BRICK_VARIANTS: RGB[] = [[1, 1, 1], [1, 1, 1], [1, 1, 1]];', 'look: every kind has at least two'],
  ['no_contrast_step', 'look', 'src/render/houseArt.ts', 'r => Math.abs(luma(r) - luma(seen)) >= 18)', 'r => true)', 'look: wall and roof differ'],
  ['no_hood', 'variety', 'src/render/houseArt.ts', '&& h86(b, 5) < 0.5,', '&& h86(b, 5) < 0.05,', 'variety: door hoods'],
  ['debris_kind', 'consumers', 'src/render/battle.ts', '        const wall = bldColorsOf(b).wall.getHex();', '        const wall = bldColorsOf({ ...b, kind: b.kind }).wall.getHex() & 0xffffff;', 'consumers: debris'],
];
try {
  for (const [name, group, file, from, to, want] of mutants) {
    const dir = join(temp, name);
    mkdirSync(join(dir, 'tests'), { recursive: true });
    cpSync(join(root, 'src'), join(dir, 'src'), { recursive: true });
    for (const f of ['README.md']) cpSync(join(root, f), join(dir, f));
    cpSync(join(root, 'tests/house-art.mjs'), join(dir, 'tests/house-art.mjs'));
    writeFileSync(join(dir, 'package.json'), '{"type":"module"}'); linkModules(dir);
    const path = join(dir, file), source = readFileSync(path, 'utf8');
    assert.equal(source.split(from).length, 2, `${name}: unique mutation anchor`);
    writeFileSync(path, source.replace(from, to));
    const r = spawnSync(process.execPath, [join(dir, 'tests/house-art.mjs'), group], { encoding: 'utf8', timeout: 240000 }), output = `${r.stdout}\n${r.stderr}`;
    assert.equal(r.error, undefined, `${name}: child starts and completes`);
    assert.notEqual(r.status, 0, `${name}: mutation must fail`);
    const first = /AssertionError \[ERR_ASSERTION\]: ([^\r\n]+)/.exec(output)?.[1] ?? '';
    assert(first.startsWith(want), `${name}: intended assertion must fail first (wanted "${want}"), got ${first || output.slice(-1500)}`);
    console.log(`OK house-art-negative/${name}: ${first}`);
  }
} finally { rmSync(temp, { recursive: true, force: true }); }
console.log(`house-art: all groups OK, ${mutants.length} isolated mutants rejected`);
