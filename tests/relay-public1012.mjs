// R1012 公開連線轉發伺服器守衛（純 Node，無網路呼叫、無外部依賴）：
// 1. defaultRelay() 在 https / localStorage / http / file 下的回傳與 httpsBlocks 相容性；
// 2. server/cf-relay/src/relay-core.js 路由、Origin 白名單、開房／加入／滿房／轉發／關房／防串房協定；
// 3. server/cf-relay/wrangler.toml 與 src/net/client.ts 接線檢查。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PUBLIC_RELAY, defaultRelay, httpsBlocks } from '../src/net/client.ts';
import { RelayRoomCore, handleRelayRequest, isOriginAllowed, MAX_MESSAGE } from '../server/cf-relay/src/relay-core.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

// 1. defaultRelay() 行為（保存舊 globalThis 設定）
{
  const prevLoc = globalThis.location;
  const prevStorage = globalThis.localStorage;
  const store = new Map();
  globalThis.localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
  };
  try {
    globalThis.location = { protocol: 'https:', host: 'lijiabao1998.github.io' };
    store.clear();
    assert.equal(defaultRelay(), PUBLIC_RELAY, 'https page with empty storage uses PUBLIC_RELAY');
    assert.equal(httpsBlocks(PUBLIC_RELAY), false, 'PUBLIC_RELAY uses wss:// and is not blocked on https pages');

    globalThis.location = { protocol: 'https:', host: 'game.lijiabao.uk' };
    store.set('gtrts.v1.relay', 'wss://custom.example/relay');
    assert.equal(defaultRelay(), 'wss://custom.example/relay', 'https page respects saved relay override');

    store.clear();
    globalThis.location = { protocol: 'http:', host: '127.0.0.1:8788' };
    assert.equal(defaultRelay(), 'ws://127.0.0.1:8788/relay', 'http LAN page keeps same-host ws:// relay');

    globalThis.location = { protocol: 'file:', host: '' };
    assert.equal(defaultRelay(), 'ws://127.0.0.1:8788/relay', 'file protocol falls back to localhost relay');
  } finally {
    globalThis.location = prevLoc;
    globalThis.localStorage = prevStorage;
  }
}

// 2. relay-core.js Mock WebSocketPair 測試
function makeWsPairCtor(created) {
  return class MockWebSocketPair {
    constructor() {
      const makeSide = name => ({
        name,
        accepted: false,
        closed: false,
        closeCode: null,
        closeReason: '',
        sent: [],
        attachment: null,
        accept() { this.accepted = true; },
        send(data) { if (!this.closed) this.sent.push(String(data)); },
        close(code = 1000, reason = '') { this.closed = true; this.closeCode = code; this.closeReason = reason; },
        serializeAttachment(v) { this.attachment = structuredClone(v); },
        deserializeAttachment() { return this.attachment; },
      });
      this[0] = makeSide('client');
      this[1] = makeSide('server');
      created.push(this[1]);
    }
  };
}

function makeCtx() {
  const sockets = [];
  return {
    sockets,
    acceptWebSocket(ws) { ws.accept(); sockets.push(ws); },
    getWebSockets() { return sockets.filter(s => !s.closed); },
  };
}

const createdPairs = [];
const Pair = makeWsPairCtor(createdPairs);
const wsResponse = client => ({ status: 101, webSocket: client });

// 2a. Origin 白名單
assert.equal(isOriginAllowed(null, 'https://game.lijiabao.uk'), true);
assert.equal(isOriginAllowed('https://game.lijiabao.uk', 'https://game.lijiabao.uk,http://localhost'), true);
assert.equal(isOriginAllowed('https://lijiabao1998.github.io', 'https://lijiabao1998.github.io'), true);
assert.equal(isOriginAllowed('https://lijiabao.uk', 'https://lijiabao.uk'), true);
assert.equal(isOriginAllowed('http://localhost:8401', 'http://localhost'), true);
assert.equal(isOriginAllowed('http://127.0.0.1:8788', 'http://127.0.0.1'), true);
assert.equal(isOriginAllowed('http://localhost.evil.com', 'http://localhost'), false);
assert.equal(isOriginAllowed('https://evil.example', 'https://game.lijiabao.uk'), false);

// 2b. handleRelayRequest HTTP 路由與 Origin 擋關
const envBase = {
  ALLOWED_ORIGINS: 'https://lijiabao1998.github.io,https://game.lijiabao.uk,https://lijiabao.uk,http://localhost,http://127.0.0.1',
  ROOMS: { idFromName: x => x, get: () => ({ fetch: async () => new Response('forwarded') }) },
};
{
  const r1 = await handleRelayRequest(new Request('https://relay.example/health'), envBase, { WebSocketPairCtor: Pair, wsResponse });
  assert.equal(r1.status, 200);
  assert.deepEqual(await r1.json(), { ok: true, service: 'glimmertown-rts-relay' });

  const rRoot = await handleRelayRequest(new Request('https://relay.example/'), envBase, { WebSocketPairCtor: Pair, wsResponse });
  assert.equal(rRoot.status, 200);

  const r404 = await handleRelayRequest(new Request('https://relay.example/other'), envBase, { WebSocketPairCtor: Pair, wsResponse });
  assert.equal(r404.status, 404);

  const r426 = await handleRelayRequest(new Request('https://relay.example/relay?room=ABCD'), envBase, { WebSocketPairCtor: Pair, wsResponse });
  assert.equal(r426.status, 426);

  const r403 = await handleRelayRequest(
    new Request('https://relay.example/relay?room=ABCD', { headers: { upgrade: 'websocket', origin: 'https://evil.example' } }),
    envBase,
    { WebSocketPairCtor: Pair, wsResponse },
  );
  assert.equal(r403.status, 403);

  const rFwd = await handleRelayRequest(
    new Request('https://relay.example/relay?room=abcd&role=host', { headers: { upgrade: 'websocket', origin: 'https://lijiabao1998.github.io' } }),
    envBase,
    { WebSocketPairCtor: Pair, wsResponse },
  );
  assert.equal(await rFwd.text(), 'forwarded');
}

// 2c. RelayRoomCore 完整房間生命週期、Hibernation 拒連／關閉握手與防串房
const ctx = makeCtx();
const room = new RelayRoomCore(ctx, { WebSocketPairCtor: Pair, wsResponse });
const req = query => new Request(`https://relay.example/relay?${query}`, { headers: { upgrade: 'websocket' } });

await room.fetch(req('room=bad-room!&role=host'));
{
  const denied = createdPairs.at(-1);
  assert.equal(ctx.sockets.length, 0, '#deny does not register rejected socket in ctx.sockets');
  assert.equal(denied.accepted, true);
  assert.deepEqual(JSON.parse(denied.sent[0]), { t: 'error', why: '房號只能是 1–12 個英文字母或數字' });
  assert.equal(denied.closed, true);
  assert.equal(denied.closeCode, 1000);
}

await room.fetch(req('room=ab12&role=join'));
{
  const denied = createdPairs.at(-1);
  assert.equal(ctx.sockets.length, 0);
  assert.equal(denied.accepted, true);
  assert.deepEqual(JSON.parse(denied.sent[0]), { t: 'error', why: '沒有這個房號（房主還沒開房，或已經離開了）' });
  assert.equal(denied.closed, true);
}

await room.fetch(req('room=ab12&role=host'));
const hostWs = ctx.sockets[0];
assert.deepEqual(JSON.parse(hostWs.sent[0]), { t: 'welcome', you: 0, room: 'AB12', players: 1 });

await room.fetch(req('room=ab12&role=host'));
{
  const denied = createdPairs.at(-1);
  assert.equal(ctx.sockets.length, 1);
  assert.deepEqual(JSON.parse(denied.sent[0]), { t: 'error', why: '這個房號已經有人開了' });
  assert.equal(denied.closed, true);
}

await room.fetch(req('room=ab12&role=join'));
const guestWs = ctx.sockets[1];
assert.deepEqual(JSON.parse(guestWs.sent[0]), { t: 'welcome', you: 1, room: 'AB12', players: 2 });
assert.deepEqual(JSON.parse(hostWs.sent[1]), { t: 'joined', who: 1 });

await room.fetch(req('room=ab12&role=join'));
{
  const denied = createdPairs.at(-1);
  assert.equal(ctx.sockets.length, 2);
  assert.deepEqual(JSON.parse(denied.sent[0]), { t: 'error', why: '這個房間滿了' });
  assert.equal(denied.closed, true);
  assert.equal(denied.closeCode, 1000);
}

await room.webSocketMessage(hostWs, JSON.stringify({ t: 'start', seed: 7 }));
assert.deepEqual(JSON.parse(guestWs.sent[1]), { t: 'start', seed: 7, from: 0 });
assert.equal(hostWs.sent.length, 2);

await room.webSocketMessage(guestWs, JSON.stringify({ t: 'tick', tick: 5 }));
assert.deepEqual(JSON.parse(hostWs.sent[2]), { t: 'tick', tick: 5, from: 1 });

await room.webSocketMessage(guestWs, '[1,2,3]');
await room.webSocketMessage(guestWs, 'not-json');
assert.equal(hostWs.sent.length, 3);

// Binary kicked -> notifies host with left(1) and closes 1003
await room.webSocketMessage(guestWs, new Uint8Array([1, 2]));
assert.equal(guestWs.closed, true);
assert.equal(guestWs.closeCode, 1003);
assert.deepEqual(JSON.parse(hostWs.sent[3]), { t: 'left', who: 1 });

// Host oversized message kicked -> closes 1009 (and calls #leave cleanly)
await room.webSocketMessage(hostWs, 'x'.repeat(MAX_MESSAGE + 1));
assert.equal(hostWs.closed, true);
assert.equal(hostWs.closeCode, 1009);

// 房主離線（回送 Close 握手）、模擬 Hibernation 重建後重開同一房號：舊客端必須無法串進新房間
const ctx2 = makeCtx();
const room2 = new RelayRoomCore(ctx2, { WebSocketPairCtor: Pair, wsResponse });
await room2.fetch(req('room=R1&role=host'));
const h1 = ctx2.sockets[0];
await room2.fetch(req('room=R1&role=join'));
const g1 = ctx2.sockets[1];
await room2.webSocketClose(h1, 1000, 'done');
assert.equal(h1.closed, true, 'webSocketClose echoes ws.close back to client');
assert.equal(h1.closeCode, 1000);
assert.equal(h1.closeReason, 'done');
assert.deepEqual(JSON.parse(g1.sent[1]), { t: 'left', who: 0 });

// Reserved WebSocket close code (e.g. 1005) falls back to 1000
const ctx3 = makeCtx();
const room3 = new RelayRoomCore(ctx3, { WebSocketPairCtor: Pair, wsResponse });
await room3.fetch(req('room=R2&role=host'));
const h3 = ctx3.sockets[0];
await room3.webSocketClose(h3, 1005, '');
assert.equal(h3.closed, true);
assert.equal(h3.closeCode, 1000);

const room2AfterHibernate = new RelayRoomCore(ctx2, { WebSocketPairCtor: Pair, wsResponse });
await room2AfterHibernate.fetch(req('room=R1&role=host'));
const h2 = ctx2.sockets[2];
assert.deepEqual(JSON.parse(h2.sent[0]), { t: 'welcome', you: 0, room: 'R1', players: 1 });
await room2AfterHibernate.webSocketMessage(g1, JSON.stringify({ t: 'tick', tick: 99 }));
assert.equal(h2.sent.length, 1);

// 3. wrangler.toml 與 client.ts 接線檢查
const wranglerToml = read('server/cf-relay/wrangler.toml');
assert(wranglerToml.includes('name = "glimmertown-rts-relay"'), 'wrangler.toml sets Worker name');
assert(wranglerToml.includes('new_sqlite_classes = ["RelayRoom"]'), 'wrangler.toml uses SQLite Durable Objects');
assert(wranglerToml.includes('https://lijiabao1998.github.io') && wranglerToml.includes('https://game.lijiabao.uk'), 'wrangler.toml allows Pages and game.lijiabao.uk');
assert(read('src/net/client.ts').includes("export const PUBLIC_RELAY = 'wss://glimmertown-rts-relay.lijiabao1998.workers.dev/relay';"), 'client.ts exposes PUBLIC_RELAY');

console.log('OK relay-public1012: defaultRelay, cf-relay protocol, hibernation isolation, wiring');
