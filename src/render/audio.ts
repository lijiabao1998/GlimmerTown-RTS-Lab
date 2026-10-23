// R117: optional presentation-only audio. Nothing is created until a native HUD gesture.
// Three finite mono buffers, one master gain and at most eight source/gain pairs.
import { SUB, SHELL_AP, SHELL_HE, SHELL_SMOKE, STAGE_RUBBLE,
  UK_TANK, UK_HOWITZER, UK_ATGUN, UK_MORTAR, UK_LIGHT, UK_HEAVY,
  type World, type Unit, type Building, type SimEvent } from '../sim/world.ts';

export type BattleSound = 'fire' | 'impact' | 'collapse';
export type AudioState = 'off' | 'on' | 'paused' | 'pending' | 'unavailable';
export interface AudioVisibility { visibleUnit(u: Unit): boolean; visibleAt(x: number, z: number): boolean }
export const AUDIO_SAMPLE_RATE = 22050;
const KINDS: readonly BattleSound[] = ['fire', 'impact', 'collapse'];
const LENGTHS = [4410, 13230, 19845]; // 0.20 + 0.60 + 0.90 seconds = 37,485 samples.
const MASTER_GAIN = 0.1; // PCM <= 1, voice gain <= 1: even eight coherent voices peak <= 0.8.
const CAPACITY = 8, STARTS_PER_FRAME = 4;
const REFILL_PER_SECOND = 12;

// Local integer noise has no relationship to simulation randomness. Sine and noise are
// shaped differently for a dry cannon crack, a low explosion, and staggered masonry.
export function makeBattlePCM(kind: BattleSound): Float32Array<ArrayBuffer> {
  const mode = KINDS.indexOf(kind), length = LENGTHS[mode];
  const pcm = new Float32Array(length);
  let noise = 0x4f1bbcdc ^ (mode * 0x9e3779b9), low = 0;
  for (let i = 0; i < length; i++) {
    noise ^= noise << 13; noise ^= noise >>> 17; noise ^= noise << 5;
    const white = (noise >>> 0) / 2147483648 - 1;
    low += (white - low) * (mode === 0 ? 0.24 : 0.08);
    const t = i / AUDIO_SAMPLE_RATE, k = i / (length - 1);
    const edge = Math.min(1, i / 80, (length - 1 - i) / 360);
    const envelope = edge * (1 - k) * (1 - k);
    const wave = mode === 0 ? 0.55 * white + 0.45 * Math.sin(2 * Math.PI * (150 * t - 160 * t * t))
      : mode === 1 ? 0.65 * low + 0.35 * Math.sin(2 * Math.PI * (78 * t - 30 * t * t))
        : (0.55 * white + 0.45 * low) * (0.35 + 0.65 * Math.pow(Math.sin(2 * Math.PI * 11 * t), 2));
    pcm[i] = wave * envelope;
  }
  // Remove the finite clip's DC component without disturbing its zero-valued endpoints.
  let sum = 0, weight = 0;
  for (let i = 0; i < length; i++) { const e = Math.sin(Math.PI * i / (length - 1)); sum += pcm[i]; weight += e * e; }
  const dc = sum / weight;
  for (let i = 1; i < length - 1; i++) { const e = Math.sin(Math.PI * i / (length - 1)); pcm[i] = (pcm[i] - dc * e * e) * 0.9; }
  return pcm;
}

interface Voice { source: AudioBufferSourceNode; gain: GainNode; connected: number; released: boolean }
const positionOK = (w: World, x: number, z: number) => Number.isInteger(x) && Number.isInteger(z) && x >= 0 && z >= 0 && x < w.n * SUB && z < w.n * SUB;
const artillery = (kind: number) => kind === UK_TANK || kind === UK_HOWITZER || kind === UK_ATGUN || kind === UK_MORTAR || kind === UK_LIGHT || kind === UK_HEAVY;

export class BattleAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffers: AudioBuffer[] = [];
  private enabled = false;
  private active = false;
  private unavailable = false;
  private disposed = false;
  private ready = false;
  private resumeSerial = 0;
  private pendingResume = false;
  private suspendSerial = 0;
  private suspending = false;
  private pending = new Uint8Array(CAPACITY);
  private pendingCount = 0;
  private voices: (Voice | null)[] = Array(CAPACITY).fill(null);
  private collapsed = new WeakSet<Building>();
  private contexts = 0;
  private bufferBuilds = 0;
  private starts = 0;
  private frameStarts = 0;
  private dropped = 0;
  private peakPending = 0;
  private peakVoices = 0;
  private peakNodes = 0;
  private played = [0, 0, 0];
  private tokens = CAPACITY;
  private tokenAt = 0;
  private onChange: () => void;
  private makeContext: () => AudioContext;

  constructor(onChange: () => void = () => {}, makeContext: () => AudioContext = () => new AudioContext()) {
    this.onChange = onChange; this.makeContext = makeContext;
  }

  status(): { enabled: boolean; state: AudioState } {
    const state = this.unavailable ? 'unavailable' : !this.enabled ? 'off' : !this.active ? 'paused'
      : this.canPlay() ? 'on' : 'pending';
    return { enabled: this.enabled, state };
  }

  // Returns copies only; callers cannot mutate the queue, graph, clips, or desired state.
  debug() {
    return { ...this.status(), active: this.active, contextState: this.context?.state ?? 'absent', contexts: this.contexts,
      bufferBuilds: this.bufferBuilds, pcmSamples: this.buffers.reduce((n, b) => n + b.length, 0),
      pending: this.pendingCount, voices: this.voiceCount(), connectedNodes: this.nodeCount(), starts: this.starts,
      frameStarts: this.frameStarts, dropped: this.dropped, peakPending: this.peakPending,
      peakVoices: this.peakVoices, peakNodes: this.peakNodes, rateTokens: this.tokens, played: [...this.played] };
  }

  toggleFromGesture(): void {
    if (this.disposed) return;
    if (this.enabled) {
      this.enabled = false; this.resumeSerial++; this.pendingResume = false;
      this.silence(); this.suspend(); this.changed(); return;
    }
    if (this.context?.state === 'closed') { this.fail(); return; }
    this.unavailable = false; this.enabled = true; this.ready = false;
    this.silence();
    try {
      if (!this.context) {
        this.context = this.makeContext(); this.contexts++; this.tokenAt = this.context.currentTime;
        this.context.onstatechange = () => {
          if (this.context?.state === 'closed') this.fail();
          else if (this.context?.state !== 'running') { this.ready = false; this.silence(); this.changed(); }
          else this.changed();
        };
        this.master = this.context.createGain(); this.master.gain.value = 0;
        this.master.connect(this.context.destination);
        for (const kind of KINDS) {
          const pcm = makeBattlePCM(kind), buffer = this.context.createBuffer(1, pcm.length, AUDIO_SAMPLE_RATE);
          buffer.copyToChannel(pcm, 0); this.buffers.push(buffer); this.bufferBuilds++;
        }
        this.measure();
      }
      if (!this.master || this.buffers.length !== 3) { this.fail(); return; }
      // This call remains on the original mouse/touch/keyboard click stack, including
      // enabling while paused/building. Suspend only after that unlock has settled.
      this.resume();
    } catch { this.fail(); }
    this.changed();
  }

  setActive(active: boolean): void {
    if (this.disposed || this.active === active) return;
    this.active = active;
    if (!active) { this.silence(); if (!this.pendingResume) this.suspend(); }
    else if (this.enabled && !this.unavailable && !this.pendingResume) this.resume();
    this.changed();
  }

  reset(): void { this.silence(); this.collapsed = new WeakSet<Building>(); }

  silence(): void {
    this.pendingCount = 0; this.frameStarts = 0;
    for (let i = 0; i < this.voices.length; i++) { const voice = this.voices[i]; if (voice) this.release(voice, true); }
  }

  enqueue(world: World, events: readonly SimEvent[], visibility: AudioVisibility): void {
    if (!this.canPlay()) return;
    for (const event of events) {
      let kind = -1;
      if (event.e === 'fire') {
        const u = world.units[event.unit - 1];
        if (!Number.isInteger(event.unit) || !u || u.id !== event.unit || !u.alive || u.hp <= 0 || !artillery(u.kind)
          || u.fireAmmo === SHELL_SMOKE || !positionOK(world, event.x, event.z) || event.x !== u.x || event.z !== u.z || !visibility.visibleUnit(u)) continue;
        // The final smoke order clears u.fireAmmo in step(); its newly emitted shell
        // is still present at t=1. Match the launch, not an older in-flight shell.
        if (world.shells.some(s => s.shooter === u.id && s.sx === event.x && s.sz === event.z && s.t === 1 && s.kind === SHELL_SMOKE)) continue;
        kind = 0;
      } else if (event.e === 'impact') {
        if ((event.kind !== SHELL_AP && event.kind !== SHELL_HE) || !positionOK(world, event.x, event.z)
          || !Number.isInteger(event.bld) || event.bld < 0 || (event.bld > 0 && world.blds[event.bld - 1]?.id !== event.bld)
          || !visibility.visibleAt(event.x, event.z)) continue;
        kind = 1;
      } else if (event.e === 'stage') {
        const b = world.blds[event.bld - 1];
        if (!Number.isInteger(event.bld) || !b || b.id !== event.bld || event.stage !== STAGE_RUBBLE || b.hp > 0 || this.collapsed.has(b)
          || !Number.isInteger(b.x) || !Number.isInteger(b.z) || !Number.isInteger(b.w) || !Number.isInteger(b.d)
          || b.w <= 0 || b.d <= 0 || b.x < 0 || b.z < 0 || b.x + b.w > world.n || b.z + b.d > world.n) continue;
        // Mark all valid collapses immediately: a later visibility change cannot replay
        // a collapse that occurred out of sight or was dropped due to the voice budget.
        this.collapsed.add(b);
        if (!visibility.visibleAt((b.x + b.w / 2) * SUB, (b.z + b.d / 2) * SUB)) continue;
        kind = 2;
      }
      if (kind < 0) continue;
      if (this.pendingCount < CAPACITY) this.pending[this.pendingCount++] = kind;
      else this.dropped++;
    }
    this.measure();
  }

  // Call once after all real-time simulation steps for a rendered frame. Overflow is
  // discarded here, never drained in later frames or made faster at 2x/4x simulation.
  flush(): void {
    this.frameStarts = 0;
    if (!this.canPlay()) { this.pendingCount = 0; return; }
    const now = this.context!.currentTime;
    if (Number.isFinite(now) && now > this.tokenAt) {
      this.tokens = Math.min(CAPACITY, this.tokens + (now - this.tokenAt) * REFILL_PER_SECOND); this.tokenAt = now;
    }
    const count = this.pendingCount; this.pendingCount = 0;
    for (let i = 0; i < count; i++) {
      if (this.frameStarts >= STARTS_PER_FRAME || this.voiceCount() >= CAPACITY || this.tokens < 1) { this.dropped++; continue; }
      this.start(this.pending[i]);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.enabled = false; this.ready = false; this.resumeSerial++; this.pendingResume = false;
    this.silence();
    if (this.context) {
      this.context.onstatechange = null;
      try { const closing = this.context.close(); void closing.catch(() => {}); } catch { /* already closed */ }
    }
    try { this.master?.disconnect(); } catch { /* disconnected */ }
    this.master = null; this.buffers = []; this.changed();
  }

  private changed(): void { this.onChange(); }
  private canPlay(): boolean { return this.enabled && this.active && this.ready && !this.unavailable && !this.disposed && this.context?.state === 'running'; }
  private voiceCount(): number { let n = 0; for (const v of this.voices) if (v) n++; return n; }
  private nodeCount(): number { let n = this.master ? 1 : 0; for (const v of this.voices) if (v) n += v.connected; return n; }
  private measure(): void {
    this.peakPending = Math.max(this.peakPending, this.pendingCount);
    this.peakVoices = Math.max(this.peakVoices, this.voiceCount()); this.peakNodes = Math.max(this.peakNodes, this.nodeCount());
  }

  private resume(): void {
    const context = this.context;
    if (!context || context.state === 'closed' || this.disposed) { this.fail(); return; }
    const serial = ++this.resumeSerial; this.pendingResume = true; this.ready = false;
    try {
      const request = context.resume();
      void request.then(() => {
        if (serial !== this.resumeSerial || this.disposed) {
          if (!this.enabled || !this.active) this.suspend();
          return;
        }
        this.pendingResume = false;
        if (!this.enabled || !this.active) { this.silence(); this.suspend(); }
        else if (context.state === 'running') { this.ready = true; if (this.master) this.master.gain.value = MASTER_GAIN; }
        else if (!this.suspending) this.fail();
        this.changed();
      }, () => { if (serial === this.resumeSerial && !this.disposed) this.fail(); });
    } catch { if (serial === this.resumeSerial) this.fail(); }
  }

  private suspend(): void {
    this.ready = false; if (this.master) this.master.gain.value = 0;
    const context = this.context;
    if (!context || context.state === 'closed' || this.disposed || this.suspending) return;
    const serial = ++this.suspendSerial; this.suspending = true;
    const settled = () => {
      if (serial !== this.suspendSerial) return;
      this.suspending = false;
      // A delayed suspend is allowed to finish, but cannot turn off a newer enable.
      if (this.enabled && this.active && !this.unavailable && !this.disposed && !this.pendingResume) this.resume();
      this.changed();
    };
    try { void context.suspend().then(settled, settled); } catch { settled(); }
  }

  private fail(): void {
    this.unavailable = true; this.enabled = false; this.ready = false;
    this.resumeSerial++; this.pendingResume = false; this.silence(); this.suspend();
    if (this.buffers.length !== 3) {
      try { this.master?.disconnect(); } catch { /* partial initialization */ }
      this.master = null; this.buffers = [];
    }
    this.changed();
  }

  private start(kind: number): void {
    if (!this.canPlay() || !this.context || !this.master || !this.buffers[kind]) return;
    const slot = this.voices.indexOf(null); if (slot < 0) return;
    let source: AudioBufferSourceNode | null = null, gain: GainNode | null = null, voice: Voice | null = null;
    try {
      source = this.context.createBufferSource(); gain = this.context.createGain();
      source.buffer = this.buffers[kind]; source.playbackRate.value = 1; gain.gain.value = 1;
      voice = { source, gain, connected: 0, released: false }; this.voices[slot] = voice;
      source.onended = () => { if (voice) this.release(voice, false); };
      source.connect(gain); voice.connected++; gain.connect(this.master); voice.connected++;
      this.measure(); source.start(); this.tokens--; this.starts++; this.frameStarts++; this.played[kind]++;
    } catch {
      if (voice) this.release(voice, true);
      else { try { source?.disconnect(); } catch { /* partially constructed */ } try { gain?.disconnect(); } catch { /* partially constructed */ } }
      this.fail();
    }
  }

  private release(voice: Voice, stop: boolean): void {
    if (voice.released) return;
    voice.released = true; voice.source.onended = null;
    if (stop) try { voice.source.stop(); } catch { /* already ended/not started */ }
    try { voice.source.disconnect(); } catch { /* already disconnected */ }
    try { voice.gain.disconnect(); } catch { /* already disconnected */ }
    voice.connected = 0;
    const slot = this.voices.indexOf(voice); if (slot >= 0) this.voices[slot] = null;
  }
}
