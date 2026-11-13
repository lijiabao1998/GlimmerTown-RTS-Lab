// R047 指令檢查：外面來的指令紀錄（匯入的重播）進 step() 之前先過這一關。純函式、整數、不碰世界。
// step() 假設指令的形狀是對的（例如 move 一定有 ids 陣列）；形狀不對的東西在這裡擋掉，不讓它走到 step()。
// 只檢查形狀與範圍，不檢查「這一步下這個指令有沒有用」：那是 step() 自己的事（沒用的指令本來就會被略過）。
import type { Command, LoggedCommand } from './step.ts';

export const MAX_IDS = 256;           // 一條指令最多點幾個單位（每方人口上限 40、沙盒 32；留很大的餘裕）
export const MAX_LOG = 200000;        // 一份紀錄最多幾筆
export const MAX_TICK = 20 * 60 * 60 * 12;   // 一局最長 12 小時（每秒 20 步）
const LIMIT = 0x7fffffff;

const int = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= -LIMIT && v <= LIMIT;
const optInt = (v: unknown): boolean => v === undefined || int(v);
const side = (v: unknown): boolean => v === 0 || v === 1;
const ids = (v: unknown): boolean => Array.isArray(v) && v.length <= MAX_IDS && v.every(int);

export function isCommand(x: unknown): x is Command {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return false;
  const c = x as Record<string, unknown>;
  switch (c.t) {
    case 'move': return side(c.side) && ids(c.ids) && int(c.x) && int(c.z);
    case 'attack': return side(c.side) && ids(c.ids) && int(c.target);
    case 'fireAt': return side(c.side) && ids(c.ids) && int(c.x) && int(c.z) && (c.ammo === undefined || c.ammo === 'smoke');
    case 'fireDiscipline': return side(c.side) && ids(c.ids) && typeof c.hold === 'boolean';
    case 'stop': return side(c.side) && ids(c.ids);
    case 'build': case 'trench': return side(c.side) && int(c.kind) && int(c.x) && int(c.z) && optInt(c.rot);
    case 'ai': return side(c.side) && int(c.level);
    case 'map': return int(c.id) && optInt(c.vegetation);
    case 'eco': return optInt(c.inf) && optInt(c.guns) && optInt(c.tanks) && optInt(c.armor2) && optInt(c.soviet) && optInt(c.international);
    case 'produce': return side(c.side) && int(c.kind);
    case 'rules': return optInt(c.force) && optInt(c.income);
    case 'zombies': case 'sandboxReset': return true;
    case 'sandboxRun': return typeof c.running === 'boolean';
    case 'sandboxPlace': return side(c.side) && int(c.kind) && int(c.x) && int(c.z);
    default: return false;
  }
}

// 一份紀錄：每筆 { tick, cmd }，tick 是不往回走的非負整數。合格回傳 null，不合格回傳原因（給人看的一句話）
export function checkLog(log: unknown): string | null {
  if (!Array.isArray(log)) return '指令紀錄不是陣列';
  if (log.length > MAX_LOG) return `指令紀錄超過 ${MAX_LOG} 筆`;
  let last = 0;
  for (let i = 0; i < log.length; i++) {
    const e = log[i] as Partial<LoggedCommand> | null;
    if (typeof e !== 'object' || e === null) return `第 ${i + 1} 筆不是指令`;
    if (!int(e.tick) || e.tick < 0 || e.tick > MAX_TICK) return `第 ${i + 1} 筆的步數不對`;
    if (e.tick < last) return `第 ${i + 1} 筆的步數往回走`;
    if (!isCommand(e.cmd)) return `第 ${i + 1} 筆的指令格式不對`;
    last = e.tick;
  }
  return null;
}
