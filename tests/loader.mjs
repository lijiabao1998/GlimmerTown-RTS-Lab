// R040 載入畫面：真的建置一份到暫存資料夾，驗載入畫面排在程式碼前面先畫、閥與錯誤提示在 module 腳本之前、動畫守規矩。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'gtrts-r040-'));
try {
  await build({ root: ROOT, logLevel: 'error', build: { outDir: out, emptyOutDir: true } });
  const files = fs.readdirSync(out, { recursive: true });
  assert.deepEqual(files, ['index.html'], `建置產物只有 index.html：${files.join(' ')}`);
  const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
  const modules = [...html.matchAll(/<script type="module"/g)].length;
  assert.equal(modules, 1, `module 腳本剛好一段（現在 ${modules}）`);
  const body = html.indexOf('<body'), loader = html.indexOf('<div id="loader"'), module = html.indexOf('<script type="module"');
  const inline = html.indexOf('noR040=1'), bodyEnd = html.lastIndexOf('</body>');
  assert.ok(body > 0 && loader > body, '載入畫面在 <body> 裡');
  assert.ok(module > body && module < bodyEnd, `module 腳本在 <body> 裡（body ${body}、腳本 ${module}、/body ${bodyEnd}）`);
  assert.ok(loader < module, `載入畫面排在 module 腳本前面（載入畫面 ${loader}、腳本 ${module}）`);
  assert.ok(inline > loader && inline < module, '閥／錯誤提示的內嵌腳本在載入畫面之後、module 腳本之前');
  assert.ok(/addEventListener\('error'/.test(html.slice(loader, module)), '程式準備好之前出錯會寫在載入畫面上');
  const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  const rules = css.split('}').filter(r => r.includes('#loader') || r.includes('ld-')).join('}');
  assert.ok(/prefers-reduced-motion:\s*reduce\)\s*\{\s*#loader/.test(css), '「減少動態效果」時載入畫面不動');
  assert.ok(!/text-shadow|filter\s*:|background-clip\s*:\s*text|linear-gradient\([^)]*#f|radial-gradient/.test(rules), '載入畫面沒有光暈、濾鏡、漸層字（R041 要拿掉的那種）');
  for (const k of [...rules.matchAll(/@keyframes\s+([\w-]+)\s*\{([^@]*)/g)]) {
    const props = [...k[2].matchAll(/([\w-]+)\s*:/g)].map(m => m[1]).filter(p => !/^\d/.test(p));
    assert.ok(props.every(p => p === 'transform' || p === 'opacity'), `動畫 ${k[1]} 只動 transform／opacity（現在 ${props.join(',')}）`);
  }
  assert.ok(/#loader\s*\{[^}]*pointer-events:\s*none/.test(css), '載入畫面不吃點擊');
  const main = fs.readFileSync(path.join(ROOT, 'src/main.ts'), 'utf8');
  const removeAt = main.indexOf("getElementById('loader')?.remove()"), readyAt = main.indexOf('.__rts = rts');
  assert.ok(removeAt > 0 && removeAt < readyAt, 'main.ts 在設好 __rts 之前拿掉載入畫面');
  console.log(`OK R040 載入畫面：載入畫面 @${loader} < module 腳本 @${module}（產物 ${html.length} 字元）`);
} catch (e) {
  console.log(`R040 loader FAIL: ${e.message}`);
  process.exitCode = 1;
} finally {
  fs.rmSync(out, { recursive: true, force: true });
}
