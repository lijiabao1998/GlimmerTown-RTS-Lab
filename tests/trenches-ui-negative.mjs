// Run R118 DOM/controller semantic negative controls under the normal unit sweep.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const result = spawnSync(process.execPath, [fileURLToPath(new URL('./trenches-ui.mjs', import.meta.url)), '--mutations'], { encoding: 'utf8', timeout: 110000 });
process.stdout.write(result.stdout); process.stderr.write(result.stderr);
assert.equal(result.status, 0, 'all R118 UI semantic negatives fail at their designated assertions');
assert.equal((result.stdout.match(/^OK trenches-ui mutation:/gm) ?? []).length, 11, 'all eleven UI negative controls ran');
