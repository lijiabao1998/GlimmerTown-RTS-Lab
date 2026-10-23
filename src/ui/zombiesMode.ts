// R045：選模式只重開布陣；最佳紀錄是容錯的本機顯示資料，不進模擬。
export interface ZombiesPick { update: () => void }
export function initZombiesPick(a: { state: () => { show: boolean; active: boolean }; toggle: () => void }): ZombiesPick {
  const btn = document.createElement('button'); btn.id = 'zombies-pick';
  btn.title = '切換喪屍防守／一般對戰；回到布陣第 0 步';
  btn.addEventListener('click', e => { e.stopPropagation(); a.toggle(); update(); });
  document.body.appendChild(btn);
  function update() { const s = a.state(); btn.hidden = !s.show; btn.textContent = s.active ? '喪屍：開' : '喪屍'; btn.setAttribute('aria-pressed', String(s.active)); }
  update(); return { update };
}

export function zombiesBest(wave: number): number {
  let best = 0;
  try {
    const stored = Number(localStorage.getItem('gtrts.v1.zombies.best'));
    if (Number.isSafeInteger(stored) && stored >= 0) best = stored;
    best = Math.max(best, wave);
    localStorage.setItem('gtrts.v1.zombies.best', String(best));
  } catch { best = Math.max(best, wave); }
  return best;
}
