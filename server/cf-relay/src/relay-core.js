// R1012 公開連線轉發伺服器核心（零外部依賴、不綁 cloudflare:workers，可同時由 Worker 與 Node 測試使用）
export const MAX_MESSAGE = 256 * 1024;
export const ROOM_RE = /^[A-Za-z0-9]{1,12}$/;
const encoder = new TextEncoder();

export function isOriginAllowed(origin, allowedList) {
  if (!origin) return true;
  let parsed;
  try { parsed = new URL(origin); } catch { return false; }
  const items = String(allowedList ?? '').split(',').map(s => s.trim()).filter(Boolean);
  if (!items.length) return true;
  for (const item of items) {
    if (item === '*') return true;
    if (parsed.origin === item) return true;
    if ((item === 'http://localhost' || item === 'http://127.0.0.1') && parsed.protocol === 'http:' && parsed.hostname === item.slice(7)) return true;
  }
  return false;
}

export async function handleRelayRequest(request, env, {
  WebSocketPairCtor = globalThis.WebSocketPair,
  wsResponse = client => new Response(null, { status: 101, webSocket: client }),
} = {}) {
  const url = new URL(request.url);
  const cors = { 'access-control-allow-origin': '*', 'cache-control': 'no-store' };
  if (url.pathname === '/' || url.pathname === '/health') {
    return new Response(JSON.stringify({ ok: true, service: 'glimmertown-rts-relay' }), {
      status: 200,
      headers: { ...cors, 'content-type': 'application/json; charset=utf-8' },
    });
  }
  if (url.pathname !== '/relay') {
    return new Response('not found\n', { status: 404, headers: { ...cors, 'content-type': 'text/plain; charset=utf-8' } });
  }
  if ((request.headers.get('upgrade') ?? '').toLowerCase() !== 'websocket') {
    return new Response('expected websocket\n', { status: 426, headers: { ...cors, 'content-type': 'text/plain; charset=utf-8' } });
  }
  if (!isOriginAllowed(request.headers.get('origin'), env?.ALLOWED_ORIGINS)) {
    return new Response('forbidden origin\n', { status: 403, headers: { ...cors, 'content-type': 'text/plain; charset=utf-8' } });
  }
  const room = (url.searchParams.get('room') ?? '').toUpperCase();
  if (!ROOM_RE.test(room)) {
    const pair = new WebSocketPairCtor();
    const client = pair[0], server = pair[1];
    server.accept();
    server.send(JSON.stringify({ t: 'error', why: '房號只能是 1–12 個英文字母或數字' }));
    try { server.close(1000, 'rejected'); } catch {}
    return wsResponse(client);
  }
  const id = env.ROOMS.idFromName(room);
  return env.ROOMS.get(id).fetch(request);
}

export class RelayRoomCore {
  constructor(ctx, {
    WebSocketPairCtor = globalThis.WebSocketPair,
    wsResponse = client => new Response(null, { status: 101, webSocket: client }),
  } = {}) {
    this.ctx = ctx;
    this.WebSocketPairCtor = WebSocketPairCtor;
    this.wsResponse = wsResponse;
    this.lastGen = 0;
  }

  activeSockets() {
    return this.ctx.getWebSockets().filter(s => !s.deserializeAttachment()?.closed);
  }

  async fetch(request) {
    if ((request.headers.get('upgrade') ?? '').toLowerCase() !== 'websocket') {
      return new Response('expected websocket\n', { status: 426 });
    }
    const url = new URL(request.url);
    const room = (url.searchParams.get('room') ?? '').toUpperCase();
    const role = url.searchParams.get('role') === 'join' ? 'join' : 'host';
    if (!ROOM_RE.test(room)) {
      return this.#deny('房號只能是 1–12 個英文字母或數字');
    }

    const active = this.activeSockets();
    const hostWs = active.find(s => s.deserializeAttachment()?.slot === 0);

    if (role === 'host') {
      if (hostWs) return this.#deny('這個房號已經有人開了');
      const maxExisting = this.ctx.getWebSockets().reduce((m, s) => Math.max(m, s.deserializeAttachment()?.gen ?? 0), 0);
      this.lastGen = Math.max(Date.now(), this.lastGen + 1, maxExisting + 1);
      const gen = this.lastGen;
      const pair = new this.WebSocketPairCtor();
      const client = pair[0], server = pair[1];
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ slot: 0, gen, room, closed: false });
      server.send(JSON.stringify({ t: 'welcome', you: 0, room, players: 1 }));
      return this.wsResponse(client);
    }

    if (!hostWs) return this.#deny('沒有這個房號（房主還沒開房，或已經離開了）');
    const hostGen = hostWs.deserializeAttachment().gen;
    const guestWs = active.find(s => {
      const a = s.deserializeAttachment();
      return a && a.slot === 1 && a.gen === hostGen;
    });
    if (guestWs) return this.#deny('這個房間滿了');

    const pair = new this.WebSocketPairCtor();
    const client = pair[0], server = pair[1];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ slot: 1, gen: hostGen, room, closed: false });
    server.send(JSON.stringify({ t: 'welcome', you: 1, room, players: 2 }));
    try { hostWs.send(JSON.stringify({ t: 'joined', who: 1 })); } catch {}
    return this.wsResponse(client);
  }

  #deny(why) {
    const pair = new this.WebSocketPairCtor();
    const client = pair[0], server = pair[1];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ slot: -1, gen: -1, room: '', closed: true });
    server.send(JSON.stringify({ t: 'error', why }));
    try { server.close(1000, 'rejected'); } catch {}
    return this.wsResponse(client);
  }

  async webSocketMessage(ws, message) {
    if (typeof message !== 'string') {
      try { ws.close(1003, 'text only'); } catch {}
      return;
    }
    if (encoder.encode(message).byteLength > MAX_MESSAGE) {
      try { ws.close(1009, 'message too large'); } catch {}
      return;
    }
    const att = ws.deserializeAttachment();
    if (!att || att.closed || att.slot < 0) return;

    let msg;
    try { msg = JSON.parse(message); } catch { return; }
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return;

    let out;
    try { out = JSON.stringify({ ...msg, from: att.slot }); }
    catch { try { ws.close(1007, 'invalid payload'); } catch {} return; }

    for (const s of this.ctx.getWebSockets()) {
      if (s === ws) continue;
      const sa = s.deserializeAttachment();
      if (!sa || sa.closed || sa.gen !== att.gen) continue;
      try { s.send(out); } catch {}
    }
  }

  async webSocketClose(ws) {
    this.#leave(ws);
  }

  async webSocketError(ws) {
    this.#leave(ws);
  }

  #leave(ws) {
    const att = ws.deserializeAttachment();
    if (!att || att.closed || att.slot < 0) return;
    ws.serializeAttachment({ ...att, closed: true });
    const leftMsg = JSON.stringify({ t: 'left', who: att.slot });
    for (const s of this.ctx.getWebSockets()) {
      if (s === ws) continue;
      const sa = s.deserializeAttachment();
      if (!sa || sa.closed || sa.gen !== att.gen) continue;
      try { s.send(leftMsg); } catch {}
      if (att.slot === 0) {
        s.serializeAttachment({ ...sa, closed: true });
      }
    }
  }
}
