// R070 桌機鍵盤的純邏輯守衛（Node）：按鍵→動作、按住→每幀位移。
// 不開瀏覽器、不碰 DOM；main.ts 的接線與實際畫面位移留給 npm run smoke 與人看。
import { actionFor, groupIndex, panDelta, panToken, PAN_SPEED, ZOOM_STEP } from '../src/ui/keys.ts';

const fails = [];
const check = (ok, name, detail = '') => {
  console.log(`${ok ? 'OK' : 'NG'}  ${name}${detail ? `　— ${detail}` : ''}`);
  if (!ok) fails.push(name);
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

{ // 1. 移動鍵認實體鍵（e.code），沒有 code 才退回 e.key；大小寫都吃
  const pairs = [['KeyW', 'w'], ['KeyA', 'a'], ['KeyS', 's'], ['KeyD', 'd'], ['ArrowUp', 'up'], ['ArrowDown', 'down'], ['ArrowLeft', 'left'], ['ArrowRight', 'right']];
  const ok = pairs.every(([code, token]) => panToken(code, '') === token) && panToken('', 'W') === 'w' && panToken('', 'ArrowLeft') === 'left';
  check(ok, '移動鍵：KeyW／KeyA／KeyS／KeyD 與四個方向鍵各自對到一個 token；沒有 code 時退回 e.key', JSON.stringify(pairs.map(([c]) => panToken(c, ''))));
}
{ // 2. 按住的位移：W 往上捲→+z、A 往左捲→+x；按住 0.5 秒＝550 CSS px
  const dt = 0.5, w = panDelta(new Set(['w']), dt), s = panDelta(new Set(['s']), dt), a = panDelta(new Set(['a']), dt), d = panDelta(new Set(['d']), dt);
  const expect = PAN_SPEED * dt;
  check(near(w.x, 0) && near(w.z, expect) && near(s.z, -expect) && near(a.x, expect) && near(d.x, -expect),
    'W／S 沿 z、A／D 沿 x，各是 1100 px／秒 × 0.5 秒＝550 px', `W ${JSON.stringify(w)}；A ${JSON.stringify(a)}`);
}
{ // 3. 斜走不加速：W+D 的合向量長度等於單按一顆（不能 √2 倍）
  const single = panDelta(new Set(['w']), 1 / 20), diag = panDelta(new Set(['w', 'd']), 1 / 20);
  const len = Math.sqrt(single.x ** 2 + single.z ** 2), dlen = Math.sqrt(diag.x ** 2 + diag.z ** 2);
  check(near(len, dlen, 1e-9), '斜走（W+D）合向量長度＝單鍵，不加速', `單鍵 ${len.toFixed(6)}；對角 ${dlen.toFixed(6)}`);
  check(diag.x < 0 && diag.z > 0, 'W+D 的方向確實是右上（x 負、z 正）', JSON.stringify(diag));
}
{ // 4. 沒按、沒時間、時間倒流都不動
  const ok = near(panDelta(new Set(), 0.5).x, 0) && near(panDelta(new Set(), 0.5).z, 0) && near(panDelta(new Set(['w']), 0).z, 0) && near(panDelta(new Set(['w']), -1).z, 0);
  check(ok, '沒按鍵／dt＝0／dt 負值都不位移');
}
{ // 5. 動作表：縮放、指揮部、砲擊、停火、說明、下一個、全選、群組
  const table = [
    ['q', {}, 'zoom-out'], ['e', {}, 'zoom-in'], ['=', {}, 'zoom-in'], ['-', {}, 'zoom-out'],
    ['h', {}, 'home'], ['f', {}, 'fire-mode'], ['g', {}, 'hold-fire'], ['F1', {}, 'help'], ['?', {}, 'help'], ['Tab', {}, 'next-unit'],
    ['a', { ctrl: true }, 'select-all'], ['5', { ctrl: true }, 'group-set'], ['5', {}, 'group-recall'],
  ];
  const bad = table.filter(([k, m, want]) => actionFor(k, m) !== want);
  check(bad.length === 0, 'Q／E／=／-／H／F／G／F1／?／Tab／Ctrl+A／Ctrl+5／5 的動作都對', bad.length ? JSON.stringify(bad) : `${table.length} 條`);
}
{ // 6. 不搶瀏覽器：Alt 組合、Ctrl 的其他組合、Shift+Tab 都不算動作
  const bad = [['h', { alt: true }], ['w', { ctrl: true }], ['Tab', { shift: true }], ['x', {}], ['0', {}], ['1', { alt: true }]].filter(([k, m]) => actionFor(k, m) !== null);
  check(bad.length === 0, 'Alt 組合、Ctrl+W、Shift+Tab、沒定義的鍵都不動作（留給瀏覽器）', bad.length ? JSON.stringify(bad) : '');
}
{ // 7. 群組號只認 1–9；0 不當成第 0 組
  const ok = groupIndex('3') === 3 && groupIndex('F1') === 0 && groupIndex('0') === 0 && groupIndex('Ctrl') === 0;
  check(ok, '群組號：3→3、F1→0、0→0（不是第 0 組）');
}
{ // 8. 倍率：Q／E 一次是 1.12，跟滾輪同一倍率；來回一次回原值
  const z = ZOOM_STEP;
  check(near(z * (1 / z), 1, 1e-12) && near(1 / z, 1 / 1.12, 1e-12), 'E 一次 ×1.12、Q 一次 ×(1/1.12)，來回回到原值', `step ${z}`);
}
{ // 9. 大寫與小寫等價（Caps Lock、Shift 不影響單鍵動作）
  const ok = actionFor('Q') === 'zoom-out' && actionFor('H') === 'home' && panToken('', 'D') === 'd';
  check(ok, '大寫 Q／H／D 與小寫同一個結果');
}

if (fails.length) { console.log(`\nNG  ${fails.length} 條沒過：${fails.join('、')}`); process.exit(1); }
console.log('\nOK desktop-keys：桌機按鍵的純邏輯全部成立');
