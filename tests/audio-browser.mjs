// R117: real Chrome/WebAudio graph and OfflineAudioContext PCM guards.
// The protected CDP harness retains --mute-audio. This is not a speaker/Android listening test.
// All fixtures, bounded tick controls, observers and semantic mutants exist only in temporary builds.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { withBrowser, sleep, touchTap } from '../tools/cdp.mjs';
import { createWorld, hashWorld, N, SUB, UK_TANK, UK_HOWITZER, UK_INFANTRY, ORD_IDLE, ORD_FIRE_AT, SHELL_AP, SHELL_HE, SHELL_SMALL, SHELL_SMOKE, BK_COTTAGE } from '../src/sim/world.ts';
import { step, runLog, spotted } from '../src/sim/step.ts';
import { runScript, SCRIPT } from '../src/sim/script.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'r117-browser-'));
const strictCI = process.env.GITHUB_ACTIONS === 'true' || !!process.env.GITHUB_RUN_ID || !!process.env.CI;
const summary = [], record = text => { summary.push(text); console.log(text); };
const mapLog = [{ tick: 0, cmd: { t: 'map', id: 1, vegetation: 1 } }, { tick: 0, cmd: { t: 'eco', inf: 1, guns: 1, tanks: 1 } }];

// Pure fixture constructor is shared with the isolated page, not with production audio.
// Geometry and expected event counts are independent; every sound comes from real step().
function audioFixture(name) {
  const w = createWorld(1944);
  w.ter.fill(0); w.occ.fill(0); w.crater.fill(0); w.blds = []; w.units = []; w.shells = []; w.events = [];
  const unit = (side, kind, x, z) => ({ id: w.units.length + 1, side, kind, x: (x + .5) * SUB, z: (z + .5) * SUB,
    hp: 1000000, alive: true, order: ORD_IDLE, target: 0, tx: 0, tz: 0, path: [], pathIdx: 0,
    cooldown: 1000000, aimX: SUB, aimZ: 0 });
  w.units.push(unit(0, UK_TANK, 4, 8)); w.units.push(unit(1, UK_TANK, 24, 24));
  const u = w.units[0], v = w.units[1];
  if (name === 'fire') { v.x = 8.5 * SUB; v.z = 8.5 * SUB; u.cooldown = 0; }
  if (['gun', 'hidden-fire', 'smoke-fire'].includes(name)) {
    const shooter = name === 'hidden-fire' ? v : u;
    shooter.kind = UK_HOWITZER; shooter.order = ORD_FIRE_AT; shooter.tx = 14;
    shooter.tz = name === 'hidden-fire' ? 24 : 8; shooter.target = 1; shooter.cooldown = 0;
    if (name === 'smoke-fire') shooter.fireAmmo = SHELL_SMOKE;
  }
  if (name === 'small') { v.x = 8.5 * SUB; v.z = 8.5 * SUB; u.kind = UK_INFANTRY; u.cooldown = 0; }
  if (['ap', 'he', 'hidden-impact', 'small-impact', 'smoke-impact', 'rubble', 'hidden-rubble', 'roof', 'burst'].includes(name)) {
    const hidden = name.startsWith('hidden'), x = (hidden ? 24.5 : 8.5) * SUB, z = (hidden ? 24.5 : 8.5) * SUB;
    const building = name.includes('rubble') || name === 'roof';
    if (building) {
      const b = { id: 1, kind: BK_COTTAGE, x: Math.floor(x / SUB), z: Math.floor(z / SUB), w: 1, d: 1, floors: 1, hp: name === 'roof' ? 75 : 1, maxHp: 100 };
      w.blds.push(b); w.occ[b.z * w.n + b.x] = 1;
    }
    const kind = name === 'he' ? SHELL_HE : name === 'small-impact' ? SHELL_SMALL : name === 'smoke-impact' ? SHELL_SMOKE : SHELL_AP;
    for (let i = 0; i < (name === 'burst' ? 60 : 1); i++) w.shells.push({ id: w.nextShell++, side: 0, kind, shooter: 1,
      sx: u.x, sz: u.z, ex: x, ez: z, t: 0, T: name === 'burst' ? 1 + Math.floor(i / 20) : 1, target: 0, hitBld: building ? 1 : 0 });
  }
  return w;
}
const expected = new Map();
function fixtures() {
  for (const name of ['fire', 'gun', 'hidden-fire', 'smoke-fire', 'small', 'ap', 'he', 'hidden-impact', 'small-impact', 'smoke-impact', 'rubble', 'hidden-rubble', 'roof', 'burst']) {
    const w = audioFixture(name), states = [];
    for (let i = 0; i < (name === 'burst' ? 3 : 1); i++) { step(w, []); states.push({ tick: w.tick, hash: hashWorld(w), rng: w.rng, events: structuredClone(w.events) }); }
    expected.set(name, states);
  }
  assert.deepEqual(expected.get('fire')[0].events.map(e => e.e), ['fire'], 'fixture: one real tank fire');
  assert.deepEqual(expected.get('rubble')[0].events.map(e => e.e), ['stage', 'impact'], 'fixture: real collapse and impact');
  assert.deepEqual(expected.get('roof')[0].events.map(e => e.stage ?? e.kind), [1, 0], 'fixture: non-rubble damage and AP impact');
  assert(expected.get('small')[0].events.some(e => e.kind === SHELL_SMALL), 'fixture: real infantry bullet impact');
  const smoke = audioFixture('smoke-fire'); step(smoke, []);
  assert(!('fireAmmo' in smoke.units[0]) && smoke.shells[0].kind === SHELL_SMOKE, 'fixture: final smoke launch has already cleared its unit ammo');
  for (const name of ['hidden-fire', 'hidden-impact', 'hidden-rubble']) {
    const w = audioFixture(name); step(w, []);
    assert(!spotted(w, 0, 24.5 * SUB, 24.5 * SUB), 'fixture: hidden events truly outside player vision');
  }
  const replay = audioFixture('fire'), replayStates = [];
  for (let i = 0; i < 9; i++) { step(replay, []); replayStates.push({ tick: replay.tick, hash: hashWorld(replay), rng: replay.rng, events: structuredClone(replay.events) }); }
  assert(replayStates.slice(1).some(s => s.events.some(e => e.e === 'impact' && e.kind === SHELL_AP && spotted(replay, 0, e.x, e.z))), 'fixture: remaining replay ticks 2–9 contain a real visible AP impact');
  expected.set('replay', replayStates);
  assert.equal(hashWorld(runScript(600)), 'd7b3572f', 'fixture: full historical SCRIPT600 hash');
  assert.equal(hashWorld(runScript(1200)), 'eea1d59b', 'fixture: full historical SCRIPT1200 hash');
  record('R117 independent Node fixtures: real visible/hidden fire, AP/HE, rubble/roof, last smoke shot, infantry and 60-event burst; historical full hashes preserved');
}

// Pass-through observers retain the browser's native context, source, gain and scheduling.
// No fake context, autoplay policy flag, or production diagnostic export is involved.
const preload = `(() => {
  const query = new URLSearchParams(location.search);
  if (query.get('__r117noFx') === '1') window.__noFx = true;
  const contexts = [], nodes = [], buffers = [], starts = [], resumes = [], clicks = [], edges = new Map();
  let frame = 0, peakNodes = 0, peakActive = 0, lastStart = -1;
  const nextFrame = () => { frame++; requestAnimationFrame(nextFrame); }; requestAnimationFrame(nextFrame);
  for (const type of ['click', 'keydown']) document.addEventListener(type, e => {
    if (e.target?.id === 'b-audio') clicks.push({ type, trusted: e.isTrusted, key: e.key ?? '', active: navigator.userActivation.isActive });
  }, true);
  const connected = () => { const set = new Set(); for (const [a, targets] of edges) for (const b of targets) { set.add(a); if (b >= 0) set.add(b); } return set.size; };
  const active = () => nodes.filter(n => n.started && !n.stopped && !n.ended && (edges.get(n.id)?.size ?? 0) > 0).length;
  const measure = () => { peakNodes = Math.max(peakNodes, connected()); peakActive = Math.max(peakActive, active()); };
  const register = (node, kind, context) => {
    const item = { id: nodes.length, kind, node, context, started: false, stopped: false, ended: false, disconnects: 0 }; nodes.push(item);
    edges.set(item.id, new Set()); const connect = node.connect.bind(node), disconnect = node.disconnect.bind(node);
    node.connect = (...args) => { const result = connect(...args), target = nodes.find(n => n.node === args[0]); edges.get(item.id).add(target?.id ?? -1); measure(); return result; };
    node.disconnect = (...args) => { const result = disconnect(...args); if (!args.length) edges.get(item.id).clear(); else { const target = nodes.find(n => n.node === args[0]); edges.get(item.id).delete(target?.id ?? -1); } item.disconnects++; return result; };
    if (kind === 'source') {
      node.addEventListener('ended', () => { item.ended = true; });
      const start = node.start.bind(node), stop = node.stop.bind(node);
      node.start = (...args) => {
        const result = start(...args); item.started = true;
        let gain = 1, current = item.id; const seen = new Set();
        while (current >= 0 && !seen.has(current)) { seen.add(current); if (nodes[current].kind === 'gain') gain *= nodes[current].node.gain.value; current = [...edges.get(current)][0] ?? -1; }
        lastStart = context.currentTime; starts.push({ frame, time: lastStart, id: item.id, buffer: buffers.indexOf(node.buffer), rate: node.playbackRate.value, gain, state: context.state }); measure(); return result;
      };
      node.stop = (...args) => { const result = stop(...args); item.stopped = true; return result; };
    }
    return node;
  };
  const Native = window.AudioContext;
  if (Native) window.AudioContext = new Proxy(Native, { construct(target, args) {
    if (query.get('__r117failure') === 'constructor') throw new Error('isolated constructor rejection');
    const context = Reflect.construct(target, args); contexts.push({ context, active: navigator.userActivation.isActive });
    for (const [method, kind] of [['createBufferSource', 'source'], ['createGain', 'gain']]) {
      const original = context[method].bind(context); context[method] = (...args) => register(original(...args), kind, context);
    }
    const createBuffer = context.createBuffer.bind(context), resume = context.resume.bind(context);
    context.createBuffer = (...args) => { const buffer = createBuffer(...args); buffers.push(buffer); return buffer; };
    context.resume = () => { resumes.push({ active: navigator.userActivation.isActive, state: context.state }); return query.get('__r117failure') === 'resume' ? Promise.reject(new Error('isolated resume rejection')) : resume(); };
    return context;
  } });
  window.__r117native = {
    snapshot: () => ({ contexts: contexts.length, states: contexts.map(x => x.context.state), createdActive: contexts.map(x => x.active),
      buffers: buffers.map(b => ({ length: b.length, rate: b.sampleRate, channels: b.numberOfChannels })), sources: nodes.filter(n => n.kind === 'source').length,
      starts: starts.map(x => ({ ...x })), resumes: resumes.map(x => ({ ...x })), clicks: clicks.map(x => ({ ...x })), connected: connected(), active: active(), peakNodes, peakActive,
      disconnected: nodes.filter(n => n.kind === 'source' && n.disconnects > 0).length,
      stopped: nodes.filter(n => n.kind === 'source' && n.stopped).length, ended: nodes.filter(n => n.kind === 'source' && n.ended).length }),
    clear: () => { starts.length = 0; peakNodes = connected(); peakActive = active(); },
    refill: () => new Promise(resolve => { const context = contexts[0]?.context; if (!context || context.state !== 'running' || lastStart < 0) { resolve(); return; } const poll = () => { if (context.state !== 'running' || context.currentTime >= lastStart + .72) resolve(); else setTimeout(poll, 10); }; poll(); }),
    close: () => Promise.all(contexts.map(x => x.context.state !== 'closed' ? x.context.close() : null)),
    pcm: async () => {
      const out = [];
      for (let b = 0; b < buffers.length; b++) {
        const buffer = buffers[b], offline = new OfflineAudioContext(1, buffer.length + 256, buffer.sampleRate);
        const source = offline.createBufferSource(), gain = offline.createGain(); source.buffer = buffer;
        gain.gain.value = starts.find(s => s.buffer === b)?.gain ?? .1;
        source.connect(gain); gain.connect(offline.destination); source.start();
        const rendered = (await offline.startRendering()).getChannelData(0);
        let peak = 0, sum = 0, energy = 0, finite = true, hash = 2166136261;
        const bits = new Uint8Array(rendered.buffer, rendered.byteOffset, rendered.byteLength);
        for (const value of rendered) { finite = finite && Number.isFinite(value); peak = Math.max(peak, Math.abs(value)); sum += value; energy += value * value; }
        for (const value of bits) hash = Math.imul(hash ^ value, 16777619);
        out.push({ length: buffer.length, rate: buffer.sampleRate, channels: buffer.numberOfChannels, finite, peak, mean: sum / rendered.length, energy,
          first: rendered[0], last: rendered[buffer.length - 1], tail: Math.max(...rendered.subarray(buffer.length)), hash: (hash >>> 0).toString(16) });
      }
      return out;
    },
  };
})();`;

const instrumentation = `
import { ORD_IDLE, ORD_FIRE_AT, SHELL_AP, SHELL_SMALL, SHELL_SMOKE } from './sim/world.ts';
${audioFixture.toString()}
(window as any).__r117Limit = null;
(window as any).__r117Events = [];
(window as any).__r117test = {
  inspect: () => ({ tick: w.tick, hash: hashWorld(w), rng: w.rng, phase, paused, speed, log: JSON.parse(JSON.stringify(log)),
    debug: battleAudio?.debug() ?? null, status: battleAudio?.status() ?? null,
    events: JSON.parse(JSON.stringify((window as any).__r117Events)),
    visible: { units: w.units.map(u => view.visibleUnit(u)), near: view.visibleAt(8.5 * SUB, 8.5 * SUB), far: view.visibleAt(24.5 * SUB, 24.5 * SUB) } }),
  fixture: (name: string, rate = 1) => {
    battleAudio?.reset(); help.close(); reportView?.hide(); reportShown = false; endT0 = -1; endFrom = null;
    w = audioFixture(name); phase = 'battle'; plan = []; pending = []; log = []; selected.clear(); paused = false; speed = rate;
    stats = newStats(w); view.setWorld(w, -1); view.snapshot(); minimap?.dirty();
    (window as any).__r117Events = []; (window as any).__r117Wanted = name === 'burst' ? 3 : 1; (window as any).__r117Limit = 0;
    acc = 0; lastT = performance.now(); syncBattleAudio(); ui();
  },
  arm: () => { (window as any).__r117Limit = (window as any).__r117Wanted; acc = 1 / TICK_HZ; lastT = performance.now(); },
  refresh: () => { syncBattleAudio(); ui(); },
  report: () => { reportShown = true; reportView?.show(makeReport(w, stats)); syncBattleAudio(); ui(); },
  visibility: (hidden: boolean) => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden }); document.dispatchEvent(new Event('visibilitychange')); },
  show: () => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); },
  mutation: (name: string) => { (window as any).__r117mutation = name; },
  releaseLimit: () => { (window as any).__r117Limit = null; },
};`;

function plugin(broken, hits) {
  const is = name => `(globalThis as any).__r117mutation === '${name}'`;
  return {
    name: broken ? 'r117-isolated-mutants' : 'r117-isolated-observation', enforce: 'pre',
    transform(code, id) {
      const rel = path.relative(ROOT, id.split('?')[0]).replaceAll('\\', '/');
      const replace = (from, to, label) => {
        assert.equal(code.split(from).length - 1, 1, `unique isolated R117 source anchor: ${label}`);
        code = code.replace(from, to); hits.add(label);
      };
      if (rel === 'src/main.ts') {
        replace('while (acc >= 1 / TICK_HZ && steps < 8)', "while (acc >= 1 / TICK_HZ && steps < 8 && ((window as any).__r117Limit == null || w.tick < (window as any).__r117Limit))", 'bounded-real-loop');
        replace('  step(w, now, sandboxPlacementResults);', `  step(w, now, sandboxPlacementResults);\n  (window as any).__r117Events?.push({ tick: w.tick, hash: hashWorld(w), rng: w.rng, events: JSON.parse(JSON.stringify(w.events)) });`, 'real-step-observer');
        if (broken) {
          replace("const battleAudio = fxOn && V.r117 ? new BattleAudio(", "const battleAudio = q.get('__r117mutant') === 'valve' || (fxOn && V.r117) ? new BattleAudio(", 'valve');   // R060：閥從閥表來
          replace('battleAudio?.enqueue(w, w.events, view);', `if (!(${is('wiring')})) battleAudio?.enqueue(w, w.events, ${is('fog')} ? { visibleUnit: () => true, visibleAt: () => true } : view);`, 'wiring-fog');
          replace("  battleAudio?.setActive(phase === 'battle' && !paused && !reportShown && !audioHelpActive && !document.hidden && audioPageActive);", `  if (!(${is('cleanup')})) battleAudio?.setActive(phase === 'battle' && !paused && !reportShown && !audioHelpActive && !document.hidden && audioPageActive);`, 'cleanup');
          replace('syncBattleAudio(); battleAudio.toggleFromGesture();', `syncBattleAudio(); if (!(${is('mute')})) battleAudio.toggleFromGesture();`, 'mute');
          replace('  view.onEvents(w.events, simT());', `  view.onEvents(w.events, simT());\n  if (${is('replay')}) { battleAudio?.enqueue(w, w.events, view); battleAudio?.flush(); }`, 'replay');
        }
        code += instrumentation; hits.add('observation');
      }
      if (broken && rel === 'src/render/audio.ts') {
        replace('this.frameStarts >= STARTS_PER_FRAME', `this.frameStarts >= (${is('capacity')} ? 8 : STARTS_PER_FRAME)`, 'capacity');
      }
      if (broken && rel === 'src/ui/hud.ts') {
        replace('if (!e.isTrusted) return;', "if (!e.isTrusted && new URLSearchParams(location.search).get('__r117mutant') !== 'trust') return;", 'trust');
        replace("root.classList.toggle('has-audio', !!a.toggleAudio);", "root.classList.toggle('has-audio', !!a.toggleAudio && new URLSearchParams(location.search).get('__r117mutant') !== 'layout');", 'layout');
      }
      return code;
    },
  };
}

async function main() {
  fixtures();
  if (process.argv.includes('--fixture-only')) return;
  const started = Date.now(), baseline = path.join(temp, 'baseline'), broken = path.join(temp, 'broken');
  const baseHits = new Set(), mutantHits = new Set();
  await build({ root: ROOT, logLevel: 'error', plugins: [plugin(false, baseHits)], build: { outDir: baseline } });
  await build({ root: ROOT, logLevel: 'error', plugins: [plugin(true, mutantHits)], build: { outDir: broken } });
  assert.deepEqual([...baseHits].sort(), ['bounded-real-loop', 'observation', 'real-step-observer'], 'fixture: baseline changes only isolated diagnostics');
  assert.equal(mutantHits.size, 11, 'fixture: eight mutation source anchors compile nine independent semantic negatives');
  record('R117 isolated baseline and semantic mutants compiled; this is not a Chrome pass');
  if (process.argv.includes('--build-only')) return;
  const overlay = {};
  await withBrowser({ root: baseline, overlay, preload, port: 8437, width: 412, height: 860, mobile: true,
    chromeWaitMs: 20000, readyMs: 8000, settle: 50 }, async ({ open, page }) => {
    const bounded = async (task, label) => {
      const ms = Math.min(8000, 110000 - (Date.now() - started)); let timer;
      assert(ms > 0, 'R117 browser operational deadline exceeded');
      try { return await Promise.race([task, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(`CDP timeout: ${label}`)), ms); })]); }
      finally { clearTimeout(timer); }
    };
    const send = page.send.bind(page), evaluate = page.evaluate.bind(page);
    page.send = (method, args) => bounded(send(method, args), method);
    page.evaluate = expression => bounded(evaluate(expression), 'evaluate');
    const E = expression => page.evaluate(expression), inspect = () => E('__r117test.inspect()'), native = () => E('__r117native.snapshot()');
    const frames = () => E('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    const until = async (expression, label) => {
      const answer = await E(`new Promise(resolve => { const start = performance.now(); const poll = () => { if (${expression}) resolve(true); else if (performance.now() - start > 3500) resolve(false); else setTimeout(poll, 15); }; poll(); })`);
      assert(answer, `fixture: ${label}; state ${JSON.stringify(await inspect())}; native ${JSON.stringify(await native())}`);
    };
    const viewport = async mobile => {
      await page.send('Emulation.setDeviceMetricsOverride', { width: mobile ? 412 : 1280, height: mobile ? 860 : 800, deviceScaleFactor: 1, mobile });
      await page.send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: 5 });
    };
    const fresh = async (query = '') => {
      await open('noR018=1&noR016=1&' + query);
      assert(await E('!!window.__rts?.ready && !!window.__r117test && !!window.__r117native'), 'fixture: real production app and native observer ready');
    };
    const key = async (key, code, virtual) => {
      // CDP does not infer generated text from the virtual key. Match Puppeteer's native
      // Enter payload: USKeyboardLayout.ts (Enter) and cdp/Input.ts (CdpKeyboard.down).
      // https://github.com/puppeteer/puppeteer/blob/main/packages/puppeteer-core/src/cdp/Input.ts
      const text = key === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {};
      await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: virtual, nativeVirtualKeyCode: virtual, ...text });
      await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: virtual, nativeVirtualKeyCode: virtual });
    };
    const keyboardProbe = async () => {
      await E(`(() => {
        const button = document.createElement('button'); button.id = '__r117-key-probe'; button.type = 'button'; button.textContent = 'Enter probe';
        button.style.cssText = 'position:fixed;left:0;top:0;z-index:9999'; document.body.appendChild(button);
        window.__r117KeyProbeEvents = [];
        for (const type of ['keydown', 'keypress', 'keyup', 'click']) button.addEventListener(type, event => window.__r117KeyProbeEvents.push({ type, trusted: event.isTrusted, key: event.key ?? '', charCode: event.charCode ?? 0 }));
        button.focus();
      })()`);
      try {
        await key('Enter', 'Enter', 13);
        const events = await E('__r117KeyProbeEvents'), clicks = events.filter(event => event.type === 'click');
        assert(clicks.length === 1 && clicks[0].trusted && events.some(event => event.type === 'keypress' && event.trusted && event.charCode === 13),
          `fixture: CDP Enter generates one trusted native button click and carriage-return keypress; events ${JSON.stringify(events)}`);
      } finally { await E('document.getElementById("__r117-key-probe")?.remove(); delete window.__r117KeyProbeEvents'); }
    };
    const button = async (id, mode = 'mouse') => {
      const p = await E(`(() => { const b = document.getElementById(${JSON.stringify(id)}); if (!b) return null; const r = b.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2, b.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))]; })()`);
      assert(p?.[2], `fixture: native ${id} button is unobstructed`);
      if (mode === 'touch') await touchTap(page, p[0], p[1]);
      else if (mode === 'key') { await E(`document.getElementById(${JSON.stringify(id)}).focus()`); await key('Enter', 'Enter', 13); }
      else {
        await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p[0], y: p[1], button: 'left', buttons: 1, clickCount: 1 });
        await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p[0], y: p[1], button: 'left', buttons: 0, clickCount: 1 });
      }
    };
    const scene = async (name, rate = 1) => {
      await E(`__r117test.fixture(${JSON.stringify(name)}, ${rate})`);
      if ((await inspect()).status?.enabled) await until('__r117test.inspect().status.state === "on"', `live ${name} has real running context before its event`);
      await E('__r117native.refill();');
      await E('__r117native.clear(); __r117test.arm()');
      const states = expected.get(name), end = states?.at(-1)?.tick ?? 1;
      await until(`__rts.tick() >= ${end}`, `bounded actual live ${name} reaches ${end} tick(s)`);
      const state = await inspect(), graph = await native();
      if (states) assert.deepEqual(state.events, states, `determinism: live ${name} full hash/RNG/events match independent Node step`);
      return { state, graph };
    };
    const enable = async mode => {
      await scene('silent');
      await button('b-audio', mode);
      await until(`__r117test.inspect().status?.state === 'on'`, `trusted ${mode} enables running audio`);
      const graph = await native();
      assert.equal(graph.contexts, 1, 'activation: exactly one real AudioContext');
      assert(graph.createdActive.every(Boolean) && graph.resumes[0]?.active && graph.clicks.some(c => c.type === 'click' && c.trusted && c.active), 'activation: context and first resume occur on trusted user-activation stack');
      assert.deepEqual(graph.states, ['running'], 'activation: real native context reaches running');
      assert.equal(graph.buffers.length, 3, 'activation: exactly three finite cached buffers');
    };
    const valveCheck = async () => {
      const graph = await native();
      assert(await E('!document.getElementById("b-audio")') && graph.contexts === 0 && graph.sources === 0 && (await inspect()).debug === null,
        'valve: audio control, context, sources and engine are absent');
      assert.equal(await E('getComputedStyle(document.querySelector("#hud .btns")).gap'), '6px', 'valve: legacy seven-button HUD retains six-pixel gap');
      assert.equal(await E('document.querySelectorAll("#hud .btns button").length'), 7, 'valve: legacy HUD retains seven buttons');
    };
    const layout = async label => {
      const g = await E(`(() => {
        const rect = e => e.getBoundingClientRect().toJSON(), bar = document.querySelector('#hud .btns');
        return { bar: rect(bar), gap: getComputedStyle(bar).gap, width: innerWidth, height: innerHeight,
          buttons: [...bar.querySelectorAll('button')].map(b => { const r = rect(b); return { ...r, id: b.id, hit: b.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) }; }),
          obstacles: ['#hud .top', '#minimap', '#prodbar', '#hint'].map(s => document.querySelector(s)).filter(e => e && !e.hidden && e.getBoundingClientRect().height).map(rect),
          label: document.getElementById('b-audio').getAttribute('aria-label'), pressed: document.getElementById('b-audio').getAttribute('aria-pressed'), text: document.getElementById('b-audio').textContent };
      })()`);
      assert(g.buttons.length === 8 && g.buttons.every(b => b.width >= 44 && b.height >= 44 && b.hit) && g.bar.width === 396 && g.gap === '4px' && g.bar.left >= 0 && g.bar.right <= g.width,
        'layout: eight 44px native targets fit a 396px toolbar inside the viewport');
      for (const r of g.obstacles) assert(g.bar.right <= r.left || g.bar.left >= r.right || g.bar.bottom <= r.top || g.bar.top >= r.bottom, `layout: ${label} toolbar avoids status/minimap/production/hint`);
      const state = await inspect();
      assert(g.label?.includes('音效') && g.label.length > 4 && g.pressed === String(state.status.enabled), `layout: ${label} accessible audio state matches intent`);
      return g;
    };
    const shot = async name => {
      const png = await page.send('Page.captureScreenshot', { format: 'png' });
      fs.mkdirSync(path.join(ROOT, 'shots'), { recursive: true }); fs.writeFileSync(path.join(ROOT, 'shots', name), Buffer.from(png.data, 'base64'));
    };
    const liveCheck = async (name, lengths) => {
      const result = await scene(name);
      assert.deepEqual(result.graph.starts.map(s => result.graph.buffers[s.buffer]?.length), lengths, `live: ${name} starts only its independently expected visible sound(s)`);
      assert(result.graph.starts.every(s => s.state === 'running' && s.rate === 1 && s.gain > 0 && s.gain <= .1 + 1e-7), `live: ${name} uses real running native graph, rate one and conservative gain`);
      return result;
    };
    const quiet = async label => {
      const s = await inspect(), g = await native();
      assert(s.debug.pending === 0 && s.debug.voices === 0 && g.active === 0 && g.connected <= 1 && g.disconnected === g.sources,
        `cleanup: ${label} immediately clears pending and disconnects every source`);
      const starts = g.starts.length; await frames();
      assert.equal((await native()).starts.length, starts, `cleanup: ${label} never replays an old queue`);
    };
    const muteCheck = async () => {
      await button('b-audio');
      const s = await inspect(), g = await native();
      assert(s.status.state === 'off' && !s.status.enabled && g.active === 0 && g.connected <= 1,
        'mute: trusted audio toggle stops native voices and clears enabled state');
    };
    const capacityCheck = async rate => {
      const { state, graph } = await scene('burst', rate), perFrame = new Map();
      for (const start of graph.starts) perFrame.set(start.frame, (perFrame.get(start.frame) ?? 0) + 1);
      assert([...perFrame.values()].every(n => n <= 4) && graph.peakActive <= 8 && graph.peakNodes <= 17 && state.debug.peakPending <= 8 && state.debug.pending === 0,
        'capacity: real graph stays within four starts/frame, eight voices/pending and seventeen connected nodes');
      assert(graph.starts.length > 0 && state.debug.dropped > 0 && graph.starts.every(s => s.rate === 1), 'capacity: audible burst drops overflow without speed-dependent pitch');
      const starts = graph.starts.length, buffers = graph.buffers.length;
      await frames(); await frames();
      assert.equal((await native()).starts.length, starts, 'capacity: overflow cannot become cross-frame historical playback');
      assert.equal((await native()).buffers.length, buffers, 'capacity: stable frames never generate more buffers');
      return graph;
    };
    const replayCheck = async () => {
      await scene('fire'); await E('__r117native.clear(); __rts.stepN(8)');
      assert.equal((await native()).starts.length, 0, 'replay: bulk stepN never plays historical events');
      assert.deepEqual((await inspect()).events, expected.get('replay'), 'replay: bulk stepN full hash/RNG/event history equals independent Node ticks 1–9');
      for (const [expression, world] of [
        ['__rts.runScript(600)', runScript(600)], ['__rts.playScript(1200)', runScript(1200)],
        [`__rts.playLog(1944, ${JSON.stringify(mapLog)}, 40)`, runLog(createWorld(1944), mapLog, 40)],
      ]) {
        await E(`__r117native.clear(); ${expression}`);
        const state = await inspect(), graph = await native();
        assert.deepEqual({ hash: state.hash, rng: state.rng, tick: state.tick }, { hash: hashWorld(world), rng: world.rng, tick: world.tick }, 'replay: full historical/new-map Chrome hash and RNG equal Node');
        assert.equal(graph.starts.length, 0, 'replay: runScript/playScript/playLog never start historical sounds');
        assert.equal(state.debug.pending, 0, 'replay: no historical pending queue remains');
      }
    };

    for (const mode of ['mouse', 'touch', 'key']) {
      const mobile = mode === 'touch'; await viewport(mobile); await fresh();
      if (mode === 'key') await keyboardProbe();
      const opening = await E('__rts.info()');
      assert(opening.calls <= 20 && opening.triangles <= 80000, `budget: ${mode} opening remains within 20 calls/80000 triangles`);
      assert.equal((await native()).contexts, 0, 'activation: loading app creates no AudioContext');
      await E('document.getElementById("b-audio").click()'); await frames();
      assert.equal((await native()).contexts, 0, 'activation: untrusted synthetic click cannot create AudioContext');
      await button('b-all', mode === 'key' ? 'mouse' : mode);
      assert.equal((await native()).contexts, 0, 'activation: ordinary HUD use never creates AudioContext');
      await scene('silent'); await layout(`${mode} off`);
      if (mode !== 'key') await shot(`r117-audio-${mobile ? 'mobile' : 'desktop'}-off.png`);
      await enable(mode); await layout(`${mode} on`);
      if (mode !== 'key') await shot(`r117-audio-${mobile ? 'mobile' : 'desktop'}-on.png`);
      await liveCheck('fire', [4410]); await muteCheck(); await quiet('mute');
      const frozen = await inspect(); await scene('fire');
      assert.equal((await native()).starts.length, 0, 'mute: future live events stay silent while disabled');
      assert.equal((await native()).contexts, 1, 'activation: mute and reset reuse exactly one context');
      assert.equal(frozen.debug.pcmSamples, 37485, 'activation: mono buffers total 37485 samples');
      record(`R117 native ${mode}: no autoplay/synthetic activation; real trusted resume/running, live fire, mute; opening ${opening.calls}/${opening.triangles}`);
    }

    // Stay on this already unlocked page for all independent bounded live event scenarios.
    await enable('mouse');
    for (const [name, clips] of [ ['fire', [4410]], ['gun', [4410]], ['ap', [13230]], ['he', [13230]], ['rubble', [19845, 13230]], ['roof', [13230]],
      ['hidden-fire', []], ['hidden-impact', []], ['hidden-rubble', []], ['small', []], ['small-impact', []], ['smoke-fire', []], ['smoke-impact', []] ]) await liveCheck(name, clips);
    const pcm = await E('__r117native.pcm()');
    assert.equal(pcm.length, 3, 'pcm: native context owns exactly three cached clips');
    assert.deepEqual(pcm.map(p => p.length), [4410, 13230, 19845], 'pcm: independently bounded cannon/explosion/collapse lengths');
    assert(pcm.every(p => p.channels === 1 && p.rate === 22050 && p.finite && p.energy > 0 && p.peak > 0 && p.peak * 8 < 1 && Math.abs(p.mean) < 1e-6 && p.first === 0 && p.last === 0 && p.tail === 0),
      'pcm: OfflineAudioContext yields nonzero finite bounded mono output, quiet endpoints/tails, negligible DC and safe eight-voice peak');
    assert.equal(new Set(pcm.map(p => p.hash)).size, 3, 'pcm: actual OfflineAudioContext waveforms are distinct');
    record(`R117 OfflineAudioContext: ${pcm.map(p => `${p.length} samples/peak ${p.peak.toFixed(5)}/hash ${p.hash}`).join('; ')}`);

    for (const rate of [1, 2, 4]) { const graph = await capacityCheck(rate); record(`R117 ${rate}x burst: ${graph.starts.length} starts, peak ${graph.peakActive} voices/${graph.peakNodes} native nodes, rate=1`); }
    await sleep(1000); await frames(); await quiet('natural completion');
    for (const [label, action] of [
      ['pause', () => button('b-pause')], ['help', () => button('b-help')],
      ['report', () => E('__r117test.report()')], ['hidden visibilitychange', () => E('__r117test.visibility(true)')],
      ['persisted pagehide', () => E('dispatchEvent(new PageTransitionEvent("pagehide", {persisted:true}))')],
    ]) {
      await E('__r117test.visibility(false); __r117test.show()'); await liveCheck('rubble', [19845, 13230]); await action(); await quiet(label);
      if (label === 'help') {
        await key(' ', 'Space', 32); await frames();
        assert((await inspect()).debug.active === false && (await native()).active === 0, 'cleanup: Space under open help cannot reactivate sound');
      }
    }
    await E('__r117test.visibility(false); __r117test.show()');
    await liveCheck('rubble', [19845, 13230]); await button('b-restart'); await quiet('native restart');
    assert.equal((await native()).contexts, 1, 'cleanup: repeated reset never accumulates contexts');
    await scene('silent'); await until('__r117test.inspect().status.state === "on"', 'same context resumes for new live events');
    await replayCheck();
    await E('__rts.playScript(600)'); await frames(); const hot = await E('__rts.info()');
    assert(hot.calls <= 22 && hot.triangles <= 80000, 'budget: replay hotspot stays within 22 calls/80000 triangles');
    record('R117 live filters, 1x/2x/4x capacity, natural end/mute/pause/help+Space/report/reset, controlled visibilitychange/PageTransitionEvent handler checks and historical replay guards passed');

    // All escape valves use the same full tick/hash/RNG reference, including preloaded __noFx.
    for (const query of ['noR117=1', 'fx=off', '__r117noFx=1']) {
      await fresh(query); await valveCheck(); await scene('fire'); await valveCheck();
      const world = runScript(600); await E('__rts.runScript(600)'); const state = await inspect();
      assert.deepEqual([state.hash, state.rng], [hashWorld(world), world.rng], 'valve: historical full hash/RNG unchanged');
    }
    await fresh(); const buildBefore = await inspect(); await button('b-audio');
    await until('__r117native.snapshot().states[0] === "suspended" && __r117test.inspect().status.state === "paused"', 'enabling during build unlocks then suspends a real context');
    const buildGraph = await native();
    assert(buildGraph.contexts === 1 && buildGraph.sources === 0 && buildGraph.createdActive[0] && buildGraph.resumes[0]?.active, 'activation: build-phase gesture unlocks once without starting a source');
    assert.deepEqual([(await inspect()).hash, (await inspect()).rng], [buildBefore.hash, buildBefore.rng], 'activation: build-phase gesture preserves complete hash and RNG');
    await liveCheck('fire', [4410]);
    await E('__r117native.close()');
    await until('__r117test.inspect().status.state === "unavailable"', 'externally closed real context is reported unavailable');
    await button('b-audio'); await scene('fire');
    assert.equal((await native()).contexts, 1, 'cleanup: a closed context is never reused or replaced by an implicit new one');
    assert.equal((await native()).starts.length, 0, 'cleanup: a closed context cannot schedule a new source');
    for (const failure of ['constructor', 'resume']) {
      await fresh(`__r117failure=${failure}`); await scene('silent'); await button('b-audio');
      await until('__r117test.inspect().status.state === "unavailable"', `${failure} rejection reaches understandable unavailable state`);
      assert(await E('document.getElementById("b-audio").getAttribute("aria-label").includes("不可用")'), 'rejection: HUD truthfully explains unavailable audio');
      await scene('fire'); assert.equal((await native()).starts.length, 0, 'rejection: failed audio never creates a source');
      const before = await inspect(), oldPressed = await E('document.getElementById("b-fire").getAttribute("aria-pressed")'); await button('b-fire');
      assert.notEqual(await E('document.getElementById("b-fire").getAttribute("aria-pressed")'), oldPressed, 'rejection: native fire-mode button still responds');
      assert.deepEqual([(await inspect()).hash, (await inspect()).rng], [before.hash, before.rng], 'rejection: ordinary controls remain usable without mutating world');
    }
    await viewport(true); await fresh(); await enable('touch'); await liveCheck('rubble', [19845, 13230]);
    await E('dispatchEvent(new PageTransitionEvent("pagehide", {persisted:false}))');
    await until('__r117native.snapshot().states.every(s => s === "closed")', 'nonpersisted pagehide closes the real context');
    await quiet('nonpersisted pagehide'); await E('__r117test.show()'); await button('b-audio');
    assert.equal((await native()).contexts, 1, 'cleanup: pageshow never reuses or recreates a disposed context');

    // Each mutant must reach exactly its intended semantic assertion, never merely fail startup.
    overlay['index.html'] = fs.readFileSync(path.join(broken, 'index.html'));
    await viewport(true); await fresh(); await enable('touch');
    const negatives = [
      ['wiring', () => liveCheck('fire', [4410]), 'live: fire starts only its independently expected visible sound(s)'],
      ['fog', () => liveCheck('hidden-fire', []), 'live: hidden-fire starts only its independently expected visible sound(s)'],
      ['capacity', () => capacityCheck(1), 'capacity: real graph stays within four starts/frame, eight voices/pending and seventeen connected nodes'],
      ['cleanup', async () => { await liveCheck('rubble', [19845, 13230]); await button('b-pause'); await quiet('pause'); }, 'cleanup: pause immediately clears pending and disconnects every source'],
      ['mute', async () => { await liveCheck('rubble', [19845, 13230]); await muteCheck(); }, 'mute: trusted audio toggle stops native voices and clears enabled state'],
      ['replay', replayCheck, 'replay: bulk stepN never plays historical events'],
    ];
    for (const [name, run, expectedFailure] of negatives) {
      await E('__r117test.mutation(""); __r117test.fixture("silent")');
      await until('__r117test.inspect().status.state === "on"', `negative ${name} starts from actual running baseline`);
      const errors = page.errors.length; await E(`__r117test.mutation(${JSON.stringify(name)})`); let failure;
      try { await run(); } catch (error) { failure = error; }
      assert(failure instanceof assert.AssertionError && failure.message.startsWith(expectedFailure), `negative ${name}: expected first semantic failure, got ${failure?.stack ?? 'no failure'}`);
      assert.equal(page.errors.length, errors, `negative ${name}: no unrelated browser exception`);
      record(`RED real Chrome ${name}: ${expectedFailure}`); await E('__r117test.mutation("")');
    }
    for (const [name, query, run, expectedFailure] of [
      ['trust', '__r117mutant=trust', async () => { await E('document.getElementById("b-audio").click()'); assert.equal((await native()).contexts, 0, 'activation: untrusted synthetic click cannot create AudioContext'); }, 'activation: untrusted synthetic click cannot create AudioContext'],
      ['valve', 'noR117=1&__r117mutant=valve', valveCheck, 'valve: audio control, context, sources and engine are absent'],
      ['layout', '__r117mutant=layout', async () => { await scene('silent'); await layout('mutant'); }, 'layout: eight 44px native targets fit a 396px toolbar inside the viewport'],
    ]) {
      await fresh(query); const errors = page.errors.length; let failure;
      try { await run(); } catch (error) { failure = error; }
      assert(failure instanceof assert.AssertionError && failure.message.startsWith(expectedFailure), `negative ${name}: expected first semantic failure, got ${failure?.stack ?? 'no failure'}`);
      assert.equal(page.errors.length, errors, `negative ${name}: no unrelated browser exception`); record(`RED real Chrome ${name}: ${expectedFailure}`);
    }
    assert(page.requests.every(url => url.startsWith('http://127.0.0.1:8437/') || url.startsWith('data:') || url === 'about:blank'), 'resources: no external audio/model/image/font request');
    assert.equal(page.errors.length, 0, 'browser: no unrelated runtime or console errors');
  });
  record(`R117 real Chrome guards completed in ${Date.now() - started}ms; 120s child limit unchanged; harness audio muted, no speaker/Android claim`);
}

try {
  await main(); fs.mkdirSync(path.join(ROOT, 'shots'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'shots/r117-browser.txt'), summary.join('\n') + '\n');
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n### R117 real audio guards\n${summary.map(s => '- ' + s).join('\n')}\n`);
} catch (error) {
  const message = String(error?.stack ?? error);
  if (/listen (?:EPERM|EACCES).*127\.0\.0\.1|socket\(\) failed: Operation not permitted/.test(message) && !strictCI) {
    console.error('NOT RUN R117 real Chrome guards: local socket restriction; CI must execute them.'); console.error(error.message); process.exitCode = 77;
  } else {
    // tools/unit prints only the last three lines: preserve the complete first-failure diagnostic there.
    console.error(error); console.error(`R117 browser FAIL: ${message.replaceAll('\n', ' | ')}`); process.exitCode = 1;
  }
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
