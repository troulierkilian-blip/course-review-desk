import * as cheerio from 'cheerio';
import type {AIMessage} from '../shared';

export const CHAPTER_LIMIT=24000, HISTORY_LIMIT=12000;
export interface ChapterText {text:string;sections:{title:string;text:string}[];}

export function extractChapter(html:string):ChapterText {
  const $=cheerio.load(html);
  $('script,style,nav,header,footer,iframe,object,embed,svg,form,button,input,textarea,select,.toc,.chapter-links,[role="navigation"]').remove();
  const root=$('main').first().length?$('main').first():$('article').first().length?$('article').first():$('body');
  let section={title:'章节正文',text:''};const sections=[section];
  function walk(node:any):string {
    if(node.type==='text')return String(node.data||'').replace(/\s+/g,' ');
    const name=node.name||'';
    if(name==='pre')return '\n\n```\n'+$(node).text().replace(/\r\n/g,'\n').trimEnd()+'\n```\n\n';
    if(name==='br')return '\n';
    if(name==='img')return node.attribs?.alt?' [插图说明：'+node.attribs.alt+'] ':'';
    const text=(node.children||[]).map(walk).join('');
    if(/^h[1-6]$/.test(name))return '\n\n'+'#'.repeat(Number(name[1]))+' '+text.trim()+'\n\n';
    if(name==='td'||name==='th')return text+' | ';
    if(name==='li')return '\n- '+text.trim()+'\n';
    if(['p','div','section','article','main','table','tr','blockquote','details','summary','ul','ol'].includes(name))return '\n'+text+'\n';
    return text;
  }
  const text=walk(root[0]).replace(/\n[ \t]+\n/g,'\n\n').replace(/\n{3,}/g,'\n\n').trim();
  // Do not interpret headings inside fenced code as section boundaries.
  let fence=false;
  for(const line of text.split('\n')) {
    if(line.startsWith('```'))fence=!fence;
    if(!fence&&/^#{1,3} /.test(line)){section={title:line.replace(/^#+ /,''),text:''};sections.push(section);}
    section.text+=line+'\n';
  }
  return {text,sections:sections.filter(s=>s.text.trim())};
}

export function selectContext(chapter:ChapterText,question='',quote='',limit=CHAPTER_LIMIT) {
  if(chapter.text.length<=limit)return {text:chapter.text,excerpted:false,characters:chapter.text.length};
  const query=(quote+' '+question).toLowerCase();
  const words=[...new Set(query.match(/[a-z_][a-z_0-9]{1,}|[\u4e00-\u9fff]{2,}/g)||[])];
  const grams=words.flatMap(w=>/[\u4e00-\u9fff]/.test(w)?Array.from({length:Math.max(1,w.length-1)},(_,i)=>w.slice(i,i+2)):[w]).slice(0,300);
  const needle=quote.trim().slice(0,120).toLowerCase();
  const ranked=chapter.sections.map((s,index)=>({s,index,score:(needle&&s.text.toLowerCase().includes(needle)?10000:0)+grams.reduce((n,w)=>n+(s.title.toLowerCase().includes(w)?8:0)+(s.text.toLowerCase().includes(w)?1:0),0)})).sort((a,b)=>b.score-a.score||a.index-b.index);
  const picked:{index:number;text:string}[]=[];let remaining=limit-60;
  for(const {s,index} of ranked){if(remaining<100)break;let text=s.text;
    if(text.length>remaining){const location=needle?text.toLowerCase().indexOf(needle):-1;const start=Math.max(0,location-Math.floor(remaining/4));text=(start?'[本节前文已节选]\n':'')+text.slice(start,start+remaining-50)+'\n[本节内容已节选]';}
    picked.push({index,text});remaining-=text.length+2;
  }
  const text='[章节过长，以下为与问题相关的小节节选]\n'+picked.sort((a,b)=>a.index-b.index).map(s=>s.text).join('\n');
  return {text:text.slice(0,limit),excerpted:true,characters:Math.min(text.length,limit)};
}

export function recentHistory(messages:AIMessage[]):{role:'user'|'assistant';content:string}[] {
  const turns=new Map<string,AIMessage[]>();
  for(const m of messages){const list=turns.get(m.turnId)||[];list.push(m);turns.set(m.turnId,list);}
  const pairs=[...turns.values()].filter(t=>t.some(m=>m.role==='assistant'&&m.status==='complete')).slice(-8);
  let length=0;const result:{role:'user'|'assistant';content:string}[][]=[];
  for(const turn of pairs.reverse()) {
    const user=turn.find(m=>m.role==='user')!,answer=[...turn].reverse().find(m=>m.role==='assistant'&&m.status==='complete')!;
    if(!user)continue;
    const pair=[{role:'user' as const,content:(user.quote?'引用文字：\n'+user.quote+'\n\n':'')+user.content},{role:'assistant' as const,content:answer.content}];
    const size=pair.reduce((s,m)=>s+m.content.length,0);if(length+size>HISTORY_LIMIT)break;
    length+=size;result.unshift(pair);
  }
  return result.flat();
}
