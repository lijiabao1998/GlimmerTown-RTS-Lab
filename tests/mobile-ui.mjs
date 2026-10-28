// R901：收合狀態與觸控框選分支。不開瀏覽器；真實觸控在 tests/input-browser.mjs。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Gestures } from '../src/ui/gestures.ts';
import { chromeFlags, chromeOpen, reduceChrome, touchBoxArmed } from '../src/ui/mobileChrome.ts';

const read = p => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const css = read('../index.html');
const main = read('../src/main.ts');
const valves = read('../src/valves.ts');
const lines = s => s.split('\n').length - (s.endsWith('\n') ? 1 : 0);

assert.equal(touchBoxArmed(), false, 'touch box starts off');
assert.deepEqual(chromeOpen(), { top: true, bar: true, box: false });
let s = chromeOpen();
s = reduceChrome(s, 'top');
assert.deepEqual(chromeFlags(true, s), { topOff: true, barOff: false, armed: false, mounted: true }, 'phone can hide the top buttons alone');
assert.deepEqual(chromeFlags(false, s), { topOff: false, barOff: false, armed: false, mounted: false }, 'a wide viewport does not keep the collapsed classes');
s = reduceChrome(s, 'bar');
assert.equal(chromeFlags(true, s).barOff, true, 'build and production collapse independently');
s = reduceChrome(s, 'box');
assert.equal(chromeFlags(true, s).armed, true, 'box mode arms only while the phone chrome is up');
s = reduceChrome(s, 'box');
assert.equal(chromeFlags(true, s).armed, false, 'second toggle disarms box mode');
assert.equal(chromeFlags(true, s).topOff, true, 'disarming box mode leaves the toolbar collapsed');

for (const key of ['safe-area-inset-top', 'safe-area-inset-right', 'safe-area-inset-bottom', 'safe-area-inset-left']) {
  assert.ok(css.includes(`env(${key})`), `css uses ${key}`);
}
assert.match(css, /#r901-chrome[\s\S]*env\(safe-area-inset-left\)[\s\S]*env\(safe-area-inset-top\)[\s\S]*env\(safe-area-inset-right\)[\s\S]*env\(safe-area-inset-bottom\)/, 'chrome block names every safe-area inset');
assert.match(css, /body\.r901-top-off #hud \.btns \{ display: none; \}/, 'collapsed toolbar is display none');
assert.match(css, /body\.r901-bar-off #prodbar, body\.r901-bar-off #buildbar \{ display: none; \}/, 'collapsed build and production bars are display none');
// R905：直向生產鍵是至少 44px 的小方鍵（名稱在上、補給在下），不用負邊距疊在一起；提示列不截斷（耐久、裝填等資訊要看得完整）
assert.match(css, /@media \(max-width: 480px\) and \(orientation: portrait\) \{[\s\S]*body #hud #prodbar button \{[^}]*min-width: 44px;[^}]*height: 44px;[^}]*flex-direction: column;/, 'portrait production keys are 44px stacked keys');
assert.equal(/#prodbar button \{[^}]*margin[^;}]*-\d/.test(css), false, 'production keys never overlap through negative margins');
assert.equal(/#hud \.bottom \{[^}]*text-overflow: ellipsis/.test(css), false, 'status line is never cut with an ellipsis');
for (const id of ['#sb-enter', '#map-pick', '#zombies-pick', '#town-pick']) {
  assert.match(css, new RegExp(`body\\.r901-top-off ${id.replace('#', '\\#')}`), `collapsed top hides ${id}`);
  assert.match(css, new RegExp(`body\\.r901-bar-off ${id.replace('#', '\\#')}`), `collapsed bar hides ${id}`);
}
assert.match(css, /#r901-chrome button \{[^}]*width:\s*44px;\s*height:\s*44px/, 'chrome buttons are 44px');
assert.match(valves, /get r901\(\) \{ return on\('901'\); \}/, 'valve r901 is on the table');
assert.match(main, /touchBox: \(\) => typeof touchBoxArmed === 'function' && touchBoxArmed\(\)/, 'main asks the chrome whether touch box is armed');
assert.match(main, /if \(V\.r901\) initMobileChrome\(canvas\);/, 'valve skips mounting the chrome');
const chromeSrc = read('../src/ui/mobileChrome.ts');
assert.equal((chromeSrc.match(/canvas\.addEventListener\('gesture(?:start|change)'/g) || []).length, 2, 'pinch blockers stay on the canvas');
assert.equal((chromeSrc.match(/addEventListener\('gesture(?:start|change)'/g) || []).length, 2, 'pinch blockers are not also on the window');
assert.ok(lines(main) <= 673, `main.ts stays within the hub ceiling (${lines(main)})`);
assert.equal(lines(read('../src/render/battle.ts')), 1175, 'battle.ts line count is unchanged');

// 教學開著時，具／產／框仍點得到。間距用安全區內距算，不假設瀏海是 0。
{
  const tutorial = read('../src/ui/tutorial.ts');
  assert.match(tutorial, /#tutorial \{[^}]*pointer-events:\s*none/, 'open tutorial panel does not take hits itself');
  assert.match(tutorial, /@media \(max-width: 480px\) and \(orientation: portrait\) \{[\s\S]*left: calc\(max\(8px, env\(safe-area-inset-left\)\) \+ 64px\)/, 'portrait tutorial steps right of the safe area');
  assert.match(tutorial, /top: calc\(max\(8px, env\(safe-area-inset-top\)\) \+ 220px\)/, 'portrait tutorial top tracks the safe area');
  const sep = (a, b) => {
    const dx = Math.max(a.left - b.right, b.left - a.right);
    const dy = Math.max(a.top - b.bottom, b.top - a.bottom);
    if (dx < 0 && dy < 0) return 0;
    if (dx < 0) return dy;
    if (dy < 0) return dx;
    return Math.hypot(dx, dy);
  };
  const insets = [{ left: 0, top: 0 }, { left: 12, top: 20 }, { left: 34, top: 47 }, { left: 59, top: 8 }];
  for (const inset of insets) {
    const edgeL = Math.max(8, inset.left), edgeT = Math.max(8, inset.top);
    const buttons = ['r901-top', 'r901-bar', 'r901-box'].map((id, i) => {
      const top = edgeT + 230 + i * (44 + 6);
      return { id, left: edgeL, top, right: edgeL + 44, bottom: top + 44, cx: edgeL + 22, cy: top + 22 };
    });
    const tut = { left: edgeL + 64, top: edgeT + 220, right: edgeL + 64 + 160, bottom: edgeT + 220 + 360 };
    for (const b of buttons) {
      const gap = sep(tut, b);
      assert.ok(gap >= 16, `tutorial open: ${b.id} stays clickable with safe-area ${inset.left},${inset.top} (gap ${gap})`);
      const inside = b.cx >= tut.left && b.cx <= tut.right && b.cy >= tut.top && b.cy <= tut.bottom;
      assert.equal(inside, false, `tutorial open: a click on ${b.id} is not inside the panel`);
    }
    const sandbox = { left: edgeL, top: edgeT + 100, right: edgeL + 96, bottom: edgeT + 144 };
    const sandboxGap = sep(tut, sandbox);
    assert.ok(sandboxGap >= 16, `tutorial open: sandbox button stays clear with safe-area ${inset.left},${inset.top} (gap ${sandboxGap})`);
  }
}

function clock() {
  let now = 0, next = 0;
  const timers = new Map();
  return {
    set: (fn, ms) => { const id = ++next; timers.set(id, { fn, at: now + ms }); return id; },
    clear: id => timers.delete(id),
    advance(ms) {
      const until = now + ms;
      for (;;) {
        const due = [...timers].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        now = due[1].at; timers.delete(due[0]); due[1].fn();
      }
      now = until;
    },
  };
}
const point = (x, y, extra = {}) => ({ pointerId: 1, pointerType: 'touch', button: 0, shiftKey: false, clientX: x, clientY: y, ...extra });
function rig(touchBox) {
  const boxes = [], selected = [], holds = [];
  let dismissed = 0;
  const c = clock();
  const g = new Gestures({
    enabled: () => true,
    box: r => boxes.push(r),
    select: r => selected.push(JSON.parse(JSON.stringify(r))),
    hold: (x, y) => holds.push([x, y]),
    dismiss: () => { dismissed++; },
    touchBox: () => touchBox,
  }, c);
  return { g, boxes, selected, holds, dismissed: () => dismissed, clock: c };
}
{
  const f = rig(true);
  f.g.down(point(100, 200));
  assert.equal(f.g.move(point(130, 240)), true, 'armed touch drag is consumed as a box');
  assert.equal(f.g.up(point(130, 240)), true);
  assert.equal(f.selected.length, 1, 'armed touch drag selects');
  assert.deepEqual(f.selected[0], { left: 100, top: 200, right: 130, bottom: 240 });
  f.g.down(point(10, 10));
  assert.equal(f.g.up(point(10, 10)), false, 'armed touch inside 8px is still a tap');
  assert.equal(f.holds.length, 0, 'armed touch does not open the long-press menu');
  f.g.down(point(40, 50));
  f.clock.advance(500);
  assert.deepEqual(f.holds, [[40, 50]], 'armed stationary touch still long-presses at 500ms');
  assert.equal(f.g.up(point(40, 50)), true, 'armed long-press release keeps the menu');
}
{
  const c = clock();
  const holds = [];
  const g = new Gestures({ enabled: () => true, box() {}, select() {}, hold: (x, y) => holds.push([x, y]), dismiss() {}, touchBox: () => false }, c);
  g.down(point(40, 50));
  c.advance(500);
  assert.deepEqual(holds, [[40, 50]], 'disarmed touch still long-presses at 500ms');
  assert.equal(g.move(point(60, 50)), false, 'moving past 8px after the menu returns to pan');
}
{
  const f = rig(true);
  f.g.down(point(80, 90));
  f.g.down(point(140, 90, { pointerId: 2 }));
  assert.equal(f.g.move(point(160, 100, { pointerId: 2 })), false, 'a second finger cancels the box and leaves pinch to the camera');
  assert.ok(f.dismissed() > 0, 'second finger dismisses');
  assert.equal(f.g.up(point(80, 90)), true, 'first finger of a pinch is consumed');
  assert.equal(f.g.up(point(160, 100, { pointerId: 2 })), true, 'second finger of a pinch is consumed');
  assert.equal(f.selected.length, 0, 'pinch does not select');
}
{
  const f = rig(false);
  f.g.down({ pointerId: 1, pointerType: 'mouse', button: 0, shiftKey: true, clientX: 10, clientY: 10 });
  assert.equal(f.g.move({ pointerId: 1, pointerType: 'mouse', button: 0, shiftKey: true, clientX: 40, clientY: 30 }), true, 'shift drag still boxes when touch box is off');
}

console.log('mobile-ui: all OK');
