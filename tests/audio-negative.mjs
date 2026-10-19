// R117: each isolated mutant must fail its intended semantic assertion first.
// Mutations live only in a disposable OS temp directory, never in the working tree.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = resolve(fileURLToPath(new URL('..', import.meta.url))), temp = mkdtempSync(join(tmpdir(), 'r117-negative-'));
const mutants = [
  ['clip_length', 'pcm', 'const LENGTHS = [4410, 13230, 19845];', 'const LENGTHS = [5513, 13230, 19845];', 'pcm: three independently fixed short clip lengths'],
  ['nan_pcm', 'pcm', 'pcm[i] = wave * envelope;', 'pcm[i] = NaN;', 'pcm: every generated sample is finite'],
  ['silent_pcm', 'pcm', 'pcm[i] = wave * envelope;', 'pcm[i] = 0;', 'pcm: each clip has audible nonzero energy'],
  ['dc_pcm', 'pcm', 'const dc = sum / weight;', 'const dc = 0;', 'pcm: finite clip has no sustained DC'],
  ['eager_context', 'lazy', 'this.onChange = onChange; this.makeContext = makeContext;', 'this.onChange = onChange; this.makeContext = makeContext; this.context = this.makeContext();', 'lazy: opening and ordinary gameplay create no context or source'],
  ['deferred_gesture', 'lazy', '      this.resume();\n    } catch', '      void Promise.resolve().then(() => this.resume());\n    } catch', 'lazy: first resume remains on the native gesture stack'],
  ['early_running', 'lazy', 'const serial = ++this.resumeSerial; this.pendingResume = true; this.ready = false;', 'const serial = ++this.resumeSerial; this.pendingResume = true; this.ready = true;', 'lazy: events arriving during unlock are discarded'],
  ['many_contexts', 'lazy', '      if (!this.context) {', '      if (true) {', 'lazy: repeated mute and restart retain exactly one context'],
  ['frame_buffers', 'lazy', '  flush(): void {\n    this.frameStarts = 0;', '  flush(): void {\n    if (this.context) this.context.createBuffer(1, 1, 22050);\n    this.frameStarts = 0;', 'lazy: stable frames and toggles never regenerate PCM buffers'],
  ['missing_fire', 'fire_events', '        kind = 0;', '        kind = -1;', 'fire_events: six supported visible vehicle and artillery kinds make cannon cues'],
  ['hidden_fire', 'fire_events', '!visibility.visibleUnit(u)', '(!visibility.visibleUnit(u) && false)', 'fire_events: hidden sources never reveal themselves through sound'],
  ['infantry_fire', 'fire_events', '!artillery(u.kind)', 'false', 'fire_events: infantry, observers and smoke fire remain excluded'],
  ['smoke_fire', 'fire_events', 'u.fireAmmo === SHELL_SMOKE', 'false', 'fire_events: infantry, observers and smoke fire remain excluded'],
  ['last_smoke', 'smoke_last', '        if (world.shells.some(s => s.shooter === u.id && s.sx === event.x && s.sz === event.z && s.t === 1 && s.kind === SHELL_SMOKE)) continue;', '', 'smoke_last: final smoke shot remains silent after simulation clears unit ammo'],
  ['hidden_impact', 'impact_events', '!visibility.visibleAt(event.x, event.z)', '(!visibility.visibleAt(event.x, event.z) && false)', 'impact_events: hidden impacts are silent'],
  ['small_explosion', 'impact_events', '(event.kind !== SHELL_AP && event.kind !== SHELL_HE)', 'false', 'impact_events: small arms and smoke never use explosion audio'],
  ['roof_collapse', 'collapse_events', 'event.stage !== STAGE_RUBBLE', 'false', 'collapse_events: a roofless stage is not a collapse'],
  ['duplicate_collapse', 'collapse_events', 'this.collapsed.has(b)', 'false', 'collapse_events: duplicate collapse is suppressed across frames'],
  ['hidden_collapse', 'collapse_events', 'if (!visibility.visibleAt((b.x + b.w / 2) * SUB, (b.z + b.d / 2) * SUB)) continue;', 'if (!visibility.visibleAt((b.x + b.w / 2) * SUB, (b.z + b.d / 2) * SUB) && false) continue;', 'collapse_events: a hidden collapse cannot replay after visibility changes'],
  ['live_collapse', 'collapse_events', 'b.hp > 0 || this.collapsed.has(b)', 'false || this.collapsed.has(b)', 'collapse_events: non-rubble, living and invalid buildings have no collapse'],
  ['queue_overflow', 'capacity', 'this.pendingCount < CAPACITY', 'this.pendingCount < CAPACITY + 1', 'capacity: event queue never exceeds eight'],
  ['frame_overflow', 'capacity', 'STARTS_PER_FRAME = 4;', 'STARTS_PER_FRAME = 8;', 'capacity: each rendered frame starts at most four sounds'],
  ['history_backlog', 'capacity', 'const count = this.pendingCount; this.pendingCount = 0;', 'const count = this.pendingCount;', 'capacity: overflow never becomes a later-frame history backlog'],
  ['pitch_speedup', 'capacity', 'source.playbackRate.value = 1;', 'source.playbackRate.value = 2;', 'capacity: accelerated simulation never changes playback pitch'],
  ['loud_master', 'capacity', 'const MASTER_GAIN = 0.1;', 'const MASTER_GAIN = 0.2;', 'capacity: eight coherent full-scale voices remain safely below unity'],
  ['no_rate_limit', 'rate', 'this.tokens < 1', 'false', 'rate: finished short voices cannot bypass the audio-clock start budget'],
  ['wrong_refill', 'rate', 'const REFILL_PER_SECOND = 12;', 'const REFILL_PER_SECOND = 24;', 'rate: audio time refills twelve tokens per second'],
  ['reset_tail', 'lifecycle', 'reset(): void { this.silence();', 'reset(): void {', 'lifecycle: every stop path immediately removes queue and source/gain nodes'],
  ['source_leak', 'lifecycle', 'try { voice.source.disconnect(); } catch { /* already disconnected */ }', '', 'lifecycle: every stop path immediately removes queue and source/gain nodes'],
  ['gain_leak', 'lifecycle', 'try { voice.gain.disconnect(); } catch { /* already disconnected */ }', '', 'lifecycle: every stop path immediately removes queue and source/gain nodes'],
  ['tail_not_stopped', 'lifecycle', 'if (stop) try { voice.source.stop(); }', 'if (stop) try {}', 'lifecycle: old sources stop and release their callbacks'],
  ['swallow_resume_denial', 'failures', '}, () => { if (serial === this.resumeSerial && !this.disposed) this.fail(); });', '}, () => { if (serial === this.resumeSerial && !this.disposed) this.ready = true; });', 'failures: failed resume never pretends audio is enabled'],
  ['partial_reuse', 'failures', '      if (!this.master || this.buffers.length !== 3) { this.fail(); return; }', '', 'failures: partial initialization is never reused as a working context'],
  ['failed_voice_leak', 'cleanup_failures', '      if (voice) this.release(voice, true);\n      else', '      if (voice) { voice.released = true; this.voices[this.voices.indexOf(voice)] = null; }\n      else', 'cleanup_failures: partially created or failed sources leave no connected voice nodes'],
  ['stale_rejection', 'races', 'if (serial === this.resumeSerial && !this.disposed) this.fail();', 'if (!this.disposed) this.fail();', 'races: an old resume outcome cannot disable a newer enable'],
  ['world_write', 'readonly', '    if (!this.canPlay()) return;\n    for (const event of events)', '    if (!this.canPlay()) return;\n    world.rng++;\n    for (const event of events)', 'readonly: complete world including events and RNG remains unchanged'],
  ['rng_read', 'readonly', '    if (!this.canPlay()) return;\n    for (const event of events)', '    if (!this.canPlay()) return;\n    void world.rng;\n    for (const event of events)', 'readonly: renderer never reads the simulation RNG'],
];
try {
  for (const [name, group, from, to, wanted] of mutants) {
    const dir = join(temp, name); mkdirSync(join(dir, 'tests'), { recursive: true }); mkdirSync(join(dir, 'src/render'), { recursive: true });
    cpSync(join(root, 'src/sim'), join(dir, 'src/sim'), { recursive: true });
    cpSync(join(root, 'tests/audio.mjs'), join(dir, 'tests/audio.mjs'));
    writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
    const source = readFileSync(join(root, 'src/render/audio.ts'), 'utf8');
    assert.equal(source.split(from).length, 2, `${name}: unique mutation anchor`);
    writeFileSync(join(dir, 'src/render/audio.ts'), source.replace(from, to));
    const result = spawnSync(process.execPath, [join(dir, 'tests/audio.mjs'), group], { encoding: 'utf8', timeout: 120000 });
    const output = `${result.stdout}\n${result.stderr}`;
    assert.equal(result.error, undefined, `${name}: child starts and completes`); assert.equal(result.signal, null, `${name}: no timeout/signal`);
    assert.notEqual(result.status, 0, `${name}: mutant must fail`);
    const first = /AssertionError \[ERR_ASSERTION\]: ([^\n]+)/.exec(output)?.[1];
    assert.equal(first, wanted, `${name}: first red must be intended semantic assertion, not startup\n${output.slice(-2500)}`);
    console.log(`OK audio-negative/${name}: ${first}`);
  }
} finally { rmSync(temp, { recursive: true, force: true }); }
console.log(`audio-negative: ${mutants.length} isolated mutants rejected at their intended first assertions`);
