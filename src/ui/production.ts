// R019 生產列（DOM）：補給、三種單位按鈕、佇列與目前那一台的進度。只顯示、只呼叫傳進來的動作。
export interface ProdItem { kind: number; label: string; cost: number }
export interface ProdState { visible: boolean; supply: number; queue: number[]; prog: number; progMax: number; queueMax: number; countdown?: string; context?: object }
export interface ProdBar { update: () => void }

export function initProduction(items: ProdItem[], a: { state: () => ProdState; produce: (kind: number) => void; countdown?: boolean; blockReason?: (kind: number) => string }): ProdBar {
  const root = document.createElement('div');
  root.id = 'prodbar'; root.className = 'bar';
  root.classList.toggle('production-countdown', !!a.countdown);
  let feedbackKind: number | undefined, feedbackContext: object | undefined;
  root.innerHTML = `${items.map(it => `<button id="pb-k${it.kind}" title="${it.label}：補給 ${it.cost}">${it.label}<b>${it.cost}</b></button>`).join('')}
    <span class="info"><span id="pb-supply"></span><span id="pb-queue"></span><i id="pb-prog"><i></i></i></span>${a.countdown ? '<span id="pb-countdown" hidden></span>' : ''}${a.blockReason ? '<span id="pb-reason" role="status" hidden></span>' : ''}`;
  (document.getElementById('hud') ?? document.body).appendChild(root);
  const $ = (id: string) => root.querySelector('#' + id) as HTMLElement;
  for (const it of items) $('pb-k' + it.kind).addEventListener('click', e => { e.stopPropagation(); feedbackKind = it.kind; a.produce(it.kind); update(); });
  const label = new Map(items.map(it => [it.kind, it.label[0]]));
  let last = '';
  let layoutValid = false, lastHint: HTMLElement | null = null, lastHintText: string | null = null;
  let lastWidth = -1, lastHeight = -1;
  function update() {
    const s = a.state();
    if (a.countdown) {
      const text = s.visible ? (s.countdown ?? '') : '';
      const el = $('pb-countdown');
      if (el.textContent !== text) el.textContent = text;
      el.hidden = !text;
    }
    if (a.blockReason) {
      if (s.context !== feedbackContext) feedbackKind = undefined;
      feedbackContext = s.context;
      for (const it of items) {
        const reason = s.visible ? a.blockReason(it.kind) : '';
        const button = $('pb-k' + it.kind);
        const title = `${it.label}：補給 ${it.cost}${reason ? ' · ' + reason : ''}`;
        if (button.title !== title) button.title = title;
        if (button.getAttribute('aria-label') !== title) button.setAttribute('aria-label', title);
        if (button.classList.contains('dim') !== !!reason) button.classList.toggle('dim', !!reason);
      }
      const reason = s.visible && feedbackKind !== undefined ? a.blockReason(feedbackKind) : '';
      const item = items.find(it => it.kind === feedbackKind);
      const text = reason && item ? `${item.label}：${reason}` : '';
      const el = $('pb-reason');
      if (el.textContent !== text) el.textContent = text;
      el.hidden = !text;
      if (!reason) feedbackKind = undefined;
    }
    root.hidden = !s.visible;
    if (!s.visible) { layoutValid = false; return; }
    const key = `${s.supply}|${s.queue.join(',')}|${s.prog}`;
    if (key !== last) {                                        // 內容沒變就不重寫；位置另外判斷
      last = key;
      if (!a.blockReason) for (const it of items) $('pb-k' + it.kind).classList.toggle('dim', it.cost > s.supply || s.queue.length >= s.queueMax);
      $('pb-supply').textContent = `補給 ${s.supply}`;
      $('pb-queue').textContent = s.queue.length ? `　${s.queue.map(k => label.get(k) ?? '?').join('')}` : '';
      ($('pb-prog').firstElementChild as HTMLElement).style.width = `${s.queue.length && s.progMax ? Math.round((100 * s.prog) / s.progMax) : 0}%`;
    }
    const hint = document.getElementById('hint');
    if (!hint) { layoutValid = false; return; }
    const hintText = hint.textContent;
    if (layoutValid && hint === lastHint && hintText === lastHintText && innerWidth === lastWidth && innerHeight === lastHeight) return;
    const bottom = `${Math.max(8, innerHeight - hint.getBoundingClientRect().top + 6)}px`;
    if (root.style.bottom !== bottom) root.style.bottom = bottom;
    lastHint = hint; lastHintText = hintText; lastWidth = innerWidth; lastHeight = innerHeight;
    layoutValid = true;
  }
  update();
  return { update };
}
