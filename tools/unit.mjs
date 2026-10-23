// Node 端守衛：不開瀏覽器，直接跑模擬層。用法：node tools/unit.mjs　退出碼 0＝綠、1＝紅
// 模擬層 import 寫明 .ts，Node 22.18+ 可以直接跑（型別剝除）。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createScanner, SyntaxKind } from 'typescript/unstable/ast';
import { ROOT } from './cdp.mjs';
import {
  createWorld, hashWorld, stageOf, blocks, idx, center, N, SUB,
  STAGE_INTACT, STAGE_ROOFLESS, STAGE_RUBBLE, UNIT_KINDS, UK_TANK, UK_HOWITZER, ORD_IDLE, BK_HOUSE,
} from '../src/sim/world.ts';
import { step, runLog, firstBlock } from '../src/sim/step.ts';
import { bldAt } from '../src/sim/world.ts';
import { findPath } from '../src/sim/path.ts';
import { isqrt } from '../src/sim/math.ts';
import { SCRIPT, SCRIPT_SEED, SCRIPT_TICKS, runScript } from '../src/sim/script.ts';

const t0 = Date.now(), fails = [];
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
function log(ok, name, detail = '') {
  console.log(`${ok ? 'OK' : 'NG'}  ${name}${detail ? '　— ' + detail : ''}`);
  if (!ok) fails.push(name);
}

// ---- R039 分片：UNIT_SHARD=k/n 時只跑分給第 k 份的 tests/*.mjs；內建各節（純度、零外部素材、模擬行為、黃金雜湊）只在第 1 份跑。
// 沒設＝全部照原本的順序跑（本機 npm run unit 不變）。UNIT_LIST_ONLY=1：只列出這一份要跑哪些守衛、不執行（驗分法用）。
// 分法固定、跟機器無關：開瀏覽器的守衛（檔名 -browser.mjs，或 import tools/cdp.mjs 的 withBrowser）最慢，照檔名排序先輪流分；其他守衛接著輪流分。
const SHARD = (() => {
  const raw = process.env.UNIT_SHARD ?? '';
  if (raw === '') return null;
  const m = /^(\d+)\/(\d+)$/.exec(raw), k = m ? Number(m[1]) : 0, n = m ? Number(m[2]) : 0;
  if (!m || n < 1 || k < 1 || k > n) { console.log(`NG  UNIT_SHARD=${raw} 寫錯：要寫成 k/n，而且 1 ≤ k ≤ n`); process.exit(1); }
  return { k, n };
})();
const BUILTINS = !SHARD || SHARD.k === 1;
const LIST_ONLY = process.env.UNIT_LIST_ONLY === '1';
function shardOf(files, dir, k, n) {
  const heavy = f => f.endsWith('-browser.mjs') || /withBrowser|tools\/cdp\.mjs/.test(fs.readFileSync(path.join(dir, f), 'utf8'));
  const order = [...files.filter(heavy), ...files.filter(f => !heavy(f))];
  return order.filter((_, i) => i % n === k - 1).sort();
}

// ---- 1. 模擬層純度（AGENTS.md 規則 2、3）----
// 詞法掃描照搬 GlimmerTown3D-lab@bece722 tools/unit.mjs:588-647；本線更嚴：
// Math 只准整數安全的幾個函式（白名單）、不准 ** 次方、import 只准同資料夾的 ./x.ts、不准碰行程與全域物件。
const MATH_OK = ['floor', 'ceil', 'trunc', 'round', 'imul', 'abs', 'min', 'max', 'sign', 'clz32'];
const GLOBALS = ['globalThis', 'process', 'require', 'eval', 'Function', 'Reflect', 'Proxy', 'crypto', 'fetch', 'setTimeout', 'setInterval',
  'queueMicrotask', 'self', 'global', 'XMLHttpRequest', 'WebSocket', 'Worker', 'Atomics', 'SharedArrayBuffer'];
function purityViolations(source) {
  const scanner = createScanner(true, undefined, source), tokens = [], templateDepth = [];
  while (true) {
    let k = scanner.scan();
    if (k === SyntaxKind.EndOfFile) break;
    if (k === SyntaxKind.TemplateHead) templateDepth.push(0);
    else if (k === SyntaxKind.OpenBraceToken && templateDepth.length) templateDepth[templateDepth.length - 1]++;
    else if (k === SyntaxKind.CloseBraceToken && templateDepth.length) {
      const top = templateDepth.length - 1;
      if (templateDepth[top]) templateDepth[top]--;
      else { k = scanner.reScanTemplateToken(false); if (k === SyntaxKind.TemplateTail) templateDepth.pop(); }
    }
    tokens.push({ k, text: scanner.getTokenText(), value: scanner.getTokenValue(), pos: scanner.getTokenStart() });
  }
  const violations = [], at = (t, why) => violations.push(`${source.slice(0, t.pos).split('\n').length}:${why}`);
  const specIsOutside = spec => !/^\.\/[\w-]+\.ts$/.test(spec);   // 模擬層只准 import 同資料夾的 ./x.ts
  const moduleToken = t => t?.k === SyntaxKind.StringLiteral || t?.k === SyntaxKind.NoSubstitutionTemplateLiteral;
  const moduleValue = t => t.k === SyntaxKind.StringLiteral ? t.value : t.text.slice(1, -1);
  const dot = t => t?.k === SyntaxKind.DotToken || t?.k === SyntaxKind.QuestionDotToken;
  const DOM = ['document', 'window', 'HTMLElement', 'localStorage', 'sessionStorage', 'navigator', 'requestAnimationFrame'];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i], a = tokens[i + 1], b = tokens[i + 2];
    if (t.k === SyntaxKind.ImportKeyword) {
      if (a?.k === SyntaxKind.OpenParenToken) at(t, 'dynamic import');
      else if (dot(a)) at(t, 'import.meta');
      else if (moduleToken(a)) { if (specIsOutside(moduleValue(a))) at(t, `import ${moduleValue(a)}`); }
      else {
        for (let j = i + 1; j < tokens.length && j < i + 80 && tokens[j].k !== SyntaxKind.SemicolonToken; j++) {
          if (tokens[j].k === SyntaxKind.FromKeyword && moduleToken(tokens[j + 1])) { if (specIsOutside(moduleValue(tokens[j + 1]))) at(t, `import ${moduleValue(tokens[j + 1])}`); break; }
        }
      }
    }
    if (t.k === SyntaxKind.ExportKeyword) {
      for (let j = i + 1; j < tokens.length && j < i + 80 && tokens[j].k !== SyntaxKind.SemicolonToken; j++) {
        if (tokens[j].k === SyntaxKind.FromKeyword && moduleToken(tokens[j + 1])) { if (specIsOutside(moduleValue(tokens[j + 1]))) at(t, `export from ${moduleValue(tokens[j + 1])}`); break; }
      }
    }
    const prop = dot(tokens[i - 1]) || a?.k === SyntaxKind.ColonToken;   // obj.process、{ process: 1 } 是屬性名，不算
    // 比對字面（字串字面的 text 帶引號，不會誤中）；TS 7 掃描器把 require 等字當關鍵字，不能只看 Identifier
    if ((DOM.includes(t.text) || GLOBALS.includes(t.text)) && !prop) at(t, t.text);
    if (t.text === 'Math' && !prop && !(dot(a) && MATH_OK.includes(b?.text))) at(t, `Math 只准 ${MATH_OK.join('/')}（看到 Math${dot(a) ? '.' + b?.text : ' ' + (a?.text ?? '')}）`);
    if (t.k === SyntaxKind.AsteriskAsteriskToken || t.k === SyntaxKind.AsteriskAsteriskEqualsToken) at(t, '** 次方（浮點）');
    if (t.text === 'Date' && ((dot(a) && b?.text === 'now') || (a?.k === SyntaxKind.OpenBracketToken && moduleToken(b) && moduleValue(b) === 'now') || a?.k === SyntaxKind.OpenParenToken || tokens[i - 1]?.k === SyntaxKind.NewKeyword)) at(t, 'Date／Date.now');
    if (t.text === 'performance' && ((dot(a) && ['now', 'timeOrigin'].includes(b?.text)) || (a?.k === SyntaxKind.OpenBracketToken && moduleToken(b) && ['now', 'timeOrigin'].includes(moduleValue(b))))) at(t, 'performance.now');
  }
  return violations;
}
if (BUILTINS) {
  const bad = [];
  const check = dir => { for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) { check(p); continue; }
    if (!e.isFile() || !/\.(ts|js|mjs)$/.test(e.name)) continue;
    bad.push(...purityViolations(read(p)).map(v => `${p}:${v}`));
  } };
  check('src/sim');
  log(bad.length === 0, '模擬層純度：只 import ./x.ts、不碰 DOM／全域／行程、Math 只用整數白名單、不用 ** 與現實時間', bad.join(' ') || 'src/sim 全乾淨');
  const forbidden = ["import 'three'", "import x from 'three'", "await import('three')", "require('three')", "import { a } from '../render/battle.ts'", "import { b } from '../ui/hud.ts'",
    "import { f } from '../ai/brain.ts'", "export { g } from '../ai/brain.ts'", 'const u = import.meta.url',
    'window.alert(1)', 'globalThis.document.title', "globalThis['window']", 'Math.random()', "Math['random']()", 'Math.sqrt(2)', 'Math.hypot(1, 2)', 'Math.atan2(1, 2)', "Math['sin'](1)",
    'const { sqrt } = Math', '(Math).random()', "Reflect.get(Math, 'random')", 'const r = x ** 0.5', 'x **= 2',
    'process.exit(0)', '(globalThis as any).process.exit(0)', 'crypto.getRandomValues(a)', 'setTimeout(f, 1)', "eval('1')", "new Function('return 1')",
    'Date.now()', 'new Date()', 'new Date', 'performance.now()', 'const q = `x ${1} and ${window.innerWidth}`'];
  const harmless = ["// Math.random() and import 'three'", "const s = 'window and Date.now() and Math.sqrt'", 'const q = `document ${1} and Math.random`',
    'Math.floor(1.5) + Math.imul(2, 3) + Math.trunc(-1.5) + Math.abs(-1) + Math.max(1, Math.min(2, 3))', "import { a } from './world.ts'", "import type { W } from './world.ts'",
    'const o = { process: 1 }; o.process', 'const z = x * y'];
  const missed = forbidden.filter(s => purityViolations(s).length === 0), wrong = harmless.filter(s => purityViolations(s).length > 0);
  log(!missed.length && !wrong.length, '純度掃描自我測試：禁止片段全抓到、註解字串與整數 Math 不誤報', [...missed.map(s => '漏 ' + s), ...wrong.map(s => '誤 ' + s)].join('；'));
}

// ---- 2. 零外部素材：src 沒有圖片／字型／模型／音效檔，程式與 index.html 不引用外部網址 ----
if (BUILTINS) {
  const assets = [], urls = [];
  const walk = d => { for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) { const p = `${d}/${e.name}`; if (e.isDirectory()) walk(p); else if (/\.(png|jpe?g|gif|webp|svg|glb|gltf|obj|fbx|ttf|otf|woff2?|mp3|ogg|wav|m4a)$/i.test(e.name)) assets.push(p); else if (/\.(ts|html|css|json)$/.test(e.name)) read(p).split('\n').forEach((l, i) => { if (/https?:\/\//.test(l.replace(/\/\/ .*$|^\s*\*.*$/, ''))) urls.push(`${p}:${i + 1}`); }); } };
  walk('src');
  // 整個倉庫（node_modules、dist、shots、docs、.git 除外）都不准有素材檔：public/ 之類的資料夾會被 Vite 原樣複製進產物
  const skip = new Set(['node_modules', 'dist', 'shots', 'docs', '.git', 'src']);
  const walkAll = d => { for (const e of fs.readdirSync(path.join(ROOT, d || '.'), { withFileTypes: true })) { if (!d && skip.has(e.name)) continue; const p = d ? `${d}/${e.name}` : e.name; if (e.isDirectory()) walkAll(p); else if (/\.(png|jpe?g|gif|webp|svg|glb|gltf|obj|fbx|ttf|otf|woff2?|mp3|ogg|wav|m4a)$/i.test(e.name)) assets.push(p); } };
  walkAll('');
  read('index.html').split('\n').forEach((l, i) => { if (/(src|href)\s*=\s*["']https?:/.test(l)) urls.push(`index.html:${i + 1}`); });
  log(assets.length === 0 && urls.length === 0, '零外部素材', [...assets, ...urls].join(' ') || '乾淨');
}

// ---- 3. 模擬行為 ----
// 空場地：地形全草地、沒有建築、沒有單位
function blank() {
  const w = createWorld(7);
  w.ter.fill(0); w.occ.fill(0); w.crater.fill(0); w.blds = []; w.units = []; w.shells = [];
  return w;
}
function addBld(w, x, z, bw, bd, hp = 200) {
  const id = w.blds.length + 1;
  w.blds.push({ id, kind: BK_HOUSE, x, z, w: bw, d: bd, floors: 1, hp, maxHp: hp });
  for (let dz = 0; dz < bd; dz++) for (let dx = 0; dx < bw; dx++) w.occ[idx(x + dx, z + dz)] = id;
  return w.blds[id - 1];
}
function addUnit(w, side, kind, cx, cz) {
  const k = UNIT_KINDS[kind], id = w.units.length + 1;
  w.units.push({ id, side, kind, x: center(cx), z: center(cz), hp: k.hp, alive: true, order: ORD_IDLE, target: 0, tx: 0, tz: 0, path: [], pathIdx: 0, cooldown: 0, aimX: SUB, aimZ: 0 });
  return w.units[id - 1];
}
const run = (w, n) => { for (let i = 0; i < n; i++) step(w, []); return w; };

if (BUILTINS) { // A*：繞過完好的牆、牆倒成瓦礫後直接穿過
  const w = blank(), wall = addBld(w, 10, 6, 1, 9);
  const p1 = findPath(w, 8, 10, 12, 10);
  const throughWall = p1.some(c => w.occ[c]);
  const end1 = p1[p1.length - 1];
  log(p1.length > 4 && !throughWall && end1 === idx(12, 10), 'A* 繞過完好建築', `${p1.length} 步，終點 ${end1 % N},${Math.floor(end1 / N)}`);
  wall.hp = 0;
  const p2 = findPath(w, 8, 10, 12, 10);
  log(p2.length === 4 && p2.some(c => w.occ[c]), 'A* 穿過瓦礫', `${p2.length} 步`);
}
if (BUILTINS) { // 坦克瞄準房子後面的敵人：砲彈打在房子上
  const w = blank(), house = addBld(w, 10, 10, 1, 1), me = addUnit(w, 0, UK_TANK, 8, 10), foe = addUnit(w, 1, UK_TANK, 12, 10);
  foe.hp = 1000; foe.alive = true;
  step(w, [{ t: 'attack', side: 0, ids: [me.id], target: foe.id }]);
  run(w, 30);
  log(house.hp < house.maxHp && foe.hp === 1000, '坦克被房子擋住時，砲彈打在房子上', `房子 ${house.hp}/${house.maxHp}，敵人 ${foe.hp}`);
}
if (BUILTINS) { // 損壞三段門檻（3D-lab：dmg≥0.3 沒屋頂、dmg≥1 瓦礫）；瓦礫不擋路、不擋射線
  const w = blank(), b = addBld(w, 5, 5, 1, 1, 100);
  const at = hp => { b.hp = hp; return stageOf(b); };
  const ok = at(100) === STAGE_INTACT && at(71) === STAGE_INTACT && at(70) === STAGE_ROOFLESS && at(1) === STAGE_ROOFLESS && at(0) === STAGE_RUBBLE;
  b.hp = 0;
  const clear = !blocks(w, 5, 5) && firstBlock(w, center(3), center(5), center(8), center(5)) < 0;
  b.hp = 50;
  const blocked = blocks(w, 5, 5) && firstBlock(w, center(3), center(5), center(8), center(5)) === idx(5, 5);
  log(ok && clear && blocked, '損壞門檻：<0.3 完好、≥0.3 沒屋頂、≥1 瓦礫；瓦礫不擋路不擋射線、空殼照擋', `${ok}/${clear}/${blocked}`);
}
// 最小射程內的距離（格）：從單位表推，GPT 調數值時守衛跟著走
const MINR = Math.floor(UNIT_KINDS[UK_HOWITZER].minRange / SUB), INSIDE = Math.max(1, MINR - 1);
const runUntil = (w, cond, cap = 20000) => { let n = 0; while (!cond() && n < cap) { step(w, []); n++; } return n; };
const firesOf = (w, n, id) => { let c = 0; for (let i = 0; i < n; i++) { step(w, []); c += w.events.filter(e => e.e === 'fire' && e.unit === id).length; } return c; };
if (BUILTINS) { // 榴彈砲不接最小射程內的目標：射擊指令、攻擊指令、自己找目標都一樣
  if (MINR < 2) log(true, '榴彈砲最小射程（< 2 格，略過）');
  else {
    const w = blank(), gun = addUnit(w, 0, UK_HOWITZER, 5, 5);
    addUnit(w, 1, UK_TANK, 30, 30);
    step(w, [{ t: 'fireAt', side: 0, ids: [gun.id], x: 5 + INSIDE, z: 5 }]);
    run(w, 200);
    log(gun.order === ORD_IDLE && w.nextShell === 1 && gun.x === center(5), '榴彈砲拒絕最小射程內的射擊指令', `距離 ${INSIDE} 格，order ${gun.order}，發射 ${w.nextShell - 1} 發`);
    const w2 = blank(), g2 = addUnit(w2, 0, UK_HOWITZER, 5, 5), foe = addUnit(w2, 1, UK_TANK, 5 + INSIDE, 5);
    g2.hp = 1e6; foe.hp = 1e6;
    step(w2, [{ t: 'attack', side: 0, ids: [g2.id], target: foe.id }]);
    const shots = firesOf(w2, 300, g2.id);
    log(g2.order === ORD_IDLE && shots === 0, '榴彈砲不接、也不自己打最小射程內的敵人', `order ${g2.order}，300 tick 開火 ${shots} 次`);
    // 一個敵人在最小射程內、另一個在射程內：自己找目標要挑打得到的那個，不能被近的卡住
    const w4 = blank(), g4 = addUnit(w4, 0, UK_HOWITZER, 2, 2), near = addUnit(w4, 1, UK_TANK, 2 + INSIDE, 2), far = addUnit(w4, 1, UK_TANK, 2, 2 + MINR + 3);
    g4.hp = 1e6; near.hp = 1e6; far.hp = 1e6;
    addUnit(w4, 0, UK_TANK, 2, 2 + MINR + 1).hp = 1e6;   // 友軍觀測：讓遠的那個被看得到
    run(w4, 3);
    const aimed = w4.shells.filter(s => s.shooter === g4.id).map(s => s.target);
    log(aimed.length > 0 && aimed.every(t => t === far.id), '榴彈砲自己找目標：跳過最小射程內的，打射程內的', `瞄準 ${JSON.stringify(aimed)}（近 ${near.id}、遠 ${far.id}）`);
    const w3 = blank(), g3 = addUnit(w3, 0, UK_HOWITZER, 2, 2), f3 = addUnit(w3, 1, UK_TANK, 2 + MINR + 4, 2);
    g3.hp = 1e6; f3.hp = 1e6;
    step(w3, [{ t: 'attack', side: 0, ids: [g3.id], target: f3.id }]);
    run(w3, 3);
    const before = g3.order;
    f3.x = center(2 + INSIDE); run(w3, 2);
    log(before === 2 && g3.order === ORD_IDLE, '攻擊目標鑽進最小射程：榴彈砲放棄這個指令', `之前 order ${before}，之後 ${g3.order}`);
  }
}
if (BUILTINS) { // 坦克不接對空地的射擊指令（打空地沒有用）；榴彈砲可以對瓦礫格開火
  const w = blank(), tank = addUnit(w, 0, UK_TANK, 5, 5);
  addUnit(w, 1, UK_TANK, 30, 30);
  step(w, [{ t: 'fireAt', side: 0, ids: [tank.id], x: 8, z: 5 }]);
  const tShots = firesOf(w, 100, tank.id);
  const w2 = blank(), gun = addUnit(w2, 0, UK_HOWITZER, 2, 2), rub = addBld(w2, 20, 2, 1, 1, 100);
  addUnit(w2, 1, UK_TANK, 30, 30);
  rub.hp = 0;
  step(w2, [{ t: 'fireAt', side: 0, ids: [gun.id], x: 20, z: 2 }]);
  const gShots = firesOf(w2, 300, gun.id);
  log(tank.order === ORD_IDLE && tShots === 0 && gShots >= 2, '坦克不接對空地開火；榴彈砲對瓦礫格照樣開火', `坦克 order ${tank.order} 開火 ${tShots}；榴彈砲 300 tick 開火 ${gShots}`);
}
if (BUILTINS) { // 視線對稱：A 看得到 B 等於 B 看得到 A（種子 1944，九格內所有空地對）
  const w = createWorld(SCRIPT_SEED);
  let pairs = 0, bad = 0;
  for (let a = 0; a < N * N; a++) {
    if (w.occ[a]) continue;
    const ax = a % N, az = (a - ax) / N;
    for (let b = a + 1; b < N * N; b++) {
      if (w.occ[b]) continue;
      const bx = b % N, bz = (b - bx) / N;
      if ((bx - ax) ** 2 + (bz - az) ** 2 > 81) continue;
      pairs++;
      if ((firstBlock(w, center(ax), center(az), center(bx), center(bz)) < 0) !== (firstBlock(w, center(bx), center(bz), center(ax), center(az)) < 0)) bad++;
    }
  }
  log(bad === 0 && pairs > 10000, '視線對稱：九格內所有空地對，A→B 與 B→A 結果相同', `${pairs} 對，不對稱 ${bad} 對`);
}
if (BUILTINS) { // 高爆彈留下彈坑
  const w = blank(), gun = addUnit(w, 0, UK_HOWITZER, 2, 2);
  addUnit(w, 1, UK_TANK, 31, 0);
  step(w, [{ t: 'fireAt', side: 0, ids: [gun.id], x: 15, z: 15 }]);
  run(w, 400);
  let craters = 0, near = true;
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) if (w.crater[idx(x, z)]) { craters++; if (Math.abs(x - 15) > 4 || Math.abs(z - 15) > 4) near = false; }
  log(craters > 0 && near, '高爆彈落點留下彈坑（落在散布範圍內）', `${craters} 格有彈坑`);
}
if (BUILTINS) { // 死掉的單位不再被瞄準；一方全滅判勝
  const w = blank(), me = addUnit(w, 0, UK_TANK, 10, 10), dead = addUnit(w, 1, UK_TANK, 12, 10), live = addUnit(w, 1, UK_TANK, 10, 13);
  dead.alive = false; dead.hp = 0; me.hp = 1000;
  run(w, 1);
  const firstAim = w.shells.length ? w.shells[0].target : 0;
  log(firstAim === live.id, '自動找目標跳過死掉的單位', `第一發瞄準 ${firstAim}`);
  runUntil(w, () => w.winner >= 0);
  log(!live.alive && w.winner === 0, '敵方全滅時判我方勝', `winner ${w.winner}，敵人 hp ${live.hp}`);
}
if (BUILTINS) { // 攻擊目標死掉：放棄指令，不再對屍體開火
  const w = blank(), me = addUnit(w, 0, UK_TANK, 10, 10), foe = addUnit(w, 1, UK_TANK, 14, 10);
  addUnit(w, 1, UK_TANK, 30, 30);
  me.hp = 1e6;
  step(w, [{ t: 'attack', side: 0, ids: [me.id], target: foe.id }]);
  foe.alive = false; foe.hp = 0;
  const next = w.nextShell;
  run(w, 3);
  const atDead = w.shells.filter(s => s.id >= next && s.target === foe.id).length;
  log(me.order === ORD_IDLE && atDead === 0, '攻擊目標死掉：放棄指令、不再對它開火', `order ${me.order}，新砲彈瞄屍體 ${atDead}`);
}
if (BUILTINS) { // 我方全滅判敗；同一刻互相打死判同歸於盡（砲彈還在飛的時候不判）
  const w = blank(), me = addUnit(w, 0, UK_TANK, 10, 10), foe = addUnit(w, 1, UK_TANK, 13, 10);
  foe.hp = 1e6;
  runUntil(w, () => w.winner >= 0);
  log(!me.alive && w.winner === 1, '我方全滅時判敵方勝', `winner ${w.winner}`);
  const w2 = blank(), a = addUnit(w2, 0, UK_TANK, 10, 10), b = addUnit(w2, 1, UK_TANK, 13, 10);
  a.hp = UNIT_KINDS[UK_TANK].dmgUnit; b.hp = UNIT_KINDS[UK_TANK].dmgUnit;
  runUntil(w2, () => w2.winner >= 0);
  log(!a.alive && !b.alive && w2.winner === 2, '同一刻互相打死判同歸於盡', `winner ${w2.winner}`);
  // 榴彈砲先被打死，但它的砲彈還在飛、落地打死敵人：等砲彈落地才判，結果是同歸於盡（不是敵勝）
  const w3 = blank(), gun = addUnit(w3, 0, UK_HOWITZER, 2, 2), tank = addUnit(w3, 1, UK_TANK, 2 + MINR + 2, 2);
  gun.hp = UNIT_KINDS[UK_TANK].dmgUnit; tank.hp = 1;
  step(w3, [{ t: 'attack', side: 0, ids: [gun.id], target: tank.id }]);
  const gunDiedFirst = runUntil(w3, () => !gun.alive, 200) < 200 && tank.alive;
  runUntil(w3, () => w3.winner >= 0);
  log(gunDiedFirst && w3.winner === 2, '砲彈還在飛時不判勝負（榴彈砲先死、砲彈落地打死敵人＝同歸於盡）', `榴彈砲先死 ${gunDiedFirst}，winner ${w3.winner}`);
}
if (BUILTINS) { // 整數平方根
  let ok = true;
  for (const n of [0, 1, 2, 3, 4, 15, 16, 17, 99, 100, 65535, 65536, 1e9, 2 ** 40 + 7]) { const r = isqrt(n); if (!(r * r <= n && (r + 1) * (r + 1) > n)) ok = false; }
  log(ok, '整數平方根 isqrt 對 0…2^40 的抽樣都精確');
}
if (BUILTINS) { // 地圖（種子 0–199 都驗）：建築 ≥12、出生角落沒有建築、單位不站在建築上、每個單位都走得到每個敵人
  const badSeeds = [];
  let minB = 1e9, maxB = 0;
  for (let seed = 0; seed < 200; seed++) {
    const w = createWorld(seed), c = u => [Math.floor(u.x / SUB), Math.floor(u.z / SUB)];
    minB = Math.min(minB, w.blds.length); maxB = Math.max(maxB, w.blds.length);
    const onBld = w.units.some(u => w.occ[idx(...c(u))]);
    const inCorner = w.blds.some(b => { for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) if ((x >= 22 && z >= 22) || (x <= 9 && z <= 9)) return true; return false; });
    let reach = true;
    for (const a of w.units) for (const b of w.units) if (a.side !== b.side) { const p = findPath(w, ...c(a), ...c(b)); if (p[p.length - 1] !== idx(...c(b))) reach = false; }
    if (w.blds.length < 12 || onBld || inCorner || !reach) badSeeds.push(seed);
  }
  log(badSeeds.length === 0, '村莊地圖（種子 0–199）：建築 ≥12、出生角落沒有建築、單位不站在建築上、兩方互相走得到', `建築 ${minB}–${maxB} 棟；不合格的種子：${badSeeds.join(',') || '無'}`);
}

// ---- 4. 寫入者自己加的守衛：tests/*.mjs，各自在子行程裡跑，退出碼 0＝綠（AGENTS.md 第 3 節）----
// 排在黃金雜湊之前（R005）：弄壞某個機制時，第一個紅燈落在那個機制的守衛上，不是黃金雜湊。
{
  const dir = path.join(ROOT, 'tests');
  const all = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.mjs')).sort() : [];
  const files = SHARD ? shardOf(all, dir, SHARD.k, SHARD.n) : all;
  if (SHARD) console.log(`・分片 ${SHARD.k}/${SHARD.n}：內建各節${BUILTINS ? '有跑' : '在第 1 份'}；這一份跑 ${files.length}／${all.length} 支：${files.join(' ')}`);
  for (const f of files) {
    if (LIST_ONLY) { console.log(`LIST tests/${f}`); continue; }
    const r = spawnSync(process.execPath, [path.join(dir, f)], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
    log(r.status === 0, `tests/${f}`, r.status === 0 ? '' : `退出碼 ${r.status}：${(r.stdout + r.stderr).trim().split('\n').slice(-3).join(' ｜ ')}`);
  }
  if (!all.length) console.log('・tests/ 還沒有守衛');
}

// ---- 5. 決定性與黃金雜湊（放在所有行為守衛之後：行為壞了，第一個紅燈落在那條行為守衛上）----
if (BUILTINS) {
  const ta = Date.now(), a = hashWorld(runScript()), ms = Date.now() - ta, b = hashWorld(runScript());
  log(a === b, `同種子同指令跑 ${SCRIPT_TICKS} tick 兩次，雜湊相同`, `${a} / ${b}；一次 ${ms} ms（只記錄，不設門檻）`);
  const c = hashWorld(runScript(SCRIPT_TICKS, SCRIPT_SEED + 1));
  log(c !== a, '換種子雜湊不同', `${SCRIPT_SEED + 1} → ${c}`);
  // 重播：指令紀錄經過 JSON 來回（瀏覽器存下來的樣子）再跑一次，結果要相同
  const replay = hashWorld(runLog(createWorld(SCRIPT_SEED), JSON.parse(JSON.stringify(SCRIPT)), SCRIPT_TICKS));
  log(replay === a, '指令紀錄經 JSON 來回後重播，雜湊相同', replay);
  // 中途存檔：600 tick 時把世界深拷貝，接著跑到底，要跟沒中斷的一樣（狀態都在 World 裡，沒有藏在模組變數）
  const w1 = runLog(createWorld(SCRIPT_SEED), SCRIPT, 600), w2 = structuredClone(w1);
  runLog(w1, SCRIPT, SCRIPT_TICKS); runLog(w2, SCRIPT, SCRIPT_TICKS);
  log(hashWorld(w1) === a && hashWorld(w2) === a, '600 tick 深拷貝後各自跑完，雜湊都等於直接跑', `${hashWorld(w1)} / ${hashWorld(w2)}`);
  // 黃金雜湊：改到模擬就會變，卡面要寫新舊值與原因
  const golden = JSON.parse(read('tools/golden.json'));
  log(golden.seed === SCRIPT_SEED && golden.ticks === SCRIPT_TICKS && golden.hash === a, '腳本戰鬥雜湊等於 tools/golden.json', `golden ${golden.hash}，現在 ${a}`);
}

const sec = ((Date.now() - t0) / 1000).toFixed(1);
if (fails.length) { console.log(`\nNG 紅燈（${sec}s）：${fails.join('、')}`); process.exit(1); }
console.log(`\nOK 綠燈（${sec}s）`);
