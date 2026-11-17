// R083 鎖步：每個人只送自己下的指令，各自跑同一個決定性的模擬（同一個種子＋同一串指令＝同一局）。
// 走第 t 步（t ≥ from）時，每個玩家送一包「第 t＋delay 步要執行的指令」（沒有指令也送空包）；第 from…from＋delay−1 步預先當成大家都送了空包。
// 第 t 步要等所有還在的玩家的包都到了才走；指令照玩家編號、再照下的先後合在一起（跟到達的先後無關）。
// 每 NET_HASH_EVERY 步各自算一次世界雜湊、送給對方；不一樣就停在那一步（desync）。
// R085 對戰（versus）：玩家 p 指揮第 p 方；第 from 步以後每一包只留 side＝p 的指令（沒有 side 的也丟），雙方用同一個規則，結果一樣。第 0 步的開局不篩。
// 純邏輯：不碰網路、不碰畫面、不碰時鐘（src/net/session.ts 接網路；tests/net-lockstep.mjs 直接測）。
import type { Command } from '../sim/step.ts';
import { isCommand } from '../sim/commandCheck.ts';

export const NET_DELAY = 4;          // 0.2 秒（20 步／秒）
export const NET_HASH_EVERY = 100;   // 5 秒比一次
// R085 對戰的開局（第 0 步，房主送）：地圖、規則、補給這類沒有 side 的、房主自己那一方（第 0 方）的、左上那一方的布陣（build、trench：電腦代排）；
// 不能有 ai、不能替左上那一方下別的指令（審查）。第 1 步以後：只收那個玩家自己那一方的、也不收 ai（審查：對戰沒有電腦）
export const versusOpening = (c: { t: string; side?: unknown }): boolean => c.t !== 'ai' && (c.side === undefined || c.side === 0 || c.t === 'build' || c.t === 'trench');
export type NetPacket = { t: 'tick'; at: number; cmds: Command[] } | { t: 'hash'; at: number; h: string };

export class Lockstep {
  readonly me: number; readonly from: number; readonly delay: number; readonly versus: boolean;
  private players: number[];
  private got = new Map<number, Map<number, Command[]>>();     // 第幾步 → 玩家 → 指令
  private last = new Map<number, number>();                   // 玩家 → 收到的最後一包是第幾步
  private gone = new Set<number>();
  private sums = new Map<number, Map<number, string>>();      // 第幾步 → 玩家 → 雜湊
  desync = -1;                                                // 不同步的那一步（−1＝沒有）
  checks = 0;                                                 // 雜湊比過、一樣的次數

  constructor(me: number, players: number[], from: number, delay = NET_DELAY, versus = false) {
    this.me = me; this.from = from; this.delay = delay; this.versus = versus; this.players = [...players].sort((a, b) => a - b);
    for (let t = from; t < from + delay; t++) for (const p of this.players) this.put(t, p, []);
  }
  // 某個玩家第 t 步的指令（收到的包、預先的空包、房主第 0 步的布陣都走這裡）；不合格式的指令丟掉（雙方用同一個檢查，結果一樣）
  put(t: number, p: number, cmds: readonly unknown[]): void {
    if (!this.players.includes(p) || !Number.isInteger(t) || t < 0) return;
    let at = this.got.get(t);
    if (!at) this.got.set(t, (at = new Map()));
    if (at.has(p)) return;   // 同一步同一個人只收第一包
    at.set(p, cmds.filter(c => isCommand(c) && (!this.versus || (t < this.from ? versusOpening(c as Command) : (c as Command).t !== 'ai' && (c as { side?: unknown }).side === p))) as Command[]);   // R085 對戰：只收自己那一方的
    if (t > (this.last.get(p) ?? -1)) this.last.set(p, t);
  }
  // 第 t 步可以走了嗎：每個還在的玩家都有這一步的包；離開的人只等到他最後一包
  ready(t: number): boolean {
    if (this.desync >= 0) return false;
    const at = this.got.get(t);
    return this.players.every(p => at?.has(p) || (this.gone.has(p) && t > (this.last.get(p) ?? -1)));
  }
  // 走第 t 步之前呼叫：回傳合好的指令，與這一步要送出去的包（第 t＋delay 步的自己的指令；每 NET_HASH_EVERY 步多一包雜湊）
  take(t: number, mine: readonly Command[], hash?: () => string): { cmds: Command[]; out: NetPacket[] } {
    if (!this.ready(t)) throw new Error(`lockstep: step ${t} is not ready`);
    const at = this.got.get(t)!, cmds: Command[] = [];
    for (const p of this.players) cmds.push(...(at?.get(p) ?? []));
    this.got.delete(t);
    const out: NetPacket[] = [];
    if (t >= this.from) {
      const own = mine.filter(c => isCommand(c)).map(c => structuredClone(c)) as Command[];
      this.put(t + this.delay, this.me, own);
      out.push({ t: 'tick', at: t + this.delay, cmds: own });
      if (hash && t % NET_HASH_EVERY === 0) { const h = hash(); this.sum(t, this.me, h); out.push({ t: 'hash', at: t, h }); }
    }
    return { cmds, out };
  }
  receive(from: number, msg: NetPacket): void {
    if (from === this.me || this.gone.has(from)) return;   // R083 第二輪審查：離開的人那個位置被別人佔了，新來的人送的包不收（不然能讓房主卡住或判成不同步）
    if (msg.t === 'tick' && Array.isArray(msg.cmds)) this.put(msg.at, from, msg.cmds);
    else if (msg.t === 'hash' && typeof msg.h === 'string' && Number.isInteger(msg.at)) this.sum(msg.at, from, msg.h);
  }
  leave(p: number): void { if (p !== this.me) this.gone.add(p); }
  stillHere(): number[] { return this.players.filter(p => !this.gone.has(p)); }
  private sum(t: number, p: number, h: string): void {
    let at = this.sums.get(t);
    if (!at) this.sums.set(t, (at = new Map()));
    at.set(p, h);
    const mine = at.get(this.me);
    if (mine === undefined) return;
    for (const [q, hq] of at) {
      if (q === this.me) continue;
      if (hq !== mine) { if (this.desync < 0 || t < this.desync) this.desync = t; }
      else this.checks++;
    }
    if ([...at.keys()].length >= this.players.length) this.sums.delete(t);
  }
}
