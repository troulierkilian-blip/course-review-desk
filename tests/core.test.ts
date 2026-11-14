import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Store,localDate,dueFor,validDate,canCountTime} from '../src/core/store';
import {prepareImport,commitImport,safePath} from '../src/core/library';
import {createBackup,restoreBackup} from '../src/core/backup';
import type {Course,Chapter} from '../src/shared';
import {DEFAULT_AI_WIDTH,fitAIWidth,maxAIWidth} from '../src/panel-layout';
const root=path.resolve('qa/core-'+Date.now());fs.mkdirSync(root,{recursive:true});
const write=(p:string,text:string)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,text);};

test('AI width keeps the document usable and preserves preferences across restart and backup',()=>{
 assert.equal(DEFAULT_AI_WIDTH,480);assert.equal(fitAIWidth(480,1366),480);
 for(const available of [990.4,1000,1081.6,1093,1366,1440,2200]){
  const maximum=maxAIWidth(available);assert.ok(maximum<=available*.7);assert.ok(available-maximum-8>=420);
  assert.equal(fitAIWidth(200,available),320);assert.equal(fitAIWidth(10000,available),maximum);
 }
 assert.equal(fitAIWidth(800,1000),572);assert.equal(fitAIWidth(800,1440),800);
 const folder=path.join(root,'width');let store=new Store(folder);assert.equal(store.uiPreferences().aiPanelWidth,480);
 for(const invalid of [null,'480',NaN,Infinity,319,10001])assert.throws(()=>store.saveAIWidth(invalid as number));
 const old=path.join(root,'old-width.zip');createBackup(store,old);
 store.saveAIWidth(780);store.close();store=new Store(folder);assert.equal(store.uiPreferences().aiPanelWidth,780);
 const backup=path.join(root,'width.zip');createBackup(store,backup);store.saveAIWidth(420);
 store=restoreBackup(store,backup);assert.equal(store.uiPreferences().aiPanelWidth,780);
 store=restoreBackup(store,old);assert.equal(store.uiPreferences().aiPanelWidth,480);
 store.db.prepare("INSERT OR REPLACE INTO meta VALUES('ai_panel_width','corrupt')").run();assert.equal(store.uiPreferences().aiPanelWidth,480);store.close();
});

test('bundled sample: manifest chapter counts, portable paths, no missing rendering resources',()=>{
 const store=new Store(path.join(root,'seeds'));const manifest=JSON.parse(fs.readFileSync('bundled/manifest.json','utf8'));
 for(const item of manifest){const prepared=prepareImport([path.resolve('bundled',item.id)],'folder');assert.equal(prepared.draft.chapters.filter(c=>c.selected).length,item.count,item.title);assert.deepEqual(prepared.draft.warnings,[],item.title);commitImport(store,prepared,{...prepared.draft,title:item.title},{id:item.id});}
 const snap=store.snapshot();assert.equal(snap.courses.length,manifest.length);assert.equal(snap.chapters.length,manifest.reduce((n:number,c:{count:number})=>n+c.count,0));for(const c of snap.chapters){assert.ok(fs.existsSync(path.join(store.root,'library',c.courseId,c.relativePath)));assert.ok(store.course(c.courseId));}store.close();
});
test('import, read progress, checklist, append, update and rename retain identity and review history',()=>{
 const source=path.join(root,'课程 资料');write(path.join(source,'index.html'),'<a href="第2章.html">第二章</a><a href="第1章.html">第一章</a>');
 write(path.join(source,'第1章.html'),'<h1>第一章</h1><img src="assets/测试.svg"><input data-check="1" type="checkbox">');write(path.join(source,'第2章.html'),'<h1>第二章</h1>');write(path.join(source,'assets/测试.svg'),'<svg xmlns="http://www.w3.org/2000/svg"/>');
 let store=new Store(path.join(root,'import'));const p=prepareImport([source],'folder');assert.equal(p.draft.chapters[0].title,'第二章');assert.equal(p.draft.warnings.length,0);const id=commitImport(store,p,p.draft);const ch=store.all<Chapter>('chapters').find(c=>c.title==='第一章')!;
 store.reading(ch.id,{scrollY:340,progress:.42,checks:{a:true,b:false}});store.addTime(ch.id,65,'2026-10-15');store.review(ch.id,'familiar',undefined,new Date(2026,9,15,23,59));store.changeDue(ch.id,'2026-11-02');store.close();store=new Store(path.join(root,'import'));
 assert.ok(prepareImport([source],'folder','new',store).draft.warnings.some(w=>w.includes('相同课程')));
 assert.equal(store.chapter(ch.id).scrollY,340);assert.deepEqual(store.chapter(ch.id).checks,{a:true,b:false});assert.equal(store.chapter(ch.id).reviews,1);assert.equal(store.chapter(ch.id).dueDate,'2026-11-02');assert.equal(store.chapter(ch.id).seconds,65);
 const duplicate=prepareImport([path.join(source,'第1章.html')],'files','append',store,id);assert.equal(duplicate.draft.chapters[0].matchId,ch.id);commitImport(store,duplicate,duplicate.draft);assert.equal(store.all<Chapter>('chapters').length,2);assert.equal(store.chapter(ch.id).reviews,1);
 fs.renameSync(path.join(source,'第1章.html'),path.join(source,'重命名.html'));write(path.join(source,'index.html'),'<a href="重命名.html">第一章</a><a href="第2章.html">第二章</a>');const updated=prepareImport([source],'folder','update',store,id);assert.equal(updated.draft.chapters.find(c=>c.title==='第一章')?.matchId,ch.id);commitImport(store,updated,updated.draft);assert.equal(store.chapter(ch.id).relativePath,'重命名.html');assert.equal(store.chapter(ch.id).reviews,1);
 fs.renameSync(source,source+' moved');assert.ok(fs.existsSync(path.join(store.root,'library',id,'assets/测试.svg')));assert.ok(fs.readFileSync(path.join(store.root,'library',id,'重命名.html'),'utf8').includes('第一章'));store.editCourse(id,{archived:true});assert.equal(store.snapshot().courses[0].archived,true);store.editCourse(id,{archived:false});assert.equal(store.chapter(ch.id).reviews,1);store.close();
});
test('resource warnings, single-file closure and traversal prevention',()=>{
 const source=path.join(root,'warnings');write(path.join(source,'单篇.html'),'<h1>单篇</h1><link rel="stylesheet" href="style.css"><img src="missing.png"><script src="https://example.com/remote.js"></script>');write(path.join(source,'style.css'),'body{background:url(images/a.svg)}');write(path.join(source,'images/a.svg'),'<svg/>');
 const p=prepareImport([path.join(source,'单篇.html')],'files');assert.ok(p.files.some(f=>f.endsWith('a.svg')));assert.ok(p.draft.warnings.some(w=>w.includes('missing.png')));assert.ok(p.draft.warnings.some(w=>w.includes('https://example.com/remote.js')));assert.throws(()=>safePath(source,'../secret'));assert.throws(()=>safePath(source,'D:\\outside\\file'));assert.equal(safePath(source,'images/a.svg'),path.join(source,'images/a.svg'));
});
test('a standalone index.html is importable as a chapter',()=>{
 const source=path.join(root,'single-index');write(path.join(source,'index.html'),'<h1>单章课程</h1><p>内容</p>');const p=prepareImport([path.join(source,'index.html')],'files');assert.equal(p.draft.chapters.length,1);assert.equal(p.draft.indexPath,null);assert.equal(p.draft.chapters[0].title,'单章课程');
});
test('calendar scheduling, valid dates and foreground-only time eligibility',()=>{
 const at=new Date(2026,0,31,23,59);assert.equal(dueFor('forgot',at),'2026-02-01');assert.equal(dueFor('fuzzy',at),'2026-02-03');assert.equal(dueFor('familiar',at),'2026-02-07');assert.equal(dueFor('mastered',at),'2026-03-02');assert.equal(localDate(at),'2026-01-31');assert.equal(validDate('2026-02-30'),false);assert.equal(validDate('2028-02-29'),true);
 const state={reader:true,visible:true,focused:true,locked:false,idle:0};assert.ok(canCountTime(state));for(const disabled of [{reader:false},{visible:false},{focused:false},{locked:true},{idle:300}])assert.equal(canCountTime({...state,...disabled}),false);
});
test('complete backup restores content and records and creates pre-restore backup; rejects corrupt archive',()=>{
 let store=new Store(path.join(root,'backup'));const source=path.join(root,'backup-source');write(path.join(source,'章节.html'),'<h1>备份章节</h1>');const p=prepareImport([source],'folder');commitImport(store,p,p.draft);const ch=store.all<Chapter>('chapters')[0];store.review(ch.id,'mastered');store.reading(ch.id,{checks:{test:true},scrollY:90});store.addTime(ch.id,12);
 const dest=path.join(root,'课程备份.zip');createBackup(store,dest);store.review(ch.id,'forgot');store.reading(ch.id,{checks:{test:false}});store=restoreBackup(store,dest);assert.equal(store.chapter(ch.id).reviews,1);assert.deepEqual(store.chapter(ch.id).checks,{test:true});assert.ok(fs.readdirSync(path.join(store.root,'backups')).length===1);assert.ok(fs.existsSync(path.join(store.root,'library',ch.courseId,ch.relativePath)));write(path.join(root,'invalid.zip'),'invalid');assert.throws(()=>restoreBackup(store,path.join(root,'invalid.zip')));assert.ok(store.db.open);store.close();
});
