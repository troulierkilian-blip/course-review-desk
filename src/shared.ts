export type Rating = 'forgot' | 'fuzzy' | 'familiar' | 'mastered';
export const ratings: Record<Rating,{label:string;days:number;color:string}> = {
  forgot:{label:'忘记',days:1,color:'#d46b6b'}, fuzzy:{label:'模糊',days:3,color:'#bd8a36'},
  familiar:{label:'熟悉',days:7,color:'#397bc4'}, mastered:{label:'掌握',days:30,color:'#329387'}
};
export interface Course { id:string; title:string; description:string; color:string; icon:string; order:number; archived:boolean; indexPath:string|null; updatedAt:string; }
export interface Chapter { id:string; courseId:string; title:string; relativePath:string; hash:string; order:number; active:boolean; scrollY:number; progress:number; lastRead:string|null; seconds:number; reviews:number; rating:Rating|null; dueDate:string|null; checks:Record<string,boolean>; }
export interface Review { id:string; chapterId:string; createdAt:string; date:string; rating:Rating; dueDate:string; chapterTitle:string; courseTitle:string; }
export interface Snapshot { courses:Course[]; chapters:Chapter[]; reviews:Review[]; daily:{date:string;seconds:number}[]; dataPath:string; today:string; }
export interface ImportChapter { relativePath:string; title:string; hash:string; selected:boolean; matchId?:string; }
export interface ImportDraft { token:string; title:string; chapters:ImportChapter[]; warnings:string[]; indexPath:string|null; fileCount:number; bytes:number; mode:'new'|'append'|'update'; courseId?:string; }
export interface ReaderTarget {courseId:string;chapterId?:string;relativePath:string;title:string;}
export interface AIConfig { baseUrl:string; model:string; stream:boolean; hasKey:boolean; }
export interface AIConfigInput { baseUrl:string; model:string; stream:boolean; apiKey?:string; }
export type AIMessageStatus = 'streaming'|'complete'|'stopped'|'failed';
export interface AIMessage { id:string; turnId:string; chapterId:string; role:'user'|'assistant'; content:string; quote:string; model:string; createdAt:string; status:AIMessageStatus; error?:string; excerpted?:boolean; contextChars?:number; chapterHash?:string; }
export interface AIContextInfo { characters:number; excerpted:boolean; }
export interface AISelection {chapterId:string;text:string;}
export interface AISendInput {chapterId:string;question:string;quote:string;retryOf?:string;}
export interface ReaderBounds {x:number;y:number;width:number;height:number;}
export interface Api {
 uiPreferences():Promise<{aiPanelWidth:number}>;
 saveAIWidth(width:number):Promise<void>;
 readerResizeStart(token:string):Promise<string|null>;
 readerResizeEnd(token:string,bounds:ReaderBounds|null):Promise<void>;
 aiConfig():Promise<AIConfig>;
 aiSaveConfig(config:AIConfigInput):Promise<AIConfig>;
 aiClearKey():Promise<AIConfig>;
 aiTest():Promise<string>;
 aiConversation(chapterId:string):Promise<{messages:AIMessage[];context:AIContextInfo}>;
 aiSend(input:AISendInput):Promise<string>;
 aiStop(chapterId:string):Promise<void>;
 aiClear(chapterId:string):Promise<void>;
 aiCopy(chapterId:string,messageId:string):Promise<void>;
 aiQuote():Promise<AISelection|null>;
 onAIMessage(fn:(message:AIMessage)=>void):()=>void;
 onAISelection(fn:(selection:AISelection)=>void):()=>void;
 snapshot():Promise<Snapshot>;
 chooseImport(kind:'folder'|'files',mode:ImportDraft['mode'],courseId?:string):Promise<ImportDraft|null>;
 commitImport(draft:ImportDraft):Promise<string>;
 courseEdit(id:string,patch:{title?:string;archived?:boolean;order?:number}):Promise<void>;
 openReader(target:ReaderTarget):Promise<void>;
 readerLayout(bounds:{x:number;y:number;width:number;height:number}|null):Promise<void>;
 closeReader():Promise<void>;
 find(text:string,forward?:boolean):Promise<void>;
 zoom(value:number):Promise<void>;
 completeReview(chapterId:string,rating:Rating,dueDate?:string):Promise<void>;
 changeDue(chapterId:string,date:string):Promise<void>;
 backup():Promise<string|null>;
 restore():Promise<boolean>;
 openData():Promise<void>;
 onChange(fn:()=>void):()=>void;
 onReader(fn:(target:ReaderTarget)=>void):()=>void;
 onReaderError(fn:(message:string)=>void):()=>void;
 onFind(fn:(r:{activeMatchOrdinal:number;matches:number})=>void):()=>void;
}
declare global { interface Window { desk:Api; } }
