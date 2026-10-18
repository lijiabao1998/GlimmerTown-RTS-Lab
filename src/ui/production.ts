// R019 生產列（DOM）：補給、三種單位按鈕、佇列與目前那一台的進度。只顯示、只呼叫傳進來的動作。
export interface ProdItem { kind: number; label: string; cost: number }
export interface ProdState { visible: boolean; supply: number; queue: number[]; prog: number; progMax: number; queueMax: number }
export interface ProdBar { update: () => void }

export function initProduction(items: ProdItem[], a: { state: () => ProdState; produce: (kind: number) => void }): ProdBar {
  const root = document.createElement('div');
  root.id = 'prodbar'; root.className = 'bar';
  root.innerHTML = `${items.map(it => `<button id="pb-k${it.kind}" title="${it.label}：補給 ${it.cost}">${it.label}<b>${it.cost}</b></button>`).join('')}
    <span class="info"><span id="pb-supply"></span><span id="pb-queue"></span><i id="pb-prog"><i></i></i></span>`;
  (document.getElementById('hud') ?? document.body).appendChild(root);
  const $ = (id: string) => root.querySelector('#' + id) as HTMLElement;
  for (const it of items) $('pb-k' + it.kind).addEventListener('click', e => { e.stopPropagation(); a.produce(it.kind); update(); });
  const label = new Map(items.map(it => [it.kind, it.label[0]]));
  let last = '';
  function update() {
    const s = a.state();
    root.hidden = !s.visible;
    if (!s.visible) return;
    const key = `${s.supply}|${s.queue.join(',')}|${s.prog}`;
    if (key === last) return;                                   // 沒變就不碰 DOM
    last = key;
    for (const it of items) $('pb-k' + it.kind).classList.toggle('dim', it.cost > s.supply || s.queue.length >= s.queueMax);
    $('pb-supply').textContent = `補給 ${s.supply}`;
    $('pb-queue').textContent = s.queue.length ? `　${s.queue.map(k => label.get(k) ?? '?').join('')}` : '';
    ($('pb-prog').firstElementChild as HTMLElement).style.width = `${s.queue.length && s.progMax ? Math.round((100 * s.prog) / s.progMax) : 0}%`;
    const hint = document.getElementById('hint');
    if (hint) root.style.bottom = `${Math.max(8, innerHeight - hint.getBoundingClientRect().top + 6)}px`;
  }
  update();
  return { update };
}
