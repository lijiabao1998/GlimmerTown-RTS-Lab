// Node 端守衛：不開瀏覽器，直接跑模擬層。用法：node tools/unit.mjs　退出碼 0＝綠、1＝紅
// 模擬層 import 寫明 .ts，Node 22.18+ 可以直接跑（型別剝除）。
import fs from 'node:fs';
import path from 'node:path';
import { createScanner, SyntaxKind } from 'typescript/unstable/ast';
import { ROOT } from './cdp.mjs';
import {
  createWorld, hashWorld, stageOf, blocks, idx, center, N, SUB,
  STAGE_INTACT, STAGE_ROOFLESS, STAGE_RUBBLE, UNIT_KINDS, UK_TANK, UK_HOWITZER, ORD_IDLE, BK_HOUSE,
} from '../src/sim/world.ts';
import { step, runLog, firstBlock } from '../src/sim/step.ts';
import { findPath } from '../src/sim/path.ts';
import { isqrt } from '../src/sim/math.ts';
import { SCRIPT, SCRIPT_SEED, SCRIPT_TICKS, runScript } from '../src/sim/script.ts';

const t0 = Date.now(), fails = [];
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
function log(ok, name, detail = '') {
  console.log(`${ok ? 'OK' : 'NG'}  ${name}${detail ? '　— ' + detail : ''}`);
  if (!ok) fails.push(name);
}

// ---- 1. 模擬層純度（AGENTS.md 規則 2、3）----
// 詞法掃描照搬 GlimmerTown3D-lab@bece722 tools/unit.mjs:588-647；本線另外禁止浮點超越函式（模擬只用整數算術）。
const FLOAT_FNS = ['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh',
  'exp', 'expm1', 'log', 'log2', 'log10', 'log1p', 'pow', 'sqrt', 'cbrt', 'hypot', 'fround', 'random'];
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
  const specIsOutside = spec => /(^three(?:\/|$)|(^|\/)(render|ui)(?:\/|$)|(^|\/)main(\.ts)?$)/.test(spec);
  const moduleToken = t => t?.k === SyntaxKind.StringLiteral || t?.k === SyntaxKind.NoSubstitutionTemplateLiteral;
  const moduleValue = t => t.k === SyntaxKind.StringLiteral ? t.value : t.text.slice(1, -1);
  const dot = t => t?.k === SyntaxKind.DotToken || t?.k === SyntaxKind.QuestionDotToken;
  const DOM = ['document', 'window', 'HTMLElement', 'localStorage', 'sessionStorage', 'navigator', 'requestAnimationFrame'];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i], a = tokens[i + 1], b = tokens[i + 2];
    if (t.k === SyntaxKind.ImportKeyword) {
      if (a?.k === SyntaxKind.OpenParenToken) {
        if (moduleToken(b) && specIsOutside(moduleValue(b))) at(t, `dynamic import ${moduleValue(b)}`);
      } else if (moduleToken(a)) { if (specIsOutside(moduleValue(a))) at(t, `import ${moduleValue(a)}`); }
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
    if (t.text === 'require' && a?.k === SyntaxKind.OpenParenToken && moduleToken(b) && specIsOutside(moduleValue(b))) at(t, `require ${moduleValue(b)}`);
    if (DOM.includes(t.text) && t.k === SyntaxKind.Identifier) at(t, t.text);
    if (t.text === 'globalThis' && a?.k === SyntaxKind.OpenBracketToken && moduleToken(b) && DOM.includes(moduleValue(b))) at(t, `globalThis[${moduleValue(b)}]`);
    if (t.text === 'Math' && ((dot(a) && FLOAT_FNS.includes(b?.text)) || (a?.k === SyntaxKind.OpenBracketToken && moduleToken(b) && FLOAT_FNS.includes(moduleValue(b))))) at(t, `Math.${dot(a) ? b.text : moduleValue(b)}`);
    if (t.text === 'Date' && ((dot(a) && b?.text === 'now') || (a?.k === SyntaxKind.OpenBracketToken && moduleToken(b) && moduleValue(b) === 'now') || a?.k === SyntaxKind.OpenParenToken || tokens[i - 1]?.k === SyntaxKind.NewKeyword)) at(t, 'Date／Date.now');
    if (t.text === 'performance' && ((dot(a) && ['now', 'timeOrigin'].includes(b?.text)) || (a?.k === SyntaxKind.OpenBracketToken && moduleToken(b) && ['now', 'timeOrigin'].includes(moduleValue(b))))) at(t, 'performance.now');
  }
  return violations;
}
{
  const bad = [];
  const check = dir => { for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) { check(p); continue; }
    if (!e.isFile() || !/\.(ts|js|mjs)$/.test(e.name)) continue;
    bad.push(...purityViolations(read(p)).map(v => `${p}:${v}`));
  } };
  check('src/sim');
  log(bad.length === 0, '模擬層不碰 three／render／ui／DOM／Math.random／現實時間／浮點超越函式', bad.join(' ') || 'src/sim 全乾淨');
  const forbidden = ["import 'three'", "import x from 'three'", "await import('three')", "require('three')", "import { a } from '../render/battle.ts'", "import { b } from '../ui/hud.ts'",
    'window.alert(1)', 'globalThis.document.title', "globalThis['window']", 'Math.random()', "Math['random']()", 'Math.sqrt(2)', 'Math.hypot(1, 2)', 'Math.atan2(1, 2)', "Math['sin'](1)",
    'Date.now()', 'new Date()', 'new Date', 'performance.now()', 'const q = `x ${1} and ${window.innerWidth}`'];
  const harmless = ["// Math.random() and import 'three'", "const s = 'window and Date.now() and Math.sqrt'", 'const q = `document ${1} and Math.random`', 'Math.floor(1.5) + Math.imul(2, 3) + Math.trunc(-1.5)'];
  const missed = forbidden.filter(s => purityViolations(s).length === 0), wrong = harmless.filter(s => purityViolations(s).length > 0);
  log(!missed.length && !wrong.length, '純度掃描自我測試：禁止片段全抓到、註解字串與整數 Math 不誤報', [...missed.map(s => '漏 ' + s), ...wrong.map(s => '誤 ' + s)].join('；'));
}

// ---- 2. 零外部素材：src 沒有圖片／字型／模型／音效檔，程式與 index.html 不引用外部網址 ----
{
  const assets = [], urls = [];
  const walk = d => { for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) { const p = `${d}/${e.name}`; if (e.isDirectory()) walk(p); else if (/\.(png|jpe?g|gif|webp|svg|glb|gltf|obj|fbx|ttf|otf|woff2?|mp3|ogg|wav|m4a)$/i.test(e.name)) assets.push(p); else if (/\.(ts|html|css|json)$/.test(e.name)) read(p).split('\n').forEach((l, i) => { if (/https?:\/\//.test(l.replace(/\/\/ .*$|^\s*\*.*$/, ''))) urls.push(`${p}:${i + 1}`); }); } };
  walk('src');
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

{ // A*：繞過完好的牆、牆倒成瓦礫後直接穿過
  const w = blank(), wall = addBld(w, 10, 6, 1, 9);
  const p1 = findPath(w, 8, 10, 12, 10);
  const throughWall = p1.some(c => w.occ[c]);
  const end1 = p1[p1.length - 1];
  log(p1.length > 4 && !throughWall && end1 === idx(12, 10), 'A* 繞過完好建築', `${p1.length} 步，終點 ${end1 % N},${Math.floor(end1 / N)}`);
  wall.hp = 0;
  const p2 = findPath(w, 8, 10, 12, 10);
  log(p2.length === 4 && p2.some(c => w.occ[c]), 'A* 穿過瓦礫', `${p2.length} 步`);
}
{ // 坦克瞄準房子後面的敵人：砲彈打在房子上
  const w = blank(), house = addBld(w, 10, 10, 1, 1), me = addUnit(w, 0, UK_TANK, 8, 10), foe = addUnit(w, 1, UK_TANK, 12, 10);
  foe.hp = 1000; foe.alive = true;
  step(w, [{ t: 'attack', side: 0, ids: [me.id], target: foe.id }]);
  run(w, 30);
  log(house.hp < house.maxHp && foe.hp === 1000, '坦克被房子擋住時，砲彈打在房子上', `房子 ${house.hp}/${house.maxHp}，敵人 ${foe.hp}`);
}
{ // 損壞三段門檻（3D-lab：dmg≥0.3 沒屋頂、dmg≥1 瓦礫）；瓦礫不擋路、不擋射線
  const w = blank(), b = addBld(w, 5, 5, 1, 1, 100);
  const at = hp => { b.hp = hp; return stageOf(b); };
  const ok = at(100) === STAGE_INTACT && at(71) === STAGE_INTACT && at(70) === STAGE_ROOFLESS && at(1) === STAGE_ROOFLESS && at(0) === STAGE_RUBBLE;
  b.hp = 0;
  const clear = !blocks(w, 5, 5) && firstBlock(w, center(3), center(5), center(8), center(5)) < 0;
  b.hp = 50;
  const blocked = blocks(w, 5, 5) && firstBlock(w, center(3), center(5), center(8), center(5)) === idx(5, 5);
  log(ok && clear && blocked, '損壞門檻：<0.3 完好、≥0.3 沒屋頂、≥1 瓦礫；瓦礫不擋路不擋射線、空殼照擋', `${ok}/${clear}/${blocked}`);
}
{ // 榴彈砲不接最小射程內的目標
  const w = blank(), gun = addUnit(w, 0, UK_HOWITZER, 5, 5);
  addUnit(w, 1, UK_TANK, 30, 30);
  step(w, [{ t: 'fireAt', side: 0, ids: [gun.id], x: 7, z: 5 }]);
  run(w, 200);
  log(gun.order === ORD_IDLE && w.nextShell === 1 && gun.x === center(5), '榴彈砲拒絕最小射程內的射擊', `order ${gun.order}，發射 ${w.nextShell - 1} 發`);
}
{ // 高爆彈留下彈坑
  const w = blank(), gun = addUnit(w, 0, UK_HOWITZER, 2, 2);
  addUnit(w, 1, UK_TANK, 31, 0);
  step(w, [{ t: 'fireAt', side: 0, ids: [gun.id], x: 15, z: 15 }]);
  run(w, 400);
  let craters = 0, near = true;
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) if (w.crater[idx(x, z)]) { craters++; if (Math.abs(x - 15) > 4 || Math.abs(z - 15) > 4) near = false; }
  log(craters > 0 && near, '高爆彈落點留下彈坑（落在散布範圍內）', `${craters} 格有彈坑`);
}
{ // 死掉的單位不再被瞄準；一方全滅判勝
  const w = blank(), me = addUnit(w, 0, UK_TANK, 10, 10), dead = addUnit(w, 1, UK_TANK, 12, 10), live = addUnit(w, 1, UK_TANK, 10, 13);
  dead.alive = false; dead.hp = 0; me.hp = 1000;
  run(w, 1);
  const firstAim = w.shells.length ? w.shells[0].target : 0;
  log(firstAim === live.id, '自動找目標跳過死掉的單位', `第一發瞄準 ${firstAim}`);
  run(w, 400);
  log(!live.alive && w.winner === 0, '敵方全滅時判我方勝', `winner ${w.winner}，敵人 hp ${live.hp}`);
}
{ // 整數平方根
  let ok = true;
  for (const n of [0, 1, 2, 3, 4, 15, 16, 17, 99, 100, 65535, 65536, 1e9, 2 ** 40 + 7]) { const r = isqrt(n); if (!(r * r <= n && (r + 1) * (r + 1) > n)) ok = false; }
  log(ok, '整數平方根 isqrt 對 0…2^40 的抽樣都精確');
}
{ // 地圖：兩方出生角落沒有建築、每個單位都站在空地上、一開始彼此都走得到
  const w = createWorld(SCRIPT_SEED);
  const onBld = w.units.filter(u => w.occ[idx(Math.floor(u.x / SUB), Math.floor(u.z / SUB))]);
  const inCorner = w.blds.filter(b => { for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) if ((x >= 22 && z >= 22) || (x <= 9 && z <= 9)) return true; return false; });
  const a = w.units[0], b = w.units.find(u => u.side === 1);
  const p = findPath(w, Math.floor(a.x / SUB), Math.floor(a.z / SUB), Math.floor(b.x / SUB), Math.floor(b.z / SUB));
  const end = p[p.length - 1];
  log(w.blds.length >= 12 && onBld.length === 0 && inCorner.length === 0 && end === idx(Math.floor(b.x / SUB), Math.floor(b.z / SUB)), '村莊地圖：建築 ≥12、出生角落沒有建築、單位不站在建築上、兩方互相走得到', `${w.blds.length} 棟；角落裡 ${inCorner.length} 棟`);
}

// ---- 4. 決定性與黃金雜湊（放在行為守衛之後：行為壞了，第一個紅燈落在那條行為守衛上）----
{
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
