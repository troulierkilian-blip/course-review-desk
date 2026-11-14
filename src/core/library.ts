import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {load} from 'cheerio';
import {Store} from './store';
import type {ImportDraft,ImportChapter,Course,Chapter} from '../shared';

const ignored=new Set(['.git','.cache','node_modules','_work','_tools','_构建与核对','_复习整理工作','_复习资料制作','_skill_build']);
const slash=(p:string)=>p.replace(/\\/g,'/');
export function safePath(root:string,relative:string):string {
 const file=path.resolve(root,relative);const rel=path.relative(path.resolve(root),file);
 if(path.isAbsolute(rel)||rel==='..'||rel.startsWith('..'+path.sep))throw Error('资源不在课程目录内');
 return file;
}
export function filesIn(root:string):string[]{let result:string[]=[];for(const e of fs.readdirSync(root,{withFileTypes:true})){if(ignored.has(e.name)||e.name.startsWith('.')||e.isSymbolicLink())continue;const full=path.join(root,e.name);if(e.isDirectory())result.push(...filesIn(full));else if(e.isFile())result.push(full);}return result;}
function commonRoot(files:string[]):string {let root=path.dirname(files[0]);while(!files.every(f=>{const r=path.relative(root,f);return !path.isAbsolute(r)&&!r.startsWith('..'+path.sep)&&r!=='..';})){const next=path.dirname(root);if(next===root)throw Error('请选择同一课程目录中的 HTML');root=next;}return root;}
export interface Prepared {draft:ImportDraft;root:string;files:string[];}
function refPath(file:string,ref:string,root:string):string|null {
 if(!ref||ref.startsWith('#')||/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(ref))return null;
 try {const decoded=decodeURIComponent(ref.split(/[?#]/)[0]);const full=decoded.startsWith('/')?path.join(root,decoded):path.resolve(path.dirname(file),decoded);return full;}catch{return null;}
}
function titleFor(file:string,root:string) {const $=load(fs.readFileSync(file,'utf8'));return ($('h1').first().text()||$('title').text()||path.basename(file,'.html')).replace(/[｜|].*$/,'').replace(/\s*[·—–-]\s*浅蓝版.*$/,'').trim().slice(0,180)||slash(path.relative(root,file));}
export function prepareImport(paths:string[],kind:'folder'|'files',mode:ImportDraft['mode']='new',store?:Store,courseId?:string):Prepared {
 if(!paths.length)throw Error('未选择资料');
 const root=kind==='folder'?path.resolve(paths[0]):commonRoot(paths.map(p=>path.resolve(p)));
 if(!fs.statSync(root).isDirectory())throw Error('请选择课程文件夹');
 let all=filesIn(root);if(all.length>30000)throw Error('文件过多，请选择具体的课程文件夹');
 const pages=all.filter(f=>/\.html?$/i.test(f));
 let index=pages.find(f=>path.relative(root,f).toLowerCase()==='index.html')||pages.find(f=>slash(path.relative(root,f)).toLowerCase()==='html/index.html');
 const ordered:string[]=[];
 if(index){const $=load(fs.readFileSync(index,'utf8'));$('a[href]').each((_,el)=>{const p=refPath(index!,$(el).attr('href')!,root);if(p&&p!==index&&pages.includes(p)&&!ordered.includes(p))ordered.push(p);});}
 if(index&&!ordered.length&&(pages.length===1||(kind==='files'&&paths.length===1&&path.resolve(paths[0])===index)))index=undefined;
 const candidates=(kind==='files'?[...new Set([...paths.map(f=>path.resolve(f)),...(index&&paths.some(f=>path.resolve(f)===index)?ordered:[])])]:pages).filter(f=>f!==index&&!/^(?:课件原文|延伸课程课件)[\\/]/.test(path.relative(root,f)));
 candidates.sort((a,b)=>{const ai=ordered.indexOf(a),bi=ordered.indexOf(b);return ai>=0||bi>=0?(ai<0?99999:ai)-(bi<0?99999:bi):a.localeCompare(b,'zh-CN',{numeric:true});});
 const chapters:ImportChapter[]=candidates.map(f=>({relativePath:slash(path.relative(root,f)),title:titleFor(f,root),hash:createHash('sha256').update(fs.readFileSync(f)).digest('hex'),selected:kind==='files'||!ordered.length||ordered.includes(f)}));
 if(!chapters.length)throw Error('没有找到章节 HTML，请选择包含复习笔记的文件夹或 HTML 文件');
 const warnings=new Set<string>();
 const closure=new Set<string>(kind==='folder'?all:[...paths.map(p=>path.resolve(p))]);
 const queue=[...chapters.filter(c=>c.selected).map(c=>path.join(root,c.relativePath)),...(index?[index]:[])];const scanned=new Set<string>();
 while(queue.length){const file=queue.shift()!;if(scanned.has(file)||!fs.existsSync(file))continue;scanned.add(file);
  const ext=path.extname(file).toLowerCase();if(!['.html','.htm','.css'].includes(ext))continue;
  const content=fs.readFileSync(file,'utf8');const refs:{value:string;render:boolean}[]=[];
  if(ext==='.css'){for(const match of content.matchAll(/(?:url\(\s*['"]?([^)'"\s]+)|@import\s+['"]([^'"]+))/g))refs.push({value:match[1]||match[2],render:true});}
  else {const $=load(content);$('[src],[href],[poster]').each((_,el)=>{for(const attr of ['src','href','poster']){const value=$(el).attr(attr);if(value)refs.push({value,render:attr!=='href'||['link','script'].includes(el.tagName)});}});$('style,[style]').each((_,el)=>{const css=el.tagName==='style'?$(el).text():$(el).attr('style')||'';for(const m of css.matchAll(/url\(\s*['"]?([^)'"\s]+)/g))refs.push({value:m[1],render:true});});$('[srcset]').each((_,el)=>{for(const part of ($(el).attr('srcset')||'').split(','))refs.push({value:part.trim().split(/\s+/)[0],render:true});});}
  for(const {value,render} of refs){if(/^(https?:)?\/\//i.test(value)){if(render)warnings.add('联网资源：'+value);continue;}const target=refPath(file,value,root);if(!target)continue;
   try{safePath(root,path.relative(root,target));}catch{warnings.add('资源在所选文件夹之外：'+value+'（请选择包含该资源的上一级目录）');continue;}
   if(!fs.existsSync(target)){warnings.add('缺失资源：'+slash(path.relative(root,target)));continue;}
   if(fs.lstatSync(target).isSymbolicLink()){warnings.add('未复制符号链接：'+value);continue;}
   if(fs.statSync(target).isFile()){closure.add(target);if(/\.(html?|css)$/i.test(target))queue.push(target);}
  }
 }
 if(kind==='files')all=[...closure];
 if(courseId&&store){const old=store.all<Chapter>('chapters').filter(c=>c.courseId===courseId);for(const c of chapters){const exact=old.find(x=>x.relativePath===c.relativePath);const hashes=old.filter(x=>x.hash===c.hash);const match=exact||(hashes.length===1?hashes[0]:undefined);if(match)c.matchId=match.id;else if(mode==='update')warnings.add('新增章节（未匹配旧记录）：'+c.title);}}
 if(mode==='new'&&store){const selected=chapters.filter(c=>c.selected);for(const course of store.all<Course>('courses')){const old=store.all<Chapter>('chapters').filter(c=>c.courseId===course.id&&c.active);if(old.length===selected.length&&selected.every(c=>old.some(x=>x.hash===c.hash)))warnings.add('检测到相同课程：'+course.title+'。如需保留原记录，请返回并选择“更新已有课程内容”。');}}
 return {root,files:all,draft:{token:randomUUID(),title:courseId&&store?store.course(courseId).title:path.basename(root),chapters,warnings:[...warnings],indexPath:index?slash(path.relative(root,index)):null,fileCount:all.length,bytes:all.reduce((s,f)=>s+fs.statSync(f).size,0),mode,courseId}};
}
export function commitImport(store:Store,prepared:Prepared,draft:ImportDraft,overrides?:Partial<Course>):string {
 const selected=draft.chapters.filter(c=>c.selected);if(!selected.length)throw Error('请至少保留一个章节');
 const original=new Map(prepared.draft.chapters.map(c=>[c.relativePath,c]));
 if(selected.some(c=>!original.has(c.relativePath)))throw Error('导入内容已变化，请重新选择文件');
 const id=prepared.draft.courseId||overrides?.id||randomUUID();const existing=prepared.draft.courseId?store.course(id):null;
 const library=path.join(store.root,'library');fs.mkdirSync(library,{recursive:true});
 const dest=path.join(library,id);const stage=path.join(library,'.stage-'+randomUUID());const previous=path.join(library,'.old-'+randomUUID());
 fs.mkdirSync(stage,{recursive:true});
 try {
  if(existing&&fs.existsSync(dest))for(const file of filesIn(dest)){const target=safePath(stage,path.relative(dest,file));fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(file,target);}
  for(const file of prepared.files){const rel=path.relative(prepared.root,file);const target=safePath(stage,rel);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(file,target);}
  if(fs.existsSync(dest))fs.renameSync(dest,previous);fs.renameSync(stage,dest);
  try{store.db.transaction(()=>{
   const course:Course={id,title:draft.title.trim().slice(0,180)||path.basename(prepared.root),description:existing?.description||'我的课程 · 离线复习资料',color:existing?.color||'#568ccc',icon:existing?.icon||'book',order:existing?.order??store.all<Course>('courses').length,archived:existing?.archived||false,indexPath:prepared.draft.mode==='append'?existing?.indexPath||null:prepared.draft.indexPath,updatedAt:new Date().toISOString(),...overrides};
   store.put('courses',course);const old=store.all<Chapter>('chapters').filter(c=>c.courseId===id);
   if(prepared.draft.mode==='update')for(const c of old)store.put('chapters',{...c,active:false});
   const offset=prepared.draft.mode==='append'?Math.max(-1,...old.map(c=>c.order))+1:0;
   selected.forEach((c,i)=>{const source=original.get(c.relativePath)!;const prior=source.matchId?old.find(x=>x.id===source.matchId):undefined;const chapter:Chapter={id:prior?.id||randomUUID(),courseId:id,title:c.title.trim().slice(0,180)||source.title,relativePath:source.relativePath,hash:source.hash,order:prepared.draft.mode==='append'&&prior?prior.order:offset+i,active:true,scrollY:prior?.scrollY||0,progress:prior?.progress||0,lastRead:prior?.lastRead||null,seconds:prior?.seconds||0,reviews:prior?.reviews||0,rating:prior?.rating||null,dueDate:prior?.dueDate||null,checks:prior?.checks||{}};store.put('chapters',chapter);});
  })();}catch(e){fs.rmSync(dest,{recursive:true,force:true});if(fs.existsSync(previous))fs.renameSync(previous,dest);throw e;}
  if(fs.existsSync(previous))fs.rmSync(previous,{recursive:true,force:true});return id;
 }finally{if(fs.existsSync(stage))fs.rmSync(stage,{recursive:true,force:true});}
}
