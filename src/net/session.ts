// R083 連線的一局：房主開戰時把種子與第 0 步的指令送給對方；對方照重播那一條路建一樣的世界；之後每一步走鎖步。
// 不碰 DOM、不碰 WebSocket：網路由呼叫的人接（src/net/client.ts 接真的 WebSocket，tests/net-lockstep.mjs 接假的）。
import type { World } from '../sim/world.ts';
import type { Command, LoggedCommand } from '../sim/step.ts';
import { Lockstep, NET_DELAY, type NetPacket } from './lockstep.ts';

export interface NetHost {
  world(): World;
  log(): LoggedCommand[];
  hash(): string;
  phase(): string;
  begin(seed: number): void;    // 加入的人：建一個這個種子的空世界（同重播的開頭）
  tick(): void;                 // 走一步（指令由 feed 給）
  remake(): void;               // 第 0 步走完之後重建畫面（同重播）
  focus(): void;                // 鏡頭對準我方（大地圖）
}
export type Role = 'host' | 'join';
// 經由轉發伺服器的訊息：伺服器發的（welcome、joined、left、error）與玩家之間的（start、tick、hash、ping、pong）
export type NetMsg =
  | { t: 'welcome'; you: number; room: string; players: number } | { t: 'joined'; who: number } | { t: 'left'; who: number } | { t: 'error'; why: string }
  | { t: 'start'; seed: number; setup: Command[]; delay: number } | NetPacket | { t: 'ping'; id: number } | { t: 'pong'; id: number };
export type NetState = 'connecting' | 'waiting' | 'ready' | 'live' | 'ended' | 'error';

export class Session {
  readonly role: Role;
  me = -1; room = ''; peer = false; state: NetState = 'connecting'; why = ''; started = -1;
  ls: Lockstep | null = null;
  peerLeft = false;
  private host: NetHost; private send: (m: NetMsg) => void;
  constructor(role: Role, host: NetHost, send: (m: NetMsg) => void) { this.role = role; this.host = host; this.send = send; }

  live(): boolean { return !!this.ls; }
  ready(t: number): boolean { return !this.ls || this.ls.ready(t); }
  // tick() 裡拿這一步的指令：沒有在鎖步時回傳 null（照舊用 pending／重播）。房主開戰的第 0 步在這裡把開局送出去。
  feed(w: World, pending: readonly Command[]): Command[] | null {
    if (this.ls) {
      const t = w.tick, { cmds, out } = this.ls.take(t, pending, () => this.host.hash());
      for (const m of out) this.send(m);
      const log = this.host.log();
      for (const c of cmds) log.push({ tick: t, cmd: structuredClone(c) });
      return cmds;
    }
    if (this.role === 'host' && this.state === 'ready' && this.peer && w.tick === 0 && this.host.phase() === 'battle' && !w.sandbox) {
      this.send({ t: 'start', seed: w.seed, setup: pending.map(c => structuredClone(c)), delay: NET_DELAY });
      this.ls = new Lockstep(0, [0, 1], 1);
      this.state = 'live'; this.started = 0;
    }
    return null;
  }
  receive(m: NetMsg & { from?: number }): void {
    switch (m.t) {
      case 'welcome': this.me = m.you; this.room = m.room; this.peer = m.players > 1; this.state = this.role === 'host' ? 'ready' : 'waiting'; return;
      case 'joined': if (!this.ls && this.host.world().tick === 0) this.peer = true; else if (!this.ls) this.send({ t: 'error', why: '已經開打了，下一局再加入' } as NetMsg); return;
      case 'left': this.peer = false; this.peerLeft = true; this.ls?.leave(m.who); if (!this.ls && this.role === 'join') { this.state = 'ended'; this.why = '房主離開了'; } return;
      case 'error': if (!this.ls) { this.state = 'error'; this.why = m.why; } return;
      case 'start': if (this.role === 'join' && !this.ls && (m.from ?? 0) === 0) this.begin(m.seed, m.setup); return;
      case 'tick': case 'hash': this.ls?.receive(m.from ?? -1, m); return;
      case 'ping': this.send({ t: 'pong', id: m.id }); return;
    }
  }
  private begin(seed: number, setup: Command[]): void {
    this.host.begin(seed);
    const ls = new Lockstep(1, [0, 1], 1);
    ls.put(0, 0, setup); ls.put(0, 1, []);
    this.ls = ls; this.state = 'live'; this.started = 0;
    this.host.tick();      // 第 0 步：房主的開局（feed 從鎖步拿）
    this.host.remake();
    this.host.focus();
  }
}
