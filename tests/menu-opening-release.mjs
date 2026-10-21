// R127: regression for a compatibility click after the opening long press.
// Measured point/menu/button rectangles: CI39607864963 R127_HOLD_TRACE.
// Other HUD boxes below are conservative reconstructions, NOT captured DOM rectangles.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const source=fs.readFileSync(new URL('../src/ui/commandMenu.ts',import.meta.url),'utf8');
const functionSource=source.slice(source.indexOf('export function menuPosition('),source.indexOf('\nexport interface CommandMenu'));
const mutant=process.argv.includes('--mutant'),selected=process.env.R127_MENU_GROUP;
const broken=functionSource.replace(/const finger = .*?;/,'const finger = 0;');
assert.notEqual(broken,functionSource,'finger exclusion mutation has exact source anchor');
const load=async s=>(await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(s)).toString('base64'))).menuPosition;
const position=await load(mutant?broken:functionSource);
const oldPosition=await load(broken);
const outside=(p,w,h,x,y)=>x<p.left||x>p.left+w||y<p.top||y>p.top+h;
function clear(p,w,h,vw,vh,obstacles){
  assert(p.left>=8&&p.top>=8&&p.left+w<=vw-8&&p.top+h<=vh-8,'menu stays inside viewport');
  for(const r of obstacles)assert(p.left+w<=r.left||p.left>=r.right||p.top+h<=r.top||p.top>=r.bottom,'menu preserves zero HUD overlap');
}
const observed=[
 {name:'R109',point:[206,508.2534612479379],menu:[108,465.234375,196,186.1875],he:[117,498.421875,178,44]},
 {name:'R123',point:[206,496.5154420607472],menu:[108,447.046875,196,186.1875],he:[117,480.234375,178,44]},
];
const groups={
 observed(){for(const f of observed){
   const [x,y]=f.point,[left,top,w,h]=f.menu,[bx,by,bw,bh]=f.he;
   assert(x>bx&&x<bx+bw&&y>by&&y<by+bh,'recorded held point lay inside HE button');
   // The candidate y=production.top-menu.height-8 reconstructs the observed placement.
   const obstacles=[{left:8,top:8,right:404,bottom:64},{left:8,top:68,right:280,bottom:103},{left:252,top:108,right:404,bottom:184},{left:8,top:top+h+8,right:404,bottom:816},{left:8,top:822,right:404,bottom:852}];
   assert.deepEqual(oldPosition(w,h,412,860,x,y,obstacles),{left,top},'original algorithm reproduces recorded menu rectangle with reconstructed obstacles');
   const p=position(w,h,412,860,x,y,obstacles);
   assert(outside(p,w,h,x,y),'opening-release: measured initiating finger excluded');
   clear(p,w,h,412,860,obstacles);
 }},
 grid(){const obstacles=[{left:44,top:8,right:404,bottom:64},{left:8,top:68,right:280,bottom:103},{left:304,top:108,right:404,bottom:208},{left:8,top:670,right:404,bottom:805},{left:8,top:812,right:404,bottom:852}];
   for(let x=0;x<=412;x+=29)for(let y=0;y<=860;y+=37){const p=position(196,188,412,860,x,y,obstacles);assert(outside(p,196,188,x,y),'opening-release: obstacle-grid finger excluded');clear(p,196,188,412,860,obstacles);}
 },
 edges(){for(const[vw,vh]of[[412,860],[860,412],[360,780],[1280,800]])for(const x of[0,8,vw/2,vw-8,vw])for(const y of[0,8,vh/2,vh-8,vh]){const p=position(196,188,vw,vh,x,y,[]);assert(outside(p,196,188,x,y),'opening-release: viewport-edge finger excluded');clear(p,196,188,vw,vh,[]);}},
};
const messages={observed:'opening-release: measured initiating finger excluded',grid:'opening-release: obstacle-grid finger excluded',edges:'opening-release: viewport-edge finger excluded'};
for(const[name,run]of Object.entries(groups)){if(selected&&selected!==name)continue;try{run();console.log('OK menu-opening-release '+name);}catch(e){console.error('FIRST_MENU_FAILURE='+JSON.stringify({group:name,name:e.name,message:e.message.split('\n')[0]}));throw e;}}
if(!mutant)for(const[name,message]of Object.entries(messages)){const child=spawnSync(process.execPath,[fileURLToPath(import.meta.url),'--mutant'],{encoding:'utf8',timeout:15000,env:{...process.env,R127_MENU_GROUP:name}});assert.equal(child.error,undefined,'isolated negative completes');assert.notEqual(child.status,0,'disabled exclusion fails');const first=(child.stdout+'\n'+child.stderr).match(/^FIRST_MENU_FAILURE=(.*)$/m);assert(first,'negative reaches semantic assertion');assert.deepEqual(JSON.parse(first[1]),{group:name,name:'AssertionError',message},'exact first semantic failure');console.log('RED menu-opening-release '+name+': '+message);}
