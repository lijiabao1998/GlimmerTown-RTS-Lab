// Group navigation tests against the actual production module. Not a browser geometry check.
import assert from 'node:assert/strict';
import { initProduction } from '../src/ui/production.ts';
import { sovietItems } from '../src/ui/sovietCatalog.ts';
class El {
 constructor(){this.children=[];this.listeners={};this.style={};this.attrs={};this.classList={toggle(){}};this.value='';}
 set innerHTML(html){for(const m of html.matchAll(/id="([^"]+)"/g)){const e=new El();e.id=m[1];if(e.id==='pb-prog')e.firstElementChild=new El();this.appendChild(e);}if(html.includes('class="info"')){const e=new El();e.className='info';this.appendChild(e);}if(html.includes('<option>'))this.value=html.match(/<option>(.*?)<\/option>/)[1];}
 querySelector(s){return this.children.find(e=>s==='.info'?e.className==='info':e.id===s.slice(1))??null;}
 appendChild(e){e.parent=this;this.children.push(e);}
 prepend(e){e.parent=this;this.children.unshift(e);}
 insertBefore(e,b){e.parent=this;const i=this.children.indexOf(b);this.children.splice(i<0?this.children.length:i,0,e);}
 remove(){if(this.parent){this.parent.children=this.parent.children.filter(e=>e!==this);this.parent=null;}}
 setAttribute(k,v){this.attrs[k]=v;}
 addEventListener(t,f){this.listeners[t]=f;}
}
const hud=new El();globalThis.document={body:hud,createElement:()=>new El(),getElementById:id=>id==='hud'?hud:null};
globalThis.innerWidth=412;globalThis.innerHeight=860;
const items=[{kind:0,label:'坦克',cost:40},...sovietItems()];
const state={visible:true,supply:999,queue:[],prog:0,progMax:300,queueMax:5};const commands=[];
const bar=initProduction(items,{state:()=>state,produce:k=>{commands.push(k);state.queue.push(k);}});
const root=hud.querySelector('#prodbar'),select=root.querySelector('#pb-catalog');
const ids=()=>root.children.filter(e=>e.id?.startsWith('pb-k')).map(e=>e.id);
assert.deepEqual(ids(),['pb-k0']);assert.equal(select.attrs['aria-label'],'裝備分類');
const switchTo=value=>{select.value=value;select.listeners.change();};
switchTo('蘇式坦克');assert.deepEqual(ids(),[12,13,14,15,16,17].map(k=>'pb-k'+k));
root.querySelector('#pb-k15').listeners.click({stopPropagation(){}});assert.deepEqual(commands,[15]);
switchTo('蘇式支援');assert.deepEqual(ids(),[18,19,20,21,22].map(k=>'pb-k'+k));
root.querySelector('#pb-k22').listeners.click({stopPropagation(){}});assert.deepEqual(commands,[15,22]);
for(let i=0;i<5;i++){switchTo('通用裝備');switchTo('蘇式坦克');switchTo('蘇式支援');bar.update();assert.equal(ids().length,5);}
assert.ok(root.querySelector('#pb-queue').textContent.includes('T-34/85'));assert.ok(root.querySelector('#pb-queue').textContent.includes('M-30'));
console.log('OK soviet production UI: real module, category changes, detached button cache, repeated navigation, commands and queue names; geometry not tested');
