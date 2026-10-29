// 無頭 Chrome 骨架（零依賴；Node 22+ 內建 WebSocket）：靜態伺服 dist/ → 開 Chrome → CDP。
// WebGL 走 SwiftShader 軟體渲染，所以雲端（GitHub Actions，沒有 GPU）也能跑。
// 照搬 GlimmerTown3D-lab@bece722 tools/cdp.mjs（它沿用 2D 實驗線 harness.js）；改動：就緒條件換成 window.__rts、多找 Playwright 的 Chromium、加觸控輔助（R037 加帶時間戳的 touchSeq）。
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const sleep = ms => new Promise(r => setTimeout(r, ms));

const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

// overlay＝{ 路徑: 內容 }：只在記憶體裡的檔案，蓋過同名檔（D004 抽取用：實驗線副本插一行出口，原檔不動、也不寫進任何目錄）
function serve(dir, port, overlay = {}) {
  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      const rel = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/+/, '') || 'index.html';
      if (rel in overlay) { res.writeHead(200, { 'Content-Type': MIME[path.extname(rel)] || 'application/octet-stream' }).end(overlay[rel]); return; }
      const file = path.join(dir, rel);
      if (!file.startsWith(dir)) { res.writeHead(403).end(); return; }
      fs.readFile(file, (err, buf) => {
        if (err) { res.writeHead(404).end(); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' }).end(buf);
      });
    });
    srv.on('error', reject);
    srv.listen(port, '127.0.0.1', () => resolve(srv));
  });
}

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map(), errors = [], requests = [];
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); return; }
    if (m.method === 'Network.requestWillBeSent') requests.push(m.params.request.url);
    if (m.method === 'Runtime.exceptionThrown') errors.push('exception: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 300));
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('console.error: ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300));
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error' && !/favicon/.test(m.params.entry.url || '')) errors.push('log: ' + m.params.entry.text.slice(0, 300));
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('evaluate: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  };
  return { send, evaluate, errors, requests, close: () => ws.close() };
}

// 開一個頁面工作階段：fn({ open, page })；open(query) 導航到 dist/index.html?query 並等 __gt.ready
// 選項：root＝要伺服的目錄（預設 dist/；D003 抽取工具拿來開 2D 實驗線）、entry＝入口檔、overlay＝只在記憶體的檔案、
//       preload＝頁面任何腳本之前先執行的 JS、ready＝等到它為真才算載入完、readyMs＝最多等多久。
// page.requests 記下所有網路請求的網址（D003「零外部素材」守衛）。
export async function withBrowser(opt, fn) {
  const port = opt.port || +(process.env.GT_PORT ?? 0) || 8411, w = opt.width || 1280, h = opt.height || 800;   // GT_PORT：同一台機器同時跑兩支工具時錯開埠
  const dist = opt.root ? path.resolve(opt.root) : path.join(ROOT, 'dist'), entry = opt.entry || 'index.html';
  const ready = opt.ready || '!!(window.__rts && window.__rts.ready)', readyMs = opt.readyMs || 30000;
  const overlay = opt.overlay || {};
  if (!(entry in overlay) && !fs.existsSync(path.join(dist, entry))) throw new Error(opt.root ? `找不到 ${path.join(dist, entry)}` : '找不到 dist/index.html，先跑 npm run build');
  const chromePath = CANDIDATES.find(p => fs.existsSync(p));
  if (!chromePath) throw new Error('找不到 Chrome，可設 CHROME_PATH');
  const srv = await serve(dist, port, overlay);
  // Chrome 冷啟動：D003 雲端首跑（run 36052184509）等了 15 秒還沒起來就放棄，同一台 runner 下一步拍樣張時 Chrome 起來花了二十多秒。
  // 做法沿用 2D 實驗線 T627（lijiabao1998/GlimmerTown-lab d23c18d，docs/T627-chrome-cold-start.md）：
  // 上限拉長（預設 60 秒）；Chrome 行程已經結束就立刻報錯、不空等；保留 stderr 尾巴；第一次起不來換新 profile 與埠重開一次。
  const waitMs = opt.chromeWaitMs ?? 60000;
  const launch = (devPort, profile) => {
    const chrome = spawn(chromePath, [
      '--headless=new', `--remote-debugging-port=${devPort}`, `--user-data-dir=${profile}`, `--window-size=${w},${h}`,
      // gl:false＝只用 CPU 畫 2D canvas（實驗線全是 2D canvas、大量 getImageData；走 SwiftShader 開機要 6 分鐘，CPU 約 20 秒）
      ...(opt.gl === false ? ['--disable-gpu'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']),
      '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--mute-audio',
      ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
      'about:blank',
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    const st = { chrome, exit: null, tail: '' };
    chrome.stderr.on('data', d => { st.tail = (st.tail + d).slice(-2048); });   // 持續讀掉，管線不會塞住
    chrome.on('exit', code => { st.exit = code ?? 'signal'; });
    chrome.on('error', e => { st.exit = 'spawn-error: ' + e.message; });
    return st;
  };
  const attempt = async (n) => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'gtrts-chrome-')), devPort = port + 1000 + n, t0 = Date.now();
    const st = launch(devPort, profile);
    let wsUrl = null;
    while (!wsUrl && st.exit === null && Date.now() - t0 < waitMs) {
      await sleep(150);
      try { const list = await (await fetch(`http://127.0.0.1:${devPort}/json/list`)).json(); wsUrl = list.find(t => t.type === 'page')?.webSocketDebuggerUrl; } catch {}
    }
    const why = wsUrl ? null : st.exit !== null ? `Chrome 結束了（結束碼 ${st.exit}）` : `等了 ${waitMs / 1000} 秒 Chrome 還沒起來`;
    return { st, profile, wsUrl, ms: Date.now() - t0, why };
  };
  const cleanup = a => { try { a.st.chrome.kill(); } catch {} setTimeout(() => { try { fs.rmSync(a.profile, { recursive: true, force: true }); } catch {} }, 800); };
  let run = await attempt(0), tries = 1;
  if (!run.wsUrl) {
    const first = run;
    cleanup(first);
    run = await attempt(1); tries = 2;
    if (!run.wsUrl) {
      cleanup(run); srv.close();
      throw new Error(`Chrome 沒有起來（重開一次也失敗）：第 1 次 ${first.why}；第 2 次 ${run.why}` + (run.st.tail ? `\n  stderr 尾巴：${run.st.tail.trim().slice(-600)}` : ''));
    }
  }
  const { wsUrl } = run;
  let page = null;
  try {
    page = await connect(wsUrl);
    page.chrome = { ms: run.ms, tries };   // Chrome 可連線花了多久、第幾次成功（印在煙霧測試開頭，之後在 Actions 紀錄看得到冷啟動時間）
    await page.send('Runtime.enable'); await page.send('Log.enable'); await page.send('Page.enable'); await page.send('Network.enable');
    await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: !!opt.mobile });
    if (opt.mobile) await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    if (opt.cpuThrottle) await page.send('Emulation.setCPUThrottlingRate', { rate: opt.cpuThrottle });
    if (opt.preload) await page.send('Page.addScriptToEvaluateOnNewDocument', { source: opt.preload });
    // R069：預設在網址加 noR069=1，既有守衛照舊測沒有開始選單的流程（它們寫的時候就是這個流程）；
    // 要測開始選單的守衛傳 open(query, { menu: true })。網址自己寫了 noR069 就照它的。
    const open = async (query, { menu = false } = {}) => {
      const q = menu || /(^|&)noR069=/.test(query) ? query : `${query ? query + '&' : ''}noR069=1`;
      await page.send('Page.navigate', { url: `http://127.0.0.1:${port}/${entry}?${q}` });
      for (let i = 0, t0 = Date.now(); Date.now() - t0 < readyMs; i++) { await sleep(150); if (await page.evaluate(ready).catch(() => false)) break; }
      await sleep(opt.settle ?? 900);   // 讓第一幀以上畫完（陰影貼圖、後製）
    };
    return await fn({ open, page });
  } finally {
    try { page?.close(); } catch {}
    cleanup(run);
    srv.close();
  }
}

// 真的觸控事件：在 (x,y) 點一下（touchStart → touchEnd）
export async function touchTap(page, x, y) {
  await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
  await sleep(60);
  await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(120);
}

// R037：照時間表送觸控事件，每個事件帶明確的時間戳（CDP 的 timestamp）：手指的節奏固定，不跟著 CI 機器忙不忙變。
// seq＝[{ type: 'touchStart'|'touchMove'|'touchEnd', x, y, at }]，at＝離 base 幾毫秒；實際也照表等到那個時刻才送（送晚了就不等）。
// 同一個手勢分兩段送時傳同一個 base。回傳每個事件 Node 端送出、收到回應的時刻（離 base 幾毫秒，診斷用）。
export async function touchSeq(page, seq, base = Date.now()) {
  const sent = [];
  for (const s of seq) {
    const wait = base + s.at - Date.now();
    if (wait > 0) await sleep(wait);
    const t0 = Date.now();
    await page.send('Input.dispatchTouchEvent', { type: s.type, touchPoints: s.type === 'touchEnd' ? [] : [{ x: s.x, y: s.y, id: 1 }], timestamp: (base + s.at) / 1000 });
    sent.push({ type: s.type, at: s.at, send: t0 - base, ack: Date.now() - base });
  }
  return sent;
}

// 截圖存成 PNG 檔
export async function shot(page, file) {
  const r = await page.send('Page.captureScreenshot', { format: 'png' });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
  return file;
}
