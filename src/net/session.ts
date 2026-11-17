// R083 連線的一局：房主開戰時把種子與第 0 步的指令送給對方；對方照重播那一條路建一樣的世界；之後每一步走鎖步。
// 不碰 DOM、不碰 WebSocket：網路由呼叫的人接（src/net/client.ts 接真的 WebSocket，tests/net-lockstep.mjs 接假的）。
import type { World } from '../sim/world.ts';
import type { Command, LoggedCommand } from '../sim/step.ts';
import { Lockstep, NET_DELAY, versusOpening, type NetPacket } from './lockstep.ts';

export interface NetHost {
  world(): World;
  log(): LoggedCommand[];
  hash(): string;
  phase(): string;
  begin(seed: number): void;    // 加入的人：建一個這個種子的空世界（同重播的開頭）
  tick(): void;                 // 走一步（指令由 feed 給）
  remake(): void;               // 第 0 步走完之後重建畫面（同重播）
  focus(): void;                // 鏡頭對準我方（大地圖；R085 左上那一方照地圖中心對折）
  versus?: boolean;             // R085：開了「連線對戰」（閥 ?noR085=1 關掉）
}
export type Role = 'host' | 'join';
// 經由轉發伺服器的訊息：伺服器發的（welcome、joined、left、error）與玩家之間的（start、tick、hash、ping、pong）
export type NetMsg =
  | { t: 'welcome'; you: number; room: string; players: number } | { t: 'joined'; who: number } | { t: 'left'; who: number } | { t: 'error'; why: string }
  | { t: 'start'; seed: number; setup: Command[]; delay: number; vs?: 1 } | NetPacket | { t: 'ping'; id: number } | { t: 'pong'; id: number };
export type NetState = 'connecting' | 'waiting' | 'ready' | 'live' | 'ended' | 'error';

export class Session {
  readonly role: Role;
  me = -1; room = ''; peer = false; state: NetState = 'connecting'; why = ''; started = -1;
  versus: boolean;   // R085 對戰：房主開房時定；加入的人照房主的開局（start 帶 vs）
  ls: Lockstep | null = null;
  peerLeft = false;
  world: World | null = null;
  private early: (NetPacket & { from?: number })[] = [];   // 加入的人在收到開局之前先到的包（真的伺服器照順序轉，不會發生；保險）   // 這一局連線的世界：本機換了世界（重開、回主選單、看重播、沙盒、讀存檔）＝這一局結束（R083 審查）
  private host: NetHost; private send: (m: NetMsg) => void;
  constructor(role: Role, host: NetHost, send: (m: NetMsg) => void, versus = false) { this.role = role; this.host = host; this.send = send; this.versus = role === 'host' && versus; }

  live(): boolean { return !!this.ls; }
  // 本機的世界換掉了：這一局連線已經不算數（client.ts 看到就斷線，對方收到「離開」自己繼續打）
  stale(): boolean { return !!this.ls && this.host.world() !== this.world; }
  // 自己跟伺服器斷線：對方的包不會再來了——跟對方離線一樣，從他最後一包之後不再等他（R083 審查）
  disconnected(): void {
    if (this.ls) { for (const p of this.ls.stillHere()) if (p !== this.me) this.ls.leave(p); this.peer = false; this.peerLeft = true; this.why = '跟伺服器斷線了：你繼續打'; }
    else if (this.state !== 'error') { this.state = 'ended'; if (!this.why) this.why = '跟伺服器斷線了'; }
  }
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
      // R085 對戰：不叫電腦、不替左上那一方下指令（布陣除外）——開局送出去之前照 versusOpening 篩，自己的紀錄也篩；喪屍模式沒有左上那一方，照合作開
      const vs = this.versus && !w.zombies, setup = vs ? pending.filter(versusOpening) : pending;
      if (vs) { const log = this.host.log(); for (let i = log.length - 1; i >= 0; i--) if (log[i].tick === 0 && !versusOpening(log[i].cmd)) log.splice(i, 1); }
      this.send({ t: 'start', seed: w.seed, setup: setup.map(c => structuredClone(c)), delay: NET_DELAY, ...(vs ? { vs: 1 as const } : {}) });
      this.versus = vs;
      this.ls = new Lockstep(0, [0, 1], 1, NET_DELAY, vs); this.world = w;
      this.state = 'live'; this.started = 0;
      return vs ? setup.slice() : null;
    }
    return null;
  }
  receive(m: NetMsg & { from?: number }): void {
    switch (m.t) {
      case 'welcome': this.me = m.you; this.room = m.room; this.peer = m.players > 1; this.state = this.role === 'host' ? 'ready' : 'waiting'; return;
      case 'joined': if (!this.ls && this.host.world().tick === 0) { this.peer = true; this.peerLeft = false; } else this.send({ t: 'error', why: this.ls ? '這一局已經開打了（斷線不能重連），下一局再加入' : '已經開打了，下一局再加入' } as NetMsg); return;   // R083 第二輪審查：開打之後才來的人也要告訴他
      case 'left': this.peer = false; this.peerLeft = true; this.ls?.leave(m.who); if (!this.ls && this.role === 'join') { this.state = 'ended'; this.why = '房主離開了'; } return;
      case 'error': if (!this.ls) { this.state = 'error'; this.why = m.why; } return;
      case 'start': if (this.role === 'join' && !this.ls && (m.from ?? 0) === 0) this.begin(m.seed, m.setup, m.vs === 1); return;
      case 'tick': case 'hash': if (this.ls) this.ls.receive(m.from ?? -1, m); else if (this.role === 'join' && this.early.length < 1000) this.early.push(m); return;
      case 'ping': this.send({ t: 'pong', id: m.id }); return;
    }
  }
  private begin(seed: number, setup: Command[], versus: boolean): void {
    this.versus = versus;   // 先定（client.ts 包的 begin 照它換「我方」）
    this.host.begin(seed);
    this.world = this.host.world();
    const ls = new Lockstep(1, [0, 1], 1, NET_DELAY, versus);
    ls.put(0, 0, setup); ls.put(0, 1, []);
    for (const e of this.early) ls.receive(e.from ?? -1, e);
    this.early = [];
    this.ls = ls; this.state = 'live'; this.started = 0;
    this.host.tick();      // 第 0 步：房主的開局（feed 從鎖步拿）
    this.host.remake();
    this.host.focus();
  }
}
