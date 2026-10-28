// R111: run the actual production module with a small, counted DOM stub.
// This proves synchronous cache behavior; real wrapping/geometry is tested in input-browser.mjs.
// node tests/production-layout.mjs --mutations runs each semantic source mutant in isolation.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const source = fs.readFileSync(new URL('../src/ui/production.ts', import.meta.url), 'utf8');
const mutations = {
  no_initial_update: { group: 'initial', from: '  update();\n  return { update };', to: '  return { update };' },
  wrong_margin: { group: 'initial', from: 'hint.getBoundingClientRect().top + 6', to: 'hint.getBoundingClientRect().top + 5' },
  wrong_minimum: { group: 'initial', from: 'Math.max(8, innerHeight', to: 'Math.max(0, innerHeight' },
  content_return: { group: 'hint_text', from: '    if (key !== last) {', to: '    if (key === last) return;\n    if (key !== last) {' },
  ignore_text: { group: 'hint_text', from: 'hintText === lastHintText && ', to: '' },
  rendered_text_read: { group: 'hint_text', from: 'const hintText = hint.textContent;', to: 'const hintText = hint.innerText;' },
  ignore_width: { group: 'viewport', from: 'innerWidth === lastWidth && ', to: '' },
  ignore_height: { group: 'viewport', from: ' && innerHeight === lastHeight', to: '' },
  ignore_identity: { group: 'identity', from: 'hint === lastHint && ', to: '' },
  cache_missing: { group: 'missing', from: 'if (!hint) { layoutValid = false; return; }', to: 'if (!hint) { return; }' },
  cache_hidden: { group: 'hidden', from: 'if (!s.visible) { layoutValid = false; return; }', to: 'if (!s.visible) { return; }' },
  every_frame_rect: { group: 'stable', from: 'if (layoutValid && hint === lastHint', to: 'if (false && layoutValid && hint === lastHint' },
  uncached_content: { group: 'content_cache', from: 'if (key !== last) {', to: 'if (true) {' },
  content_remeasures: { group: 'content_changes', from: '      last = key;', to: '      last = key; layoutValid = false;' },
  changed_supply_label: { group: 'content_changes', from: '`補給 ${s.supply}`', to: '`物資 ${s.supply}`' },
  repeat_bottom_write: { group: 'bottom_write', from: 'if (root.style.bottom !== bottom) root.style.bottom = bottom;', to: 'root.style.bottom = bottom;' },
  wrong_button_kind: { group: 'buttons', from: 'a.produce(it.kind);', to: 'a.produce(items[0].kind);' },
  duplicate_button_call: { group: 'buttons', from: 'a.produce(it.kind);', to: 'a.produce(it.kind); a.produce(it.kind);' },
  missing_button_update: { group: 'buttons', from: 'a.produce(it.kind); update();', to: 'a.produce(it.kind);' },
  deferred_layout: { group: 'synchronous', from: 'if (root.style.bottom !== bottom) root.style.bottom = bottom;', to: 'if (root.style.bottom !== bottom) { if (root.style.bottom) queueMicrotask(() => { root.style.bottom = bottom; }); else root.style.bottom = bottom; }' },
};
const mutant = process.argv.find(a => a.startsWith('--mutant='))?.slice(9);
let initProduction;
if (mutant) {
  const m = mutations[mutant]; assert(m, 'known mutation');
  assert.equal(source.split(m.from).length - 1, 1, `${mutant}: unique production-source anchor`);
  const broken = stripTypeScriptTypes(source.replace(m.from, m.to));
  ({ initProduction } = await import(`data:text/javascript;base64,${Buffer.from(broken).toString('base64')}`));
} else {
  ({ initProduction } = await import('../src/ui/production.ts'));
}

class Element {
  constructor(metrics) {
    this.metrics = metrics; this.children = new Map(); this.events = new Map();
    this.hidden = false; this.text = ''; this.html = ''; this.top = 800;
    this.textWrites = 0; this.classWrites = 0; this.widthWrites = 0; this.bottomWrites = 0; this.htmlWrites = 0;
    this.classes = new Set();
    this.classList = { toggle: (name, on) => { this.classWrites++; if (on) this.classes.add(name); else this.classes.delete(name); } };
    this.style = new Proxy({ bottom: '', width: '' }, { set: (target, key, value) => {
      if (key === 'bottom') this.bottomWrites++;
      if (key === 'width') this.widthWrites++;
      target[key] = value; return true;
    } });
  }
  set innerHTML(html) {
    this.html = html; this.htmlWrites++;
    for (const m of html.matchAll(/id="([^"]+)"/g)) {
      const child = new Element(this.metrics); child.id = m[1]; this.children.set(child.id, child);
      if (child.id === 'pb-prog') child.firstElementChild = new Element(this.metrics);
    }
  }
  get innerHTML() { return this.html; }
  set textContent(text) { this.text = text; this.textWrites++; }
  get textContent() { return this.text; }
  get innerText() { this.metrics.innerTextReads++; return this.text; }
  querySelector(selector) { return this.children.get(selector.slice(1)) ?? null; }
  appendChild(child) { this.children.set(child.id, child); }
  addEventListener(type, callback) {
    const callbacks = this.events.get(type) ?? []; callbacks.push(callback); this.events.set(type, callbacks);
  }
  getBoundingClientRect() {
    if (this.id === 'hint') {
      this.metrics.hintReads++; return { top: this.top, bottom: innerHeight - 8, left: 8, right: innerWidth - 8 };
    }
    assert.equal(this.id, 'prodbar', 'fixture only measures hint or the production obstacle');
    this.metrics.obstacleReads++;
    const bottom = innerHeight - Number.parseFloat(this.style.bottom || '0');
    return { top: bottom - 92, bottom, left: 8, right: innerWidth - 8, width: innerWidth - 16, height: 92 };
  }
}
const ITEMS = [
  { kind: 7, label: '坦克', cost: 80 },
  { kind: 23, label: '榴彈砲', cost: 120 },
  { kind: 91, label: '觀測車', cost: 30 },
];
function fixture({ visible = true, hint = true, top = 800, text = '短提示', hud = true } = {}) {
  const metrics = { hintReads: 0, obstacleReads: 0, innerTextReads: 0, creates: 0 };
  const makeHint = (value = text, hintTop = top) => {
    const element = new Element(metrics); element.id = 'hint'; element.textContent = value; element.top = hintTop; return element;
  };
  let currentHint = hint ? makeHint() : null;
  const body = new Element(metrics), hudElement = hud ? new Element(metrics) : null;
  globalThis.innerWidth = 412; globalThis.innerHeight = 860;
  globalThis.document = {
    body,
    createElement() { metrics.creates++; return new Element(metrics); },
    getElementById(id) { return id === 'hint' ? currentHint : id === 'hud' ? hudElement : null; },
  };
  const state = { visible, supply: 100, queue: [], prog: 0, progMax: 80, queueMax: 3 }, calls = [];
  const bar = initProduction(ITEMS, { state: () => state, produce(kind) { calls.push(kind); state.supply--; } });
  const root = (hudElement ?? body).children.get('prodbar'), get = id => root.querySelector('#' + id);
  return {
    metrics, state, calls, bar, root, get, makeHint,
    get hint() { return currentHint; }, set hint(value) { currentHint = value; },
    contentWrites() { return {
      html: root.htmlWrites, supply: get('pb-supply').textWrites, queue: get('pb-queue').textWrites,
      progress: get('pb-prog').firstElementChild.widthWrites,
      buttons: ITEMS.map(it => get('pb-k' + it.kind).classWrites),
    }; },
    click(kind) {
      let stopped = 0;
      for (const callback of get('pb-k' + kind).events.get('click') ?? []) callback({ stopPropagation() { stopped++; } });
      return stopped;
    },
  };
}
const expectedWrites = count => ({ html: 1, supply: count, queue: count, progress: count, buttons: [count, count, count] });
function unchangedContent(f, before, group) { assert.deepEqual(f.contentWrites(), before, `${group}: layout-only changes never rewrite production content`); }

const groups = {
  initial() {
    for (const [top, bottom] of [[800, '66px'], [799.5, '66.5px'], [860, '8px'], [900, '8px']]) {
      const f = fixture({ top, hud: top !== 900 });
      assert.equal(f.root.style.bottom, bottom, 'initial: first visible update uses the exact six-pixel gap and eight-pixel minimum');
      assert.equal(f.metrics.hintReads, 1, 'initial: first visible update measures once');
      assert.equal(f.root.bottomWrites, 1, 'initial: first visible update writes bottom once');
      assert.equal(f.root.hidden, false, 'initial: visible production is shown');
    }
  },
  hint_text() {
    const f = fixture(), before = f.contentWrites();
    assert.equal(f.metrics.innerTextReads, 0, 'hint_text: cache reads textContent without forcing rendered-text layout');
    for (const [text, top, bottom, reads] of [
      ['選取長提示，需要多行說明。砲擊成功後可繼續選取單位。', 722, '144px', 2],
      ['短提示', 800, '66px', 3],
      ['新提示', 788, '78px', 4], // Same length, different content must invalidate too.
    ]) {
      f.hint.textContent = text; f.hint.top = top; f.bar.update();
      assert.equal(f.root.style.bottom, bottom, 'hint_text: paused short/long/short text repositions on the next update');
      assert.equal(f.metrics.hintReads, reads, 'hint_text: each changed text is measured exactly once');
      unchangedContent(f, before, 'hint_text');
    }
    assert.equal(f.metrics.innerTextReads, 0, 'hint_text: repeated updates never read innerText');
  },
  viewport() {
    const f = fixture(), before = f.contentWrites();
    globalThis.innerWidth = 1024; f.hint.top = 820; f.bar.update();
    assert.equal(f.root.style.bottom, '46px', 'viewport: width-only change remeasures wrapped hint');
    assert.equal(f.metrics.hintReads, 2, 'viewport: width-only change measures exactly once');
    globalThis.innerHeight = 900; f.bar.update();
    assert.equal(f.root.style.bottom, '86px', 'viewport: height-only change updates the existing formula');
    assert.equal(f.metrics.hintReads, 3, 'viewport: height-only change measures exactly once');
    globalThis.innerWidth = 412; globalThis.innerHeight = 860; f.hint.top = 800; f.bar.update();
    assert.equal(f.root.style.bottom, '66px', 'viewport: returning to the phone viewport restores placement');
    assert.equal(f.metrics.hintReads, 4, 'viewport: paired viewport change measures only once');
    unchangedContent(f, before, 'viewport');
  },
  identity() {
    const f = fixture(), before = f.contentWrites();
    f.hint = f.makeHint('短提示', 730); f.bar.update();
    assert.equal(f.root.style.bottom, '136px', 'identity: replacement hint with identical text repositions');
    assert.equal(f.metrics.hintReads, 2, 'identity: replacement hint measures exactly once');
    unchangedContent(f, before, 'identity');
  },
  missing() {
    const f = fixture({ hint: false }), before = f.contentWrites();
    for (let i = 0; i < 120; i++) assert.doesNotThrow(() => f.bar.update(), 'missing: no hint remains safe');
    assert.equal(f.metrics.hintReads, 0, 'missing: absent hint is never measured');
    assert.equal(f.root.bottomWrites, 0, 'missing: absent hint does not write a fictitious position');
    f.hint = f.makeHint(); f.bar.update();
    assert.equal(f.root.style.bottom, '66px', 'missing: a late hint is measured despite unchanged production content');
    const original = f.hint; f.hint = null; f.bar.update();
    assert.equal(f.metrics.hintReads, 1, 'missing: removal does not measure');
    original.top = 744; f.hint = original; f.bar.update();
    assert.equal(f.root.style.bottom, '122px', 'missing: reappearing same hint was not incorrectly marked measured while absent');
    assert.equal(f.metrics.hintReads, 2, 'missing: reappearing same hint measures exactly once');
    unchangedContent(f, before, 'missing');
  },
  hidden() {
    const f = fixture({ visible: false });
    assert.equal(f.root.hidden, true, 'hidden: initial hidden production remains hidden');
    assert.equal(f.metrics.hintReads, 0, 'hidden: initial hidden update does not measure');
    assert.deepEqual(f.contentWrites(), expectedWrites(0), 'hidden: initial hidden update does not write content');
    f.state.visible = true; f.bar.update();
    assert.equal(f.root.style.bottom, '66px', 'hidden: first show positions immediately');
    const before = f.contentWrites(); f.state.visible = false; f.bar.update();
    f.hint.top = 750; f.state.visible = true; f.bar.update();
    assert.equal(f.root.style.bottom, '116px', 'hidden: show invalidates even when hint identity/text/viewport stayed the same');
    assert.equal(f.metrics.hintReads, 2, 'hidden: same-key hide/show measures once');
    f.state.visible = false; f.bar.update(); f.hint.textContent = '隱藏期間變成長提示';
    globalThis.innerWidth = 1024; globalThis.innerHeight = 900; f.hint.top = 760;
    const reads = f.metrics.hintReads, writes = f.root.bottomWrites;
    for (let i = 0; i < 120; i++) f.bar.update();
    assert.equal(f.metrics.hintReads, reads, 'hidden: hidden changes never measure');
    assert.equal(f.root.bottomWrites, writes, 'hidden: hidden changes never write bottom');
    f.state.visible = true; f.bar.update();
    assert.equal(f.root.hidden, false, 'hidden: show restores visibility');
    assert.equal(f.root.style.bottom, '146px', 'hidden: show uses text and viewport changed while hidden');
    assert.equal(f.metrics.hintReads, reads + 1, 'hidden: changed hidden inputs measure once on show');
    unchangedContent(f, before, 'hidden');
  },
  stable() {
    const f = fixture(), before = f.contentWrites(), creates = f.metrics.creates;
    for (let i = 0; i < 120; i++) f.bar.update();
    assert.equal(f.metrics.hintReads, 1, 'stable: 120 unchanged updates add zero hint geometry reads');
    assert.equal(f.root.bottomWrites, 1, 'stable: 120 unchanged updates add zero bottom writes');
    unchangedContent(f, before, 'stable');
    assert.equal(f.metrics.creates, creates, 'stable: unchanged updates allocate no DOM');
  },
  content_cache() {
    const f = fixture(), before = f.contentWrites();
    f.hint.textContent = '布局變了但補給與佇列沒有變'; f.hint.top = 730; f.bar.update();
    unchangedContent(f, before, 'content_cache');
    for (let i = 0; i < 120; i++) f.bar.update();
    unchangedContent(f, before, 'content_cache');
  },
  content_changes() {
    const f = fixture();
    assert.equal(f.get('pb-supply').textContent, '補給 100', 'content_changes: exact original supply label');
    assert.equal(f.get('pb-queue').textContent, '', 'content_changes: empty queue label stays empty');
    assert.equal(f.get('pb-prog').firstElementChild.style.width, '0%', 'content_changes: empty queue has zero progress');
    f.state.supply = 25; f.bar.update();
    assert.equal(f.metrics.hintReads, 1, 'content_changes: supply-only change never remeasures hint');
    assert.equal(f.root.bottomWrites, 1, 'content_changes: supply-only change never rewrites bottom');
    assert.equal(f.get('pb-supply').textContent, '補給 25', 'content_changes: changed supply text stays exact');
    assert(ITEMS.every(it => f.get('pb-k' + it.kind).classes.has('dim')), 'content_changes: unaffordable buttons stay dim');
    assert.deepEqual(f.contentWrites(), expectedWrites(2), 'content_changes: supply change renders content once');
    f.state.queue = [23, 7, 999]; f.bar.update();
    assert.equal(f.get('pb-queue').textContent, '　榴坦?', 'content_changes: queue preserves labels/order/unknown-kind fallback');
    assert.equal(f.metrics.hintReads, 1, 'content_changes: queue-only change never remeasures hint');
    assert.deepEqual(f.contentWrites(), expectedWrites(3), 'content_changes: queue change renders content once');
    f.state.prog = 29; f.bar.update();
    assert.equal(f.get('pb-prog').firstElementChild.style.width, '36%', 'content_changes: progress keeps the existing rounded percentage');
    assert.equal(f.metrics.hintReads, 1, 'content_changes: progress-only change never remeasures hint');
    assert.deepEqual(f.contentWrites(), expectedWrites(4), 'content_changes: progress change renders content once');
    f.state.supply = 500; f.bar.update();
    assert(ITEMS.every(it => f.get('pb-k' + it.kind).classes.has('dim')), 'content_changes: full queue dims affordable buttons');
    f.state.queue = []; f.bar.update();
    assert(ITEMS.every(it => !f.get('pb-k' + it.kind).classes.has('dim')), 'content_changes: available queue restores affordable buttons');
    assert.equal(f.get('pb-prog').firstElementChild.style.width, '0%', 'content_changes: empty queue resets progress');
    assert.equal(f.metrics.hintReads, 1, 'content_changes: all content-only changes keep one initial geometry read');
    assert.equal(f.root.bottomWrites, 1, 'content_changes: all content-only changes keep one initial bottom write');
  },
  bottom_write() {
    const f = fixture(), before = f.contentWrites();
    f.hint.textContent = '同樣高度的新提示'; f.bar.update();
    assert.equal(f.metrics.hintReads, 2, 'bottom_write: changed text is still measured if its height happens to match');
    assert.equal(f.root.bottomWrites, 1, 'bottom_write: unchanged computed bottom is not rewritten');
    globalThis.innerHeight = 900; f.hint.top = 840; f.bar.update();
    assert.equal(f.metrics.hintReads, 3, 'bottom_write: viewport change measures even when bottom remains equal');
    assert.equal(f.root.bottomWrites, 1, 'bottom_write: equal bottom after viewport change is not rewritten');
    unchangedContent(f, before, 'bottom_write');
  },
  buttons() {
    const f = fixture();
    assert.equal(f.root.innerHTML, '<div class="production-buttons"><button id="pb-k7" title="坦克：補給 80">坦克<b>80</b></button><button id="pb-k23" title="榴彈砲：補給 120">榴彈砲<b>120</b></button><button id="pb-k91" title="觀測車：補給 30">觀測車<b>30</b></button></div>\n    <span class="info"><span id="pb-supply"></span><span id="pb-queue"></span><i id="pb-prog"><i></i></i></span>', 'buttons: scroll wrapper preserves exact button markup, labels, costs and titles');
    for (const [index, kind] of [7, 23, 91].entries()) {
      assert.equal(f.click(kind), 1, 'buttons: each click stops propagation exactly once');
      assert.deepEqual(f.calls, [7, 23, 91].slice(0, index + 1), 'buttons: each click emits exactly one original kind callback');
      assert.equal(f.get('pb-supply').textContent, `補給 ${99 - index}`, 'buttons: callback still synchronously refreshes production content');
      assert.equal(f.metrics.hintReads, 1, 'buttons: callback-only content change does not remeasure geometry');
    }
  },
  synchronous() {
    const f = fixture(), before = f.contentWrites();
    // Same call stack as HUD.update -> production.update -> menu.open's obstacle read.
    f.hint.textContent = '選單打開前的多行提示'; f.hint.top = 712;
    const returned = f.bar.update();
    const obstacle = f.root.getBoundingClientRect();
    assert.equal(obstacle.bottom, 706, 'synchronous: immediate caller measures the updated production obstacle before any microtask/frame');
    assert.equal(returned, undefined, 'synchronous: update retains its synchronous void API');
    assert.equal(f.metrics.hintReads, 2, 'synchronous: synchronous caller requires only one new hint measurement');
    assert.equal(f.metrics.obstacleReads, 1, 'synchronous: caller reads its obstacle once');
    unchangedContent(f, before, 'synchronous');
  },
};
const only = process.argv.find(a => a.startsWith('--group='))?.slice(8);
assert(!only || Object.hasOwn(groups, only), 'known guard group');
assert.deepEqual(new Set(Object.values(mutations).map(m => m.group)), new Set(Object.keys(groups)), 'every new guard group has an isolated semantic production mutant');
for (const [name, run] of Object.entries(groups)) if (!only || name === only) {
  try { run(); console.log(`OK production-layout ${name}`); }
  catch (error) { console.error(`NG production-layout ${name}`); throw error; }
}
if (process.argv.includes('--mutations')) {
  for (const [name, m] of Object.entries(mutations)) {
    const p = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--mutant=${name}`, `--group=${m.group}`], { encoding: 'utf8', timeout: 10000 });
    assert.equal(p.status, 1, `${name}: isolated broken production source must exit 1\n${p.stdout}\n${p.stderr}`);
    const first = p.stderr.match(/AssertionError \[ERR_ASSERTION\]: ([^\n]+)/)?.[1];
    assert(first?.startsWith(`${m.group}:`), `${name}: first red must be its intended semantic assertion, not syntax/startup\n${p.stderr}`);
    assert(p.stderr.includes(`NG production-layout ${m.group}`), `${name}: intended guard ran`);
    console.log(`RED production-layout ${name}: ${first}`);
  }
}
console.log('production-layout: all requested groups OK (actual production module; DOM-stub counts, not browser geometry)');
