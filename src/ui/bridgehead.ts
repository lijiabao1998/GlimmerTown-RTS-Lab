import { BRIDGE_X, BRIDGE_Z, CAPTURE_TICKS, SUPPLY_TICKS, bridgePresence } from '../sim/bridgehead.ts';
import { TICK_HZ, waterAt, type World } from '../sim/world.ts';
import { SIDE_PLAYER } from '../side.ts';

const NEUTRAL = '#e2d6ac', FRIEND = '#8ec9ff', ENEMY = '#ff947d', CONTESTED = '#ffd36a';

function presentation(w: World) {
  const p = w.bridgehead!;
  const who = (side: number) => side === SIDE_PLAYER ? '我方' : '敵方';
  const owner = p.owner < 0 ? '中立' : who(p.owner) + '控制';
  const color = p.owner < 0 ? NEUTRAL : p.owner === SIDE_PLAYER ? FRIEND : ENEMY;
  if (waterAt(w, BRIDGE_X, BRIDGE_Z)) return { status: '斷橋', detail: owner + ' · 等待修復', color: '#b7b8ae' };
  const present = bridgePresence(w);
  if (present === 3) return { status: '爭奪中', detail: owner + ' · 補給暫停', color: CONTESTED };
  if (p.claimant >= 0) {
    const left = Math.ceil((CAPTURE_TICKS - p.progress) / TICK_HZ);
    return { status: who(p.claimant) + '奪取中', detail: owner + ' · 還需 ' + left + ' 秒', color };
  }
  const detail = p.owner < 0 ? '駐守 ' + CAPTURE_TICKS / TICK_HZ + ' 秒可佔領'
    : present ? '每 ' + SUPPLY_TICKS / TICK_HZ + ' 秒 +1 補給' : '無人駐守 · 補給暫停';
  return { status: owner, detail, color };
}

// 跟著小地圖的位置與縮放。按狀態列用既有的小地圖手勢把鏡頭移到橋心。
export function bridgeheadOverlay(map: HTMLCanvasElement, focus: (x: number, z: number) => void) {
  let button: HTMLButtonElement | undefined;
  let status: HTMLElement, detail: HTMLElement;
  return (ctx: CanvasRenderingContext2D, w: World, project: (x: number, z: number) => [number, number]) => {
    if (!w.bridgehead) { if (button) button.hidden = true; return; }
    if (!button) {
      button = document.createElement('button');
      button.id = 'bridgehead-status'; button.type = 'button';
      button.title = '定位西海斯橋 · 橋心四格內可駐守';
      const name = document.createElement('b'); name.textContent = '西海斯橋';
      status = document.createElement('strong'); detail = document.createElement('small');
      button.append(name, status, detail);
      button.onclick = () => focus(BRIDGE_X + 0.5, BRIDGE_Z + 0.5);
      map.after(button);
    }
    const state = presentation(w);
    button.hidden = false;
    const top = (map.offsetTop + map.offsetHeight + 3) + 'px';
    if (button.style.top !== top) button.style.top = top;
    if (status.textContent !== state.status) { status.textContent = state.status; status.style.color = state.color; }
    if (detail.textContent !== state.detail) detail.textContent = state.detail;

    const [x, y] = project(BRIDGE_X + 0.5, BRIDGE_Z + 0.5);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, y + 2); ctx.lineTo(x, y - 9); ctx.lineTo(x + 8, y - 7); ctx.lineTo(x, y - 4);
    ctx.fillStyle = state.color; ctx.strokeStyle = '#171d1b'; ctx.lineWidth = 3;
    ctx.stroke(); ctx.fill(); ctx.strokeStyle = '#fff5da'; ctx.lineWidth = 1; ctx.stroke();
    ctx.restore();
  };
}
