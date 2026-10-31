import { fireDisciplineEligible } from '../sim/fireDiscipline.ts';
import type { World } from '../sim/world.ts';
import type { Command } from '../sim/step.ts';

export function fireDisciplineState(w: World, selected: Iterable<number>, pending: readonly Command[] = []) {
  const units = [...new Set(selected)].map(id => w.units[id - 1]).filter(u => u && fireDisciplineEligible(u));
  let held = 0;
  for (const u of units) {
    let hold = u.holdFire === 1;
    for (const cmd of pending) if (cmd.t === 'fireDiscipline' && cmd.side === u.side && cmd.ids.includes(u.id)) hold = cmd.hold;
    if (hold) held++;
  }
  return { ids: units.map(u => u.id), held, hold: held !== units.length };
}

export function initFireDiscipline(read: () => { world: World; selected: Iterable<number>; pending: readonly Command[]; active: boolean }, issue: (cmd: Command) => void): () => void {
  const hud = document.querySelector('#hud')!;
  hud.classList.add('has-fire-control');
  const button = document.createElement('button');
  button.id = 'b-discipline'; button.type = 'button';
  hud.querySelector('.btns')!.appendChild(button);
  const frame = () => {
    const s = read(), state = fireDisciplineState(s.world, s.selected, s.pending);
    button.hidden = !s.active;
    button.disabled = !state.ids.length;
    button.textContent = state.hold ? '停火' : '開火';
    button.setAttribute('aria-pressed', String(state.ids.length > 0 && !state.hold));
    const waiting = s.pending.some(c => c.t === 'fireDiscipline' && c.ids.some(id => state.ids.includes(id)));
    const label = `車砲停火 ${state.held}/${state.ids.length}${waiting ? '（待模擬執行）' : ''}；點按${state.hold ? '全部停火待命' : '解除停火'}；移動與裝填不受影響`;
    button.title = label; button.setAttribute('aria-label', label);
  };
  button.addEventListener('click', e => {
    e.stopPropagation();
    const s = read(); if (!s.active) return;
    const state = fireDisciplineState(s.world, s.selected, s.pending);
    if (state.ids.length) issue({ t: 'fireDiscipline', side: 0, ids: state.ids, hold: state.hold });
    frame();
  });
  frame(); return frame;
}
