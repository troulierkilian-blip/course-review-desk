import {app,BrowserWindow,WebContentsView,protocol,net,ipcMain,dialog,shell,powerMonitor,session,Menu,safeStorage,clipboard} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {Store,canCountTime,localDate} from '../core/store';
import {prepareImport,commitImport,safePath,type Prepared} from '../core/library';
import {createBackup,restoreBackup} from '../core/backup';
import type {Course,Chapter,ReaderTarget,ImportDraft,AISelection,ReaderBounds} from '../shared';
import {AIService,KeyVault} from '../core/ai-service';
import {AIError} from '../core/ai-client';

app.setName('CourseReviewDeskPublic');
const customData=process.env.COURSE_REVIEW_DATA;
if(customData)app.setPath('userData',path.resolve(customData));
protocol.registerSchemesAsPrivileged([{scheme:'desk',privileges:{standard:true,secure:true,supportFetchAPI:true}},{scheme:'course',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}}]);
let ai:AIService;let aiSelection:AISelection|null=null;
function makeAI(){ai=new AIService(store,new KeyVault(path.join(app.getPath('userData'),'ai-credentials.json'),safeStorage),(url,options)=>session.fromPartition('ai-network').fetch(url,options),message=>{if(win&&!win.isDestroyed())win.webContents.send('desk:aiMessage',message);});}
let win:BrowserWindow;let reader:WebContentsView|null=null;let store:Store;let active:ReaderTarget|null=null;let readerVisible=false;let locked=false;
let layoutBounds:ReaderBounds|null=null;let resizeToken:string|null=null;
function applyReaderLayout(bounds:ReaderBounds|null){
 layoutBounds=bounds;if(!reader)return;
 if(!bounds||!active||closing){reader.setVisible(false);readerVisible=false;return;}
 const [width,height]=win.getContentSize();
 const x=Math.max(0,Math.round(bounds.x)),y=Math.max(0,Math.round(bounds.y));
 const w=Math.max(0,Math.min(width-x,Math.round(bounds.width))),h=Math.max(0,Math.min(height-y,Math.round(bounds.height)));
 if(![x,y,w,h].every(Number.isFinite))return;
 reader.setBounds({x,y,width:w,height:h});readerVisible=w>0&&h>0&&!resizeToken;reader.setVisible(readerVisible);
}
async function beginReaderResize(token:string){
 if(typeof token!=='string'||! /^[a-zA-Z0-9-]{1,80}$/.test(token))throw Error('无效的调整请求');
 if(!reader||!active||!layoutBounds)return null;
 const view=reader,chapter=active;resizeToken=token;
 // Hide immediately so pointer capture belongs to the shell over the entire document.
 view.setVisible(false);readerVisible=false;
 let timeout:ReturnType<typeof setTimeout>|undefined;
 try{
  const snapshot=await Promise.race([view.webContents.capturePage(undefined,{stayHidden:true}),new Promise<null>(resolve=>{timeout=setTimeout(()=>resolve(null),700);})]);
  if(!snapshot||snapshot.isEmpty()||resizeToken!==token||active!==chapter||reader!==view)return null;
  const size=snapshot.getSize();return (size.width>1600?snapshot.resize({width:1600}):snapshot).toDataURL();
 }catch{return null;}finally{if(timeout)clearTimeout(timeout);}
}
function endReaderResize(token:string,bounds:ReaderBounds|null){
 if(token!==resizeToken)return;
 resizeToken=null;
 // A modal or navigation may already have hidden the view; never reveal it then.
 applyReaderLayout(layoutBounds&&active?bounds:null);
}
let state:{scrollY:number;progress:number;checks:Record<string,boolean>}|null=null;
let drafts=new Map<string,Prepared>();let closing=false;let lastTick=Date.now();let pendingTime=new Map<string,number>();let restoreInProgress=false;
const changed=()=>{if(win&&!win.isDestroyed())win.webContents.send('desk:changed');};
function dataRoot(){return path.join(app.getPath('userData'),'data');}
function flush(){if(active?.chapterId&&state)store.reading(active.chapterId,state);for(const [key,seconds]of pendingTime){const [id,date]=key.split('|');store.addTime(id,seconds,date);}pendingTime.clear();}
function tick(){const now=Date.now(),delta=Math.max(0,Math.min(2,(now-lastTick)/1000));lastTick=now;if(!store||!active?.chapterId||restoreInProgress)return;
 if(canCountTime({reader:readerVisible,visible:win.isVisible()&&!win.isMinimized(),focused:win.isFocused(),locked,idle:powerMonitor.getSystemIdleTime()})){const key=active.chapterId+'|'+localDate();pendingTime.set(key,(pendingTime.get(key)||0)+delta);}
}
async function capture(){if(reader&&!reader.webContents.isDestroyed()){reader.webContents.send('reader:flush');await new Promise(r=>setTimeout(r,80));}flush();}
function resolveCourse(url:string){const u=new URL(url);if(u.protocol!=='course:')throw Error('不支持的课程地址');const c=store.course(u.hostname);const rel=decodeURIComponent(u.pathname).replace(/^\/+/, '');const root=path.join(store.root,'library',c.id);const file=safePath(root,rel);if(fs.existsSync(file)){const real=fs.realpathSync(file);safePath(root,path.relative(root,real));}return {course:c,relativePath:rel,file,hash:u.hash};}
function targetFrom(url:string):ReaderTarget {const r=resolveCourse(url);const chapter=store.all<Chapter>('chapters').find(c=>c.courseId===r.course.id&&c.relativePath===r.relativePath);return {courseId:r.course.id,chapterId:chapter?.id,relativePath:r.relativePath,title:chapter?.title||r.course.title+' · 课程总览'};}
function courseURL(t:ReaderTarget){return `course://${t.courseId}/${t.relativePath.split('/').map(encodeURIComponent).join('/')}`;}
async function external(url:string){if(/^https?:\/\//i.test(url))await shell.openExternal(url);}
function makeReader(){
 reader=new WebContentsView({webPreferences:{preload:path.join(__dirname,'reader-preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true}});
 win.contentView.addChildView(reader);reader.setVisible(false);
 const wc=reader.webContents;
 wc.on('context-menu',(_,params)=>{
  if(!active?.chapterId||!params.selectionText.trim())return;
  const selection={chapterId:active.chapterId,text:params.selectionText.slice(0,12000)};
  Menu.buildFromTemplate([{label:'询问 AI',click:()=>{if(active?.chapterId===selection.chapterId){aiSelection=selection;win.webContents.send('desk:aiSelection',selection);}}},{type:'separator'},{role:'copy'}]).popup({window:win});
 });
 wc.setWindowOpenHandler(({url})=>{if(url.startsWith('course:'))void navigateLink(url);else void external(url);return {action:'deny'};});
 wc.on('will-navigate',(event,url)=>{event.preventDefault();void navigateLink(url);});
 wc.on('will-redirect',(event,url)=>{event.preventDefault();if(!url.startsWith('course:'))void external(url);});
 wc.on('did-fail-load',(_,code,description,validatedURL,isMainFrame)=>{if(isMainFrame&&code!==-3)win.webContents.send('desk:readerError','页面无法打开：'+description);});
 wc.on('found-in-page',(_,result)=>win.webContents.send('desk:found',result));
 wc.on('render-process-gone',()=>{readerVisible=false;win.webContents.send('desk:readerError','阅读页面已停止，请重新打开本章。');});
}
async function navigateLink(url:string){try{if(!url.startsWith('course:')){await external(url);return;}const r=resolveCourse(url);if(/\.html?$/i.test(r.file)){if(active&&r.course.id===active.courseId&&r.relativePath===active.relativePath){await reader?.webContents.loadURL(url);return;}await openReader(targetFrom(url),r.hash);}
 else if(/\.(pdf|md|txt|png|jpe?g|gif|svg|webp)$/i.test(r.file)){if(fs.existsSync(r.file))await shell.openPath(r.file);else throw Error('附件不存在');}}
 catch(e){win.webContents.send('desk:readerError',(e as Error).message);}}
async function openReader(t:ReaderTarget,hash=''){
 resizeToken=null;
 await ai.stop();aiSelection=null;await capture();const c=store.course(t.courseId);if(c.archived)throw Error('请先恢复已归档课程');
 const canonical=targetFrom(courseURL(t));if(canonical.chapterId)store.reading(canonical.chapterId,{});
 active=canonical;state=null;if(!reader)makeReader();
 win.webContents.send('desk:reader',canonical);changed();await reader!.webContents.loadURL(courseURL(canonical)+hash);
}
async function hideReader(){resizeToken=null;layoutBounds=null;await ai.stop();aiSelection=null;await capture();reader?.setVisible(false);readerVisible=false;active=null;state=null;}
function handle(name:string,fn:(...args:any[])=>any){ipcMain.handle('desk:'+name,async(event,...args)=>{if(event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame||!event.senderFrame.url.startsWith('desk://app/'))throw Error('无效的应用请求');try{return await fn(...args);}catch(e){if(name.startsWith('ai'))throw new Error(e instanceof AIError?e.message:'AI 操作未完成，请检查设置后重试。');fs.appendFileSync(path.join(app.getPath('userData'),'app.log'),new Date().toISOString()+' '+name+': '+String(e)+'\n');throw new Error((e as Error).message||'操作未完成');}});}
function setupIPC(){
 handle('snapshot',()=>store.snapshot());
 handle('uiPreferences',()=>store.uiPreferences());
 handle('saveAIWidth',(width)=>store.saveAIWidth(width));
 handle('readerResizeStart',beginReaderResize);
 handle('readerResizeEnd',endReaderResize);
 handle('aiConfig',()=>ai.config());
 handle('aiSaveConfig',async(config)=>{await ai.stopAll();return ai.saveConfig(config);});
 handle('aiClearKey',async()=>{await ai.stopAll();return ai.clearKey();});
 handle('aiTest',()=>ai.test());
 handle('aiConversation',(id)=>ai.conversation(id));
 handle('aiSend',(input)=>{if(input?.chapterId!==active?.chapterId||!active?.chapterId)throw new AIError('chapter','请在当前章节中提问。');return ai.send(input);});
 handle('aiStop',(id)=>ai.stop(id));
 handle('aiClear',(id)=>ai.clear(id));
 handle('aiCopy',(chapterId,messageId)=>{const m=ai.repo.messages(chapterId).find(m=>m.id===messageId&&m.role==='assistant');if(!m)throw new AIError('copy','回答不存在，无法复制。');clipboard.writeText(m.content);});
 handle('aiQuote',()=>aiSelection?.chapterId===active?.chapterId?aiSelection:null);
 handle('courseEdit',async(id,patch)=>{if(active?.courseId===id&&patch.archived)await hideReader();store.editCourse(id,patch);changed();});
 handle('chooseImport',async(kind,mode,courseId)=>{
  if(!['folder','files'].includes(kind)||!['new','append','update'].includes(mode))throw Error('导入方式无效');if(mode!=='new'&&!courseId)throw Error('请选择课程');
  const res=await dialog.showOpenDialog(win,{title:mode==='update'?'选择更新后的完整课程文件夹':'选择课程资料',properties:kind==='folder'?['openDirectory']:['openFile','multiSelections'],filters:kind==='files'?[{name:'HTML 复习资料',extensions:['html','htm']}]:undefined});if(res.canceled)return null;
  const prepared=prepareImport(res.filePaths,kind,mode,store,courseId);drafts.clear();drafts.set(prepared.draft.token,prepared);return prepared.draft;
 });
 handle('commitImport',async(draft:ImportDraft)=>{const p=drafts.get(draft.token);if(!p)throw Error('导入预览已过期，请重新选择');await hideReader();const id=commitImport(store,p,draft);drafts.delete(draft.token);changed();return id;});
 handle('openReader',openReader);handle('closeReader',hideReader);
 handle('readerLayout',applyReaderLayout);
 handle('find',(text:string,forward=true)=>{if(!reader)return;if(text.trim())reader.webContents.findInPage(text.slice(0,300),{forward,findNext:true});else reader.webContents.stopFindInPage('clearSelection');});
 handle('zoom',(factor:number)=>{if(reader&&Number.isFinite(factor))reader.webContents.setZoomFactor(Math.max(.6,Math.min(2,factor)));});
 handle('completeReview',async(id,rating,due)=>{await capture();store.review(id,rating,due);changed();});
 handle('changeDue',(id,date)=>{store.changeDue(id,date);changed();});
 handle('openData',()=>shell.openPath(store.root));
 handle('backup',async()=>{const res=await dialog.showSaveDialog(win,{title:'导出完整备份',defaultPath:`课程复习备份-${localDate()}.zip`,filters:[{name:'完整备份',extensions:['zip']}]});if(res.canceled||!res.filePath)return null;await capture();createBackup(store,res.filePath);return res.filePath;});
 handle('restore',async()=>{const pick=await dialog.showOpenDialog(win,{title:'选择课程复习备份',properties:['openFile'],filters:[{name:'完整备份',extensions:['zip']}]});if(pick.canceled)return false;const confirm=await dialog.showMessageBox(win,{type:'question',title:'恢复完整备份',message:'将用备份中的课程和记录替换当前资料库。',detail:'当前资料会先自动备份到资料库 backups 文件夹，可随时恢复。',buttons:['取消','恢复备份'],defaultId:0,cancelId:0});if(confirm.response!==1)return false;
  await hideReader();await ai.stopAll();restoreInProgress=true;try{store=restoreBackup(store,pick.filePaths[0]);makeAI();await session.defaultSession.clearStorageData({storages:['localstorage']});changed();return true;}catch(e){if(!store.db.open){store=new Store(dataRoot());makeAI();}throw e;}finally{restoreInProgress=false;}
 });
 ipcMain.on('reader:ready',(e,url)=>{if(e.sender!==reader?.webContents||e.senderFrame!==reader.webContents.mainFrame||!active)return;try{const t=targetFrom(url);if(t.courseId!==active.courseId||t.relativePath!==active.relativePath)return;const c=active.chapterId?store.chapter(active.chapterId):null;e.sender.send('reader:hydrate',{scrollY:c?.scrollY||0,checks:c?.checks||{}});}catch{}});
 ipcMain.on('reader:state',(e,payload)=>{if(e.sender!==reader?.webContents||e.senderFrame!==reader.webContents.mainFrame||!active?.chapterId||!payload||payload.url.split('#')[0]!==reader.webContents.getURL().split('#')[0])return;try{const t=targetFrom(payload.url);if(t.chapterId!==active.chapterId)return;state={scrollY:payload.scrollY,progress:payload.progress,checks:payload.checks};if(payload.immediate)flush();}catch{}});
 ipcMain.on('reader:selection',(e,payload)=>{if(e.sender!==reader?.webContents||e.senderFrame!==reader.webContents.mainFrame||!active?.chapterId||typeof payload?.text!=='string'||payload.url!==reader.webContents.getURL())return;if(payload.text.trim())aiSelection={chapterId:active.chapterId,text:payload.text.slice(0,12000)};});
 ipcMain.on('reader:findShortcut',e=>{if(e.sender===reader?.webContents)win.webContents.send('desk:readerError','__find__');});
}
async function seed(){
 if(store.db.prepare("SELECT value FROM meta WHERE key='seeded'").get())return;
 const root=app.isPackaged?path.join(process.resourcesPath,'bundled'):path.join(app.getAppPath(),'bundled');const mf=path.join(root,'manifest.json');if(!fs.existsSync(mf))return;
 const manifest=JSON.parse(fs.readFileSync(mf,'utf8'));for(const c of manifest){if(store.get<Course>('courses',c.id))continue;const p=prepareImport([path.join(root,c.id)],'folder');const draft={...p.draft,title:c.title};commitImport(store,p,draft,{id:c.id,description:c.description,color:c.color,icon:c.icon,order:c.order});}
 store.db.prepare("INSERT OR REPLACE INTO meta VALUES('seeded','1')").run();
}
async function init(){
 store=new Store(dataRoot());makeAI();
 protocol.handle('desk',request=>{try{const u=new URL(request.url);if(u.hostname!=='app')return new Response('',{status:403});const f=safePath(path.join(__dirname,'../ui'),decodeURIComponent(u.pathname).replace(/^\//,'')||'index.html');return net.fetch(pathToFileURL(f).toString());}catch{return new Response('',{status:404});}});
 protocol.handle('course',async request=>{try{const r=resolveCourse(request.url);if(!fs.existsSync(r.file)||!fs.statSync(r.file).isFile())throw Error('Missing resource');const response=await net.fetch(pathToFileURL(r.file).toString());
  // User-authored UTF-8 HTML may omit <meta charset>. Chromium otherwise falls
  // back to Windows-1252 and corrupts Chinese relative links.
  if(/\.html?$/i.test(r.file)){const headers=new Headers(response.headers);headers.set('content-type','text/html; charset=utf-8');return new Response(response.body,{status:response.status,headers});}
  return response;
 }catch{return new Response('资源不存在或不可访问',{status:404,headers:{'content-type':'text/plain;charset=utf-8'}});}});
 session.defaultSession.setPermissionRequestHandler((_,__,callback)=>callback(false));session.defaultSession.setPermissionCheckHandler(()=>false);
 await seed();
 win=new BrowserWindow({width:1440,height:940,minWidth:1000,minHeight:650,backgroundColor:'#f3f7fc',title:'课程复习助手',icon:path.join(app.getAppPath(),'assets/icon.ico'),show:false,autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true}});
 Menu.setApplicationMenu(null);setupIPC();win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',e=>e.preventDefault());
 await win.loadURL('desk://app/index.html');win.show();
 win.on('close',e=>{if(closing)return;e.preventDefault();void ai.stopAll().then(()=>capture()).finally(()=>{closing=true;reader?.webContents.close();store.close();win.destroy();app.quit();});});
 powerMonitor.on('lock-screen',()=>{locked=true;flush();});powerMonitor.on('unlock-screen',()=>{locked=false;lastTick=Date.now();});powerMonitor.on('suspend',()=>{locked=true;flush();});powerMonitor.on('resume',()=>{locked=false;lastTick=Date.now();});
 setInterval(tick,1000);setInterval(()=>{if(!closing&&!restoreInProgress){flush();changed();}},15000);
}
if(!app.requestSingleInstanceLock())app.quit();else {app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.show();win.focus();}});app.whenReady().then(init).catch(e=>{dialog.showErrorBox('课程复习助手启动失败',String(e));app.quit();});}
app.on('window-all-closed',()=>app.quit());
