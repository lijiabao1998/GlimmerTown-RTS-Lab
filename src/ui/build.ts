// R006 布陣列：DOM（中文字不在 3D 裡畫）。只讀狀態、只呼叫傳進來的動作，不直接改世界。
// 擺在提示列正上方，手機 412×860 也不蓋住上方的條與提示列；每個按鈕至少 44×44 CSS 像素。

export interface BuildBarItem { kind: number; label: string; cost: number; detail?: string }
export interface BuildBarState { visible: boolean; kind: number; trench?: number; rot: number; rotatable: boolean; left: number; total: number; planned: number }
export interface BuildBarActions {
  state: () => BuildBarState;
  pick: (kind: number) => void;
  pickTrench?: (kind: number) => void;
  rotate: () => void;
  undo: () => void;
  start: () => void;
}
export interface BuildBar { update: () => void }

export function initBuildBar(items: BuildBarItem[], a: BuildBarActions, trenches: BuildBarItem[] = []): BuildBar {
  const root = document.createElement('div');
  root.id = 'buildbar';
  root.className = 'bar';
  root.innerHTML = `
    <div class="row">${items.map(it => `<button id="bb-k${it.kind}" title="${it.label}：建材 ${it.cost}">${it.label}<b>${it.cost}</b></button>`).join('')}
      ${trenches.length ? '<button id="bb-trench" title="戰壕：選形狀、轉向，任一方單位都能通行並獲得掩護" aria-expanded="false" aria-controls="bb-trenches">戰壕</button>' : ''}
      <button id="bb-rot" title="${trenches.length ? '轉向（磚房橫放／直放；戰壕每次90度）' : '轉向（磚房橫放／直放）'}">轉向</button>
      <button id="bb-undo" title="拿掉最後放下的一項，退回建材">復原</button></div>
    ${trenches.length ? `<div class="row" id="bb-trenches" hidden>${trenches.map(it => `<button id="bb-t${it.kind}" title="${it.label}：${it.detail ?? '建材 ' + it.cost}">${it.label}<b>${it.cost}</b></button>`).join('')}</div>` : ''}
    <div id="bb-detail" role="status" aria-live="polite"></div>
    <div class="row"><span id="bb-left"></span><button id="bb-start" title="布陣完成，開打">開戰</button></div>`;
  (document.getElementById('hud') ?? document.body).appendChild(root);
  const $ = (id: string) => root.querySelector('#' + id) as HTMLButtonElement;
  const act = (el: HTMLElement, f: () => void) => el.addEventListener('click', e => { e.stopPropagation(); f(); update(); });
  for (const it of items) act($('bb-k' + it.kind), () => a.pick(it.kind));
  if (trenches.length) {
    act($('bb-trench'), () => a.pickTrench?.(a.state().trench ?? trenches[0].kind));
    for (const it of trenches) act($('bb-t' + it.kind), () => a.pickTrench?.(it.kind));
  }
  act($('bb-rot'), a.rotate); act($('bb-undo'), a.undo); act($('bb-start'), a.start);

  function update() {
    const s = a.state();
    root.hidden = !s.visible;
    if (!s.visible) return;
    for (const it of items) {
      const b = $('bb-k' + it.kind);
      b.classList.toggle('sel', s.trench === undefined && it.kind === s.kind);
      b.setAttribute('aria-pressed', String(s.trench === undefined && it.kind === s.kind));
      b.classList.toggle('dim', it.cost > s.left);
    }
    if (trenches.length) {
      $('bb-trench').classList.toggle('sel', s.trench !== undefined);
      $('bb-trench').setAttribute('aria-expanded', String(s.trench !== undefined));
      $('bb-trenches').hidden = s.trench === undefined;
      for (const it of trenches) {
        const b = $('bb-t' + it.kind);
        b.classList.toggle('sel', it.kind === s.trench);
        b.setAttribute('aria-pressed', String(it.kind === s.trench));
        b.classList.toggle('dim', it.cost > s.left);
      }
    }
    const detail = s.trench !== undefined
      ? `${trenches.find(it => it.kind === s.trench)?.detail ?? ''} · 轉向 ${s.rot * 90}°`
      : items.find(it => it.kind === s.kind)?.detail ?? '';
    $('bb-detail').textContent = detail; $('bb-detail').hidden = !detail;
    $('bb-rot').textContent = s.trench !== undefined ? `轉向 ${s.rot * 90}°` : s.rot ? '轉向 ↕' : '轉向 ↔';
    $('bb-rot').classList.toggle('dim', !s.rotatable);
    $('bb-undo').classList.toggle('dim', !s.planned);
    const pips = Array.from({ length: s.total }, (_, i) => `<i class="${i < s.left ? 'on' : ''}"></i>`).join('');
    $('bb-left').innerHTML = `建材 ${s.left}／${s.total} <span class="pips">${pips}</span>`;
    // 貼在提示列上面（提示列的字數會變，高度跟著變）
    const hint = document.getElementById('hint');
    if (hint) root.style.bottom = `${Math.max(8, innerHeight - hint.getBoundingClientRect().top + 6)}px`;
  }
  update();
  return { update };
}
