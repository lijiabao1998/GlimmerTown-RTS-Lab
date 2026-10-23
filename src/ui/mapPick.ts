// R043 地圖鍵：布陣時在左上（「沙盒模式」旁邊）切換萊伊 32×32 與鄉間 64×64。只顯示狀態、只呼叫傳進來的動作，不碰世界。
interface MapPickState { show: boolean; large: boolean; rye: boolean }
export interface MapPick { update: () => void }

export const MAP_LABEL = { rye: '地圖：萊伊', village: '地圖：村莊', large: '地圖：鄉間大圖' } as const;   // 手機窄：字短，不碰右上的小地圖

export function initMapPick(a: { state: () => MapPickState; toggle: () => void }): MapPick {
  const btn = document.createElement('button');
  btn.id = 'map-pick';
  btn.addEventListener('click', e => { e.stopPropagation(); a.toggle(); update(); });
  document.body.appendChild(btn);
  function update() {
    const s = a.state(), text = s.large ? MAP_LABEL.large : s.rye ? MAP_LABEL.rye : MAP_LABEL.village;
    btn.title = `在${s.rye ? '萊伊' : '村莊'}（32×32）與英格蘭東南鄉間大地圖（64×64）之間切換；換了回到布陣第 0 步`;
    if (btn.hidden !== !s.show) btn.hidden = !s.show;
    if (btn.textContent !== text) btn.textContent = text;
    btn.setAttribute('aria-pressed', String(s.large));
  }
  update();
  return { update };
}
