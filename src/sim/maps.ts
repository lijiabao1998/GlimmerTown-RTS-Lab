// R026 手排地圖。第一張：1940 年夏天的 Rye（East Sussex）。純函式、只在第 0 步套、不用亂數。
// 地圖轉了 180°：上方（敵方角落）＝南邊的 Camber 沙灘與 Rye Harbour（海獅作戰 C 區登陸方向），
// 右下（我方角落）＝北邊往 Udimore／Peasmarsh 的路；左＝東（Rother 河、Romney Marsh），右＝西（Tillingham 河）。
// 參考：Rye 舊城（Citadel）的街道格局——High Street、Mermaid Street、Watchbell Street、Lion Street、Church Square、
// East Cliff 經 Landgate 下山、Conduit Hill、The Strand 碼頭、Cinque Ports Street；St Mary's 教堂、Ypres Tower、Landgate 城門、Strand 倉庫、火車站（1851）。
import {
  N, idx, bldMaxHp, TER_GRASS, TER_ROAD, TER_FIELD, TER_MUD, BK_HOUSE, BK_COTTAGE, BK_BARN, BK_CHURCH, BK_SHOP, type World,
} from './world.ts';

import { generateVegetation } from './vegetation.ts';

export const MAP_RYE = 1;

// id=0 保留原亂數村莊；舊 map 指令不帶 vegetation，地圖／雜湊逐位保持。
export function applyMap(w: World, id: number, vegetation?: number): void {
  if (w.tick !== 0 || (id !== 0 && id !== MAP_RYE)) return;
  const changed = id === MAP_RYE && !w.map;
  applyRye(w, id);
  if (changed && w.vegetation) delete w.vegetation; // 同 tick 換底圖時不留舊候選
  if (vegetation === 1 && (w.map ?? 0) === id) generateVegetation(w);
}

function applyRye(w: World, id: number): void {
  if (id !== MAP_RYE || w.tick !== 0 || w.map) return;
  w.ter.fill(TER_GRASS); w.occ.fill(0); w.crater.fill(0); w.blds = [];
  const ter = (t: number, x0: number, z0: number, x1: number, z1: number) => {   // 含兩端
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) w.ter[idx(x, z)] = t;
  };
  const bld = (kind: number, x: number, z: number, bw: number, bd: number, floors: number) => {
    const id = w.blds.length + 1, maxHp = bldMaxHp(kind, bw, bd, floors);
    w.blds.push({ id, kind, x, z, w: bw, d: bd, floors, hp: maxHp, maxHp });
    for (let dz = 0; dz < bd; dz++) for (let dx = 0; dx < bw; dx++) w.occ[idx(x + dx, z + dz)] = id;
  };

  // ---- 地形：田、泥灘（河與潮間帶），最後鋪路（橋＝路蓋過河）----
  ter(TER_FIELD, 0, 11, 6, N - 1);          // Romney Marsh 的牧草地
  ter(TER_FIELD, 10, 4, 23, 6);             // Rock Channel 南邊的鹽沼地
  ter(TER_FIELD, 29, 0, N - 1, 18);         // Tillingham 河谷西岸
  ter(TER_FIELD, 17, 25, 21, N - 1);        // 車站北邊的田
  ter(TER_MUD, 7, 9, 8, N - 1);             // Rother 河
  ter(TER_MUD, 9, 7, N - 1, 8);             // Rock Channel（兩河合流往海）
  ter(TER_MUD, 27, 9, 28, 20);              // Tillingham 河
  ter(TER_MUD, 29, 19, N - 1, 20);          // Tillingham 往西的上游
  ter(TER_ROAD, 3, 0, 3, 21);               // 往 Camber 的路
  ter(TER_ROAD, 4, 3, 23, 3);               // 沿海小路（Rye Harbour 村）
  ter(TER_ROAD, 24, 0, 24, 14);             // Harbour Road（過 Rock Channel 的橋）
  ter(TER_ROAD, 0, 21, N - 1, 21);          // Cinque Ports Street（東邊過 Rother 橋、西邊往 Udimore）
  ter(TER_ROAD, 25, 12, 25, N - 1);         // The Strand 沿河，往北接 Rye Hill（往 Peasmarsh）
  ter(TER_ROAD, 26, 15, N - 1, 15);         // A259 過 Tillingham 橋往 Winchelsea
  ter(TER_ROAD, 11, 15, 24, 15);            // High Street（西端是 The Mint 下到 Strand）
  ter(TER_ROAD, 17, 12, 24, 12);            // Mermaid Street（石板路，往西下坡到 Strand）
  ter(TER_ROAD, 12, 9, 21, 9);              // Watchbell Street（崖邊）
  ter(TER_ROAD, 15, 9, 15, 15);             // Lion Street（Watchbell → Church Square → High Street）
  ter(TER_ROAD, 11, 10, 11, 15);            // Church Square 東側＋East Street
  ter(TER_ROAD, 11, 13, 15, 13);            // Church Square 北側
  ter(TER_ROAD, 18, 12, 18, 15);            // Market Street
  ter(TER_ROAD, 21, 9, 21, 15);             // West Street
  ter(TER_ROAD, 10, 15, 10, 21);            // East Cliff 經 Landgate 下山
  ter(TER_ROAD, 16, 15, 16, 21);            // Conduit Hill
  ter(TER_ROAD, 14, 21, 14, 22);            // 車站前

  // ---- 舊城 ----
  bld(BK_CHURCH, 12, 10, 3, 3, 2);          // St Mary's 教堂
  bld(BK_CHURCH, 10, 10, 1, 1, 2);          // Ypres Tower（十三世紀石塔，崖邊）
  bld(BK_CHURCH, 9, 18, 1, 1, 2);           // Landgate 城門兩座塔（路從中間穿過）
  bld(BK_CHURCH, 11, 18, 1, 1, 2);
  // Watchbell Street 與 Mermaid Street 之間
  bld(BK_HOUSE, 16, 10, 2, 1, 2); bld(BK_COTTAGE, 18, 10, 1, 1, 1); bld(BK_HOUSE, 19, 10, 2, 1, 2);
  bld(BK_COTTAGE, 16, 11, 1, 1, 1); bld(BK_HOUSE, 19, 11, 2, 1, 2);
  bld(BK_HOUSE, 22, 10, 2, 2, 2);           // Watchbell 西端
  // Mermaid Street 與 High Street 之間
  bld(BK_HOUSE, 16, 13, 2, 2, 2);           // Mermaid Inn（1420 年重建的木構老旅店）
  bld(BK_HOUSE, 19, 13, 2, 1, 2); bld(BK_COTTAGE, 19, 14, 1, 1, 1); bld(BK_HOUSE, 20, 14, 1, 1, 2);
  bld(BK_HOUSE, 22, 13, 3, 1, 2); bld(BK_COTTAGE, 22, 14, 2, 1, 1);   // The Mint
  bld(BK_HOUSE, 12, 14, 2, 1, 2); bld(BK_SHOP, 14, 14, 1, 1, 2);      // Church Square 北邊、面向 High Street
  // High Street 北側的店面（連棟）
  bld(BK_SHOP, 11, 16, 2, 1, 2); bld(BK_SHOP, 13, 16, 2, 1, 2); bld(BK_HOUSE, 15, 16, 1, 1, 2);
  bld(BK_SHOP, 17, 16, 2, 1, 2); bld(BK_HOUSE, 19, 16, 1, 1, 2);
  bld(BK_SHOP, 20, 16, 2, 1, 2);            // George Hotel（馬車旅店）
  bld(BK_HOUSE, 22, 16, 2, 1, 2);
  // 山坡下半（後院隔一排草地）
  bld(BK_HOUSE, 12, 18, 2, 2, 2); bld(BK_HOUSE, 17, 18, 2, 1, 2); bld(BK_COTTAGE, 19, 18, 1, 2, 1);
  bld(BK_HOUSE, 21, 18, 2, 1, 2); bld(BK_COTTAGE, 23, 18, 1, 2, 1);
  // The Strand 碼頭的黑色木板倉庫（河與路之間）
  bld(BK_BARN, 26, 10, 1, 2, 1); bld(BK_BARN, 26, 12, 1, 2, 1); bld(BK_BARN, 26, 17, 1, 2, 1);

  // ---- 山腳與鎮外 ----
  bld(BK_SHOP, 12, 23, 3, 1, 1);            // Rye 車站
  bld(BK_BARN, 16, 23, 2, 2, 1);            // 貨棚
  bld(BK_HOUSE, 18, 22, 2, 1, 2); bld(BK_COTTAGE, 20, 22, 1, 1, 1);   // Cinque Ports Street 北側
  bld(BK_COTTAGE, 12, 1, 1, 1, 1); bld(BK_COTTAGE, 14, 1, 2, 1, 1); bld(BK_COTTAGE, 17, 4, 1, 1, 1);   // Rye Harbour 村
  bld(BK_BARN, 20, 0, 2, 2, 1);             // 船棚
  bld(BK_COTTAGE, 1, 14, 1, 1, 1); bld(BK_COTTAGE, 5, 16, 1, 1, 1);   // Romney Marsh 的看羊人小屋
  bld(BK_BARN, 1, 25, 2, 2, 1);
  bld(BK_BARN, 29, 23, 2, 2, 1); bld(BK_COTTAGE, 30, 27, 1, 1, 1);    // 往 Udimore 路邊的農場
  w.map = id;
}
