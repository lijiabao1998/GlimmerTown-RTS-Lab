// R117 DOM-only HUD contract. No browser layout, native activation or audible-output claim.
// --mutations applies isolated production-source negatives and checks the semantic first red.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const read = p => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const sources = { hud: read('../src/ui/hud.ts'), css: read('../index.html') };
const mutations = {
  optional: { group: 'optional', file: 'hud', from: "${a.toggleAudio ? '<button id=\"b-audio\"", to: "${true ? '<button id=\"b-audio\"" },
  spacing_scope: { group: 'optional', file: 'hud', from: "root.classList.toggle('has-audio', !!a.toggleAudio);", to: "root.classList.toggle('has-audio', true);" },
  pending: { group: 'states', file: 'hud', from: "pending: '待啟用'", to: "pending: '音效開'" },
  unavailable: { group: 'states', file: 'hud', from: "unavailable: '音效不可用'", to: "unavailable: '音效已開'" },
  pressed: { group: 'states', file: 'hud', from: "button.setAttribute('aria-pressed', String(audio.enabled));", to: "button.setAttribute('aria-pressed', String(audio.state === 'on'));" },
  callback: { group: 'click', file: 'hud', from: 'a.toggleAudio!(); update();', to: 'update();' },
  deferred: { group: 'click', file: 'hud', from: 'a.toggleAudio!(); update();', to: 'queueMicrotask(a.toggleAudio!); update();' },
  trust: { group: 'click', file: 'hud', from: 'if (!e.isTrusted) return;', to: 'if (false) return;' },
  eager_context: { group: 'lazy', file: 'hud', from: "const root = document.createElement('div');", to: "new AudioContext();\n  const root = document.createElement('div');" },
  compact_gap: { group: 'layout', file: 'css', from: '#hud.has-audio .btns { gap: 4px; }', to: '#hud.has-audio .btns { gap: 6px; }' },
  build_control: { group: 'layout', file: 'css', from: '#hud.build #b-ammo { display: none; }', to: '#hud.build #b-ammo, #hud.build #b-audio { display: none; }' },
};
const mutant = process.argv.find(a => a.startsWith('--mutant='))?.slice(9);
if (mutant) {
  const m = mutations[mutant]; assert(m, 'known mutation');
  assert.equal(sources[m.file].split(m.from).length - 1, 1, `${mutant}: unique production-source anchor`);
  sources[m.file] = sources[m.file].replace(m.from, m.to);
}
const { initHud } = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(sources.hud)).toString('base64')}`);

class Element {
  constructor() {
    this.children = new Map(); this.events = new Map(); this.attrs = new Map(); this.textContent = ''; this.disabled = false; this.hidden = false;
    const classes = new Set(); this.classList = { toggle: (key, on) => on ? classes.add(key) : classes.delete(key), contains: key => classes.has(key) };
  }
  set innerHTML(html) {
    this.html = html;
    for (const tag of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)) {
      const el = new Element(); for (const a of tag[0].matchAll(/([\w-]+)="([^"]*)"/g)) el.attrs.set(a[1], a[2]);
      this.children.set(tag[1], el);
    }
  }
  querySelector(selector) { return this.children.get(selector.slice(1)) ?? null; }
  setAttribute(key, value) { this.attrs.set(key, value); }
  getAttribute(key) { return this.attrs.get(key); }
  addEventListener(type, callback) { assert(!this.events.has(type), 'one listener per event'); this.events.set(type, callback); }
  click(isTrusted = false) { const event = { isTrusted, stopped: false, stopPropagation() { this.stopped = true; } }; if (!this.disabled) this.events.get('click')?.(event); return event; }
}
function fixture({ audio = true, stateAudio, callback } = {}) {
  let root;
  const previous = globalThis.document;
  globalThis.document = { createElement: () => new Element(), body: { appendChild(el) { root = el; } } };
  try {
    const state = { tick: 0, paused: false, speed: 1, fireMode: false, winner: -1, mine: 1, theirs: 0, tanks: 0, guns: 0, observers: 0, audio: stateAudio };
    const calls = []; let inDispatch = false, synchronous = false;
    const actions = Object.fromEntries(['togglePause', 'cycleSpeed', 'toggleFire', 'toggleAmmo', 'selectAll', 'restart', 'help'].map(name => [name, () => calls.push(name)]));
    const hud = initHud({ ...actions, state: () => state, ...(audio ? { toggleAudio() { synchronous = inDispatch; calls.push('toggleAudio'); callback?.(state); } } : {}) });
    return { root, hud, state, calls, audio: root.querySelector('#b-audio'), synchronous: () => synchronous,
      click() { inDispatch = true; const result = root.querySelector('#b-audio').click(true); inDispatch = false; return result; } };
  } finally { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; }
}
const groups = {
  optional() {
    for (const stateAudio of [undefined, { enabled: true, state: 'on' }]) {
      const old = fixture({ audio: false, stateAudio });
      assert.equal(old.audio, null, 'optional: no callback means no audio button even when state exists');
      assert.equal([...old.root.html.matchAll(/<button\b/g)].length, 7, 'optional: legacy HUD renders seven buttons');
      assert.equal(old.root.classList.contains('has-audio'), false, 'optional: legacy HUD does not opt into compact spacing');
      old.hud.update(); old.hud.frame();
    }
    const current = fixture();
    assert(current.audio, 'optional: callback renders audio button');
    assert.equal([...current.root.html.matchAll(/<button\b/g)].length, 8, 'optional: new HUD renders eight buttons');
    assert.equal(current.root.classList.contains('has-audio'), true, 'optional: new HUD uses scoped compact spacing');
    assert.equal(current.audio.textContent, '音效關', 'optional: absent audio state defaults to off');
    assert.equal(current.audio.getAttribute('aria-pressed'), 'false');
  },
  states() {
    const f = fixture();
    for (const [state, enabled, text, label] of [
      ['off', false, '音效關', '音效已關；點按開啟'], ['on', true, '音效開', '音效已開；點按關閉'],
      ['paused', true, '音效停', '音效暫停；點按關閉'], ['pending', true, '待啟用', '音效等待啟用；點按關閉'],
      ['unavailable', false, '無音效', '音效不可用；點按開啟'], ['off', false, '音效關', '音效已關；點按開啟'],
    ]) {
      f.state.audio = { enabled, state }; f.hud.update();
      assert.equal(f.audio.textContent, text, `states: ${state} is visible and truthful`);
      assert.equal(f.audio.getAttribute('aria-label'), label, `states: ${state} has clear accessible status/action`);
      assert.equal(f.audio.getAttribute('title'), label, `states: ${state} title matches actual status`);
      assert.equal(f.audio.getAttribute('aria-pressed'), String(enabled), `states: ${state} exposes user intent`);
      assert.equal(f.audio.classList.contains('on'), enabled);
    }
  },
  click() {
    const f = fixture({ callback(state) { const enabled = !state.audio?.enabled; state.audio = { enabled, state: enabled ? 'pending' : 'off' }; } });
    assert(f.audio.click().stopped, 'click: synthetic activation also stops propagation');
    assert.equal(f.calls.length, 0, 'click: synthetic activation cannot invoke audio callback');
    assert.equal(f.audio.textContent, '音效關', 'click: synthetic activation leaves sound off');
    for (const build of [false, true]) {
      f.state.build = build; f.hud.update();
      assert.equal(f.audio.disabled, false, 'click: mute/enable remains available during build and battle');
      assert(f.click().stopped, 'click: audio activation stops propagation to game controls');
      assert(f.synchronous(), 'click: callback runs in the original click stack, preserving the user gesture');
      assert.equal(f.audio.textContent, '待啟用', 'click: state immediately refreshes after callback');
      assert(f.click().stopped); assert.equal(f.audio.textContent, '音效關');
    }
    assert.equal(f.calls.filter(name => name === 'toggleAudio').length, 4, 'click: exactly one callback for each activation');
    assert.deepEqual([...f.audio.events.keys()], ['click'], 'click: use native button activation, no extra pointer/key toggles');
    for (const [id, action] of [['b-pause', 'togglePause'], ['b-speed', 'cycleSpeed'], ['b-fire', 'toggleFire'], ['b-ammo', 'toggleAmmo'], ['b-all', 'selectAll'], ['b-restart', 'restart'], ['b-help', 'help']]) {
      f.state.build = false; f.hud.update(); assert(f.root.querySelector(`#${id}`).click().stopped); assert.equal(f.calls.at(-1), action, 'click: old control still routes to its original callback');
    }
  },
  lazy() {
    let constructors = 0;
    const previous = globalThis.AudioContext;
    globalThis.AudioContext = class { constructor() { constructors++; } };
    try {
      for (const audio of [false, true]) {
        const f = fixture({ audio }); f.hud.update(); f.hud.frame(); if (audio) f.click();
        assert.equal(constructors, 0, 'lazy: DOM HUD never creates an audio context, even on click');
      }
    } finally { if (previous === undefined) delete globalThis.AudioContext; else globalThis.AudioContext = previous; }
  },
  layout() {
    assert.match(sources.css, /#hud \.bar\s*\{[^}]*gap:\s*6px/, 'layout: original generic gap stays 6px');
    assert.match(sources.css, /#hud\.has-audio \.btns\s*\{\s*gap:\s*4px;\s*\}/, 'layout: only optional audio opts into 4px gap');
    assert.match(sources.css, /#hud \.btns button\s*\{[^}]*width:\s*44px;\s*height:\s*44px;[^}]*flex:\s*0 0 44px/, 'layout: every battle button preserves 44px targets');
    for (const rule of sources.css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      assert.ok(!(rule[1].includes('#b-audio') && /display:\s*none|visibility:\s*hidden/.test(rule[2])), 'layout: build and battle never hide the audio off control');
    }
  },
};
assert.deepEqual(new Set(Object.values(mutations).map(m => m.group)), new Set(Object.keys(groups)), 'each semantic group has a production negative');
for (const [name, test] of Object.entries(groups)) {
  if (mutant && mutations[mutant].group !== name) continue;
  try { test(); console.log(`OK audio-ui: ${name}`); }
  catch (error) { console.error(`NG audio-ui: ${name}`); throw error; }
}
if (process.argv.includes('--mutations')) for (const [name, m] of Object.entries(mutations)) {
  const p = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--mutant=${name}`], { encoding: 'utf8', timeout: 120000 });
  assert.equal(p.status, 1, `${name}: broken guard must fail\n${p.stdout}\n${p.stderr}`);
  assert.match(p.stderr, new RegExp(`NG audio-ui: ${m.group}`), `${name}: intended semantic group must be first red`);
  assert.match(p.stderr, /AssertionError/, `${name}: fails an assertion, not module startup`);
  console.log(`OK audio-ui mutation: ${name} → first red ${m.group}`);
}
console.log('audio-ui: all OK (DOM mock and CSS contracts only)');
