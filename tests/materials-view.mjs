// R105：材質可讀性、全損壞階段、視覺逃生閥、零額外幾何與布陣資訊。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createWorld, hashWorld, BK_HOUSE, BK_BARN, BK_CHURCH, BK_HQ, BK_PILLBOX, STAGE_INTACT, STAGE_ROOFLESS, STAGE_RUBBLE } from '../src/sim/world.ts';
import { applyMap, MAP_RYE } from '../src/sim/maps.ts';
import { buildingGeo, buildTown, bldColors, setMaterials, setFacades } from '../src/render/buildings.ts';
import { Geo } from '../src/render/geo.ts';
import { materialBuildDetail } from '../src/ui/materials.ts';
const check=(ok,name)=>{assert.ok(ok,name);console.log(`OK materials-view: ${name}`);};
const worlds=[createWorld(1944),createWorld(1944)]; applyMap(worlds[1],MAP_RYE);
{
 setMaterials(true);
 assert.deepEqual([BK_BARN,BK_HOUSE,BK_CHURCH].map(k=>bldColors(k).wall.getHex()),[0x866344,0xa5644c,0xb2aea0]);
 const b={id:1,x:1,z:1,w:2,d:2,floors:1,hp:100,maxHp:100};
 for(const stage of [STAGE_INTACT,STAGE_ROOFLESS,STAGE_RUBBLE]) {
   const colors=[BK_BARN,BK_HOUSE,BK_CHURCH].map(kind=>JSON.stringify(buildingGeo(new Geo(),{...b,kind},stage).col));
   assert.equal(new Set(colors).size,3);
 }
 check(true,'木磚石牆色與分類一致，完好／空殼／瓦礫均有材質差別');
}
{
 let changed=0, triangles=0;
 for(const w of worlds) {
   const before=hashWorld(w);
   for(const b of w.blds) for(const stage of [STAGE_INTACT,STAGE_ROOFLESS,STAGE_RUBBLE]) {
     setMaterials(true);const on=buildingGeo(new Geo(),b,stage);
     setMaterials(false);const off=buildingGeo(new Geo(),b,stage);
     assert.deepEqual(on.pos,off.pos);assert.deepEqual(on.nor,off.nor);
     if(JSON.stringify(on.col)!==JSON.stringify(off.col))changed++;
   }
   setMaterials(true);triangles=Math.max(triangles,buildTown(w).pos.length/9);assert.equal(hashWorld(w),before);
 }
 assert.ok(changed>0);assert.ok(triangles<=40000);
 const b={id:1,x:1,z:1,w:2,d:2,floors:1,hp:100,maxHp:100};
 for(const kind of [BK_HQ,BK_PILLBOX]) for(const stage of [STAGE_INTACT,STAGE_ROOFLESS,STAGE_RUBBLE]){
   setMaterials(true);const on=buildingGeo(new Geo(),{...b,kind},stage);setMaterials(false);const off=buildingGeo(new Geo(),{...b,kind},stage);assert.deepEqual(on,off);
 }
 check(true,`新配色不增頂點、法線、三角形，不改世界與特殊工事；城鎮最多 ${triangles} 三角形`);
}
{
 // 固定的舊模型指紋來自既有 facades.mjs，不以新程式輸出當期望。
 const fp=g=>{let h=2166136261;const s=JSON.stringify([g.pos,g.col,g.nor]);for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)>>>0;}return h.toString(16);};
 setMaterials(false);setFacades(false);assert.deepEqual(worlds.map(w=>fp(buildTown(w))),['fc43cc18','2eb8beb0']);setFacades(true);setMaterials(true);
 check(true,'關閉材質與外牆效果後，兩張地圖的歷史模型指紋完全不變');
}
{
 assert.equal(materialBuildDetail(BK_BARN,2,2,1),'木造 · 耐久 150');
 assert.equal(materialBuildDetail(BK_HOUSE,2,1,2),'磚造 · 耐久 210');
 assert.equal(materialBuildDetail(BK_CHURCH,3,3,2),'石造 · 耐久 1020');
 assert.equal(materialBuildDetail(BK_PILLBOX,1,1,1),'混凝土 · 耐久 400');
 const ui=fs.readFileSync(new URL('../src/ui/build.ts',import.meta.url),'utf8'),main=fs.readFileSync(new URL('../src/main.ts',import.meta.url),'utf8');
 assert.ok(ui.includes("$('bb-detail').textContent = detail")&&ui.includes("it.kind === s.kind"));
 assert.ok(fs.readFileSync(new URL('../src/valves.ts',import.meta.url),'utf8').includes("get r105() { return on('105'); }")&&main.includes('setMaterials(V.r105)')&&main.includes('V.r105 ? { detail: materialBuildDetail'));
 check(true,'布陣選中項讀共用材質／耐久，noR105 同時關配色與提示');
}
console.log('materials-view: all OK');
