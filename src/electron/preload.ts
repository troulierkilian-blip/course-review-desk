import {contextBridge,ipcRenderer} from 'electron';
import type {Api} from '../shared';
const listen=(channel:string,fn:(v:any)=>void)=>{const handler=(_:unknown,value:any)=>fn(value);ipcRenderer.on(channel,handler);return()=>ipcRenderer.removeListener(channel,handler);};
const api:Api={
 uiPreferences:()=>ipcRenderer.invoke('desk:uiPreferences'),saveAIWidth:width=>ipcRenderer.invoke('desk:saveAIWidth',width),
 readerResizeStart:token=>ipcRenderer.invoke('desk:readerResizeStart',token),readerResizeEnd:(token,bounds)=>ipcRenderer.invoke('desk:readerResizeEnd',token,bounds),
 aiConfig:()=>ipcRenderer.invoke('desk:aiConfig'),aiSaveConfig:c=>ipcRenderer.invoke('desk:aiSaveConfig',c),aiClearKey:()=>ipcRenderer.invoke('desk:aiClearKey'),aiTest:()=>ipcRenderer.invoke('desk:aiTest'),
 aiConversation:id=>ipcRenderer.invoke('desk:aiConversation',id),aiSend:input=>ipcRenderer.invoke('desk:aiSend',input),aiStop:id=>ipcRenderer.invoke('desk:aiStop',id),aiClear:id=>ipcRenderer.invoke('desk:aiClear',id),aiCopy:(chapterId,messageId)=>ipcRenderer.invoke('desk:aiCopy',chapterId,messageId),aiQuote:()=>ipcRenderer.invoke('desk:aiQuote'),
 onAIMessage:fn=>listen('desk:aiMessage',fn),onAISelection:fn=>listen('desk:aiSelection',fn),
 snapshot:()=>ipcRenderer.invoke('desk:snapshot'),
 chooseImport:(...a)=>ipcRenderer.invoke('desk:chooseImport',...a),commitImport:(draft)=>ipcRenderer.invoke('desk:commitImport',draft),
 courseEdit:(...a)=>ipcRenderer.invoke('desk:courseEdit',...a),openReader:(target)=>ipcRenderer.invoke('desk:openReader',target),
 readerLayout:(bounds)=>ipcRenderer.invoke('desk:readerLayout',bounds),closeReader:()=>ipcRenderer.invoke('desk:closeReader'),
 find:(...a)=>ipcRenderer.invoke('desk:find',...a),zoom:(value)=>ipcRenderer.invoke('desk:zoom',value),
 completeReview:(...a)=>ipcRenderer.invoke('desk:completeReview',...a),changeDue:(...a)=>ipcRenderer.invoke('desk:changeDue',...a),
 backup:()=>ipcRenderer.invoke('desk:backup'),restore:()=>ipcRenderer.invoke('desk:restore'),openData:()=>ipcRenderer.invoke('desk:openData'),
 onChange:fn=>listen('desk:changed',fn),onReader:fn=>listen('desk:reader',fn),onReaderError:fn=>listen('desk:readerError',fn),onFind:fn=>listen('desk:found',fn)
};
contextBridge.exposeInMainWorld('desk',api);
