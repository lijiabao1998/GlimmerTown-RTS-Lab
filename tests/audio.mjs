// R117 independent Node guards. No DOM or real AudioContext is needed; browser guards
// separately observe the actual Web Audio graph and render its buffers offline.
import assert from 'node:assert/strict';
import { BattleAudio, makeBattlePCM, AUDIO_SAMPLE_RATE } from '../src/render/audio.ts';
import { createWorld, hashWorld, SUB, UK_TANK, UK_HOWITZER, UK_ATGUN, UK_MORTAR, UK_LIGHT, UK_HEAVY, UK_INFANTRY, UK_OBSERVER,
  SHELL_AP, SHELL_HE, SHELL_SMALL, SHELL_SMOKE, STAGE_RUBBLE } from '../src/sim/world.ts';
import { step, runLog } from '../src/sim/step.ts';
import { SCRIPT, SCRIPT_SEED } from '../src/sim/script.ts';
const only = process.argv[2];
const drain = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const visible = { visibleUnit: () => true, visibleAt: () => true };
const hidden = { visibleUnit: () => false, visibleAt: () => false };
const impact = { e: 'impact', kind: SHELL_AP, x: 512, z: 768, bld: 0 };
let gesture = false;
function toggle(audio) { gesture = true; audio.toggleFromGesture(); gesture = false; }
function fixture() {
  const w = createWorld(1944);
  w.units = [UK_TANK, UK_HOWITZER, UK_ATGUN, UK_MORTAR, UK_LIGHT, UK_HEAVY, UK_INFANTRY, UK_OBSERVER].map((kind, n) => ({
    ...w.units[0], id: n + 1, side: 0, kind, alive: true, hp: 100, x: 512 + n * SUB, z: 768, path: [],
  }));
  w.blds = [1, 2, 3].map(id => ({ id, kind: 0, x: 4 + id * 2, z: 6, w: 2, d: 3, floors: 1, maxHp: 200, hp: 0 }));
  w.events = []; return w;
}
function fire(w, index = 0) { const u = w.units[index]; return { e: 'fire', unit: u.id, x: u.x, z: u.z }; }

class FakeNode {
  constructor(context, type) { this.context = context; this.type = type; this.links = new Set(); this.disconnects = 0; context.nodes.push(this); }
  connect(node) {
    if (this.context.failure === `${this.type}-connect`) throw Error('injected connect');
    this.links.add(node); this.context.peakNodes = Math.max(this.context.peakNodes, this.context.connected()); return node;
  }
  disconnect() { this.disconnects++; this.links.clear(); }
}
class FakeSource extends FakeNode {
  constructor(context) { super(context, 'source'); this.playbackRate = { value: 1 }; this.buffer = null; this.onended = null; this.started = false; this.ended = false; this.stops = 0; }
  start() {
    if (this.context.failure === 'start') throw Error('injected start');
    this.started = true; this.context.started.push(this);
  }
  stop() { this.stops++; if (this.context.failure === 'stop') throw Error('injected stop'); this.end(); }
  end() { if (this.ended) return; this.ended = true; this.onended?.(); }
}
class FakeContext {
  constructor(options = {}) {
    this.options = options; this.currentTime = 0; this.state = 'suspended'; this.onstatechange = null; this.nodes = []; this.started = []; this.buffers = [];
    this.destination = {}; this.resumes = []; this.suspends = []; this.closes = 0; this.peakNodes = 0; this.failure = options.failure;
  }
  transition(state) { this.state = state; this.onstatechange?.(); }
  connected() { return this.nodes.filter(n => n.links.size > 0).length; }
  createGain() {
    if (this.failure === 'master' || (this.failure === 'gain' && this.nodes.length > 0)) throw Error('injected gain');
    const node = new FakeNode(this, this.nodes.length ? 'gain' : 'master'); node.gain = { value: 1 }; return node;
  }
  createBuffer(channels, length, rate) {
    if (this.failure === 'buffer') throw Error('injected buffer');
    const data = new Float32Array(length), buffer = { numberOfChannels: channels, length, sampleRate: rate, duration: length / rate,
      copyToChannel(pcm, channel) { assert.equal(channel, 0); data.set(pcm); }, getChannelData: () => data };
    this.buffers.push(buffer); return buffer;
  }
  createBufferSource() { if (this.failure === 'source') throw Error('injected source'); return new FakeSource(this); }
  resume() {
    const entry = { gesture }; this.resumes.push(entry);
    if (this.options.resume === 'throw') throw Error('resume throw');
    if (this.options.resume === 'reject') return Promise.reject(Error('resume reject'));
    if (this.options.resume === 'defer') return new Promise((resolve, reject) => {
      entry.resolve = (state = 'running') => { this.transition(state); resolve(); }; entry.reject = reject;
    });
    if (this.options.resume !== 'no-running') this.transition('running');
    return Promise.resolve();
  }
  suspend() {
    const entry = {}; this.suspends.push(entry);
    if (this.options.suspend === 'throw') throw Error('suspend throw');
    if (this.options.suspend === 'reject') return Promise.reject(Error('suspend reject'));
    if (this.options.suspend === 'defer') return new Promise(resolve => { entry.resolve = () => { this.transition('suspended'); resolve(); }; });
    this.transition('suspended'); return Promise.resolve();
  }
  close() { this.closes++; this.transition('closed'); return Promise.resolve(); }
  finish() { for (const source of this.started) source.end(); }
}
async function setup(options = {}, active = true) {
  const ctx = new FakeContext(options); let builds = 0, changes = 0;
  const audio = new BattleAudio(() => changes++, () => { builds++; return ctx; });
  audio.setActive(active); toggle(audio); await drain();
  return { audio, ctx, builds: () => builds, changes: () => changes };
}
function cue(a, w = fixture(), events = [impact], visibility = visible) { a.enqueue(w, events, visibility); a.flush(); }
function counts(ctx) { return [4410, 13230, 19845].map(n => ctx.started.filter(s => s.buffer?.length === n).length); }
const groups = {
  pcm() {
    const clips = ['fire', 'impact', 'collapse'].map(makeBattlePCM);
    assert.deepEqual(clips.map(p => p.length), [4410, 13230, 19845], 'pcm: three independently fixed short clip lengths');
    assert.equal(AUDIO_SAMPLE_RATE, 22050);
    assert(clips.reduce((n, p) => n + p.length, 0) <= 40000, 'pcm: total mono sample budget');
    for (const [i, pcm] of clips.entries()) {
      assert(pcm.every(Number.isFinite), 'pcm: every generated sample is finite');
      assert(pcm.some(v => Math.abs(v) > 0.01), 'pcm: each clip has audible nonzero energy');
      assert(Math.max(...pcm.map(Math.abs)) <= 1, 'pcm: samples stay inside unity before conservative master gain');
      assert.equal(Math.abs(pcm[0]), 0, 'pcm: clipped start is exactly silent'); assert.equal(Math.abs(pcm.at(-1)), 0, 'pcm: clipped end is exactly silent');
      assert(Math.abs(pcm.reduce((s, v) => s + v, 0) / pcm.length) < 1e-8, 'pcm: finite clip has no sustained DC');
      const rms = p => Math.sqrt(p.reduce((s, v) => s + v * v, 0) / p.length);
      assert(rms(pcm.slice(-200)) < rms(pcm.slice(100, 1000)) / 100, 'pcm: tail decays to silence without a persistent echo');
      assert.deepEqual(pcm, makeBattlePCM(['fire', 'impact', 'collapse'][i]), 'pcm: generation repeats without clock or random state');
    }
    const crossing = p => p.reduce((n, v, i) => n + (i > 0 && v * p[i - 1] < 0 ? 1 : 0), 0) / p.length;
    assert(crossing(clips[0]) > crossing(clips[1]) * 5 && crossing(clips[2]) > crossing(clips[1]) * 5, 'pcm: cannon, low explosion and masonry have distinct spectra and lengths');
  },
  async lazy() {
    const ctx = new FakeContext(); let builds = 0;
    const audio = new BattleAudio(() => {}, () => { builds++; return ctx; });
    audio.setActive(true); cue(audio);
    assert.equal(builds, 0, 'lazy: opening and ordinary gameplay create no context or source');
    assert.deepEqual(audio.status(), { enabled: false, state: 'off' });
    toggle(audio);
    assert.equal(ctx.resumes[0]?.gesture, true, 'lazy: first resume remains on the native gesture stack');
    assert.equal(ctx.started.length, 0, 'lazy: no source starts before running is confirmed');
    cue(audio); assert.equal(ctx.started.length, 0, 'lazy: events arriving during unlock are discarded');
    await drain(); assert.deepEqual(audio.status(), { enabled: true, state: 'on' });
    for (let i = 0; i < 20; i++) { cue(audio); toggle(audio); audio.reset(); toggle(audio); await drain(); }
    assert.equal(builds, 1, 'lazy: repeated mute and restart retain exactly one context');
    assert.equal(ctx.buffers.length, 3, 'lazy: stable frames and toggles never regenerate PCM buffers');
    assert.equal(ctx.buffers.reduce((n, b) => n + b.length, 0), 37485);
    assert(ctx.buffers.every(b => b.numberOfChannels === 1 && b.sampleRate === 22050));
    const debug = audio.debug(); debug.played.fill(999); debug.pending = 999;
    assert.notEqual(audio.debug().played[0], 999, 'lazy: instrumentation returns copies');
    audio.dispose(); assert.equal(ctx.closes, 1); assert.equal(ctx.connected(), 0);
    toggle(audio); assert.equal(builds, 1, 'lazy: disposed controller cannot create another context');
  },
  async fire_events() {
    const { audio, ctx } = await setup(), w = fixture();
    for (let i = 0; i < 6; i++) { cue(audio, w, [fire(w, i)]); ctx.finish(); }
    assert.deepEqual(counts(ctx), [6, 0, 0], 'fire_events: six supported visible vehicle and artillery kinds make cannon cues');
    let seen = 0;
    cue(audio, w, [fire(w)], { visibleUnit(u) { seen++; assert.equal(u, w.units[0]); return true; }, visibleAt() { throw Error('unexpected different visibility'); } }); ctx.finish();
    assert.equal(seen, 1, 'fire_events: source visibility is delegated to the existing view');
    const before = ctx.started.length;
    cue(audio, w, [fire(w)], hidden);
    assert.equal(ctx.started.length, before, 'fire_events: hidden sources never reveal themselves through sound');
    for (const i of [6, 7]) cue(audio, w, [fire(w, i)]);
    w.units[1].fireAmmo = SHELL_SMOKE; cue(audio, w, [fire(w, 1)]);
    assert.equal(ctx.started.length, before, 'fire_events: infantry, observers and smoke fire remain excluded');
    for (const bad of [{ ...fire(w), unit: 99 }, { ...fire(w), unit: 0 }, { ...fire(w), unit: 1.5 }, { ...fire(w), x: -1 }, { ...fire(w), x: NaN }, { ...fire(w), x: 1024 }]) cue(audio, w, [bad]);
    w.units[0].alive = false; cue(audio, w, [fire(w)]); w.units[0].alive = true; w.units[0].kind = 99; cue(audio, w, [fire(w)]);
    assert.equal(ctx.started.length, before, 'fire_events: invalid, dead, misplaced and unknown sources are silent'); audio.dispose();
  },
  async smoke_last() {
    const { audio, ctx } = await setup(), w = fixture();
    w.occ.fill(0); w.blds = []; w.shells = []; w.units = [w.units[1]];
    const gun = w.units[0]; Object.assign(gun, { id: 1, order: 3, target: 1, tx: 12, tz: 3, cooldown: 0, fireAmmo: SHELL_SMOKE });
    step(w, []);
    assert.equal(w.events.filter(e => e.e === 'fire').length, 1, 'smoke_last: actual simulation emits the final smoke fire event');
    assert.equal(gun.fireAmmo, undefined, 'smoke_last: actual final shot clears the transient unit ammo');
    assert.equal(w.shells[0]?.kind, SHELL_SMOKE); assert.equal(w.shells[0]?.t, 1);
    cue(audio, w, w.events);
    assert.equal(ctx.started.length, 0, 'smoke_last: final smoke shot remains silent after simulation clears unit ammo'); audio.dispose();
  },
  async impact_events() {
    const { audio, ctx } = await setup(), w = fixture(); let seen = [];
    for (const kind of [SHELL_AP, SHELL_HE]) { cue(audio, w, [{ ...impact, kind }], { visibleUnit: visible.visibleUnit, visibleAt(x, z) { seen.push([x, z]); return true; } }); ctx.finish(); }
    assert.deepEqual(counts(ctx), [0, 2, 0], 'impact_events: visible AP and HE impacts each produce one explosion');
    assert.deepEqual(seen, [[512, 768], [512, 768]], 'impact_events: view receives the original SUB coordinates');
    const before = ctx.started.length; cue(audio, w, [impact], hidden);
    assert.equal(ctx.started.length, before, 'impact_events: hidden impacts are silent');
    for (const kind of [SHELL_SMALL, SHELL_SMOKE, -1, 99]) cue(audio, w, [{ ...impact, kind }]);
    assert.equal(ctx.started.length, before, 'impact_events: small arms and smoke never use explosion audio');
    for (const fields of [{ x: -1 }, { x: 8192 }, { z: NaN }, { z: 10.5 }, { bld: -1 }, { bld: 100 }, { bld: 0.5 }]) cue(audio, w, [{ ...impact, ...fields }]);
    cue(audio, w, [{ e: 'kill', unit: 1 }, { e: 'build', bld: 1 }]);
    assert.equal(ctx.started.length, before, 'impact_events: malformed impacts, kill and build never duplicate explosions'); audio.dispose();
  },
  async collapse_events() {
    const { audio, ctx } = await setup(), w = fixture(), event = { e: 'stage', bld: 1, stage: STAGE_RUBBLE }; let seen;
    cue(audio, w, [event], { visibleUnit: visible.visibleUnit, visibleAt(x, z) { seen = [x, z]; return true; } }); ctx.finish();
    assert.deepEqual(counts(ctx), [0, 0, 1], 'collapse_events: a visible valid building first becoming rubble has one collapse');
    assert.deepEqual(seen, [1792, 1920], 'collapse_events: visibility uses the building center in SUB coordinates');
    cue(audio, w, [event, event]); ctx.finish(); cue(audio, w, [event]);
    assert.deepEqual(counts(ctx), [0, 0, 1], 'collapse_events: duplicate collapse is suppressed across frames');
    cue(audio, w, [{ ...event, bld: 2 }], hidden); cue(audio, w, [{ ...event, bld: 2 }]);
    assert.deepEqual(counts(ctx), [0, 0, 1], 'collapse_events: a hidden collapse cannot replay after visibility changes');
    cue(audio, w, [{ ...event, bld: 3, stage: 1 }]);
    assert.deepEqual(counts(ctx), [0, 0, 1], 'collapse_events: a roofless stage is not a collapse');
    w.blds[2].hp = 100;
    for (const e of [{ ...event, bld: 0 }, { ...event, bld: 100 }, { ...event, bld: 1.5 }, { ...event, bld: 3 }, { ...event, bld: 3, stage: 1 }]) cue(audio, w, [e]);
    w.blds[2].hp = 0; w.blds[2].x = -1; cue(audio, w, [{ ...event, bld: 3 }]);
    assert.deepEqual(counts(ctx), [0, 0, 1], 'collapse_events: non-rubble, living and invalid buildings have no collapse');
    audio.reset(); cue(audio, w, [event]); assert.deepEqual(counts(ctx), [0, 0, 2], 'collapse_events: a reset accepts the next world collapse'); audio.dispose();
  },
  async capacity() {
    const { audio, ctx } = await setup(), w = fixture(), events = Array.from({ length: 100 }, () => ({ ...impact }));
    audio.enqueue(w, events, visible);
    assert.equal(audio.debug().pending, 8, 'capacity: event queue never exceeds eight');
    audio.flush(); assert.equal(ctx.started.length, 4, 'capacity: each rendered frame starts at most four sounds');
    assert.equal(audio.debug().pending, 0, 'capacity: overflow never becomes a later-frame history backlog');
    audio.flush(); assert.equal(ctx.started.length, 4);
    cue(audio, w, events); assert.equal(audio.debug().voices, 8, 'capacity: eight simultaneous voices is the hard ceiling');
    cue(audio, w, events); assert.equal(ctx.started.length, 8, 'capacity: saturated voices drop incoming sounds');
    assert.equal(ctx.connected(), 17, 'capacity: actual connected graph is one master plus eight source-gain pairs');
    assert(ctx.peakNodes <= 17, 'capacity: graph never briefly exceeds the node budget');
    assert(ctx.started.every(s => s.playbackRate.value === 1), 'capacity: accelerated simulation never changes playback pitch');
    assert.equal(ctx.nodes.find(n => n.type === 'master').gain.value, 0.1, 'capacity: eight coherent full-scale voices remain safely below unity');
    for (let frame = 0; frame < 1000; frame++) { ctx.currentTime += 0.1; ctx.finish(); cue(audio, w, events); }
    ctx.finish();
    assert.deepEqual([audio.debug().pending, audio.debug().voices, ctx.connected()], [0, 0, 1], 'capacity: long-running natural cleanup returns to the idle graph');
    assert.equal(ctx.buffers.length, 3, 'capacity: long-running stable frames reuse exactly three buffers');
    assert(audio.debug().peakPending <= 8 && audio.debug().peakVoices <= 8 && audio.debug().peakNodes <= 17); audio.dispose();
  },
  async rate() {
    const { audio, ctx } = await setup(), w = fixture(), burst = Array.from({ length: 8 }, () => ({ ...impact }));
    cue(audio, w, burst); ctx.finish(); cue(audio, w, burst); ctx.finish();
    assert.equal(ctx.started.length, 8, 'rate: fresh bucket permits eight starts across two frames');
    cue(audio, w, burst); ctx.finish();
    assert.equal(ctx.started.length, 8, 'rate: finished short voices cannot bypass the audio-clock start budget');
    audio.reset(); toggle(audio); toggle(audio); await drain(); cue(audio, w, burst);
    assert.equal(ctx.started.length, 8, 'rate: reset and repeated mute cannot refill the start budget');
    ctx.currentTime = 0.09; cue(audio, w, burst); ctx.finish();
    assert.equal(ctx.started.length, 9, 'rate: audio time refills twelve tokens per second');
    audio.flush(); assert.equal(ctx.started.length, 9, 'rate: dropped events cannot play when tokens return');
    ctx.currentTime = 100; cue(audio, w, burst); ctx.finish(); cue(audio, w, burst); ctx.finish(); cue(audio, w, burst);
    assert.equal(ctx.started.length, 17, 'rate: a long idle interval still replenishes at most eight starts'); audio.dispose();
  },
  async lifecycle() {
    const { audio, ctx } = await setup(), w = fixture();
    for (const action of ['silence', 'reset', 'inactive', 'mute']) {
      if (!audio.status().enabled) { toggle(audio); await drain(); }
      audio.setActive(true); await drain(); cue(audio, w); audio.enqueue(w, [impact], visible);
      if (action === 'inactive') audio.setActive(false); else if (action === 'mute') toggle(audio); else audio[action]();
      assert.deepEqual([audio.debug().pending, audio.debug().voices, ctx.connected()], [0, 0, 1], 'lifecycle: every stop path immediately removes queue and source/gain nodes');
      assert(ctx.started.every(s => s.ended && s.onended === null), 'lifecycle: old sources stop and release their callbacks');
      if (action === 'inactive' || action === 'mute') {
        assert.equal(ctx.state, 'suspended', 'lifecycle: inactive and muted contexts suspend'); cue(audio, w);
        assert.equal(audio.debug().voices, 0, 'lifecycle: inactive cues are discarded');
      }
      await drain();
    }
    toggle(audio); audio.setActive(true); await drain();
    const count = ctx.started.length; audio.flush(); assert.equal(ctx.started.length, count, 'lifecycle: resuming never flushes historical events');
    audio.dispose(); assert.equal(ctx.connected(), 0, 'lifecycle: disposal also disconnects the master');
  },
  async failures() {
    const unsupported = new BattleAudio(); unsupported.setActive(true); assert.doesNotThrow(() => toggle(unsupported));
    assert.deepEqual(unsupported.status(), { enabled: false, state: 'unavailable' }, 'failures: unsupported Web Audio reports unavailable without breaking input');
    const constructor = new BattleAudio(() => {}, () => { throw Error('constructor'); });
    assert.doesNotThrow(() => toggle(constructor)); assert.equal(constructor.status().state, 'unavailable', 'failures: constructor rejection has an understandable state');
    for (const resume of ['throw', 'reject', 'no-running']) {
      const { audio, ctx } = await setup({ resume }); cue(audio);
      assert.deepEqual(audio.status(), { enabled: false, state: 'unavailable' }, 'failures: failed resume never pretends audio is enabled');
      assert.equal(ctx.started.length, 0); assert.equal(ctx.connected(), 1); audio.dispose();
    }
    for (const failure of ['master', 'buffer']) {
      const { audio, ctx } = await setup({ failure }); cue(audio);
      assert.equal(audio.status().state, 'unavailable', 'failures: graph or PCM construction failure is contained');
      ctx.failure = null; toggle(audio); await drain(); cue(audio);
      assert.equal(audio.status().state, 'unavailable', 'failures: partial initialization is never reused as a working context'); audio.dispose();
    }
    const { audio, ctx } = await setup(); ctx.transition('closed'); toggle(audio); cue(audio);
    assert.deepEqual(audio.status(), { enabled: false, state: 'unavailable' }, 'failures: externally closed contexts are never reused on page restoration');
    assert.equal(audio.debug().contexts, 1); assert.equal(ctx.started.length, 0); audio.dispose();
  },
  async cleanup_failures() {
    for (const failure of ['source', 'gain', 'source-connect', 'gain-connect', 'start']) {
      const { audio, ctx } = await setup(); ctx.failure = failure; cue(audio);
      assert.deepEqual([audio.debug().pending, audio.debug().voices, ctx.connected()], [0, 0, 1], 'cleanup_failures: partially created or failed sources leave no connected voice nodes');
      assert.equal(audio.status().state, 'unavailable', 'cleanup_failures: source failures report unavailable safely'); audio.dispose();
    }
    for (const suspend of ['throw', 'reject']) {
      const { audio, ctx } = await setup({ suspend }); cue(audio); toggle(audio); await drain();
      assert.equal(audio.status().state, 'off', 'cleanup_failures: suspension failure cannot revive muted output');
      assert.equal(ctx.nodes.find(n => n.type === 'master').gain.value, 0);
      assert.equal(ctx.connected(), 1); audio.dispose();
    }
    const { audio, ctx } = await setup(); cue(audio); ctx.failure = 'stop'; audio.reset();
    assert.deepEqual([audio.debug().voices, ctx.connected()], [0, 1], 'cleanup_failures: a throwing stop still disconnects both nodes'); audio.dispose();
  },
  async races() {
    {
      const { audio, ctx } = await setup({ resume: 'defer' }); cue(audio);
      assert.equal(ctx.started.length, 0); toggle(audio); ctx.resumes[0].resolve(); await drain(); cue(audio);
      assert.deepEqual(audio.status(), { enabled: false, state: 'off' }, 'races: late resume cannot resurrect a muted controller');
      assert.equal(ctx.started.length, 0); assert.equal(ctx.state, 'suspended'); audio.dispose();
    }
    for (const outcome of ['resolve', 'reject']) {
      const { audio, ctx } = await setup({ resume: 'defer' }); toggle(audio); toggle(audio); ctx.resumes[1].resolve(); await drain();
      if (outcome === 'resolve') ctx.resumes[0].resolve(); else ctx.resumes[0].reject(Error('old denial'));
      await drain(); cue(audio);
      assert.deepEqual(audio.status(), { enabled: true, state: 'on' }, 'races: an old resume outcome cannot disable a newer enable');
      assert.equal(ctx.started.length, 1); audio.dispose();
    }
    {
      const { audio, ctx } = await setup({ resume: 'defer' }); cue(audio); audio.reset(); ctx.resumes[0].resolve(); await drain(); audio.flush();
      assert.equal(ctx.started.length, 0, 'races: reset during unlock cannot preserve old cues'); cue(audio); assert.equal(ctx.started.length, 1); audio.dispose();
    }
    {
      const { audio, ctx } = await setup({ resume: 'defer' }); audio.setActive(false); ctx.resumes[0].resolve(); await drain(); cue(audio);
      assert.deepEqual(audio.status(), { enabled: true, state: 'paused' }, 'races: late unlock while inactive remains silent and suspended');
      assert.equal(ctx.state, 'suspended'); assert.equal(ctx.started.length, 0); audio.dispose();
    }
    {
      const { audio, ctx } = await setup({ resume: 'defer' }, false);
      assert.equal(ctx.resumes[0].gesture, true, 'races: enabling in build phase unlocks on the actual gesture');
      ctx.resumes[0].resolve(); await drain(); assert.equal(ctx.state, 'suspended');
      audio.setActive(true); ctx.resumes[1].resolve(); await drain(); cue(audio);
      assert.deepEqual(audio.status(), { enabled: true, state: 'on' }, 'races: build-phase enable resumes when battle becomes active');
      assert.equal(ctx.started.length, 1); audio.dispose();
    }
    {
      const { audio, ctx } = await setup({ suspend: 'defer' }); toggle(audio); toggle(audio); await drain(); ctx.suspends[0].resolve(); await drain(); cue(audio);
      assert.deepEqual(audio.status(), { enabled: true, state: 'on' }, 'races: a late suspend reconciles to the newest enabled intent');
      assert.equal(ctx.started.length, 1); audio.dispose();
    }
    {
      const { audio, ctx } = await setup({ resume: 'defer' }); audio.dispose(); ctx.resumes[0].resolve(); await drain(); cue(audio);
      assert.equal(ctx.started.length, 0, 'races: disposing during unlock cannot bring the graph back'); assert.equal(ctx.connected(), 0);
    }
  },
  async readonly() {
    const { audio, ctx } = await setup(), w = fixture(); w.events = [fire(w), impact, { e: 'stage', bld: 1, stage: 2 }];
    const before = structuredClone(w), hash = hashWorld(w);
    audio.enqueue(w, w.events, visible); audio.flush(); ctx.finish(); audio.reset();
    assert.deepEqual(w, before, 'readonly: complete world including events and RNG remains unchanged'); assert.equal(hashWorld(w), hash);
    const guarded = new Proxy(w, { get(target, key) { assert.notEqual(key, 'rng', 'readonly: renderer never reads the simulation RNG'); return target[key]; }, set() { assert.fail('readonly: renderer never writes world properties'); } });
    audio.enqueue(guarded, w.events, visible); audio.flush(); ctx.finish(); audio.dispose();
  },
  async replay() {
    for (const mode of ['on', 'off', 'mute', 'denied', 'reset', 'map']) {
      const { audio, ctx } = await setup(mode === 'denied' ? { resume: 'reject' } : {});
      if (mode === 'off') toggle(audio);
      const commands = mode === 'map' ? [{ tick: 0, cmd: { t: 'map', id: 1, vegetation: 1 } }, ...SCRIPT] : SCRIPT;
      const w = createWorld(SCRIPT_SEED), expected = runLog(createWorld(SCRIPT_SEED), commands, 1200);
      for (let tick = 0; tick < 1200; tick++) {
        ctx.currentTime = tick / 20;
        step(w, commands.filter(c => c.tick === tick).map(c => c.cmd));
        if (mode === 'mute' && tick % 100 === 0) { toggle(audio); await drain(); }
        if (mode === 'reset' && tick % 99 === 0) audio.reset();
        const original = structuredClone(w); audio.enqueue(w, w.events, visible); audio.flush(); ctx.finish();
        assert.deepEqual(w, original, 'replay: every tick audio preserves all world fields and event data');
        if (tick === 599 && mode !== 'map') assert.equal(hashWorld(w), '29d7ef19', 'replay: old SCRIPT600 complete hash is frozen');
      }
      assert.equal(hashWorld(w), mode === 'map' ? hashWorld(expected) : '89aa0b92', 'replay: old SCRIPT1200 and explicit map replay hashes survive every audio state');
      assert.deepEqual(w, expected, 'replay: full world and RNG match direct simulation'); audio.dispose();
    }
  },
};
for (const [name, run] of Object.entries(groups)) if (!only || only === name) {
  try { await run(); console.log(`OK audio/${name}`); }
  catch (error) { console.error(`NG audio/${name}`); throw error; }
}
assert(!only || only in groups, 'requested audio guard group exists');
console.log('audio: requested Node guards passed; browser playback and actual speaker listening are separate');
