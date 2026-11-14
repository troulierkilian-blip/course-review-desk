import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import {extractChapter,selectContext,recentHistory} from '../src/core/ai-context';
import {chatCompletion,endpointFor,apiError,type Fetcher} from '../src/core/ai-client';
import {AIService,KeyVault} from '../src/core/ai-service';
import {AIStore} from '../src/core/ai-store';
import {Store} from '../src/core/store';
import {prepareImport,commitImport} from '../src/core/library';
import {createBackup,restoreBackup} from '../src/core/backup';
import type {AIMessage,Chapter} from '../src/shared';
const root=path.resolve('qa/ai-core-'+Date.now());fs.mkdirSync(root,{recursive:true});
const key='sk-test-secret-never-persist',signal=()=>new AbortController().signal;
const json=(text='这是测试回答。')=>new Response(JSON.stringify({choices:[{message:{content:text},finish_reason:'stop'}]}),{headers:{'content-type':'application/json'}});
const event=(content:string,finish:string|null=null)=>'data: '+JSON.stringify({choices:[{delta:{content},finish_reason:finish}]})+'\r\n\r\n';
const stream=(text:string)=>new Response(new ReadableStream({start(controller){const b=new TextEncoder().encode(text);for(let i=0;i<b.length;i+=3)controller.enqueue(b.slice(i,i+3));controller.close();}}),{headers:{'content-type':'text/event-stream'}});
const request=(fetcher:Fetcher,extra:any={})=>chatCompletion({endpoint:'http://localhost/v1/chat/completions',key,model:'fixture-model',stream:true,messages:[{role:'user',content:'测试'}],signal:signal(),fetcher,onText:()=>{},...extra});
const wait=async(check:()=>boolean)=>{for(let n=0;n<200;n++){if(check())return;await new Promise(r=>setTimeout(r,10));}throw Error('Test timed out');};
const encryption={isEncryptionAvailable:()=>true,encryptString:(s:string)=>Buffer.from([...s].reverse().join('')),decryptString:(b:Buffer)=>[...b.toString()].reverse().join('')};

test('extract all bundled example chapters, preserve indentation and collapsed answers, omit executable and navigation content',()=>{
 let count=0;const manifest=JSON.parse(fs.readFileSync('bundled/manifest.json','utf8'));
 for(const c of manifest){const p=prepareImport([path.resolve('bundled',c.id)],'folder');for(const ch of p.draft.chapters.filter(x=>x.selected)){const file=path.join('bundled',c.id,ch.relativePath);const html=fs.readFileSync(file,'utf8');const result=extractChapter(html);assert.ok(result.text.length>200,ch.title);assert.ok(/[\u4e00-\u9fff]/.test(result.text));assert.ok(!result.text.includes('localStorage.setItem('));count++;}}
 assert.equal(count,manifest.reduce((n:number,c:{count:number})=>n+c.count,0));
 const extracted=extractChapter('<nav>不要带导航</nav><main><h1>中文章节</h1><p>示例</p><pre><code>def f():\n    return 42\n</code></pre><details><summary>查看答案</summary><p>隐藏答案也保留</p></details><script>EVIL_SCRIPT</script><style>BAD_STYLE</style></main>');
 assert.ok(extracted.text.includes('def f():\n    return 42'));assert.ok(extracted.text.includes('隐藏答案也保留'));for(const omitted of ['不要带导航','EVIL_SCRIPT','BAD_STYLE'])assert.ok(!extracted.text.includes(omitted));
 const long=extractChapter('<h1>概述</h1><p>'+('无关材料。'.repeat(9000))+'</p><h2>梯度下降</h2><p>唯一选中段落。学习率影响参数更新。</p>');const context=selectContext(long,'解释学习率','唯一选中段落');assert.equal(context.excerpted,true);assert.ok(context.characters<=24000);assert.ok(context.text.includes('唯一选中段落'));assert.equal(selectContext(extracted).excerpted,false);
});

test('recent history keeps eight complete turns with 12000-character budget',()=>{
 const messages:AIMessage[]=[];for(let i=0;i<12;i++)for(const role of ['user','assistant'] as const)messages.push({id:i+role,turnId:String(i),chapterId:'chapter',role,content:role+i,quote:'',model:'model',createdAt:'date',status:'complete'});
 const history=recentHistory(messages);assert.equal(history.length,16);assert.equal(history[0].content,'user4');messages.at(-1)!.status='failed';assert.equal(recentHistory(messages).at(-1)!.content,'assistant10');messages.at(-3)!.content='x'.repeat(13000);assert.equal(recentHistory(messages).length,0);
});

test('endpoint validation and actionable errors never echo response secrets',()=>{
 assert.equal(endpointFor('https://example.com/v1/'),'https://example.com/v1/chat/completions');assert.equal(endpointFor('http://127.0.0.1:8877/chat/completions'),'http://127.0.0.1:8877/chat/completions');
 for(const url of ['http://example.com','file:///tmp/a','https://user:pass@example.com','https://example.com/?key=abc'])assert.throws(()=>endpointFor(url));
 for(const [status,body,code] of [[401,key,'auth'],[429,'limit','rate'],[429,'insufficient_quota','quota'],[404,'model_not_found','model'],[400,'context_length_exceeded','context'],[500,key,'server']] as const){const error=apiError(status,body);assert.equal(error.code,code);assert.ok(!error.message.includes(key));}
});

test('stream chunks across UTF-8 and CRLF boundaries; redaction, JSON compatibility and bounded output',async()=>{
 const emitted:string[]=[];const response=await request(async(url,init)=>{assert.equal(JSON.parse(String(init.body)).model,'fixture-model');assert.equal((init.headers as any).Authorization,'Bearer '+key);assert.equal(init.redirect,'error');return stream(': keepalive\r\n\r\n'+event('中文，')+event(key.slice(0,10))+event(key.slice(10)+'完成','stop')+'data: [DONE]\r\n\r\n');},{onText:(s:string)=>emitted.push(s)});
 assert.equal(response,'中文，[密钥已隐藏]完成');assert.ok(emitted.every(x=>!x.includes(key)&&!x.endsWith(key.slice(0,10))));
 assert.equal(await request(async()=>json(),{stream:false}),'这是测试回答。');assert.equal(await request(async()=>json()),'这是测试回答。');
 await assert.rejects(request(async()=>json('x'.repeat(120001))),{code:'size'});
});

test('partial stream disconnect, malformed stream, finish length, auth, rate and timeout are explicit failures without auto-retry',async()=>{
 let partial='';await assert.rejects(request(async()=>stream(event('部分回答')),{onText:(s:string)=>partial=s}),{code:'interrupted'});assert.equal(partial,'部分回答');
 await assert.rejects(request(async()=>stream('data: nope\n\n')),{code:'format'});await assert.rejects(request(async()=>stream(event('部分','length'))),{code:'length'});
 for(const status of [401,429]){let calls=0;await assert.rejects(request(async()=>{calls++;return new Response(key,{status});}),{code:status===401?'auth':'rate'});assert.equal(calls,1);}
 const pending:Fetcher=async(_url,init)=>new Promise((_resolve,reject)=>{init.signal!.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});});
 await assert.rejects(request(pending,{timeoutMs:20}),{code:'timeout'});const abort=new AbortController();const cancelled=request(pending,{signal:abort.signal});abort.abort();await assert.rejects(cancelled,{code:'cancelled'});
});

test('encrypted endpoint-bound key, isolated chapter turns, cancellation/retry, update, restart and backup migration',async()=>{
 const folder=path.join(root,'service'),source=path.join(root,'课程');fs.mkdirSync(source);fs.mkdirSync(folder);fs.writeFileSync(path.join(source,'一.html'),'<h1>章节一</h1><p>只属于本章的知识。</p>');fs.writeFileSync(path.join(source,'二.html'),'<h1>章节二</h1><p>不要自动发送第二章。</p>');
 let store=new Store(path.join(folder,'data'));const prepared=prepareImport([source],'folder');const course=commitImport(store,prepared,prepared.draft);const all=store.all<Chapter>('chapters'),one=all.find(c=>c.relativePath==='一.html')!,two=all.find(c=>c.relativePath==='二.html')!;
 const oldBackup=path.join(root,'old.zip');createBackup(store,oldBackup);
 const vault=new KeyVault(path.join(folder,'ai-credentials.json'),encryption);let mode='normal';const requests:any[]=[];const emitted:AIMessage[]=[];
 const fetcher:Fetcher=async(_url,init)=>{requests.push(JSON.parse(String(init.body)));if(mode==='pending')return new Promise((_resolve,reject)=>init.signal!.addEventListener('abort',()=>reject(Error('abort')),{once:true}));if(mode==='failed')return stream(event('收到一半'));return json('回答 '+key);};
 let service=new AIService(store,vault,fetcher,m=>emitted.push({...m}));service.saveConfig({baseUrl:'http://localhost/v1',model:'fixture',stream:true,apiKey:key});assert.equal(service.config().hasKey,true);assert.ok(!fs.readFileSync(path.join(folder,'ai-credentials.json'),'utf8').includes(key));assert.ok(!JSON.stringify(service.config()).includes(key));
 service.saveConfig({baseUrl:'http://localhost/other',model:'fixture',stream:true});assert.equal(service.config().hasKey,false);service.saveConfig({baseUrl:'http://localhost/v1',model:'fixture',stream:true});assert.equal(service.config().hasKey,true);
 await service.test();assert.equal(requests[0].messages.length,1);assert.ok(!JSON.stringify(requests[0]).includes('章节一'));
 service.send({chapterId:one.id,question:'解释这段',quote:'引用中文'});await wait(()=>service.repo.messages(one.id).at(-1)?.status==='complete');assert.equal(service.repo.messages(one.id).length,2);assert.ok(requests.at(-1).messages.at(-1).content.includes('引用中文'));assert.ok(!requests.at(-1).messages.at(-1).content.includes('不要自动发送第二章'));assert.ok(!JSON.stringify(emitted).includes(key));
 service.send({chapterId:one.id,question:'再举个例子',quote:''});await wait(()=>service.repo.messages(one.id).at(-1)?.status==='complete');assert.equal(requests.at(-1).messages.length,4);
 mode='pending';service.send({chapterId:one.id,question:'取消这个',quote:''});await service.stop(one.id);assert.equal(service.repo.messages(one.id).at(-1)?.status,'stopped');const stopped=service.repo.messages(one.id).at(-1)!;
 mode='normal';service.send({chapterId:two.id,question:'第二章问题',quote:''});await wait(()=>service.repo.messages(two.id).at(-1)?.status==='complete');assert.equal(requests.at(-1).messages.length,2);
 service.send({chapterId:one.id,question:'取消这个',quote:'',retryOf:stopped.id});await wait(()=>service.repo.messages(one.id).at(-1)?.status==='complete');assert.equal(service.repo.messages(one.id).filter(m=>m.role==='user').length,3);
 mode='failed';service.send({chapterId:one.id,question:'失败内容保留',quote:''});await wait(()=>service.repo.messages(one.id).at(-1)?.status==='failed');assert.equal(service.repo.messages(one.id).at(-1)?.content,'收到一半');
 fs.renameSync(path.join(source,'一.html'),path.join(source,'改名.html'));const update=prepareImport([source],'folder','update',store,course);commitImport(store,update,update.draft);assert.equal(store.chapter(one.id).relativePath,'改名.html');assert.equal(service.repo.messages(one.id).filter(m=>m.role==='user').length,4);
 const before=service.repo.messages(one.id);store.close();store=new Store(path.join(folder,'data'));service=new AIService(store,vault,fetcher,()=>{});assert.deepEqual(service.repo.messages(one.id),before);
 const backup=path.join(root,'new.zip');createBackup(store,backup);const zip=new AdmZip(backup);assert.ok(zip.getEntries().every(e=>!e.entryName.includes('credential')));assert.ok(!zip.getEntry('review.sqlite')!.getData().includes(Buffer.from(key)));await service.clear(one.id);store=restoreBackup(store,backup);service=new AIService(store,vault,fetcher,()=>{});assert.deepEqual(service.repo.messages(one.id),before);
 service.saveConfig({baseUrl:'http://localhost/new',model:'fixture',stream:false,apiKey:'another-key'});store=restoreBackup(store,backup);service=new AIService(store,vault,fetcher,()=>{});assert.equal(service.config().hasKey,false,'Restored endpoint must not reuse a different endpoint key');
 const pendingMessage={...before.at(-1)!,id:'interrupted-on-exit',status:'streaming' as const};service.repo.put(pendingMessage);new AIStore(store).recover();assert.equal(service.repo.messages(one.id).at(-1)?.status,'stopped');
 store=restoreBackup(store,oldBackup);service=new AIService(store,vault,fetcher,()=>{});assert.deepEqual(service.repo.messages(one.id),[]);assert.equal(store.all('chapters').length,2);service.clearKey();assert.equal(service.config().hasKey,false);store.close();
});
