// R109 pure command routing, placement and DOM lifecycle. Actual geometry/touches use input-browser guards.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createWorld, hashWorld, N, SUB, SIDE_PLAYER, SIDE_ENEMY, UK_HOWITZER, UK_MORTAR, UK_TANK, UK_OBSERVER } from '../src/sim/world.ts';
const read = p => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const sources = { menu: read('../src/ui/commandMenu.ts'), help: read('../src/ui/help.ts') };
const mutations = {
  target: { group: 'target', file: 'menu', from: 'unit?.alive ?', to: 'false ?' },
  eligibility: { group: 'eligibility', file: 'menu', from: 'u.kind === UK_HOWITZER :', to: 'true :' },
  revalidation: { group: 'revalidation', file: 'menu', from: 'return u?.alive &&', to: 'return u &&' },
  placement: { group: 'placement', file: 'menu', from: 'const overlap = obstacles.reduce', to: 'const overlap = [].reduce' },
  oneshot: { group: 'oneshot', file: 'menu', from: 'const target = { ...aim }; close(); on.choose', to: 'const target = { ...aim }; on.choose' },
  disclosure: { group: 'disclosure', file: 'help', from: 'root.innerHTML = gestures ?', to: 'root.innerHTML = false ?' },
};
const mutant = process.argv.find(a => a.startsWith('--mutant='))?.slice(9);
if (mutant) { const m = mutations[mutant]; assert(m, 'known mutation'); assert(sources[m.file].includes(m.from), 'mutation anchor'); sources[m.file] = sources[m.file].replace(m.from, m.to); }
async function load(source, base) {
  const js = stripTypeScriptTypes(source).replace(/from '([^']+)'/g, (_, spec) => `from '${new URL(spec, new URL(base, import.meta.url)).href}'`);
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
}
const { bombardTarget, bombardCommand, menuPosition, initCommandMenu } = await load(sources.menu, '../src/ui/commandMenu.ts');
const { initHelp } = await load(sources.help, '../src/ui/help.ts');
const aim = { x: 18, z: 17 };
function fixture() {
  const w = createWorld(1944), gun = w.units.find(u => u.side === SIDE_PLAYER && u.kind === UK_HOWITZER);
  const tank = w.units.find(u => u.side === SIDE_PLAYER && u.kind === UK_TANK), observer = w.units.find(u => u.side === SIDE_PLAYER && u.kind === UK_OBSERVER);
  const foe = w.units.find(u => u.side === SIDE_ENEMY);
  const mortar = { ...structuredClone(gun), id: w.units.length + 1, kind: UK_MORTAR }; w.units.push(mortar);
  return { w, gun, tank, observer, foe, mortar };
}
const hit = opts => ({ unit: 0, building: null, ground: { x: 15.7, z: 16.1 }, ...opts });
class Element {
  constructor() { this.children = new Map(); this.events = new Map(); this.hidden = false; this.attrs = new Map(); this.style = {}; this.textContent = ''; this.rect = { left: 0, top: 0, right: 196, bottom: 188, width: 196, height: 188 }; }
  set innerHTML(v) { this.html = v; for (const m of v.matchAll(/id="([^"]+)"/g)) this.children.set(m[1], new Element()); }
  setAttribute(k, v) { this.attrs.set(k, v); }
  addEventListener(k, cb) { if (!this.events.has(k)) this.events.set(k, []); this.events.get(k).push(cb); }
  dispatch(k) { const event = { target: this, stopPropagation() {} }; for (const cb of this.events.get(k) ?? []) cb(event); }
  querySelector(s) { return this.children.get(s.slice(1)); }
  contains(t) { return this === t || [...this.children.values()].some(c => c.contains(t)); }
  getBoundingClientRect() { return this.rect; }
  appendChild(el) { this.children.set(el.id, el); }
}
function dom() {
  const body = new Element(), hud = new Element(); body.appendChild(hud);
  globalThis.Node = Element; globalThis.innerWidth = 412; globalThis.innerHeight = 860;
  globalThis.document = { body, createElement: () => new Element(), getElementById: id => id === 'hud' ? hud : hud.children.get(id), querySelector: () => null };
  return { body, hud };
}
const group = {
  target() {
    const { w, gun } = fixture(); gun.x = 5 * SUB + 99; gun.z = 6 * SUB + 1;
    assert.deepEqual(bombardTarget(w, hit({ unit: gun.id, building: [9, 10] })), { x: 5, z: 6 }, 'target: unit cell precedes building/ground');
    assert.deepEqual(bombardTarget(w, hit({ building: [9, 10] })), { x: 9, z: 10 }, 'target: canonical building cell');
    assert.deepEqual(bombardTarget(w, hit({})), { x: 15, z: 16 }, 'target: ground is floored');
    gun.alive = false; assert.deepEqual(bombardTarget(w, hit({ unit: gun.id, building: [9, 10] })), { x: 9, z: 10 }, 'target: dead hit does not steal aim');
    for (const p of [null, { x: -0.1, z: 1 }, { x: N, z: 1 }, { x: 1, z: N }, { x: NaN, z: 1 }, { x: 1, z: Infinity }]) assert.equal(bombardTarget(w, hit({ ground: p })), null, 'target: invalid ground rejected');
  },
  eligibility() {
    const { w, gun, mortar, tank, observer, foe } = fixture(), ids = [gun.id, mortar.id, tank.id, observer.id, foe.id, 999, gun.id];
    assert.deepEqual(bombardCommand(w, ids, aim, 'smoke'), { t: 'fireAt', side: SIDE_PLAYER, ids: [gun.id], ...aim, ammo: 'smoke' }, 'eligibility: smoke only live friendly howitzers');
    assert.deepEqual(bombardCommand(w, ids, aim, 'he'), { t: 'fireAt', side: SIDE_PLAYER, ids: [gun.id, mortar.id], ...aim }, 'eligibility: HE only indirect, deduplicated');
    for (const ammo of ['he', 'smoke']) {
      assert.equal(bombardCommand(w, [tank.id, observer.id, foe.id], aim, ammo), null, 'eligibility: no valid units means no order');
      for (const p of [{ x: -1, z: 0 }, { x: N, z: 0 }, { x: 0.5, z: 1 }, { x: 0, z: NaN }]) assert.equal(bombardCommand(w, [gun.id], p, ammo), null, 'eligibility: invalid frozen cell');
    }
  },
  revalidation() {
    const { w, gun, mortar } = fixture(), ids = new Set([gun.id, mortar.id]);
    const frozen = bombardTarget(w, hit({ unit: gun.id })), old = structuredClone(frozen); gun.x += SUB;
    assert.deepEqual(bombardCommand(w, ids, frozen, 'smoke'), { t: 'fireAt', side: SIDE_PLAYER, ids: [gun.id], ...old, ammo: 'smoke' }, 'revalidation: cell remains frozen');
    gun.alive = false; assert.equal(bombardCommand(w, ids, frozen, 'smoke'), null, 'revalidation: death before choose removes gun');
    gun.alive = true; gun.side = SIDE_ENEMY; assert.equal(bombardCommand(w, ids, frozen, 'smoke'), null, 'revalidation: ownership rechecked');
    const before = structuredClone(w), hash = hashWorld(w), savedIds = [...ids];
    for (let i = 0; i < 100; i++) for (const ammo of ['he', 'smoke']) bombardCommand(w, ids, frozen, ammo);
    assert.deepEqual(w, before, 'revalidation: routing never mutates world/RNG'); assert.equal(hashWorld(w), hash); assert.deepEqual([...ids], savedIds); assert.deepEqual(frozen, old);
  },
  placement() {
    const obstacles = [{ left: 44, top: 8, right: 404, bottom: 64 }, { left: 8, top: 68, right: 280, bottom: 103 }, { left: 304, top: 108, right: 404, bottom: 208 }, { left: 8, top: 670, right: 404, bottom: 805 }, { left: 8, top: 812, right: 404, bottom: 852 }];
    for (let cx = 0; cx <= 412; cx += 29) for (let cy = 0; cy <= 860; cy += 37) {
      const p = menuPosition(196, 188, 412, 860, cx, cy, obstacles);
      assert(p.left >= 8 && p.left + 196 <= 404 && p.top >= 8 && p.top + 188 <= 852, 'placement: within viewport');
      for (const r of obstacles) assert(p.left + 196 <= r.left || p.left >= r.right || p.top + 188 <= r.top || p.top >= r.bottom, 'placement: does not cover HUD');
    }
  },
  oneshot() {
    const { hud } = dom(), commands = [], cancels = [];
    const menu = initCommandMenu({ choose: (...a) => commands.push(a), cancel: () => cancels.push(1) }), root = hud.children.get('command-menu');
    const target = { ...aim }; menu.open(target, 206, 430); target.x++;
    assert(menu.isOpen(), 'oneshot: open shows menu'); assert(menu.contains(root.children.get('cm-he'))); assert(!menu.contains(new Element()));
    root.children.get('cm-smoke').dispatch('click'); root.children.get('cm-smoke').dispatch('click');
    assert.deepEqual(commands, [['smoke', aim]], 'oneshot: frozen aim issued once, menu closes before callback'); assert(!menu.isOpen());
    menu.open(aim, 206, 430); menu.close(); root.children.get('cm-he').dispatch('click'); assert.equal(commands.length, 1);
    menu.open(aim, 206, 430); root.children.get('cm-cancel').dispatch('click'); root.children.get('cm-cancel').dispatch('click'); assert.equal(cancels.length, 1); assert.equal(commands.length, 1);
    menu.open({ x: -1, z: 3 }, 200, 400); assert(!menu.isOpen(), 'oneshot: invalid open stays hidden');
  },
  disclosure() {
    const { hud } = dom(); initHelp({ open() {}, close() {} }, true);
    assert(hud.children.get('help').html.includes('Shift＋左鍵拖曳'), 'disclosure: new gestures discoverable');
    assert(hud.children.get('help').html.includes('半秒'), 'disclosure: touch hold duration documented');
    initHelp({ open() {}, close() {} }, false); assert(!hud.children.get('help').html.includes('Shift＋左鍵拖曳'), 'disclosure: valve restores legacy help');
  },
};
const only = process.argv.find(a => a.startsWith('--group='))?.slice(8);
for (const [name, run] of Object.entries(group)) if (!only || name === only) { run(); console.log(`OK command-menu ${name}`); }
if (process.argv.includes('--mutations')) {
  for (const [name, m] of Object.entries(mutations)) {
    const p = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--mutant=${name}`, `--group=${m.group}`], { encoding: 'utf8' });
    assert.notEqual(p.status, 0, `${name}: must fail`);
    assert(p.stderr.includes('AssertionError') && p.stderr.includes(`${m.group}:`), `${name}: semantic first red expected, got ${p.stderr.slice(-800)}`);
    console.log(`RED control ${name}: ${p.stderr.match(/AssertionError[^\n]*\n[^\n]*/)?.[0]?.split('\n').join(' ')}`);
  }
}
