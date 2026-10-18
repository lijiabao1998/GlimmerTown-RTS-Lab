// 煙霧測試：無頭 Chrome（SwiftShader）開 dist/index.html，量預算、比對 Node 與瀏覽器的雜湊、用真的觸控下指令、拍樣張。
// 用法：npm run build && node tools/smoke.mjs　退出碼 0＝綠、1＝紅；樣張存在 shots/（不進倉庫，CI 當附件）。
import fs from 'node:fs';
import path from 'node:path';
import { withBrowser, touchTap, shot, sleep, ROOT } from './cdp.mjs';
import { hashWorld, createWorld, bldAt, N } from '../src/sim/world.ts';
import { runLog, step } from '../src/sim/step.ts';
import { runScript, SCRIPT, SCRIPT_TICKS } from '../src/sim/script.ts';
import { FLOOR_H } from '../src/render/buildings.ts';
import { buildError, BUILD_KINDS } from '../src/sim/build.ts';
import { spotted } from '../src/sim/step.ts';
import { endgameLog } from './endgame.mjs';

const t0 = Date.now(), fails = [];
function log(ok, name, detail = '') {
  console.log(`${ok ? 'OK' : 'NG'}  ${name}${detail ? '　— ' + detail : ''}`);
  if (!ok) fails.push(name);
}
const SHOTS = path.join(ROOT, 'shots');
const BUDGET = { calls: 20, triangles: 80_000 };     // R001 手機預算（含陰影那一趟）
const nodeHash = hashWorld(runScript());
const nodeHalf = hashWorld(runScript(600));
// 每個瀏覽器工作階段用不同的埠：上一個 Chrome 還在關的時候，下一個才不會撞到同一個除錯埠（CI 上曾因此卡 60 秒）
const PORTS = { desktop: 8411, mobile: 8431, valve: 8451, build: 8471, fx: 8491, fxMobile: 8511, noR004: 8531, tracks: 8551, noR008: 8571, bars: 8591, barsMobile: 8611, noR009: 8631, report: 8651, reportMobile: 8671, noR010: 8691, cam: 8771, camMobile: 8831, noR012: 8851 };
const external = reqs => reqs.filter(u => !/^(http:\/\/127\.0\.0\.1|data:|blob:|about:|chrome)/.test(u));

// 一個空地格（我方附近、沒有建築）：觸控下移動指令用
function freeCellNear(cx, cz) {
  const w = createWorld(1944);
  for (let r = 0; r < 6; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
    const x = cx + dx, z = cz + dz;
    if (x >= 0 && z >= 0 && x < N && z < N && !bldAt(w, x, z)) return [x, z];
  }
  return [cx, cz];
}

// ---- 產物只有一個檔 ----
{
  const files = fs.readdirSync(path.join(ROOT, 'dist'), { recursive: true });
  log(files.length === 1 && files[0] === 'index.html', '建置產物只有 dist/index.html', files.join(' '));
}

// ---- 桌機 1280×800 ----
await withBrowser({ width: 1280, height: 800, port: PORTS.desktop }, async ({ open, page }) => {
  console.log(`Chrome 可連線：${page.chrome.ms} ms（第 ${page.chrome.tries} 次）`);
  await open('');
  const info = await page.evaluate('__rts.info()');
  log(info.calls > 0 && info.triangles > 0, '桌機開局有畫出東西', JSON.stringify(info));
  await shot(page, path.join(SHOTS, 'desktop-start.png'));
  const half = await page.evaluate('__rts.runScript(600)');
  await page.evaluate('__rts.pause(true)'); await sleep(500);
  await shot(page, path.join(SHOTS, 'desktop-30s.png'));
  log(half === nodeHalf, '瀏覽器跑腳本戰鬥 600 tick，雜湊等於 Node', `${half} / ${nodeHalf}`);
  const full = await page.evaluate(`__rts.runScript(${SCRIPT_TICKS})`);
  log(full === nodeHash, `瀏覽器跑腳本戰鬥 ${SCRIPT_TICKS} tick，雜湊等於 Node`, `${full} / ${nodeHash}`);
  // 即時迴圈：不暫停跑 2 秒，tick 要往前走
  await page.evaluate('__rts.pause(false)');
  const a = await page.evaluate('__rts.tick()'); await sleep(2000); const b = await page.evaluate('__rts.tick()');
  log(b > a, '即時迴圈在走', `${a} → ${b}`);
  log(page.errors.length === 0, '桌機零頁面錯誤', page.errors.join(' | '));
  log(external(page.requests).length === 0, '桌機零外部請求', external(page.requests).join(' '));
});

// ---- 手機 412×860：R006 布陣（預設網址開頁就是布陣）——預算、真觸控放房子、按「開戰」、Node 重播 ----
await withBrowser({ width: 412, height: 860, mobile: true, port: PORTS.build }, async ({ open, page }) => {
  await open('');
  const t0b = await page.evaluate('__rts.tick()'); await sleep(600); const t1b = await page.evaluate('__rts.tick()');
  const ph = await page.evaluate('__rts.phase()');
  log(ph === 'build' && t0b === 0 && t1b === 0, '開頁在布陣、停在第 0 步', `phase ${ph}，tick ${t0b} → ${t1b}`);
  const info = await page.evaluate('__rts.info()');
  log(info.calls <= BUDGET.calls && info.triangles <= BUDGET.triangles, `手機開局預算：繪製呼叫 ≤ ${BUDGET.calls}、三角形 ≤ ${BUDGET.triangles}`, JSON.stringify(info));
  await shot(page, path.join(SHOTS, 'mobile-start.png'));
  // 挑一格合法的農舍位置（Node 用同一支 buildError 判），而且畫面上點得到（在畫布上、不在布陣列底下）
  const w0 = createWorld(1944), cottage = BUILD_KINDS.find(k => k.w === 1 && k.d === 1);
  let cell = null, tx = 0, ty = 0;
  for (let z = 17; z < N && !cell; z++) for (let x = 17; x < N && !cell; x++) {
    if (buildError(w0, { t: 'build', side: 0, kind: cottage.kind, x, z })) continue;
    const [sx, sy] = await page.evaluate(`__rts.screenOfCell(${x}, ${z})`);
    if (sx < 30 || sy < 130 || sx > 382 || sy > 620) continue;
    if (await page.evaluate(`document.elementFromPoint(${sx}, ${sy})?.tagName`) !== 'CANVAS') continue;
    cell = [x, z]; tx = sx; ty = sy;
  }
  if (cell) await touchTap(page, tx, ty);
  const plan = await page.evaluate('__rts.plan()');
  log(!!cell && plan.length === 1 && plan[0].x === cell[0] && plan[0].z === cell[1] && plan[0].kind === cottage.kind, '觸控點我方半場的一格＝布陣多一棟農舍',
    cell ? `點 (${tx.toFixed(0)},${ty.toFixed(0)}) → ${JSON.stringify(plan)}` : '畫面上找不到合法的格');
  await sleep(300);
  await shot(page, path.join(SHOTS, 'mobile-build.png'));
  const r = await page.evaluate("(() => { const b = document.getElementById('bb-start').getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2, b.width, b.height]; })()");
  await touchTap(page, r[0], r[1]);
  await page.evaluate('__rts.pause(true)');
  const lg = await page.evaluate('__rts.log()'), ph2 = await page.evaluate('__rts.phase()');
  const b0 = lg.filter(c => c.cmd.t === 'build' && c.tick === 0 && c.cmd.side === 0).length, b1 = lg.filter(c => c.cmd.t === 'build' && c.tick === 0 && c.cmd.side === 1).length;
  log(ph2 === 'battle' && b0 === 1 && b1 >= 1 && r[2] >= 44 && r[3] >= 44, '觸控按「開戰」：紀錄裡有第 0 步的我方與敵方布陣，開打', `phase ${ph2}，我方 ${b0} 條、敵方 ${b1} 條；按鈕 ${r[2].toFixed(0)}×${r[3].toFixed(0)}`);
  const t = await page.evaluate('__rts.stepN(Math.max(0, 100 - __rts.tick()))'), h = await page.evaluate('__rts.hash()');
  const nodeH = hashWorld(runLog(createWorld(1944), lg, t));
  log(h === nodeH, '布陣後跑 100 步：瀏覽器雜湊等於 Node 重播', `tick ${t}：${h} / ${nodeH}`);
  log(page.errors.length === 0, '布陣零頁面錯誤', page.errors.join(' | '));
  log(external(page.requests).length === 0, '布陣零外部請求', external(page.requests).join(' '));
});

// ---- 手機 412×860：?noR006=1（沒有布陣，R102 的流程）——觸控、即時重播、戰鬥中預算 ----
await withBrowser({ width: 412, height: 860, mobile: true, port: PORTS.mobile }, async ({ open, page }) => {
  await open('noR006=1');
  const phv = await page.evaluate('__rts.phase()'), tv = await page.evaluate('__rts.tick()');
  log(phv === 'battle' && tv > 0, '?noR006=1：開頁直接開打（不停在第 0 步）', `phase ${phv}，tick ${tv}`);
  await page.evaluate('__rts.pause(true)');
  await sleep(400);
  // 觸控：點我方 1 號坦克 → 選到；點附近空地 → 紀錄裡多一條移動指令
  const [ux, uy] = await page.evaluate('__rts.screenOf(1)');
  await touchTap(page, ux, uy);
  const sel = await page.evaluate('__rts.selected()');
  log(sel.length === 1 && sel[0] === 1, '觸控點我方坦克會選取', `點 (${ux.toFixed(0)},${uy.toFixed(0)})，選到 ${JSON.stringify(sel)}`);
  const [gx, gz] = freeCellNear(21, 22);
  const [cx, cy] = await page.evaluate(`__rts.screenOfCell(${gx}, ${gz})`);
  await touchTap(page, cx, cy);
  const lg = await page.evaluate('__rts.log()');
  const mv = lg.find(c => c.cmd.t === 'move');
  log(!!mv && JSON.stringify(mv.cmd.ids) === '[1]', '觸控點地面會下移動指令', mv ? JSON.stringify(mv.cmd) : `紀錄 ${JSON.stringify(lg)}`);
  // 觸控點小房子的屋頂：要對那棟房子開火，不是移動到屋頂後面的地面
  // 挑屋頂真的落在畫布上（不在畫面外、不在 HUD 按鈕底下）的 1×1 小房子
  const blds = await page.evaluate('__rts.blds()');
  let house = null, rx = 0, ry = 0;
  for (const b of blds.filter(b => b.w === 1 && b.d === 1 && b.hp > 0)) {
    const [x, y] = await page.evaluate(`__rts.screenOfPoint(${b.x + 0.5}, ${b.floors * FLOOR_H + 0.1 + 0.2}, ${b.z + 0.5})`);
    if (x < 20 || y < 20 || x > 392 || y > 840) continue;
    if (await page.evaluate(`document.elementFromPoint(${x}, ${y})?.tagName`) !== 'CANVAS') continue;
    house = b; rx = x; ry = y; break;
  }
  if (house) await touchTap(page, rx, ry);
  const fire = (await page.evaluate('__rts.log()')).find(c => c.cmd.t === 'fireAt');
  log(!!house && !!fire && fire.cmd.x === house.x && fire.cmd.z === house.z, '觸控點小房子的屋頂＝對那棟房子開火',
    !house ? '畫面上找不到 1×1 小房子' : fire ? `${JSON.stringify(fire.cmd)}，房子 #${house.id} 在 ${house.x},${house.z}，點 (${rx.toFixed(0)},${ry.toFixed(0)})` : `沒有開火指令（點 ${rx.toFixed(0)},${ry.toFixed(0)}）`);
  // 即時迴圈下的指令紀錄，拿到 Node 重播要得到同一個雜湊（含會抽亂數的榴彈砲射擊）
  await page.evaluate("__rts.issue({ t: 'fireAt', side: 0, ids: [4], x: 10, z: 10 })");
  const t1 = await page.evaluate('__rts.stepN(60)'), h1 = await page.evaluate('__rts.hash()');
  const t2 = await page.evaluate('__rts.stepN(140)'), h2 = await page.evaluate('__rts.hash()');
  const liveLog = await page.evaluate('__rts.log()');
  const n1 = hashWorld(runLog(createWorld(1944), liveLog, t1)), n2 = hashWorld(runLog(createWorld(1944), liveLog, t2));
  log(h1 === n1 && h2 === n2, '即時遊玩的指令紀錄在 Node 重播，雜湊相同（兩個時間點）', `tick ${t1}: ${h1}/${n1}；tick ${t2}: ${h2}/${n2}；指令 ${liveLog.length} 條`);
  await page.evaluate('__rts.runScript(600)'); await page.evaluate('__rts.pause(true)'); await sleep(500);
  await shot(page, path.join(SHOTS, 'mobile-30s.png'));
  const mid = await page.evaluate('__rts.info()');
  log(mid.calls <= BUDGET.calls + 2, '手機戰鬥中繪製呼叫仍在預算附近（爆炸、砲彈各多一次）', JSON.stringify(mid));
  log(page.errors.length === 0, '手機零頁面錯誤', page.errors.join(' | '));
  log(external(page.requests).length === 0, '手機零外部請求', external(page.requests).join(' '));
});

// ---- 逃生閥 ?fx=off：效果關掉，模擬結果不變 ----
await withBrowser({ width: 800, height: 600, port: PORTS.valve }, async ({ open, page }) => {
  await open('fx=off');
  const info = await page.evaluate('__rts.info()');
  const h = await page.evaluate(`__rts.runScript(${SCRIPT_TICKS})`);
  log(info.fx === false && h === nodeHash, '?fx=off 關掉效果，模擬雜湊不變', `fx=${info.fx}，${h}`);
  log(page.errors.length === 0, '?fx=off 零頁面錯誤', page.errors.join(' | '));
});


// ---- R004 特寫：效果正在發生的那一刻（固定 tick、固定鏡頭；暫停＝模擬時間凍結，畫面可重現）----
// 腳本戰鬥裡沒有房子倒成瓦礫，所以倒塌特寫用腳本第 600 步加一條射擊指令（Node 先算出倒塌的那一步）。
const FX = (() => {
  const base = runScript(600), live = base.units.filter(u => u.alive && u.side === 0 && u.kind !== 2).map(u => u.id);
  let best = null;   // 最快倒的那一棟
  for (const b of base.blds.filter(b => b.hp > 0)) {
    const w = structuredClone(base), cmd = { t: 'fireAt', side: 0, ids: live, x: b.x, z: b.z };
    for (let k = 0; k < (best ? best.ticks : 600); k++) {
      step(w, k === 0 ? [cmd] : []);
      if (w.events.some(e => e.e === 'stage' && e.bld === b.id && e.stage === 2)) { best = { cmd, b, ticks: w.tick - 600 }; break; }
    }
  }
  return best;
})();
const HE = (() => {   // 第一發我方看得到的高爆彈落點
  const w = createWorld(1944);
  let i = 0;
  while (w.tick < SCRIPT_TICKS) {
    const now = []; while (i < SCRIPT.length && SCRIPT[i].tick <= w.tick) { if (SCRIPT[i].tick === w.tick) now.push(SCRIPT[i].cmd); i++; }
    step(w, now);
    const e = w.events.find(e => e.e === 'impact' && e.kind === 1);
    if (e && spotted(w, 0, e.x, e.z)) return { tick: w.tick, x: e.x / 256, z: e.z / 256 };
  }
  return null;
})();
const collapseJs = FX ? `__rts.pause(true); __rts.runScript(600); __rts.issue(${JSON.stringify(FX.cmd)}); __rts.stepN(${FX.ticks + 6}); __rts.focus(${FX.b.x + FX.b.w / 2}, ${FX.b.z + FX.b.d / 2}, 2.4); 0` : '0';
const impactJs = HE ? `__rts.pause(true); __rts.runScript(${HE.tick - 1}); __rts.stepN(3); __rts.focus(${HE.x}, ${HE.z}, 2.4); 0` : '0';
const sum = p => p.puff + p.glow + p.debris + p.ring + p.ghost;
await withBrowser({ width: 1280, height: 800, port: PORTS.fx }, async ({ open, page }) => {
  await open('');
  log(!!FX && !!HE, 'R004 特寫的時刻（Node 算）', `倒塌：#${FX?.b.id} 在 ${FX?.b.x},${FX?.b.z}，第 600 步下令後 ${FX?.ticks} 步倒；高爆彈：第 ${HE?.tick} 步落在 ${HE?.x.toFixed(1)},${HE?.z.toFixed(1)}`);
  await page.evaluate(collapseJs); await sleep(400);
  const c1 = await page.evaluate('__rts.info()'), d1 = await page.evaluate('__rts.fxDigest()');
  await shot(page, path.join(SHOTS, 'desktop-collapse.png'));
  log(c1.calls <= BUDGET.calls + 2 && c1.triangles <= BUDGET.triangles, '倒塌特寫：繪製呼叫 ≤ 22、三角形 ≤ 80,000', JSON.stringify(c1));
  log(c1.pools.ghost > 0 && c1.pools.debris > 0 && c1.pools.puff > 0, '倒塌特寫：倒塌殘影、碎片、揚塵都在畫', JSON.stringify(c1.pools));
  await page.evaluate(collapseJs); await sleep(400);
  const d2 = await page.evaluate('__rts.fxDigest()');
  log(d1 === d2 && d1 !== 'off', '倒塌特寫重跑一次：效果池狀態完全相同（只用 hash2 與模擬時間）', `${d1} / ${d2}`);
  await page.evaluate(impactJs); await sleep(400);
  const i1 = await page.evaluate('__rts.info()'), e1 = await page.evaluate('__rts.fxDigest()');
  await shot(page, path.join(SHOTS, 'desktop-impact.png'));
  log(i1.calls <= BUDGET.calls + 2 && i1.triangles <= BUDGET.triangles && i1.pools.glow > 0 && i1.pools.ring > 0, '彈著特寫：光與震波環在畫；繪製呼叫 ≤ 22、三角形 ≤ 80,000', JSON.stringify(i1));
  await page.evaluate(impactJs); await sleep(400);
  const e2 = await page.evaluate('__rts.fxDigest()');
  log(e1 === e2, '彈著特寫重跑一次：效果池狀態完全相同', `${e1} / ${e2}`);
  log(page.errors.length === 0, '特寫零頁面錯誤', page.errors.join(' | '));
});
await withBrowser({ width: 412, height: 860, mobile: true, port: PORTS.fxMobile }, async ({ open, page }) => {
  await open('');
  await page.evaluate(collapseJs); await sleep(400);
  const m1 = await page.evaluate('__rts.info()');
  await shot(page, path.join(SHOTS, 'mobile-collapse.png'));
  log(m1.calls <= BUDGET.calls + 2 && m1.triangles <= BUDGET.triangles && m1.pools.ghost > 0, '手機倒塌特寫：繪製呼叫 ≤ 22、三角形 ≤ 80,000、殘影在畫', JSON.stringify(m1));
  log(page.errors.length === 0, '手機特寫零頁面錯誤', page.errors.join(' | '));
});
// 逃生閥：?noR004=1＝舊效果（新池全程 0 個實例）；?fx=off＝所有效果 0 個實例。雜湊都不變。
await withBrowser({ width: 800, height: 600, port: PORTS.noR004 }, async ({ open, page }) => {
  for (const q of ['noR004=1', 'fx=off']) {
    await open(q);
    const h = await page.evaluate(`__rts.runScript(${SCRIPT_TICKS})`);
    await page.evaluate(collapseJs); await sleep(300);
    const a = await page.evaluate('__rts.info()');
    await page.evaluate(impactJs); await sleep(300);
    const b = await page.evaluate('__rts.info()');
    log(h === nodeHash && sum(a.pools) === 0 && sum(b.pools) === 0 && !a.r004, `?${q}：新效果池全程 0 個實例，模擬雜湊不變`, `${h}；倒塌 ${JSON.stringify(a.pools)}；彈著 ${JSON.stringify(b.pools)}`);
  }
  log(page.errors.length === 0, '?noR004=1／?fx=off 零頁面錯誤', page.errors.join(' | '));
});


// ---- R008 車轍特寫：從第 0 步照腳本一步一步跑（每一步都餵畫面，跟真的玩一樣），鏡頭對準我方坦克走過的路 ----
await withBrowser({ width: 1280, height: 800, port: PORTS.tracks }, async ({ open, page }) => {
  await open('');
  const h = await page.evaluate('__rts.pause(true); __rts.playScript(600)');
  log(h === nodeHalf, '一步一步餵畫面跑腳本 600 步：瀏覽器雜湊等於 Node', `${h} / ${nodeHalf}`);
  await page.evaluate('__rts.focus(21.5, 21.5, 1.7)'); await sleep(400);
  const info = await page.evaluate('__rts.info()');
  log(info.calls <= BUDGET.calls + 2 && info.triangles <= BUDGET.triangles, '車轍特寫：繪製呼叫 ≤ 22、三角形 ≤ 80,000', JSON.stringify(info));
  await shot(page, path.join(SHOTS, 'desktop-tracks.png'));
  log(page.errors.length === 0, '車轍特寫零頁面錯誤', page.errors.join(' | '));
});
await withBrowser({ width: 800, height: 600, port: PORTS.noR008 }, async ({ open, page }) => {
  await open('noR008=1');
  const h = await page.evaluate(`__rts.pause(true); __rts.playScript(${SCRIPT_TICKS})`);
  log(h === nodeHash && page.errors.length === 0, '?noR008=1：一步一步跑完腳本，雜湊不變、零頁面錯誤', `${h} / ${nodeHash} ${page.errors.join(' | ')}`);
});


// ---- R009 血條特寫：我方第一次受傷後 0.2 秒（白色殘影還在縮），全選我方、鏡頭對準受傷的那台 ----
const HURT = (() => {
  const w = createWorld(1944);
  let i = 0;
  while (w.tick < SCRIPT_TICKS) {
    const now = []; while (i < SCRIPT.length && SCRIPT[i].tick <= w.tick) { if (SCRIPT[i].tick === w.tick) now.push(SCRIPT[i].cmd); i++; }
    step(w, now);
    const u = w.units.find(u => u.side === 0 && u.alive && u.kind !== 2 && u.hp < (u.kind === 0 ? 100 : 60));
    if (u) return { tick: w.tick + 4, id: u.id, x: u.x / 256, z: u.z / 256, mine: w.units.filter(x => x.side === 0).map(x => x.id) };
  }
  return null;
})();
const barsJs = HURT ? `__rts.pause(true); __rts.playScript(${HURT.tick}); __rts.select(${JSON.stringify(HURT.mine)}); __rts.focus(${HURT.x}, ${HURT.z}, 2); 0` : '0';
for (const [W, H, mobile, port, name] of [[1280, 800, false, PORTS.bars, 'desktop-bars.png'], [412, 860, true, PORTS.barsMobile, 'mobile-bars.png']]) {
  await withBrowser({ width: W, height: H, mobile, port }, async ({ open, page }) => {
    await open('');
    await page.evaluate(barsJs); await sleep(400);
    const info = await page.evaluate('__rts.info()'), bars = await page.evaluate('__rts.bars()');
    await shot(page, path.join(SHOTS, name));
    log(!!HURT && bars.bg > 0 && bars.fill > 0 && info.calls <= BUDGET.calls + 2 && info.triangles <= BUDGET.triangles, `血條特寫（${mobile ? '手機' : '桌機'}）：有血條、繪製呼叫 ≤ 22、三角形 ≤ 80,000`,
      `第 ${HURT?.tick} 步、#${HURT?.id} 受傷；血條 ${JSON.stringify(bars)}；${JSON.stringify({ calls: info.calls, triangles: info.triangles })}`);
    log(page.errors.length === 0, `血條特寫（${mobile ? '手機' : '桌機'}）零頁面錯誤`, page.errors.join(' | '));
  });
}
await withBrowser({ width: 800, height: 600, port: PORTS.noR009 }, async ({ open, page }) => {
  await open('noR009=1');
  await page.evaluate(barsJs); await sleep(300);
  const bars = await page.evaluate('__rts.bars()'), h = await page.evaluate(`__rts.runScript(${SCRIPT_TICKS})`);
  log(bars.bg === 0 && bars.fill === 0 && h === nodeHash && page.errors.length === 0, '?noR009=1：不畫血條、雜湊不變、零頁面錯誤', `${JSON.stringify(bars)}；${h}`);
});
// ---- R010 結局與戰報：一份會打完的固定紀錄（Node 產生），瀏覽器一步一步跑到勝負出現，量慢動作、等戰報 ----
const END = endgameLog();
const endHash = hashWorld(runLog(createWorld(1944), END.log, END.endTick));
for (const [W, H, mobile, port, name] of [[1280, 800, false, PORTS.report, 'desktop-report.png'], [412, 860, true, PORTS.reportMobile, 'mobile-report.png']]) {
  await withBrowser({ width: W, height: H, mobile, port }, async ({ open, page }) => {
    await open('');
    const h = await page.evaluate(`__rts.pause(true); __rts.playLog(1944, ${JSON.stringify(END.log)}, ${END.endTick})`);
    await page.evaluate('__rts.pause(false)');
    await sleep(100);
    const a = await page.evaluate('__rts.tick()'); await sleep(2000); const b = await page.evaluate('__rts.tick()');
    if (!mobile) log(h === endHash && b - a >= 9 && b - a <= 11, `勝負出現後慢動作：2 秒推進 ${b - a} 步（0.25 倍＝10 步，±10%）；雜湊等於 Node`, `勝方 ${END.winner}、第 ${END.endTick} 步；${h} / ${endHash}`);
    await sleep(1200);
    const rp = await page.evaluate('__rts.report()');
    const box = await page.evaluate("(() => { const p = document.querySelector('#report .panel')?.getBoundingClientRect(); const bs = [...document.querySelectorAll('#report .acts button')].map(b => { const r = b.getBoundingClientRect(); return [r.width, r.height]; }); return p ? { l: p.left, t: p.top, r: p.right, b: p.bottom, bs } : null; })()");
    await shot(page, path.join(SHOTS, name));
    const inside = !!box && box.l >= 0 && box.t >= 0 && box.r <= W && box.b <= H && box.bs.every(([bw, bh]) => bw >= 44 && bh >= 44);
    log(rp.shown && rp.data.winner === END.winner && inside, `戰報出現（${mobile ? '手機' : '桌機'}）：勝方對、面板與按鈕都在畫面內、按鈕 ≥ 44 像素`, `${JSON.stringify(box)}；擊毀 ${rp.data.kills}、損失 ${rp.data.lost}、開火 ${rp.data.fires}`);
    const [x, y] = await page.evaluate("(() => { const r = document.getElementById('rp-again').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()");
    if (mobile) await touchTap(page, x, y); else await page.evaluate("document.getElementById('rp-again').click()");
    await sleep(300);
    const ph = await page.evaluate('__rts.phase()'), t = await page.evaluate('__rts.tick()'), gone = !(await page.evaluate('__rts.report()')).shown;
    log(ph === 'build' && t === 0 && gone, `按「再來一局」（${mobile ? '觸控' : '滑鼠'}）：回到布陣、第 0 步、戰報收起`, `phase ${ph}，tick ${t}`);
    log(page.errors.length === 0, `戰報（${mobile ? '手機' : '桌機'}）零頁面錯誤`, page.errors.join(' | '));
  });
}
await withBrowser({ width: 800, height: 600, port: PORTS.noR010 }, async ({ open, page }) => {
  await open('noR010=1');
  const h = await page.evaluate(`__rts.pause(true); __rts.playLog(1944, ${JSON.stringify(END.log)}, ${END.endTick})`);
  await page.evaluate('__rts.pause(false)'); await sleep(3200);
  const rp = await page.evaluate('__rts.report()'), ban = await page.evaluate("!document.getElementById('banner').hidden && document.getElementById('banner').textContent");
  log(!rp.shown && ban === '勝利' && h === endHash && page.errors.length === 0, '?noR010=1：只有「勝利」橫幅、沒有戰報、雜湊不變、零頁面錯誤', `戰報 ${rp.shown}，橫幅 ${ban}，${h}`);
});


// ---- R012 鏡頭手感：真的滾輪、真的觸控拖曳放手、真的雙擊 ----
const touchDrag = async (page, x, y0, y1, steps = 6) => {
  await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0, id: 1 }] });
  for (let k = 1; k <= steps; k++) { await sleep(16); await page.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y0 + ((y1 - y0) * k) / steps, id: 1 }] }); }
  await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
};
const camAt = page => page.evaluate('__rts.cam()');
await withBrowser({ width: 1280, height: 800, port: PORTS.cam }, async ({ open, page }) => {
  await open('noR006=1');
  await page.evaluate('__rts.pause(true); __rts.focus(16, 16, 1); 0'); await sleep(200);
  const g0 = await page.evaluate('__rts.groundAt(1100, 150)');
  await page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 1100, y: 150, deltaX: 0, deltaY: -120 }); await sleep(200);
  const g1 = await page.evaluate('__rts.groundAt(1100, 150)'), c = await camAt(page);
  log(c.zoom > 1.05 && Math.hypot(g1[0] - g0[0], g1[1] - g0[1]) < 0.05, '滾輪在右上角放大：游標下的地面格不動', `縮放 ${c.zoom.toFixed(2)}；${g0.map(v => v.toFixed(2))} → ${g1.map(v => v.toFixed(2))}`);
  log(page.errors.length === 0, '鏡頭手感（桌機）零頁面錯誤', page.errors.join(' | '));
});
await withBrowser({ width: 412, height: 860, mobile: true, port: PORTS.camMobile }, async ({ open, page }) => {
  await open('noR006=1');
  await page.evaluate('__rts.pause(true); __rts.focus(16, 16, 1); 0'); await sleep(200);
  const s0 = await camAt(page);
  await touchDrag(page, 200, 620, 420);
  const c0 = await camAt(page); await sleep(300); const c1 = await camAt(page); await sleep(900); const c2 = await camAt(page); await sleep(300); const c3 = await camAt(page);
  const dragDir = [c0.x - s0.x, c0.z - s0.z], glideDir = [c1.x - c0.x, c1.z - c0.z];
  log(Math.hypot(...glideDir) > 0.2 && dragDir[0] * glideDir[0] + dragDir[1] * glideDir[1] > 0 && c3.x === c2.x && c3.z === c2.z, '手機快速拖曳放手：0.3 秒後還往同方向滑、1 秒後停住',
    `拖曳 ${dragDir.map(v => v.toFixed(2))}；放手後 0.3 秒又滑 ${glideDir.map(v => v.toFixed(2))}；1.2 秒後 ${c2.x.toFixed(2)},${c2.z.toFixed(2)} → 1.5 秒 ${c3.x.toFixed(2)},${c3.z.toFixed(2)}`);
  // 雙擊我方 1 號坦克：鏡頭跟過去、選到它
  await page.evaluate('__rts.focus(21, 23, 1); 0'); await sleep(200);
  const [tx, ty] = await page.evaluate('__rts.screenOf(1)');
  await touchTap(page, tx, ty); await touchTap(page, tx, ty); await sleep(600);
  const c = await camAt(page), sel = await page.evaluate('__rts.selected()');
  const pos = await page.evaluate('(() => { const p = __rts.screenOf(1); return __rts.groundAt(p[0], p[1]); })()');
  log(JSON.stringify(sel) === '[1]' && Math.hypot(c.x - pos[0], c.z - pos[1]) < 0.6, '手機雙擊我方坦克：鏡頭移到那台車、選到它', `鏡頭 ${c.x.toFixed(2)},${c.z.toFixed(2)}；坦克約 ${pos.map(v => v.toFixed(2))}；選取 ${JSON.stringify(sel)}`);
  log(page.errors.length === 0, '鏡頭手感（手機）零頁面錯誤', page.errors.join(' | '));
});
await withBrowser({ width: 412, height: 860, mobile: true, port: PORTS.noR012 }, async ({ open, page }) => {
  await open('noR006=1&noR012=1');
  await page.evaluate('__rts.pause(true); __rts.focus(16, 16, 1); 0'); await sleep(200);
  await touchDrag(page, 200, 620, 420);
  const c0 = await camAt(page); await sleep(300); const c1 = await camAt(page);
  const h = await page.evaluate(`__rts.runScript(${SCRIPT_TICKS})`);
  log(c0.x === c1.x && c0.z === c1.z && h === nodeHash && page.errors.length === 0, '?noR012=1：放手立刻停、雜湊不變、零頁面錯誤', `${c0.x.toFixed(2)},${c0.z.toFixed(2)} → ${c1.x.toFixed(2)},${c1.z.toFixed(2)}；${h}`);
});

const sec = ((Date.now() - t0) / 1000).toFixed(1);
if (fails.length) { console.log(`\nNG 紅燈（${sec}s）：${fails.join('、')}`); process.exit(1); }
console.log(`\nOK 綠燈（${sec}s）　樣張在 shots/`);
