// R070 桌機操作接線：WASD／方向鍵平移、Q／E 縮放、標準 RTS 快捷鍵。
// 只讀世界、只呼叫傳進來的動作；按鍵本身的純邏輯在 src/ui/keys.ts（Node 守衛測那一支）。
// 說明、戰報、開始選單開著時整組不作用；?noR070=1 時 main.ts 根本不呼叫這裡。
import type { World } from '../sim/world.ts';
import { SIDE_PLAYER, SUB } from '../sim/world.ts';
import type { BattleView } from '../render/battle.ts';
import type { Fling, Glide } from './camera.ts';
import type { Hud } from './hud.ts';
import { initDesktopKeys, type KeyAction } from './keys.ts';

export interface DesktopDeps {
  world: () => World;
  selected: Set<number>;
  view: () => BattleView;
  fling: Fling;
  glide: Glide;
  hud: () => Hud | undefined;
  blocked: () => boolean;
  toggleFireMode: () => void;   // 同工具列「砲擊」那顆鍵
  selectAll: () => void;        // 同工具列「全選」那顆鍵
  toggleHoldFire: () => void;   // 同 R143 那顆浮動鍵（桌機改成按 G）
  help: () => void;
}

// 主要指標不是粗指標＝有滑鼠（無頭 Chrome 的 hover 不可靠，CI 上會是 none；pointer:coarse 才是「這台是觸控」的可靠訊號）。
export const DESKTOP_POINTER = '(pointer: coarse)';

export function isDesktopPointer(): boolean {
  return typeof matchMedia === 'function' && !matchMedia(DESKTOP_POINTER).matches;
}

// R069 開始選單開著時整組不作用（選單本身不在這裡建立，只讀它的 hidden）。
const menuOpen = (): boolean => {
  const m = document.getElementById('start-menu');
  return !!m && !m.hidden;
};

export function initDesktopControls(d: DesktopDeps): void {
  document.body.classList.add('r070');
  const groups = new Map<number, number[]>();
  let tabAt = 0;
  const select = (ids: Iterable<number>) => {
    d.selected.clear();
    for (const id of ids) if (d.world().units[id - 1]?.alive) d.selected.add(id);
  };
  // H：回我方指揮部；還沒設置（布陣中）時退回我方單位重心。
  const home = () => {
    const w = d.world(), id = w.eco?.hq[SIDE_PLAYER] ?? 0, b = id > 0 ? w.blds[id - 1] : undefined;
    const mine = w.units.filter(u => u.alive && u.side === SIDE_PLAYER);
    const at = b && b.hp > 0 ? { x: b.x + b.w / 2, z: b.z + b.d / 2 }
      : mine.length ? { x: mine.reduce((s, u) => s + u.x, 0) / mine.length / SUB, z: mine.reduce((s, u) => s + u.z, 0) / mine.length / SUB } : null;
    if (at) d.glide.start(d.view().target.x, d.view().target.z, at.x, at.z, performance.now() / 1000);
  };
  // Tab：依 id 順序換下一個我方單位（只換選取，不動鏡頭）。
  const nextUnit = () => {
    const ids = d.world().units.filter(u => u.alive && u.side === SIDE_PLAYER).map(u => u.id);
    if (!ids.length) return;
    const cur = ids.indexOf([...d.selected][0]);
    tabAt = cur < 0 ? (tabAt + 1) % ids.length : (cur + 1) % ids.length;
    select([ids[tabAt]]); d.hud()?.update();
  };
  const act = (a: KeyAction, n: number) => {
    if (a === 'select-all') { d.selectAll(); d.hud()?.update(); }
    else if (a === 'group-set') groups.set(n, [...d.selected]);
    else if (a === 'group-recall') { select(groups.get(n) ?? []); d.hud()?.update(); }
    else if (a === 'next-unit') nextUnit();
    else if (a === 'home') home();
    else if (a === 'fire-mode') { d.toggleFireMode(); d.hud()?.update(); }
    else if (a === 'hold-fire') d.toggleHoldFire();
    else if (a === 'help') d.help();
  };
  const keys = initDesktopKeys({
    blocked: () => d.blocked() || menuOpen(),
    pan: (dx, dz) => { d.fling.stop(); d.glide.stop(); d.view().pan(dx, dz, innerHeight); },
    zoom: f => d.view().zoomAt(f, innerWidth / 2, innerHeight / 2, innerWidth, innerHeight),
    action: act,
  });
  // 自己跑一個 rAF：總機那條迴圈是守衛的切片對象，不再往裡面加識別字。
  let last = performance.now();
  const frame = (now: number) => {
    const dt = Math.min(0.25, Math.max(0, (now - last) / 1000));
    last = now;
    keys.step(dt);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
