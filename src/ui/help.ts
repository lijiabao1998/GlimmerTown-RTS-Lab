// R013 說明面板（DOM）：怎麼玩。只顯示文字、只呼叫傳進來的動作，不碰世界。
export interface Help { open: () => void; close: () => void; visible: () => boolean }

const HTML = `
  <div class="panel" role="dialog" aria-label="怎麼玩">
    <h2>怎麼玩</h2>
    <ol>
      <li><b>布陣</b>：開局先停著。點藍色的我方半場蓋房子（農舍 1、磚房 2、穀倉 3，建材共 8）。房子擋子彈、也擋敵人的視線；點蓋好的房子可以拿掉。</li>
      <li><b>開戰</b>：按「開戰」。敵人也會在他那半邊蓋房子。</li>
      <li><b>選取</b>：點我方單位（藍圈）；「全選」選全部。受傷或選中的單位頭上有血條。</li>
      <li><b>下指令</b>：點地面＝移動；點敵人＝攻擊；點房子＝轟它；「砲擊」模式下點地面＝榴彈砲對那一格開火。選中的單位地上會畫出路線、攻擊線與準星。</li>
      <li><b>看戰報</b>：一方全滅時慢動作、鏡頭移到最後一擊，接著出戰報；「再來一局」回到布陣。</li>
    </ol>
    <h3>手勢</h3>
    <p>單指拖曳平移（放手會滑一段）；雙指捏合縮放（對準手指）；雙擊我方單位＝鏡頭跟過去。桌機：右鍵下指令、滾輪縮放、空白鍵暫停、Esc 取消選取。</p>
    <h3>戰術</h3>
    <ul>
      <li>坦克被房子擋住時，砲彈打在房子上——先把掩體轟塌，視線就通了。</li>
      <li>榴彈砲射程遠，但要有友軍<b>看得到</b>目標才打得準；<b>觀測員</b>視野最遠，可以進駐房子。同一個目標連打、看得到落點，會越打越準。</li>
      <li>車會互相擠開；瓦礫可以走、不擋射線。</li>
    </ul>
    <div class="acts"><button id="help-ok">知道了</button></div>
  </div>`;

export function initHelp(on: { open: () => void; close: () => void }): Help {
  const root = document.createElement('div');
  root.id = 'help'; root.hidden = true; root.innerHTML = HTML;
  (document.getElementById('hud') ?? document.body).appendChild(root);
  const close = () => { if (root.hidden) return; root.hidden = true; on.close(); };
  const open = () => { if (!root.hidden) return; root.hidden = false; on.open(); };
  root.addEventListener('click', e => { e.stopPropagation(); if (e.target === root) close(); });   // 點面板外關掉
  (root.querySelector('#help-ok') as HTMLButtonElement).addEventListener('click', e => { e.stopPropagation(); close(); });
  return { open, close, visible: () => !root.hidden };
}
