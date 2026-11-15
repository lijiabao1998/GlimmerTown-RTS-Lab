// 發布後確認用：這台機器真顯示卡的無頭 Chrome 開一個網址（預設公開站），等遊戲準備好，在頁面裡跑一段腳本、拍一張圖。唯讀，零依賴。
// 內建瀏覽器面板藏起來的時候不出幀（requestAnimationFrame 不會跑），畫面上的東西要靠這支看。
// 用法：node tools/live.mjs [網址] --run <腳本檔> [--shot <png>] [--size 412x915] [--mobile]
//   腳本檔是一個 async 函式的內容（可以用 await、最後 return 一個可以轉 JSON 的值）；頁面裡有 window.__rts。
//   沒有真顯示卡（例如雲端）就會失敗——這支不進 CI，只給本機發布後確認。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const SITE = 'https://lijiabao1998.github.io/GlimmerTown-RTS-Lab/';
const CANDIDATES = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? def : process.argv[i + 1]; };

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl), pending = new Map(), errors = [];
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let next = 1;
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
    else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text ?? 'exception');
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const id = next++; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  return { send, evaluate, errors, close: () => ws.close() };
}

const url = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : SITE;
const [W, H] = String(arg('size', '412x915')).split('x').map(Number), mobile = process.argv.includes('--mobile');
const script = arg('run', null) ? fs.readFileSync(arg('run'), 'utf8') : 'return { tick: __rts.tick(), phase: __rts.phase() };';
const chromePath = CANDIDATES.find(p => fs.existsSync(p));
if (!chromePath) { console.error('找不到 Chrome，可設 CHROME_PATH'); process.exit(1); }
const devPort = 9800 + (process.pid % 150), profile = fs.mkdtempSync(path.join(os.tmpdir(), 'gtrts-live-'));
const chrome = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--mute-audio', `--window-size=${W},${H}`,
  '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', `--user-data-dir=${profile}`, `--remote-debugging-port=${devPort}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
chrome.stderr.on('data', () => {});
let page = null;
try {
  let wsUrl = null;
  for (let t = 0; !wsUrl && t < 60000; t += 200) { await sleep(200); try { wsUrl = (await (await fetch(`http://127.0.0.1:${devPort}/json/list`)).json()).find(x => x.type === 'page')?.webSocketDebuggerUrl; } catch { /* 還沒起來 */ } }
  if (!wsUrl) throw new Error('Chrome 沒有起來');
  page = await connect(wsUrl);
  await page.send('Runtime.enable'); await page.send('Page.enable');
  await page.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile });
  if (mobile) await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await page.send('Page.navigate', { url });
  let ready = false;
  for (let t = 0; !ready && t < 60000; t += 250) { await sleep(250); ready = await page.evaluate('!!(window.__rts && window.__rts.ready)').catch(() => false); }
  if (!ready) throw new Error('頁面沒有準備好（60 秒內沒有 __rts.ready）');
  const renderer = await page.evaluate("(()=>{try{const g=document.createElement('canvas').getContext('webgl2')||document.createElement('canvas').getContext('webgl');const e=g&&g.getExtension('WEBGL_debug_renderer_info');return e?g.getParameter(e.UNMASKED_RENDERER_WEBGL):'(none)'}catch(e){return String(e)}})()");
  const result = await page.evaluate(`(async () => { ${script}\n})()`);
  if (arg('shot', null)) {
    await page.evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
    const png = await page.send('Page.captureScreenshot', { format: 'png' });
    fs.mkdirSync(path.dirname(path.resolve(arg('shot'))), { recursive: true });
    fs.writeFileSync(arg('shot'), Buffer.from(png.data, 'base64'));
  }
  console.log(JSON.stringify({ url, renderer, result, errors: page.errors }, null, 1));
} catch (e) { console.error('live FAIL: ' + (e?.message ?? e)); process.exitCode = 1; }
finally { try { page?.close(); } catch { /* 已經關了 */ } try { chrome.kill(); } catch { /* 已經結束 */ } await sleep(1200); try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* 之後系統會清 */ } }
