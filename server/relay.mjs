// R083 連線的轉發伺服器：零依賴（只用 Node 內建模組），一個檔案。
//   node server/relay.mjs [--port 8788] [--host 0.0.0.0] [--dist dist]
// HTTP：伺服 dist/ 的遊戲頁（先 npm run build）——同一個區域網路裡的人開 http://<這台的位址>:8788/ 就能玩。
// WebSocket /relay?room=<房號>&role=host|join：房間最多 2 人；host 開房拿 0 號、join 加入拿 1 號。
// 一個人送的訊息原樣轉給同房的另一個人（加上 from）；有人進來、離開通知對方；房主離開房間就關掉。
// 不存世界、不存紀錄、不懂遊戲規則：它只轉訊息（遊戲的同步在 src/net/）。
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? def : process.argv[i + 1]; };
const PORT = Number(arg('port', process.env.PORT ?? 8788)), HOST = arg('host', '0.0.0.0');
const DIST = path.resolve(arg('dist', path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist')));
const MAX_MESSAGE = 256 * 1024, MAX_PLAYERS = 2, ROOM_RE = /^[A-Za-z0-9]{1,12}$/;
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

// ---- WebSocket（RFC 6455 的最小子集：文字訊息、分段、ping／pong、關閉）----
function frame(opcode, payload) {
  const n = payload.length, head = n < 126 ? Buffer.from([0x80 | opcode, n]) : n < 65536 ? Buffer.from([0x80 | opcode, 126, n >> 8, n & 255]) : (() => { const b = Buffer.alloc(10); b[0] = 0x80 | opcode; b[1] = 127; b.writeBigUInt64BE(BigInt(n), 2); return b; })();
  return Buffer.concat([head, payload]);
}
function wsAccept(req, socket, onMessage, onClose) {
  const key = req.headers['sec-websocket-key'];
  if (!key || (req.headers.upgrade ?? '').toLowerCase() !== 'websocket') { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); return null; }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.setNoDelay(true);
  let buf = Buffer.alloc(0), parts = [], closed = false;
  const ws = {
    send(text) { if (!closed) socket.write(frame(1, Buffer.from(text))); },
    close(code = 1000) { if (closed) return; closed = true; const b = Buffer.alloc(2); b.writeUInt16BE(code); socket.write(frame(8, b)); socket.end(); },
  };
  const fail = () => { ws.close(1002); };
  socket.on('data', chunk => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (buf.length < 2) return;
      const fin = buf[0] & 0x80, op = buf[0] & 0x0f, masked = buf[1] & 0x80;
      let len = buf[1] & 0x7f, at = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); at = 4; }
      else if (len === 127) { if (buf.length < 10) return; const big = buf.readBigUInt64BE(2); if (big > BigInt(MAX_MESSAGE)) return fail(); len = Number(big); at = 10; }
      if (!masked || len > MAX_MESSAGE) return fail();   // 客戶端送來的一定要加遮罩
      if (buf.length < at + 4 + len) return;
      const mask = buf.subarray(at, at + 4), data = Buffer.from(buf.subarray(at + 4, at + 4 + len));
      for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
      buf = buf.subarray(at + 4 + len);
      if (op === 8) { ws.close(); return; }
      if (op === 9) { socket.write(frame(10, data)); continue; }
      if (op === 10) continue;
      if (op !== 0 && op !== 1) return fail();   // 只收文字
      parts.push(data);
      if (parts.reduce((s, p) => s + p.length, 0) > MAX_MESSAGE) return fail();
      if (fin) { const text = Buffer.concat(parts).toString('utf8'); parts = []; onMessage(text); }
    }
  });
  const end = () => { if (!closed) closed = true; onClose(); };
  socket.on('close', end); socket.on('error', () => socket.destroy());
  return ws;
}

// ---- 房間 ----
const rooms = new Map();   // 房號 → [0 號, 1 號]（沒人＝null）
function join(ws, room, role) {
  const members = rooms.get(room);
  if (role === 'host') {
    if (members) return { why: '這個房號已經有人開了' };
    rooms.set(room, [ws, null]); return { you: 0 };
  }
  if (!members) return { why: '沒有這個房號（房主還沒開房，或已經離開了）' };
  const free = members.indexOf(null);
  if (free < 0 || free >= MAX_PLAYERS) return { why: '這個房間滿了' };
  members[free] = ws; return { you: free };
}
function others(room, you, msg) { for (const [i, m] of (rooms.get(room) ?? []).entries()) if (m && i !== you) m.send(JSON.stringify(msg)); }

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x'), rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const file = path.resolve(DIST, '.' + rel);
  if (!file.startsWith(DIST + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    const missing = rel === '/index.html' && !fs.existsSync(path.join(DIST, 'index.html'));
    res.writeHead(missing ? 503 : 404, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end(missing ? '轉發伺服器開著，但還沒有遊戲頁：先在倉庫根目錄跑 npm run build，再開這一頁。\n' : 'not found\n');
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
});
server.on('upgrade', (req, socket) => {
  const url = new URL(req.url, 'http://x'), room = (url.searchParams.get('room') ?? '').toUpperCase(), role = url.searchParams.get('role') === 'join' ? 'join' : 'host';
  if (url.pathname !== '/relay') { socket.end('HTTP/1.1 404 Not Found\r\n\r\n'); return; }
  let you = -1;
  const ws = wsAccept(req, socket, text => {
    let msg;
    try { msg = JSON.parse(text); } catch { return; }
    if (you < 0 || !msg || typeof msg !== 'object' || Array.isArray(msg)) return;
    others(room, you, { ...msg, from: you });
  }, () => {
    const members = rooms.get(room);
    if (you < 0 || !members || members[you] !== ws) return;
    members[you] = null;
    others(room, you, { t: 'left', who: you });
    if (you === 0 || members.every(m => !m)) rooms.delete(room);   // 房主走了：房間關掉（還在的人照舊連著，但沒有對象了）
  });
  if (!ws) return;
  if (!ROOM_RE.test(room)) { ws.send(JSON.stringify({ t: 'error', why: '房號只能是 1–12 個英文字母或數字' })); ws.close(); return; }
  const r = join(ws, room, role);
  if (r.why) { ws.send(JSON.stringify({ t: 'error', why: r.why })); ws.close(); return; }
  you = r.you;
  ws.send(JSON.stringify({ t: 'welcome', you, room, players: rooms.get(room).filter(Boolean).length }));
  others(room, you, { t: 'joined', who: you });
});
server.listen(PORT, HOST, () => {
  const lan = Object.values(os.networkInterfaces()).flat().filter(a => a && a.family === 'IPv4' && !a.internal).map(a => a.address);
  const port = server.address().port;
  console.log(`轉發伺服器開好了（埠 ${port}）`);
  for (const ip of HOST === '0.0.0.0' ? ['127.0.0.1', ...lan] : [HOST]) console.log(`  http://${ip}:${port}/`);
  console.log(fs.existsSync(path.join(DIST, 'index.html')) ? '同一個區域網路裡的人開上面的網址，按「連線合作」開房或加入。' : '還沒有遊戲頁：先跑 npm run build。');
});
