import React,{useState,useRef,useEffect,useLayoutEffect} from 'react';
import {DEFAULT_AI_WIDTH,MIN_AI_WIDTH,fitAIWidth,maxAIWidth} from '../panel-layout';
import type {ReaderBounds} from '../shared';

type Drag={token:string;pointerId:number;element:HTMLDivElement;startX:number;startWidth:number;preferred:number;last:number};
export function useAIWidth(body:React.RefObject<HTMLDivElement|null>,slot:React.RefObject<HTMLDivElement|null>,enabled:boolean,chapterId:string|undefined,onError:(message:string)=>void){
 const [preferred,setPreferred]=useState(DEFAULT_AI_WIDTH),[available,setAvailable]=useState(1000),[dragWidth,setDragWidth]=useState<number|null>(null),[preview,setPreview]=useState<{image:string|null}|null>(null);
 const dragging=useRef<Drag|null>(null),preferredRef=useRef(preferred),availableRef=useRef(available),revision=useRef(0);
 preferredRef.current=preferred;availableRef.current=available;
 const width=fitAIWidth(dragWidth??preferred,available);
 const error=useRef(onError);error.current=onError;
 const bounds=():ReaderBounds|null=>{const r=slot.current?.getBoundingClientRect();return r?{x:r.x,y:r.y,width:r.width,height:r.height}:null;};
 function save(value:number){revision.current++;preferredRef.current=value;setPreferred(value);void window.desk.saveAIWidth(value).catch(()=>error.current('宽度未能保存，请稍后重新调整。'));}
 function finish(cancel=false){
  const d=dragging.current;if(!d)return;dragging.current=null;
  document.documentElement.classList.remove('is-resizing-ai');
  if(d.element.hasPointerCapture(d.pointerId))d.element.releasePointerCapture(d.pointerId);
  setDragWidth(null);setPreview(null);
  if(cancel){setPreferred(d.preferred);preferredRef.current=d.preferred;}else save(d.last);
  // Wait for React's final layout; stale tokens cannot reveal a different chapter.
  requestAnimationFrame(()=>void window.desk.readerResizeEnd(d.token,bounds()).catch(()=>error.current('阅读区域恢复失败，请重新打开本章。')));
 }
 const finishRef=useRef(finish);finishRef.current=finish;
 useEffect(()=>{
  let alive=true;const read=()=>{const version=revision.current;void window.desk.uiPreferences().then(p=>{if(alive&&!dragging.current&&version===revision.current){setPreferred(p.aiPanelWidth);preferredRef.current=p.aiPanelWidth;}}).catch(()=>{});};
  read();const off=window.desk.onChange(read);return()=>{alive=false;off();finishRef.current();};
 },[]);
 useLayoutEffect(()=>{const element=body.current;if(!element)return;const measure=()=>setAvailable(element.getBoundingClientRect().width);measure();const o=new ResizeObserver(measure);o.observe(element);return()=>o.disconnect();},[enabled,chapterId]);
 useEffect(()=>{if(!enabled)finishRef.current();return()=>finishRef.current();},[enabled,chapterId]);
 useEffect(()=>{
  const blur=()=>finishRef.current();const key=(e:KeyboardEvent)=>{if(e.key==='Escape'&&dragging.current){e.preventDefault();e.stopImmediatePropagation();finishRef.current(true);}};
  // Native child-view visibility changes can release Chromium's element capture.
  // Track at window capture phase as well, so a release over any shell element ends the drag.
  const move=(e:PointerEvent)=>{const d=dragging.current;if(!d||e.pointerId!==d.pointerId)return;if(!e.buttons){finishRef.current();return;}const next=fitAIWidth(d.startWidth+d.startX-e.clientX,availableRef.current);d.last=next;setDragWidth(next);};
  const up=(e:PointerEvent)=>{if(dragging.current?.pointerId===e.pointerId)finishRef.current();};
  const mouseup=(e:MouseEvent)=>{if(e.button===0)finishRef.current();};
  window.addEventListener('blur',blur);window.addEventListener('keydown',key,true);
  window.addEventListener('pointermove',move,true);window.addEventListener('pointerup',up,true);window.addEventListener('pointercancel',up,true);window.addEventListener('mouseup',mouseup,true);
  return()=>{window.removeEventListener('blur',blur);window.removeEventListener('keydown',key,true);window.removeEventListener('pointermove',move,true);window.removeEventListener('pointerup',up,true);window.removeEventListener('pointercancel',up,true);window.removeEventListener('mouseup',mouseup,true);};
 },[]);
 function down(e:React.PointerEvent<HTMLDivElement>){
  if(e.button!==0||dragging.current)return;e.preventDefault();e.currentTarget.focus();e.currentTarget.setPointerCapture(e.pointerId);
  const token=crypto.randomUUID();dragging.current={token,pointerId:e.pointerId,element:e.currentTarget,startX:e.clientX,startWidth:width,preferred:preferredRef.current,last:width};
  setDragWidth(width);setPreview({image:null});document.documentElement.classList.add('is-resizing-ai');
  void window.desk.readerResizeStart(token).then(image=>{if(dragging.current?.token===token)setPreview({image});}).catch(()=>{if(dragging.current?.token===token)finishRef.current(true);});
 }
 const separator=<div className="ai-resizer" role="separator" aria-label="调整 AI 伴侣宽度" aria-orientation="vertical" aria-controls="ai-companion-panel" aria-valuemin={MIN_AI_WIDTH} aria-valuemax={maxAIWidth(available)} aria-valuenow={width} aria-valuetext={`${width} 像素`} title="左右拖动调整宽度 · 双击恢复默认 · 方向键微调" tabIndex={0}
  onPointerDown={down}
  onPointerUp={()=>finish()} onPointerCancel={()=>finish()} onLostPointerCapture={e=>{const d=dragging.current;if(d&&e.pointerId===d.pointerId&&!e.currentTarget.hasPointerCapture(e.pointerId))finish();}} onDoubleClick={()=>{finish(true);save(DEFAULT_AI_WIDTH);}}
  onKeyDown={e=>{if(dragging.current)return;if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();save(fitAIWidth(width+(e.key==='ArrowLeft'?20:-20),available));}}}><span/></div>;
 return {width,separator,preview};
}
