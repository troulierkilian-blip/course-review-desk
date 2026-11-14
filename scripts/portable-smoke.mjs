import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

// Launch the outer NSIS portable EXE, then attach to its extracted Electron child.
// App data and fake credentials belong to QA, never the user's real profile.
const version=JSON.parse(fs.readFileSync('package.json')).version;
const source=path.resolve(`release/v${version}/CourseReviewDesk-v${version}-win-x64.exe`);
const manifest=JSON.parse(fs.readFileSync('bundled/manifest.json','utf8'));const chapterCount=manifest.reduce((n,c)=>n+c.count,0);
const qa=path.resolve('qa/portable-'+Date.now());fs.mkdirSync(qa,{recursive:true});
const data=path.join(qa,'isolated-user-data');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const expected=hash(source);
const report={version,ok:false,outerExecutable:true,sha256:expected,isolatedData:data,mockOnly:true,runs:[],errors:[]};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function port(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function jsonReady(port,pathname,child){for(let i=0;i<180;i++){if(child.exitCode!==null)throw Error('Outer EXE exited before app ready: '+child.exitCode);try{return await (await fetch(`http://127.0.0.1:${port}${pathname}`,{signal:AbortSignal.timeout(1000)})).json();}catch{}await pause(500);}throw Error('Portable startup timeout');}
async function mainConnection(url){const socket=new WebSocket(url);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});let id=0;const pending=new Map();socket.addEventListener('message',({data})=>{const r=JSON.parse(data);const p=pending.get(r.id);if(p){pending.delete(r.id);r.error?p.reject(Error(JSON.stringify(r.error))):p.resolve(r.result);}});return {socket,async evaluate(expression){const next=++id;const result=await new Promise((resolve,reject)=>{pending.set(next,{resolve,reject});socket.send(JSON.stringify({id:next,method:'Runtime.evaluate',params:{expression,returnByValue:true,awaitPromise:true}}));});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;}};}
async function run(exe,label,onlyExe=false){
 const browserPort=await port(),nodePort=await port();const env={...process.env,COURSE_REVIEW_DATA:data};delete env.ELECTRON_RUN_AS_NODE;delete env.NODE_OPTIONS;
 if(onlyExe)assert.deepEqual(fs.readdirSync(path.dirname(exe)),[path.basename(exe)]);
 const started=Date.now();const child=spawn(exe,[`--inspect=127.0.0.1:${nodePort}`,`--remote-debugging-port=${browserPort}`],{cwd:path.dirname(exe),env,stdio:'ignore',windowsHide:true});
 let browser,main;const exit=new Promise(resolve=>child.once('exit',(code)=>resolve(code)));
 try{
  const targets=await jsonReady(nodePort,'/json/list',child);main=await mainConnection(targets[0].webSocketDebuggerUrl);
  await jsonReady(browserPort,'/json/version',child);browser=await chromium.connectOverCDP(`http://127.0.0.1:${browserPort}`);
  const context=browser.contexts()[0];let page;for(let i=0;i<100;i++){page=context.pages().find(p=>p.url().startsWith('desk://app/'));if(page)break;await pause(100);}assert.ok(page);await page.getByRole('heading',{name:'今天，也向前一点。'}).waitFor();
  const info=await main.evaluate(`(()=>{const {app}=process.mainModule.require('electron'),fs=process.mainModule.require('fs'),path=process.mainModule.require('path');return {name:app.getName(),version:app.getVersion(),packaged:app.isPackaged,userData:app.getPath('userData'),runtime:process.execPath,outer:process.env.PORTABLE_EXECUTABLE_FILE,icu:fs.existsSync(path.join(path.dirname(process.execPath),'icudtl.dat')),bundled:fs.existsSync(path.join(process.resourcesPath,'bundled/manifest.json')),native:fs.existsSync(path.join(process.resourcesPath,'app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node'))};})()`);
  assert.equal(info.name,'CourseReviewDeskPublic');assert.equal(info.version,version);assert.equal(info.packaged,true);assert.equal(path.resolve(info.outer),path.resolve(exe));assert.notEqual(path.dirname(info.runtime),path.dirname(exe));assert.equal(path.resolve(info.userData),path.resolve(data));assert.ok(info.icu&&info.bundled&&info.native);
  const snap=await page.evaluate(()=>window.desk.snapshot());assert.equal(snap.chapters.length,chapterCount);assert.equal(snap.courses.length,manifest.length);
  const hasKey=(await page.evaluate(()=>window.desk.aiConfig())).hasKey;assert.equal(hasKey,false);
  const beforeWidth=(await page.evaluate(()=>window.desk.uiPreferences())).aiPanelWidth;if(report.runs.length)assert.equal(beforeWidth,680,'Width follows user data rather than EXE location');
  await page.evaluate(()=>window.desk.saveAIWidth(680));const chapter=snap.chapters.find(c=>c.courseId===manifest[0].id&&c.order===0);
  await page.evaluate(c=>window.desk.openReader({courseId:c.courseId,chapterId:c.id,relativePath:c.relativePath,title:c.title}),chapter);await page.getByTitle('AI 伴侣',{exact:true}).click();await page.locator('.ai-panel').waitFor();
  const documentState=await main.evaluate(`(async()=>{const {webContents}=process.mainModule.require('electron');const wc=webContents.getAllWebContents().find(w=>w.getURL().startsWith('course://'));await new Promise(r=>setTimeout(r,300));return wc.executeJavaScript("({title:document.title,ready:document.documentElement.dataset.reviewReady,heading:document.querySelector('h1')?.textContent})");})()`);assert.equal(documentState.ready,'true');assert.ok(documentState.heading);
  await page.screenshot({path:path.join(qa,label+'.png')});
  report.runs.push({label,executable:exe,onlyExe,secondsToReady:Math.round((Date.now()-started)/100)/10,...info,chapters:snap.chapters.length,hasKey,width:680,documentState});console.log('PASS OUTER '+label+' '+exe);
 }finally{
  if(main){await main.evaluate("process.mainModule.require('electron').BrowserWindow.getAllWindows().forEach(w=>w.close());'closing'").catch(()=>{});main.socket.close();}
  if(browser)await browser.close().catch(()=>{});
  const code=await Promise.race([exit,pause(15000).then(()=> 'timeout')]);assert.equal(code,0,'Portable launcher should exit cleanly after app close');
 }
 if(onlyExe)assert.deepEqual(fs.readdirSync(path.dirname(exe)),[path.basename(exe)],'No sibling runtime/data files required');
}
try{
 const empty=path.join(qa,'only-exe');fs.mkdirSync(empty);let exe=path.join(empty,path.basename(source));fs.copyFileSync(source,exe);await run(exe,'only-exe',true);
 const chinese=path.join(qa,'中文 空格目录');fs.mkdirSync(chinese);const moved=path.join(chinese,'移动后 重命名的复习软件.exe');fs.renameSync(exe,moved);exe=moved;await run(exe,'moved-renamed-chinese',true);
 report.ok=true;
}catch(e){report.errors.push(e.stack);console.error(e);process.exitCode=1;}finally{fs.writeFileSync(path.join(qa,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({qa,ok:report.ok,runs:report.runs.length,errors:report.errors},null,2));}
