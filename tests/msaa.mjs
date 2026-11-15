// R065 建築抗鋸齒守衛（Node）：後製渲染目標照設定開多重取樣、不超過顯示卡上限、軟體繪圖不取樣、取樣數變了才重建、換大小不掉取樣；?noR065=1 回到 0。
// R079（業主 2026-11-15「改回關」）：預設樣式不取樣；要開用網址 ?msaa=4（msaaSetting），閥贏過網址。取樣那幾群改成對「開著的樣式」ON 驗。
// --mutations：故意弄壞 post.ts（隔離的資料網址模組），每個都要紅在對應那一句。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { valves } from '../src/valves.ts';

const url = new URL('../src/render/post.ts', import.meta.url), source = fs.readFileSync(url, 'utf8');
const mutations = {
  never: ['config', 'const samples = msaaSamples(style, renderer.capabilities.maxSamples, this.software);', 'const samples = 0;', 'pipeline: an opted-in style renders with 4 samples'],
  software_ignored: ['software', 'return software ? 0 : Math.max(', 'return Math.max(', 'software: a software renderer (SwiftShader) renders without samples'],
  uncapped: ['cap', 'Math.min(style.msaa ?? 0, maxSamples | 0)', '(style.msaa ?? 0)', 'cap: never more samples than the GPU allows'],
  rebuild: ['rebuild', 'if (this.rt.samples !== samples) {', 'if (true) {', 'rebuild: same sample count keeps the render target'],
  resize_drop: ['resize', 'if (this.rt.width !== w || this.rt.height !== h) this.rt.setSize(w, h);', 'if (this.rt.width !== w || this.rt.height !== h) { this.rt.setSize(w, h); this.rt.samples = 0; }', 'resize: a new size rebuilds the target once and keeps the sample count'],
  default_on: ['style', 'export const STYLE_A: Style = { pixelCss: 2, outline: true, quant: 12, msaa: 0 };', 'export const STYLE_A: Style = { pixelCss: 2, outline: true, quant: 12, msaa: 4 };', 'style: default is no MSAA (owner 2026-11-15)'],
  setting_ignores_valve: ['setting', '  if (!valveOn) return 0;\n', '', 'setting: the valve forces 0 whatever the address says'],
  setting_uncapped: ['setting', 'Math.min(MSAA_MAX, n)', 'n', 'setting: never more than 8'],
  setting_default_on: ['setting', "  if (param === null) return STYLE_A.msaa ?? 0;", '  if (param === null) return 4;', 'setting: an address without msaa asks for none'],
};
const mutant = process.argv.find(a => a.startsWith('--mutant='))?.slice(9);
async function load() {
  if (!mutant) return import(url.href);
  const [, from, to] = mutations[mutant];
  assert.equal(source.split(from).length, 2, `${mutant}: unique anchor`);
  const js = stripTypeScriptTypes(source.replace(from, to)).replace(/from '([^']+)'/g, (_, spec) => `from '${spec.startsWith('.') ? new URL(spec, url).href : import.meta.resolve(spec)}'`);
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
}
const { Pipeline, STYLE_A, msaaSamples, msaaSetting, MSAA_MAX, softwareRenderer } = await load();
const ON = { ...STYLE_A, msaa: 4 };   // 開著的樣式（網址 ?msaa=4 會得到的）
let groups = 0;
function group(name, fn) {
  try { fn(); groups++; console.log(`OK msaa: ${name}`); }
  catch (e) { console.error(`FIRST_MSAA_FAILURE=${JSON.stringify({ group: name, message: e.message.split('\n')[0] })}`); throw e; }
}
// 假的 renderer：只記下 Pipeline 用到的東西（設渲染目標、畫、統計、顯示卡上限）
const fakeRenderer = (maxSamples = 4) => ({ capabilities: { maxSamples }, info: { render: { calls: 0, triangles: 0 } }, targets: [], setRenderTarget(rt) { this.targets.push(rt ? rt.samples : null); }, render() {} });
// 假的 GL：Chrome 的 RENDERER 是「WebKit WebGL」，真名在 WEBGL_debug_renderer_info；Firefox 直接給真名
const withGL = (r, renderer, unmasked) => Object.assign(r, { getContext: () => ({ RENDERER: 0x1f01, getParameter: p => p === 0x1f01 ? renderer : p === 0x9246 ? unmasked : null, getExtension: n => n === 'WEBGL_debug_renderer_info' && unmasked ? { UNMASKED_RENDERER_WEBGL: 0x9246 } : null }) });
const scene = new THREE.Scene(), cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
const disposals = rt => { const box = { n: 0 }; rt.addEventListener('dispose', () => box.n++); return box; };

group('style', () => {
  assert.equal(STYLE_A.msaa, 0, 'style: default is no MSAA (owner 2026-11-15)');
  assert.equal(STYLE_A.pixelCss, 2, 'style: pixel scale unchanged'); assert.equal(STYLE_A.quant, 12); assert.equal(STYLE_A.outline, true);
});
group('valve', () => {
  assert.equal(valves(new URLSearchParams('')).r065, true, 'valve: default on');
  assert.equal(valves(new URLSearchParams('noR065=1')).r065, false, 'valve: ?noR065=1 off');
  const main = fs.readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  assert.ok(main.includes("msaa: msaaSetting(q.get('msaa'), V.r065) };"), 'valve: main.ts style reads the address and the R065 valve through msaaSetting');
});
group('setting', () => {
  assert.equal(MSAA_MAX, 8, 'fixture: the cap on the card');
  assert.equal(msaaSetting(null, true), 0, 'setting: an address without msaa asks for none');
  assert.deepEqual([msaaSetting('4', true), msaaSetting('2', true), msaaSetting('8', true)], [4, 2, 8], 'setting: ?msaa=4 (or 2, or 8) asks for that many');
  assert.deepEqual([msaaSetting('16', true), msaaSetting('999', true)], [8, 8], 'setting: never more than 8');
  for (const junk of ['', '0', '-3', '2.5', 'on', 'true', '4x', ' ', 'NaN', 'Infinity']) assert.equal(msaaSetting(junk, true), 0, `setting: ?msaa=${JSON.stringify(junk)} asks for none`);
  for (const param of [null, '4', '8', 'on']) assert.equal(msaaSetting(param, false), 0, 'setting: the valve forces 0 whatever the address says');
});
group('config', () => {
  const pipe = new Pipeline(), r = fakeRenderer(8);
  pipe.render(r, scene, cam, STYLE_A, 800, 600, 1);
  assert.equal(pipe.samples, 0, 'pipeline: the default style renders without samples');
  const mark = r.targets.length;
  pipe.render(r, scene, cam, ON, 800, 600, 1);
  assert.equal(pipe.samples, 4, 'pipeline: an opted-in style renders with 4 samples');
  assert.equal(r.targets[mark], 4, 'pipeline: the scene pass draws into the multisampled target');
  pipe.render(r, scene, cam, { ...STYLE_A, msaa: 0 }, 800, 600, 1);
  assert.equal(pipe.samples, 0, 'pipeline: msaa 0 renders without samples');
  pipe.render(r, scene, cam, { pixelCss: 2, outline: true, quant: 12 }, 800, 600, 1);
  assert.equal(pipe.samples, 0, 'pipeline: style without msaa (old callers) renders without samples');
  pipe.dispose();
});
group('cap', () => {
  for (const [max, want] of [[2, 2], [4, 4], [16, 4], [0, 0]]) {
    const pipe = new Pipeline(); pipe.render(fakeRenderer(max), scene, cam, ON, 400, 300, 1);
    assert.equal(pipe.samples, want, 'cap: never more samples than the GPU allows'); pipe.dispose();
  }
  assert.equal(msaaSamples({ ...STYLE_A, msaa: -3 }, 4), 0, 'cap: negative settings clamp to 0');
});
group('software', () => {
  const swift = 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)';
  for (const [renderer, unmasked, want, label] of [['WebKit WebGL', swift, 0, 'Chrome SwiftShader'], ['llvmpipe (LLVM 17.0.6, 256 bits)', null, 0, 'Firefox llvmpipe'],
    ['WebKit WebGL', 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)', 4, 'desktop GPU'], ['WebKit WebGL', 'ANGLE (Qualcomm, Adreno (TM) 650, OpenGL ES 3.2)', 4, 'phone GPU'], ['Apple GPU', null, 4, 'Safari']]) {
    const pipe = new Pipeline(); pipe.render(withGL(fakeRenderer(8), renderer, unmasked), scene, cam, ON, 400, 300, 1);
    assert.equal(pipe.samples, want, want ? `software: a real GPU keeps 4 samples (${label})` : 'software: a software renderer (SwiftShader) renders without samples'); pipe.dispose();
  }
  assert.equal(softwareRenderer(''), false, 'software: unknown renderer counts as a real GPU');
});
group('rebuild', () => {
  const pipe = new Pipeline(), r = fakeRenderer(4), rt = pipe.rt, d = disposals(rt);
  pipe.render(r, scene, cam, ON, 800, 600, 1); const first = d.n;
  for (let i = 0; i < 5; i++) pipe.render(r, scene, cam, ON, 800, 600, 1);
  assert.equal(d.n, first, 'rebuild: same sample count keeps the render target');
  pipe.render(r, scene, cam, { ...ON, msaa: 2 }, 800, 600, 1);
  assert.equal(d.n, first + 1, 'rebuild: a new sample count rebuilds once'); assert.equal(pipe.samples, 2);
  const off = new Pipeline(), dOff = disposals(off.rt); off.render(r, scene, cam, { ...STYLE_A, msaa: 0 }, 800, 600, 1);
  assert.equal(dOff.n, 1, 'rebuild: msaa 0 behaves like before R065 (only the first resize from 1×1)');
  pipe.dispose(); off.dispose();
});
group('resize', () => {
  const pipe = new Pipeline(), r = fakeRenderer(4), d = disposals(pipe.rt);
  pipe.render(r, scene, cam, ON, 800, 600, 1); const before = d.n; pipe.render(r, scene, cam, ON, 1024, 700, 1);
  assert.deepEqual(pipe.size, [512, 350]);
  assert.ok(d.n === before + 1 && pipe.samples === 4 && r.targets.at(-2) === 4, 'resize: a new size rebuilds the target once and keeps the sample count');
  pipe.dispose();
});
if (process.argv.includes('--mutations')) {
  for (const [name, [g, , , message]] of Object.entries(mutations)) {
    const p = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--mutant=${name}`], { encoding: 'utf8', timeout: 30000 });
    assert.notEqual(p.status, 0, `${name} must fail`);
    const first = p.stderr.match(/^FIRST_MSAA_FAILURE=(.*)$/m);
    assert.ok(first, `${name}: fails inside a guard, not at import: ${p.stderr.slice(0, 1500)}`);
    assert.deepEqual(JSON.parse(first[1]), { group: g, message }, `${name}: first failure is the intended guard`);
    console.log(`RED msaa ${name}: ${message}`);
  }
}
console.log(`msaa: ${groups} groups OK`);
