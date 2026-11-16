// R075 看得懂：選中單位的規格與狀態（只讀，不改模擬）。開著穿甲規則寫厚度與穿深，開著士氣規則寫壓制狀態。
// 數字直接讀模擬用的表與函式（ballistics.ts、world.ts 的 moraleState），不另外抄一份。
import { ARMOR_MM, PEN_MM, penetration } from '../sim/ballistics.ts';
import { SUB, UNIT_KINDS, UK_ZOMBIE, SIDE_PLAYER, cellOf, moraleState, type World } from '../sim/world.ts';
import { heightAt } from '../sim/terrain.ts';

export const MORALE_NAME = ['穩定', '受壓', '釘住', '潰退'];

// 選中的我方單位（活著的）的一行字，前面接 lead；兩條擬真規則都沒開、沒選到東西、或沒有可寫的：空字串（連 lead 都沒有）
export function unitSpec(w: World, selected: ReadonlySet<number>, enabled = true, lead = ''): string {
  if (!enabled || (!w.rules?.ap && !w.rules?.morale && !w.height)) return '';
  const sel = w.units.filter(u => selected.has(u.id) && u.alive && u.side === SIDE_PLAYER);
  if (!sel.length) return '';
  const parts: string[] = [];
  if (w.rules?.ap && sel.every(u => u.kind === sel[0].kind)) {   // 厚度與穿深只在選中同一種單位時寫（混選一行寫不下）
    const kind = sel[0].kind, k = UNIT_KINDS[kind], plate = ARMOR_MM[kind];
    if (plate && k.armored) parts.push(`裝甲 正 ${plate[0]}／側 ${plate[1]}／後 ${plate[2]} 公釐`);
    if (PEN_MM[kind] && !k.indirect) parts.push(`穿深 近 ${penetration(kind, SUB)}／遠 ${penetration(kind, k.range)} 公釐`);
  }
  if (w.rules?.morale) {
    const n = [0, 0, 0, 0];
    for (const u of sel) if (!UNIT_KINDS[u.kind].armored && u.kind !== UK_ZOMBIE) n[moraleState(u)]++;   // 會被壓制的：沒有裝甲的（跟 morale.ts 的 suppressible 同一個條件）
    if (n[0] + n[1] + n[2] + n[3]) parts.push(n[1] + n[2] + n[3] === 0 ? '士氣穩定' : `士氣：${n.map((c, i) => (c ? `${MORALE_NAME[i]} ${c}` : '')).filter(Boolean).join('、')}`);
  }
  if (w.height) {   // R055：站在高處的寫高度（都在平地就不寫）
    const hs = sel.map(u => heightAt(w, cellOf(u.x), cellOf(u.z))), lo = Math.min(...hs), hi = Math.max(...hs);
    if (hi > 0) parts.push(lo === hi ? `高度 ${hi}` : `高度 ${lo}–${hi}`);
  }
  return parts.length ? lead + parts.join('；') : '';
}
