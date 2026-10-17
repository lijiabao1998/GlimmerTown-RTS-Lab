// 煙霧測試：無頭 Chrome（SwiftShader）開 dist/index.html，量預算、比對 Node 與瀏覽器的雜湊、用真的觸控下指令、拍樣張。
// 用法：npm run build && node tools/smoke.mjs　退出碼 0＝綠、1＝紅；樣張存在 shots/（不進倉庫，CI 當附件）。
import fs from 'node:fs';
import path from 'node:path';
import { withBrowser, touchTap, shot, sleep, ROOT } from './cdp.mjs';
import { hashWorld, createWorld, bldAt, N } from '../src/sim/world.ts';
import { runLog } from '../src/sim/step.ts';
import { runScript, SCRIPT_TICKS } from '../src/sim/script.ts';
import { FLOOR_H } from '../src/render/buildings.ts';

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
const PORTS = { desktop: 8411, mobile: 8431, valve: 8451 };
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

// ---- 手機 412×860：預算、觸控 ----
await withBrowser({ width: 412, height: 860, mobile: true, port: PORTS.mobile }, async ({ open, page }) => {
  await open('');
  await page.evaluate('__rts.pause(true)');
  await sleep(400);
  const info = await page.evaluate('__rts.info()');
  log(info.calls <= BUDGET.calls && info.triangles <= BUDGET.triangles, `手機開局預算：繪製呼叫 ≤ ${BUDGET.calls}、三角形 ≤ ${BUDGET.triangles}`, JSON.stringify(info));
  await shot(page, path.join(SHOTS, 'mobile-start.png'));
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

const sec = ((Date.now() - t0) / 1000).toFixed(1);
if (fails.length) { console.log(`\nNG 紅燈（${sec}s）：${fails.join('、')}`); process.exit(1); }
console.log(`\nOK 綠燈（${sec}s）　樣張在 shots/`);
