// R010 戰報畫面（DOM）：只顯示傳進來的戰報、只呼叫傳進來的動作。
import type { Report } from './report.ts';

export interface ReportView { show: (r: Report) => void; hide: () => void; visible: () => boolean }

export function initReportView(actions: { again: () => void }): ReportView {
  const root = document.createElement('div');
  root.id = 'report'; root.hidden = true;
  const reopen = document.createElement('button');
  reopen.id = 'report-open'; reopen.textContent = '戰報'; reopen.hidden = true;
  (document.getElementById('hud') ?? document.body).append(root, reopen);
  let last: Report | null = null;
  const row = (name: string, a: string | number, b: string | number) => `<tr><th>${name}</th><td>${a}</td><td>${b}</td></tr>`;
  const units = (c: number[]) => `坦克 ${c[0]}・砲 ${c[1]}・觀測 ${c[2]}`;
  function show(r: Report) {
    last = r;
    const title = r.winner === 0 ? '勝利' : r.winner === 1 ? '戰敗' : '同歸於盡';
    root.className = r.winner === 0 ? 'win' : r.winner === 1 ? 'lose' : 'draw';
    root.innerHTML = `
      <div class="panel">
        <h2>${title}</h2>
        <p class="time">戰鬥 ${Math.floor(r.seconds / 60)}:${String(r.seconds % 60).padStart(2, '0')}　擊毀 ${r.kills}　損失 ${r.lost}</p>
        <table>
          <tr><th></th><td>我方</td><td>敵方</td></tr>
          ${row('開局', units(r.start[0]), units(r.start[1]))}
          ${row('剩下', units(r.left[0]), units(r.left[1]))}
          ${row('開火', `${r.fires[0]} 發`, `${r.fires[1]} 發`)}
        </table>
        <p class="town">村子：轟塌 ${r.rubble} 棟、打成空殼 ${r.roofless} 棟${r.built ? `；你蓋的 ${r.built} 棟還站著 ${r.builtStanding} 棟` : ''}</p>
        <div class="acts"><button id="rp-look">看戰場</button><button id="rp-again">再來一局</button></div>
      </div>`;
    root.hidden = false; reopen.hidden = true;
    (root.querySelector('#rp-again') as HTMLButtonElement).addEventListener('click', e => { e.stopPropagation(); actions.again(); });
    (root.querySelector('#rp-look') as HTMLButtonElement).addEventListener('click', e => { e.stopPropagation(); root.hidden = true; reopen.hidden = false; });
  }
  reopen.addEventListener('click', e => { e.stopPropagation(); if (last) show(last); });
  return { show, hide: () => { root.hidden = true; reopen.hidden = true; last = null; }, visible: () => !root.hidden };
}
