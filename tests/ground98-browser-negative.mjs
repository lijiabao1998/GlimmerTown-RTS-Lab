// R098 暫存先被 renderer 認得（initTexture 過）：copyTextureToTexture 就改走 GPU 複製，從那張只上傳過一次的暫存複製——之後改過的格是舊的。
// 只有真的 GPU 看得出來：用 tests/ground98-browser.mjs 的建置突變（GT98_MUTANT=staging）跑河鎮那一段，第一個紅的要是讀回比對那一句。
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const r = spawnSync(process.execPath, ['tests/ground98-browser.mjs'], { cwd: root, encoding: 'utf8', timeout: 110000, env: { ...process.env, GT98_MUTANT: 'staging', GT98_CASES: 'town' } });
const all = (r.stdout ?? '') + (r.stderr ?? '');
if (/NOT RUN ground98/.test(all)) { console.log('NOT RUN ground98-browser-negative: no local Chrome'); process.exit(0); }
assert(!r.error && r.status !== 0, `staging: the mutant must fail (${r.error ?? r.status})`);
const first = all.match(/AssertionError[^\r\n]*?: ([^\r\n]+)/)?.[1];
assert.match(first ?? '', /^gpu: after town .+ the ground texture on the GPU equals a full upload of groundPx/, `staging: first red must be the GPU readback; ${all.slice(-800)}`);
console.log(`RED ground98-browser/staging: ${first}`);
