// R901：直向手機把上方按鈕、建造／生產列收進安全區裡的小鍵，把點擊還給地圖。
// 框選另開一顆鍵；沒開時單指拖曳仍是平移，雙指縮放與長按下指令都不改。
export interface ChromeState { top: boolean; bar: boolean; box: boolean }
export const chromeOpen = (): ChromeState => ({ top: true, bar: true, box: false });
export function reduceChrome(s: ChromeState, which: 'top' | 'bar' | 'box'): ChromeState {
  return { ...s, [which]: !s[which] };
}
export interface ChromeFlags { topOff: boolean; barOff: boolean; armed: boolean; mounted: boolean }
export function chromeFlags(phone: boolean, state: ChromeState): ChromeFlags {
  return { topOff: phone && !state.top, barOff: phone && !state.bar, armed: phone && state.box, mounted: phone };
}

const PHONE = '(max-width: 480px) and (orientation: portrait)';
let armed = false;
export function touchBoxArmed(): boolean { return armed; }

export function initMobileChrome(canvas: HTMLCanvasElement): void {
  let state = chromeOpen();
  const root = document.createElement('div');
  root.id = 'r901-chrome';
  root.innerHTML = `<button type="button" id="r901-top" aria-expanded="true" title="收起或展開上方按鈕" aria-label="收起或展開上方按鈕">具</button>
    <button type="button" id="r901-bar" aria-expanded="true" title="收起或展開建造與生產列" aria-label="收起或展開建造與生產列">產</button>
    <button type="button" id="r901-box" aria-pressed="false" title="框選：拖曳圈選我方；再按恢復單指平移。雙指仍縮放，未開框選時長按仍下指令" aria-label="框選">框</button>`;
  const top = root.querySelector('#r901-top') as HTMLButtonElement;
  const bar = root.querySelector('#r901-bar') as HTMLButtonElement;
  const box = root.querySelector('#r901-box') as HTMLButtonElement;
  const phone = matchMedia(PHONE);
  const apply = () => {
    const flags = chromeFlags(phone.matches, state);
    if (flags.mounted) { if (!root.isConnected) document.body.appendChild(root); }
    else if (root.isConnected) root.remove();
    document.body.classList.toggle('r901-top-off', flags.topOff);
    document.body.classList.toggle('r901-bar-off', flags.barOff);
    armed = flags.armed;
    top.setAttribute('aria-expanded', String(state.top));
    bar.setAttribute('aria-expanded', String(state.bar));
    box.setAttribute('aria-pressed', String(state.box));
  };
  const act = (el: HTMLButtonElement, which: 'top' | 'bar' | 'box') => {
    let origin: { id: number; x: number; y: number } | null = null;
    let fromPointer = false;
    const toggle = () => { state = reduceChrome(state, which); apply(); };
    el.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      fromPointer = false;
      origin = { id: e.pointerId, x: e.clientX, y: e.clientY };
      e.stopPropagation();
    });
    el.addEventListener('pointerup', e => {
      if (!origin || origin.id !== e.pointerId) return;
      const start = origin;
      origin = null;
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8) return;
      fromPointer = true;
      e.stopPropagation();
      toggle();
    });
    el.addEventListener('click', e => {
      e.stopPropagation();
      if (fromPointer) { fromPointer = false; return; }
      toggle();
    });
  };
  act(top, 'top'); act(bar, 'bar'); act(box, 'box');
  phone.addEventListener('change', apply);
  addEventListener('resize', apply);
  new ResizeObserver(apply).observe(document.documentElement);
  apply();
  // 拖曳時 canvas 抓住指標。放手後放開，下一點才打得到這些鍵。
  const release = (e: PointerEvent) => { if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId); };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  // 頁面自己的捏合、長按選字會把手指偷走。不在 pointerdown 上 preventDefault（會把相容滑鼠事件弄亂）。
  canvas.addEventListener('touchmove', e => { if (e.touches.length >= 2) e.preventDefault(); }, { passive: false });
  addEventListener('gesturestart', e => e.preventDefault());
  addEventListener('gesturechange', e => e.preventDefault());
}
