import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {ratings, type Course, type Chapter, type Review, type Rating, type Snapshot} from '../shared';
import {DEFAULT_AI_WIDTH,validAIWidth} from '../panel-layout';

export function localDate(d=new Date()):string {return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
export function validDate(s:string):boolean {if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;const d=new Date(s+'T12:00:00');return !isNaN(+d)&&localDate(d)===s;}
export function dueFor(rating:Rating,from=new Date()):string {const d=new Date(from);d.setDate(d.getDate()+ratings[rating].days);return localDate(d);}
export function canCountTime(s:{reader:boolean;visible:boolean;focused:boolean;locked:boolean;idle:number}):boolean {return s.reader&&s.visible&&s.focused&&!s.locked&&s.idle<300;}

export class Store {
 db:Database.Database;
 constructor(public root:string) {
  fs.mkdirSync(root,{recursive:true});
  this.db=new Database(path.join(root,'review.sqlite'));
  this.db.pragma('journal_mode = WAL');
  this.db.pragma('synchronous = FULL');
  this.db.exec(`CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS courses(id TEXT PRIMARY KEY,data TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS chapters(id TEXT PRIMARY KEY,data TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS reviews(id TEXT PRIMARY KEY,data TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS daily(date TEXT PRIMARY KEY,seconds REAL NOT NULL DEFAULT 0);`);
  this.db.prepare("INSERT OR IGNORE INTO meta VALUES('schema','1')").run();
 }
 get<T>(table:'courses'|'chapters'|'reviews',id:string):T|undefined {const row=this.db.prepare(`SELECT data FROM ${table} WHERE id=?`).get(id) as {data:string}|undefined;return row?JSON.parse(row.data):undefined;}
 all<T>(table:'courses'|'chapters'|'reviews'):T[]{return (this.db.prepare(`SELECT data FROM ${table}`).all() as {data:string}[]).map(x=>JSON.parse(x.data));}
 put<T extends {id:string}>(table:'courses'|'chapters'|'reviews',value:T){this.db.prepare(`INSERT INTO ${table}(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`).run(value.id,JSON.stringify(value));}
 course(id:string){const c=this.get<Course>('courses',id);if(!c)throw Error('课程不存在');return c;}
 chapter(id:string){const c=this.get<Chapter>('chapters',id);if(!c)throw Error('章节不存在');return c;}
 snapshot():Snapshot {
  const courses=this.all<Course>('courses').sort((a,b)=>a.order-b.order);
  const chapters=this.all<Chapter>('chapters').sort((a,b)=>a.order-b.order);
  const reviews=this.all<Review>('reviews').sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(r=>({...r,chapterTitle:chapters.find(c=>c.id===r.chapterId)?.title||r.chapterTitle,courseTitle:courses.find(c=>c.id===chapters.find(x=>x.id===r.chapterId)?.courseId)?.title||r.courseTitle}));
  return {courses,chapters,reviews,daily:this.db.prepare('SELECT date,seconds FROM daily ORDER BY date').all() as Snapshot['daily'],dataPath:this.root,today:localDate()};
 }
 editCourse(id:string,patch:{title?:string;archived?:boolean;order?:number}) {const c=this.course(id);if(patch.title!==undefined)c.title=patch.title.trim().slice(0,180)||c.title;if(typeof patch.archived==='boolean')c.archived=patch.archived;if(Number.isFinite(patch.order))c.order=patch.order!;this.put('courses',c);}
 reading(id:string,patch:{scrollY?:number;progress?:number;checks?:Record<string,boolean>}){
  const c=this.chapter(id);
  if(Number.isFinite(patch.scrollY))c.scrollY=Math.max(0,Math.min(1e8,patch.scrollY!));
  if(Number.isFinite(patch.progress))c.progress=Math.max(0,Math.min(1,patch.progress!));
  if(patch.checks && Object.keys(patch.checks).length<2000)c.checks=Object.fromEntries(Object.entries(patch.checks).filter(([k,v])=>k.length<500&&typeof v==='boolean'));
  c.lastRead=new Date().toISOString();this.put('chapters',c);
 }
 addTime(id:string,seconds:number,date=localDate()) {if(seconds<=0||!Number.isFinite(seconds))return;this.db.transaction(()=>{const c=this.chapter(id);c.seconds+=seconds;this.put('chapters',c);this.db.prepare('INSERT INTO daily(date,seconds) VALUES(?,?) ON CONFLICT(date) DO UPDATE SET seconds=seconds+excluded.seconds').run(date,seconds);})();}
 review(id:string,rating:Rating,dueDate?:string,at=new Date()) {
  if(!ratings[rating])throw Error('请选择掌握程度');
  const due=dueDate||dueFor(rating,at);if(!validDate(due))throw Error('复习日期无效');
  this.db.transaction(()=>{const c=this.chapter(id);const course=this.course(c.courseId);c.reviews++;c.rating=rating;c.dueDate=due;this.put('chapters',c);this.put('reviews',{id:randomUUID(),chapterId:id,createdAt:at.toISOString(),date:localDate(at),rating,dueDate:due,chapterTitle:c.title,courseTitle:course.title} as Review);})();
 }
 changeDue(id:string,date:string){if(!validDate(date))throw Error('请输入有效日期');const c=this.chapter(id);c.dueDate=date;this.put('chapters',c);}
 uiPreferences(){const row=this.db.prepare("SELECT value FROM meta WHERE key='ai_panel_width'").get() as {value:string}|undefined;const width=Number(row?.value);return {aiPanelWidth:validAIWidth(width)?Math.round(width):DEFAULT_AI_WIDTH};}
 saveAIWidth(width:number){if(!validAIWidth(width))throw Error('AI 面板宽度无效');this.db.prepare("INSERT OR REPLACE INTO meta(key,value) VALUES('ai_panel_width',?)").run(String(Math.round(width)));}
 checkpoint(){this.db.pragma('wal_checkpoint(TRUNCATE)');}
 close(){this.checkpoint();this.db.close();}
}
