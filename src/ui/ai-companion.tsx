import React,{useEffect,useRef,useState} from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import {Sparkles,Settings,Send,Square,X,Copy,Check,RotateCcw,Trash2,Quote,BookOpen,KeyRound,Link2,LoaderCircle,CheckCircle2} from 'lucide-react';
import type {AIConfig,AIMessage,AISelection,Chapter} from '../shared';
import 'katex/dist/katex.min.css';
import './ai.css';

const errorText=(e:unknown)=>(e instanceof Error?e.message:String(e)).replace(/^Error invoking remote method '[^']+': Error: /,'');

export function AISettings({compact=false,onSaved,refreshVersion=0}:{compact?:boolean;onSaved:()=>void;refreshVersion?:number}) {
  const [config,setConfig]=useState<AIConfig|null>(null),[baseUrl,setBaseUrl]=useState(''),[model,setModel]=useState(''),[key,setKey]=useState(''),[stream,setStream]=useState(true);
  const [busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[failed,setFailed]=useState(false);
  useEffect(()=>{let alive=true;window.desk.aiConfig().then(c=>{if(alive){setConfig(c);setBaseUrl(c.baseUrl);setModel(c.model);setStream(c.stream);}}).catch(e=>{if(alive){setFailed(true);setNotice(errorText(e));}});return()=>{alive=false;};},[refreshVersion]);
  async function act(fn:()=>Promise<void>){setBusy(true);setNotice('');setFailed(false);try{await fn();}catch(e){setFailed(true);setNotice(errorText(e));}finally{setBusy(false);}}
  async function save(){const c=await window.desk.aiSaveConfig({baseUrl,model,stream,apiKey:key||undefined});setConfig(c);setKey('');onSaved();return c;}
  return <section className={compact?'ai-settings':'panel settings-panel ai-settings'}>
    {!compact&&<><h2><Sparkles size={20}/>AI 服务</h2><p>连接你自己的 API，让复习伴侣结合当前章节讲解。支持 Chat Completions 兼容接口。</p></>}
    <div className="ai-service-badge"><span className="ai-spark"><Sparkles size={18}/></span><div><strong>为你的学习，连接一位伴侣</strong><small>当前章节 · 引用文字 · 连续追问</small></div><span className={'ai-connection '+(config?.hasKey?'ready':'')}>{config?.hasKey?'密钥已保存':'尚未配置'}</span></div>
    <div className="form-field"><label htmlFor="ai-base"><Link2 size={14}/>API 基础地址</label><input id="ai-base" disabled={busy} value={baseUrl} onChange={e=>setBaseUrl(e.target.value)} placeholder="https://你的服务地址/v1" autoComplete="off" spellCheck={false}/><small>填写服务商提供的基础地址；也支持完整的 /chat/completions 地址。</small></div>
    <div className="ai-config-row"><div className="form-field"><label htmlFor="ai-model">模型名称</label><input id="ai-model" disabled={busy} value={model} onChange={e=>setModel(e.target.value)} placeholder="填写服务商提供的模型 ID" autoComplete="off" spellCheck={false}/></div><div className="form-field"><label htmlFor="ai-key"><KeyRound size={14}/>API Key</label><input id="ai-key" type="password" disabled={busy} value={key} onChange={e=>setKey(e.target.value)} placeholder={config?.hasKey?'已加密保存，留空保留':'粘贴你的 API Key'} autoComplete="new-password" spellCheck={false}/></div></div>
    <label className="ai-stream-option"><input type="checkbox" checked={stream} disabled={busy} onChange={e=>setStream(e.target.checked)}/><span><strong>逐步显示回答</strong><small>遇到不支持流式的接口时，可关闭此项。</small></span></label>
    <div className="button-row ai-config-actions"><button className="primary" disabled={busy||!baseUrl.trim()||!model.trim()} onClick={()=>void act(async()=>{const c=await save();setNotice(c.hasKey?'AI 设置已保存，可以回到章节提问。':'地址和模型已保存，请填写此接口的密钥。');})}><Check size={16}/>保存设置</button><button className="secondary" disabled={busy||!baseUrl.trim()||!model.trim()} onClick={()=>void act(async()=>{await save();setNotice(await window.desk.aiTest());})}>{busy?<LoaderCircle className="spin" size={16}/>:<CheckCircle2 size={16}/>}测试连接</button><button className="text-button" disabled={busy} onClick={()=>void act(async()=>{setConfig(await window.desk.aiClearKey());setKey('');onSaved();setNotice('已清除保存的密钥。');})}>清除密钥</button></div>
    <p className="ai-config-note">密钥仅在本机加密保存，不包含在资料备份中。测试连接会发送一条简短消息；提问时会将本章文字和引用内容发送给你配置的服务商。</p>
    {notice&&<div className={'ai-notice '+(failed?'error':'')} role="status">{notice}</div>}
  </section>;
}

function MessageBody({text}:{text:string}) {
  return <div className="ai-markdown"><Markdown skipHtml remarkPlugins={[remarkGfm,remarkMath]} rehypePlugins={[[rehypeKatex,{trust:false,strict:'ignore',throwOnError:false,maxExpand:100,maxSize:20}]]}
    components={{img:({alt})=><span className="ai-image-note">{alt?'[图片：'+alt+']':'[图片未加载]'}</span>,a:({children,href})=><span className="ai-answer-link" title={href}>{children}{href&&<small>（{href}）</small>}</span>}}>{text}</Markdown></div>;
}

export function AICompanion({chapter,selection,configVersion,onClose,onSettings}:{chapter:Chapter;selection:AISelection|null;configVersion:number;onClose:()=>void;onSettings:()=>void}) {
  const [messages,setMessages]=useState<AIMessage[]>([]),[question,setQuestion]=useState(''),[quote,setQuote]=useState(''),[config,setConfig]=useState<AIConfig|null>(null);
  const [context,setContext]=useState({characters:0,excerpted:false}),[loading,setLoading]=useState(true),[submitting,setSubmitting]=useState(false),[error,setError]=useState(''),[copied,setCopied]=useState(''),[confirmClear,setConfirmClear]=useState(false);
  const scroll=useRef<HTMLDivElement>(null),input=useRef<HTMLTextAreaElement>(null),follow=useRef(true);
  const update=(items:AIMessage[],message:AIMessage)=>items.some(m=>m.id===message.id)?items.map(m=>m.id===message.id?message:m):[...items,message];
  useEffect(()=>{
    let alive=true,hydrated=false;const incoming:AIMessage[]=[];
    const off=window.desk.onAIMessage(m=>{if(m.chapterId!==chapter.id||!alive)return;if(!hydrated)incoming.push(m);setMessages(items=>update(items,m));});
    window.desk.aiConversation(chapter.id).then(result=>{if(alive){setMessages(incoming.reduce(update,result.messages));hydrated=true;incoming.length=0;setContext(result.context);setLoading(false);}}).catch(e=>{if(alive){setError(errorText(e));setLoading(false);}});
    return()=>{alive=false;off();};
  },[chapter.id]);
  useEffect(()=>{let alive=true;window.desk.aiConfig().then(c=>{if(alive)setConfig(c);}).catch(e=>{if(alive)setError(errorText(e));});return()=>{alive=false;};},[configVersion]);
  useEffect(()=>{if(selection?.chapterId===chapter.id){setQuote(selection.text);input.current?.focus();}},[selection,chapter.id]);
  useEffect(()=>{if(follow.current&&scroll.current)scroll.current.scrollTop=scroll.current.scrollHeight;},[messages,loading]);
  const generating=messages.some(m=>m.status==='streaming'),busy=generating||submitting;
  async function send(retry?:AIMessage){
    const user=retry?messages.find(m=>m.turnId===retry.turnId&&m.role==='user'):undefined;
    const text=user?.content||question.trim(),quoted=user?.quote??quote;if(!text||busy||loading||!config?.hasKey)return;
    setSubmitting(true);setError('');follow.current=true;
    try{await window.desk.aiSend({chapterId:chapter.id,question:text,quote:quoted,retryOf:retry?.id});if(!retry){setQuestion('');setQuote('');}}
    catch(e){setError(errorText(e));}finally{setSubmitting(false);}
  }
  async function copy(m:AIMessage){try{await window.desk.aiCopy(chapter.id,m.id);setCopied(m.id);setTimeout(()=>setCopied(''),1800);}catch{setError('复制未完成，请手动选择回答文字复制。');}}
  async function clear(){try{await window.desk.aiClear(chapter.id);setMessages([]);setConfirmClear(false);setError('');}catch(e){setError(errorText(e));}}
  const latestAnswer=[...messages].reverse().find(m=>m.role==='assistant');
  return <aside id="ai-companion-panel" className="ai-panel" aria-label="AI 复习伴侣">
    <header className="ai-panel-header"><span className="ai-spark"><Sparkles size={21}/></span><div><h2>AI 复习伴侣</h2><span>把不懂的，聊明白</span></div><button className="icon-button" title="AI 服务设置" onClick={onSettings}><Settings size={17}/></button><button className="icon-button" title="关闭 AI 伴侣" onClick={onClose}><X size={19}/></button></header>
    <div className="ai-chapter-context"><BookOpen size={15}/><div><strong title={chapter.title}>{chapter.title}</strong><span>{latestAnswer?.excerpted?'本次参考：已节选相关小节':context.excerpted?'长章节 · 发送时节选相关小节':'参考当前章节正文'}{config?.model?' · '+config.model:''}</span></div><button className="icon-button" title="清空本章对话" disabled={loading||!messages.length} onClick={()=>setConfirmClear(true)}><Trash2 size={15}/></button></div>
    {confirmClear&&<div className="ai-clear-confirm"><span>清空本章的全部问答？</span><button onClick={()=>void clear()}>确认清空</button><button onClick={()=>setConfirmClear(false)}>取消</button></div>}
    <div className="ai-messages" ref={scroll} onScroll={()=>{const el=scroll.current;if(el)follow.current=el.scrollHeight-el.scrollTop-el.clientHeight<90;}}>
      {loading?<div className="ai-loading"><LoaderCircle className="spin" size={19}/>正在读取本章对话…</div>:!messages.length&&<div className="ai-welcome"><div className="ai-welcome-icon"><Sparkles size={28}/></div><h3>这一章，我们一起读懂</h3><p>告诉我哪里不明白，或选中课件文字后右键“询问 AI”。我会结合本章内容解释，再给你一个简单例子。</p><div className="ai-welcome-hint"><BookOpen size={14}/>已关联当前章节{context.characters>0&&` · ${(context.characters/1000).toFixed(1)} 千字符`}</div></div>}
      {messages.map(m=><article key={m.id} className={'ai-message '+m.role} data-message-id={m.id} data-status={m.status}><div className="ai-message-label">{m.role==='user'?'我的问题':<><Sparkles size={13}/>AI 伴侣</>}<time>{new Date(m.createdAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}</time></div>
        {m.quote&&<details className="ai-message-quote"><summary><Quote size={12}/>引用课件文字</summary><pre>{m.quote}</pre></details>}
        {m.role==='user'?<div className="ai-user-text">{m.content}</div>:m.content?<MessageBody text={m.content}/>:m.status==='streaming'?<div className="ai-thinking"><span/><span/><span/>正在思考…</div>:null}
        {m.status==='streaming'&&m.content&&<div className="ai-streaming-label">正在生成…</div>}
        {m.error&&<div className={'ai-message-error '+(m.status==='stopped'?'stopped':'')}>{m.error}</div>}
        {m.role==='assistant'&&m.status!=='streaming'&&<div className="ai-message-actions">{m.content&&<button onClick={()=>void copy(m)}>{copied===m.id?<Check size={13}/>:<Copy size={13}/>}{copied===m.id?'已复制':'复制'}</button>}{['failed','stopped'].includes(m.status)&&<button disabled={busy} onClick={()=>void send(m)}><RotateCcw size={13}/>重试</button>}{m.excerpted&&<span>基于本章节选</span>}{m.chapterHash&&m.chapterHash!==chapter.hash&&<span>回答后课件已更新</span>}</div>}
      </article>)}
    </div>
    <div className="ai-composer">
      {!config?.hasKey&&config&&<div className="ai-setup-prompt"><span>连接 API 后，即可开始提问</span><button onClick={onSettings}>去设置<Settings size={13}/></button></div>}
      {quote&&<div className="ai-quote-preview"><div><Quote size={13}/><strong>本次引用</strong><button title="移除引用文字" onClick={()=>setQuote('')}><X size={14}/></button></div><p title={quote}>{quote}</p></div>}
      <div className="ai-quick-actions">{['解释这段内容','举个简单例子','讲解这段代码'].map(label=><button key={label} disabled={busy} onClick={()=>{setQuestion(label+'。');input.current?.focus();}}>{label}</button>)}</div>
      <div className="ai-input-box"><textarea ref={input} aria-label="向 AI 提问" placeholder="哪里不太明白？在这里问我…" value={question} maxLength={8000} onChange={e=>setQuestion(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void send();}}}/><div className="ai-input-footer"><span>Enter 发送 · Shift+Enter 换行</span>{busy?<button className="ai-stop" onClick={()=>void window.desk.aiStop(chapter.id).catch(e=>setError(errorText(e)))}><Square size={13}/>停止</button>:<button className="ai-send" title="发送问题" disabled={!question.trim()||!config?.hasKey||loading} onClick={()=>void send()}><Send size={15}/></button>}</div></div>
      {error&&<div className="ai-notice error" role="alert">{error}</div>}
      <div className="ai-footnote">问答保存在本章 · 回答仅供理解与复习参考</div>
    </div>
  </aside>;
}
