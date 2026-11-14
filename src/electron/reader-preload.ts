import {ipcRenderer} from 'electron';
let ready=false;let hydrated=false;
history.scrollRestoration='manual';
function elements(){return [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];}
function keyFor(e:HTMLInputElement,i:number){const label=(e.closest('label')?.textContent||e.parentElement?.textContent||'').replace(/\s+/g,' ').trim().slice(0,180);return (e.dataset.check||e.id||String(i))+'|'+label;}
function snapshot(immediate=false){if(!ready||!hydrated)return;const max=Math.max(0,document.documentElement.scrollHeight-innerHeight);const checks=Object.fromEntries(elements().map((e,i)=>[keyFor(e,i),e.checked]));ipcRenderer.send('reader:state',{url:location.href,scrollY:scrollY,progress:max?Math.min(1,scrollY/max):1,checks,immediate});}
window.addEventListener('load',()=>{ready=true;ipcRenderer.send('reader:ready',location.href);});
ipcRenderer.on('reader:hydrate',(_,state:{scrollY:number;checks:Record<string,boolean>})=>{
 elements().forEach((e,i)=>{const key=keyFor(e,i);if(Object.prototype.hasOwnProperty.call(state.checks,key))e.checked=state.checks[key];});
 // Wait for native view layout and bypass the imported page's smooth scrolling.
 setTimeout(()=>{
  if(!location.hash)scrollTo({top:state.scrollY||0,behavior:'instant'});
  hydrated=true;document.documentElement.dataset.reviewReady='true';snapshot();
 },100);
});
let timeout:ReturnType<typeof setTimeout>|null=null;
window.addEventListener('scroll',()=>{if(timeout)clearTimeout(timeout);timeout=setTimeout(()=>snapshot(),200);},{passive:true});
document.addEventListener('change',e=>{if((e.target as HTMLInputElement)?.type==='checkbox')snapshot(true);},true);
window.addEventListener('pagehide',()=>snapshot(true));
ipcRenderer.on('reader:flush',()=>snapshot(true));
setInterval(()=>snapshot(),15000);
window.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='f'){e.preventDefault();ipcRenderer.send('reader:findShortcut');}});

let selectionTimer:ReturnType<typeof setTimeout>|null=null;
document.addEventListener('selectionchange',()=>{if(selectionTimer)clearTimeout(selectionTimer);selectionTimer=setTimeout(()=>{const text=getSelection()?.toString()||'';if(text.trim())ipcRenderer.send('reader:selection',{url:location.href,text:text.slice(0,12000)});},100);});
