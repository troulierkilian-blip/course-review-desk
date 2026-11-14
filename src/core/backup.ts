import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import AdmZip from 'adm-zip';
import Database from 'better-sqlite3';
import {Store} from './store';
import {safePath} from './library';

export function createBackup(store:Store,destination:string){
 store.checkpoint();const zip=new AdmZip();zip.addLocalFile(path.join(store.root,'review.sqlite'));
 const library=path.join(store.root,'library');if(fs.existsSync(library))zip.addLocalFolder(library,'library');
 zip.addFile('manifest.json',Buffer.from(JSON.stringify({format:'course-review-desk',version:1,createdAt:new Date().toISOString()})));
 const temp=destination+'.tmp';zip.writeZip(temp);fs.renameSync(temp,destination);
}
export function restoreBackup(store:Store,file:string):Store {
 const zip=new AdmZip(file);const manifest=zip.readAsText('manifest.json');
 if(!manifest||JSON.parse(manifest).format!=='course-review-desk'||JSON.parse(manifest).version!==1)throw Error('请选择本软件导出的完整备份 ZIP');
 const stage=path.join(store.root,'.restore-'+randomUUID());fs.mkdirSync(stage,{recursive:true});
 try {
  let total=0;for(const entry of zip.getEntries()){const n=entry.entryName;if(n==='manifest.json')continue;if(n!=='review.sqlite'&&!n.startsWith('library/'))throw Error('备份包含非资料库文件');if(n.includes('\\')||n.includes(':')||n.startsWith('/')||n.split('/').includes('..'))throw Error('备份路径无效');total+=entry.header.size;if(total>5*1024**3)throw Error('备份超过 5 GB');const dest=safePath(stage,n);if(entry.isDirectory)fs.mkdirSync(dest,{recursive:true});else{fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,entry.getData());}}
  const dbfile=path.join(stage,'review.sqlite');if(!fs.existsSync(dbfile))throw Error('备份缺少复习记录');
  const check=new Database(dbfile,{readonly:true,fileMustExist:true});try{if(check.pragma('integrity_check',{simple:true})!=='ok')throw Error('备份数据库损坏');for(const table of ['courses','chapters','reviews','daily'])check.prepare(`SELECT * FROM ${table} LIMIT 1`).all();for(const row of check.prepare('SELECT data FROM chapters').all() as {data:string}[]){const c=JSON.parse(row.data);safePath(path.join(stage,'library'),c.courseId+'/'+c.relativePath);if(c.active&&!fs.existsSync(safePath(path.join(stage,'library'),c.courseId+'/'+c.relativePath)))throw Error('备份缺少章节文件');}}finally{check.close();}
  const before=path.join(store.root,'backups');fs.mkdirSync(before,{recursive:true});createBackup(store,path.join(before,`恢复前-${new Date().toISOString().replace(/[:.]/g,'-')}.zip`));
  store.close();const rollback=path.join(stage,'rollback');fs.mkdirSync(rollback);
  const items=['review.sqlite','library'];
  try{for(const item of items){const current=path.join(store.root,item);if(fs.existsSync(current))fs.renameSync(current,path.join(rollback,item));const incoming=path.join(stage,item);if(fs.existsSync(incoming))fs.renameSync(incoming,current);}return new Store(store.root);}
  catch(e){for(const item of items){const old=path.join(rollback,item);if(fs.existsSync(old)){const current=path.join(store.root,item);if(fs.existsSync(current))fs.rmSync(current,{recursive:true,force:true});fs.renameSync(old,current);}}throw e;}
 }finally{fs.rmSync(stage,{recursive:true,force:true});}
}
