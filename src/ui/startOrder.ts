// R041 開戰命令條：取代 R016 的發光大字「開戰！」。一張小小的作戰命令：在哪裡、對手是誰、怎樣算贏。
// 只顯示文字、不吃點擊、不碰世界；約 2.8 秒自己收掉。?noR041=1 回到 R016 的大字。
export interface StartOrder { place: string; title: string; goal: string }

export const START_ORDER_MS = 2800;

// 文字只看開局設定：地圖、有沒有指揮部（R019）、電腦難度（R018）
export function startOrderText(map: number, eco: boolean, ai: string | undefined, zombies = false): StartOrder {
  const where = map === 1 ? '萊伊（Rye），1940 年夏' : map === 2 ? '英格蘭東南鄉間（64×64），1940 年夏' : map === 3 ? '英格蘭河鎮與村落（96×96），1940 年夏' : '英格蘭東南的村莊，1940 年夏';
  return {
    place: zombies ? `${where} · 喪屍防守` : ai ? `${where} · 敵方由電腦指揮（${ai}）` : where,
    title: '作戰開始',
    goal: zombies ? `喪屍從地圖邊緣湧來。${eco ? '守住指揮部' : '保住我方部隊'}，撐越多波越好。` : eco ? '守住我方指揮部，打掉敵方指揮部就贏。' : '擊毀全部敵軍就贏。',
  };
}

export function showStartOrder(parent: HTMLElement, o: StartOrder): HTMLElement {
  const el = document.createElement('div');
  el.id = 'start-order';
  el.setAttribute('role', 'status');
  for (const [cls, text] of [['so-place', o.place], ['so-title', o.title], ['so-goal', o.goal]]) {
    const p = document.createElement('p');
    p.className = cls; p.textContent = text;
    el.appendChild(p);
  }
  parent.appendChild(el);
  setTimeout(() => el.remove(), START_ORDER_MS + 100);   // 只是畫面上的字，跟模擬無關
  return el;
}
