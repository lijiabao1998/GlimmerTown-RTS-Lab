import { MAP_ENTRIES } from '../sim/mapRegistry.ts';
import { MAP_RYE } from '../sim/maps.ts';
import { MAP_LARGE } from '../sim/largeMap.ts';
import { MAP_TOWN } from '../sim/expandedMap.ts';
// R043 地圖鍵：布陣時在左上（「沙盒模式」旁邊）切換萊伊 32×32 與鄉間 64×64。只顯示狀態、只呼叫傳進來的動作，不碰世界。
interface MapPickState { show: boolean; large: boolean; rye: boolean; expanded?: boolean }
export interface MapPick { update: () => void }

const label = (id: number): string => MAP_ENTRIES.find(m => m.id === id)!.label;
export const MAP_LABEL = { rye: label(MAP_RYE), village: '地圖：村莊', large: label(MAP_LARGE) } as const;   // 手機窄：字短，不碰右上的小地圖

export function initMapPick(a: { state: () => MapPickState; toggle: () => void }): MapPick {
  const btn = document.createElement('button');
  btn.id = 'map-pick';
  btn.addEventListener('click', e => { e.stopPropagation(); a.toggle(); update(); });
  document.body.appendChild(btn);
  function update() {
    const s = a.state(), text = s.expanded ? label(MAP_TOWN) : s.large ? MAP_LABEL.large : s.rye ? MAP_LABEL.rye : MAP_LABEL.village;
    btn.title = `在${s.rye ? '萊伊' : '村莊'}（32×32）與英格蘭東南鄉間大地圖（64×64）之間切換；換了回到布陣第 0 步`;
    if (btn.hidden !== !s.show) btn.hidden = !s.show;
    if (btn.textContent !== text) btn.textContent = text;
    btn.setAttribute('aria-pressed', String(s.large));
  }
  update();
  return { update };
}

// R130：獨立入口保留原有 32↔64 地圖鍵的操作順序，窄螢幕放在第二列左側。
export function initTownPick(a: { state: () => { show: boolean; expanded: boolean }; toggle: () => void }): MapPick {
  const btn = document.createElement('button'); btn.id = 'town-pick';
  btn.addEventListener('click', e => { e.stopPropagation(); a.toggle(); update(); });
  document.body.appendChild(btn);
  function update() {
    const s = a.state(); btn.hidden = !s.show;
    btn.textContent = s.expanded ? '返回32×32' : '96×96 河鎮';
    btn.title = '切換 96×96 河鎮與原有 32×32 地圖；換圖回到布陣第 0 步';
    btn.setAttribute('aria-pressed', String(s.expanded));
  }
  update(); return { update };
}
