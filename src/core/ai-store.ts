import type {Store} from './store';
import type {AIConfigInput,AIMessage} from '../shared';

export class AIStore {
  constructor(private store:Store){
    store.db.exec(`CREATE TABLE IF NOT EXISTS ai_threads(chapter_id TEXT PRIMARY KEY,updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ai_messages(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,chapter_id TEXT NOT NULL,data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS ai_chapter_messages ON ai_messages(chapter_id,seq);`);
  }
  config():Omit<AIConfigInput,'apiKey'> {
    const row=this.store.db.prepare("SELECT value FROM meta WHERE key='ai_config'").get() as {value:string}|undefined;
    try{const value=JSON.parse(row?.value||'{}');return {baseUrl:typeof value.baseUrl==='string'?value.baseUrl:'',model:typeof value.model==='string'?value.model:'',stream:value.stream!==false};}
    catch{return {baseUrl:'',model:'',stream:true};}
  }
  saveConfig(config:Omit<AIConfigInput,'apiKey'>){this.store.db.prepare("INSERT OR REPLACE INTO meta(key,value) VALUES('ai_config',?)").run(JSON.stringify(config));}
  messages(chapterId:string):AIMessage[]{return (this.store.db.prepare('SELECT data FROM ai_messages WHERE chapter_id=? ORDER BY seq').all(chapterId) as {data:string}[]).map(r=>JSON.parse(r.data));}
  put(message:AIMessage){this.store.db.transaction(()=>{
    this.store.db.prepare('INSERT INTO ai_messages(id,chapter_id,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(message.id,message.chapterId,JSON.stringify(message));
    this.store.db.prepare('INSERT OR REPLACE INTO ai_threads(chapter_id,updated_at) VALUES(?,?)').run(message.chapterId,new Date().toISOString());
  })();}
  clear(chapterId:string){this.store.db.transaction(()=>{this.store.db.prepare('DELETE FROM ai_messages WHERE chapter_id=?').run(chapterId);this.store.db.prepare('DELETE FROM ai_threads WHERE chapter_id=?').run(chapterId);})();}
  recover(){for(const row of this.store.db.prepare('SELECT data FROM ai_messages').all() as {data:string}[]){const m=JSON.parse(row.data) as AIMessage;if(m.status==='streaming')this.put({...m,status:'stopped',error:'上次生成未完成，已保留收到的内容。'});}}
}
