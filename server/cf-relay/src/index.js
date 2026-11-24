// R1012 公開連線轉發伺服器進入點：Cloudflare Workers + SQLite Durable Objects（免費方案）。
import { DurableObject } from 'cloudflare:workers';
import { RelayRoomCore, handleRelayRequest } from './relay-core.js';

export default {
  async fetch(request, env) {
    return handleRelayRequest(request, env);
  },
};

export class RelayRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.core = new RelayRoomCore(ctx);
  }

  async fetch(request) {
    return this.core.fetch(request);
  }

  async webSocketMessage(ws, message) {
    return this.core.webSocketMessage(ws, message);
  }

  async webSocketClose(ws) {
    return this.core.webSocketClose(ws);
  }

  async webSocketError(ws) {
    return this.core.webSocketError(ws);
  }
}
