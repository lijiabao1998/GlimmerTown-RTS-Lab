// R041 開戰命令條：文字照開局設定、樣式沒有光暈／陰影字／漸層／驚嘆號、?noR041=1 走回 R016 的大字。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startOrderText, START_ORDER_MS } from '../src/ui/startOrder.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
try {
  const rye = startOrderText(1, true, '普通'), village = startOrderText(0, false, undefined), noAi = startOrderText(1, true, undefined);
  assert.deepEqual(rye, { place: '萊伊（Rye），1940 年夏 · 敵方由電腦指揮（普通）', title: '作戰開始', goal: '守住我方指揮部，打掉敵方指揮部就贏。' });
  assert.equal(village.place, '英格蘭東南的村莊，1940 年夏');
  assert.equal(village.goal, '擊毀全部敵軍就贏。');
  assert.equal(noAi.place, '萊伊（Rye），1940 年夏', '沒有電腦對手時不寫對手');
  for (const o of [rye, village, noAi]) assert.ok(!/[!！]/.test(o.place + o.title + o.goal), `命令條沒有驚嘆號：${JSON.stringify(o)}`);
  assert.ok(START_ORDER_MS >= 2000 && START_ORDER_MS <= 3200, `命令條停留 2–3.2 秒（現在 ${START_ORDER_MS}）`);

  const html = read('index.html'), css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  const rules = css.split('}').filter(r => /#start-order|gtrts-order/.test(r)).join('}');
  assert.ok(rules.includes('#start-order {'), '找得到命令條的樣式');
  assert.ok(!/text-shadow|box-shadow|filter\s*:|gradient|letter-spacing/.test(rules), `命令條沒有光暈、陰影字、漸層、拉開的字距：${(rules.match(/text-shadow|box-shadow|filter\s*:|gradient|letter-spacing/) || [])[0]}`);
  assert.ok(/#start-order\s*\{[^}]*pointer-events:\s*none/.test(css), '命令條不吃點擊');
  assert.ok(/prefers-reduced-motion:\s*reduce\)\s*\{\s*#start-order/.test(css), '減少動態效果時不滑');

  const main = read('src/main.ts');
  assert.ok(main.includes("if (r016) { if (r041) startOrder(); else startBanner(); }"), 'startBattle：開著 R041 出命令條、?noR041=1 出舊大字、?noR016=1 兩種都不出');
  assert.ok(/const r041 = q\.get\('noR041'\) !== '1'/.test(main), '逃生閥 ?noR041=1');
  const body = main.slice(main.indexOf('function startOrder()'), main.indexOf('function startBanner()'));
  assert.ok(body.includes('r019') && body.includes('r018') && !/w\.eco|w\.ai/.test(body), '命令條看開局開關（開戰這一刻 eco／ai 指令還沒套用），不看世界');
  console.log('OK R041 開戰命令條：文字、樣式、逃生閥');
} catch (e) {
  console.log(`R041 start-order FAIL: ${e.message}`);
  process.exitCode = 1;
}
