// R092 運輸：生產列 R142 分組選單裡的「運輸」一組、「搭車」浮動鍵、每一幀把車上的人從選取拿掉。
// 那一組有沒有看這一頁的閥（main.ts），能不能按看世界的 tp（productionBlockReason）。「搭車」只改選取、不送指令（鎖步連線不受影響）。
import { UK_TRUCK, UK_HALFTRACK, UNIT_KINDS, ORD_IDLE, type World } from '../sim/world.ts';
import { SIDE_PLAYER } from '../side.ts';   // R085「我方」可以換（連線對戰）
import { match92, pinned92 } from '../sim/transport92.ts';

export const transport92Items = () => [
  { kind: UK_TRUCK, label: '卡車', cost: UNIT_KINDS[UK_TRUCK].cost, group: '運輸', role: '卡車 · 跟一班步兵或一門砲一起選，點地面＝載過去，到了就放下；一打就爛，車上的人會受傷' },
  { kind: UK_HALFTRACK, label: '半履帶', cost: UNIT_KINDS[UK_HALFTRACK].cost, group: '運輸', role: '半履帶車 · 步槍、機槍打不動；載法同卡車；怕反戰車武器' },
];

interface Read92 { world: World; selected: Set<number>; active: boolean }
// R030 照車配，跟模擬（hitch92）同一條 match92：我方每台活著、停著、空著、沒被釘住、沒潰退的車照 id 逐台，挑兩格內最近、選到的人或砲。
// 選到的拖著的砲也算（它的車沒被選，點地面那一步會先解掛）。回傳配到的車（要加進選取的）；沒配到的車不加，加了點地面也會空車開走。
// 正在開的車不加（自己有事、或是隊友在開）；按下到點地面之間有人、車走開或被釘住，那台車還是可能空著
export function pair92(w: World, selected: ReadonlySet<number>): number[] {
  const busy = new Set<number>();
  for (const u of w.units) if (u.alive) { if (u.ride) busy.add(u.ride); if (u.towBy) busy.add(u.towBy); }
  const sel = w.units.filter(u => selected.has(u.id) && u.alive);
  if (sel.some(u => UNIT_KINDS[u.kind].carry)) return [];   // 已經選了車：照選的配
  const mine = sel.filter(u => u.side === SIDE_PLAYER && !u.rout && !u.ride);   // 潰退中的不收指令（step.ts）
  const cars = w.units.filter(c => c.alive && c.side === SIDE_PLAYER && UNIT_KINDS[c.kind].carry && c.order === ORD_IDLE && !c.rout && !busy.has(c.id) && !pinned92(w, c));
  return match92(w, cars, mine).map(([c]) => c.id);
}

export function initTransport92(read: () => Read92, add: (ids: number[]) => void, pruned: () => void, opts: { show?: boolean } = {}): { frame: () => void } {
  let bar: HTMLElement | null = null, button: HTMLButtonElement | null = null;
  if (opts.show !== false && typeof document !== 'undefined') {
    bar = document.createElement('div'); bar.id = 'transport92'; bar.className = 'bar';
    document.querySelector('#hud')?.appendChild(bar);
    button = document.createElement('button'); button.id = 'b-ride'; button.type = 'button'; button.textContent = '搭車';
    button.title = '搭車：選到的人、砲各配一台兩格內的空車（只改選取）；再點地面＝兩格內的人上車、砲掛上，到了就放下'; button.setAttribute('aria-label', button.title);
    bar.appendChild(button);
    button.addEventListener('click', e => { e.stopPropagation(); const s = read(); const ids = pair92(s.world, s.selected); if (ids.length) add(ids); });
  }
  const frame = () => {
    const s = read();
    let cut = false;
    for (const id of [...s.selected]) { const u = s.world.units[id - 1]; if (u?.ride) { s.selected.delete(id); cut = true; } }   // 車上的人不能選
    if (cut) pruned();
    if (bar && button) { const show = s.active && !!s.world.eco?.tp && pair92(s.world, s.selected).length > 0; bar.hidden = !show; button.hidden = !show; }
  };
  frame();
  return { frame };
}
