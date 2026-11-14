export interface ChatMessage {role:'system'|'user'|'assistant';content:string;}
export type Fetcher=(url:string,init:RequestInit)=>Promise<Response>;
export class AIError extends Error {constructor(public code:string,message:string){super(message);}}

export function endpointFor(base:string):string {
  let url:URL;try{url=new URL(base.trim());}catch{throw new AIError('config','请输入有效的 API 基础地址。');}
  const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  if(url.protocol!=='https:'&&!(local&&url.protocol==='http:'))throw new AIError('config','API 地址应使用 HTTPS；本机接口可使用 HTTP。');
  if(url.username||url.password||url.search||url.hash)throw new AIError('config','API 地址不能包含账号、密钥、查询参数或锚点。');
  url.pathname=url.pathname.replace(/\/+$/,'');
  if(!url.pathname.endsWith('/chat/completions'))url.pathname+='/chat/completions';
  return url.toString();
}

export function apiError(status:number,body:string):AIError {
  const text=body.toLowerCase();
  if(status===401||status===403)return new AIError('auth','密钥无效或没有访问权限，请在 AI 服务设置中检查密钥。');
  if(/insufficient_quota|quota|credit|balance|余额|额度/.test(text)||status===402)return new AIError('quota','API 额度或余额不足，请查看服务商账户。');
  if(/context_length|context.*(long|limit|exceed)|maximum context|上下文/.test(text))return new AIError('context','当前上下文超过模型容量。请换用更大上下文的模型，或清空本章对话后重试。');
  if(/model.*(not found|not exist|invalid)|model_not_found/.test(text))return new AIError('model','模型不存在或不可用，请核对模型名称与接口地址。');
  if(status===404)return new AIError('endpoint','接口或模型不存在，请核对基础地址和模型名称。');
  if(status===429)return new AIError('rate','请求过于频繁，服务商正在限流，请稍后手动重试。');
  if(status>=500)return new AIError('server','AI 服务暂时不可用，请稍后重试。');
  return new AIError('request','接口拒绝了请求，请检查模型是否支持 Chat Completions；也可尝试关闭流式回答。');
}

async function boundedText(response:Response,limit=1000000) {
  if(!response.body)return '';const reader=response.body.getReader(),decoder=new TextDecoder();let text='';
  try{while(true){const r=await reader.read();if(r.done)break;text+=decoder.decode(r.value,{stream:true});if(text.length>limit)throw new AIError('size','服务返回的内容过大，已停止接收。');}return text+decoder.decode();}
  finally{await reader.cancel().catch(()=>{});}
}

export async function chatCompletion(options:{endpoint:string;key:string;model:string;stream:boolean;messages:ChatMessage[];signal:AbortSignal;fetcher:Fetcher;onText:(text:string)=>void;timeoutMs?:number}) {
  const abort=new AbortController();let timedOut=false;
  const cancel=()=>abort.abort();options.signal.addEventListener('abort',cancel,{once:true});if(options.signal.aborted)cancel();
  const timeout=setTimeout(()=>{timedOut=true;abort.abort();},options.timeoutMs??120000);
  let content='';
  const safeText=(final=false)=>{
    let text=content.split(options.key).join('[密钥已隐藏]');
    if(!final&&options.key)for(let n=Math.min(text.length,options.key.length-1);n>0;n--)if(text.endsWith(options.key.slice(0,n))){text=text.slice(0,-n);break;}
    return text;
  };
  function append(text:unknown){if(typeof text!=='string')return;content+=text;if(content.length>120000)throw new AIError('size','回答过长，已停止接收。请缩小问题范围。');options.onText(safeText());}
  try {
    const response=await options.fetcher(options.endpoint,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+options.key},body:JSON.stringify({model:options.model,messages:options.messages,stream:options.stream}),signal:abort.signal,redirect:'error',credentials:'omit'});
    if(!response.ok)throw apiError(response.status,await boundedText(response,32000));
    if(!response.headers.get('content-type')?.includes('text/event-stream')) {
      let json:any;try{json=JSON.parse(await boundedText(response));}catch(e){if(e instanceof AIError)throw e;throw new AIError('format','服务未返回有效的 JSON 回答，请核对 API 地址。');}
      if(json.error)throw apiError(400,JSON.stringify(json.error));
      append(json.choices?.[0]?.message?.content);if(json.choices?.[0]?.finish_reason==='length')throw new AIError('length','回答达到模型长度限制，已保留当前内容。');
    } else {
      if(!response.body)throw new AIError('empty','服务未返回内容。');
      const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',done=false,finished=false,lengthLimit=false;
      function event(block:string) {
        const data=block.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');
        if(!data)return;if(data.trim()==='[DONE]'){done=true;return;}
        let chunk:any;try{chunk=JSON.parse(data);}catch{throw new AIError('format','流式回答格式异常，已保留收到的内容。');}
        if(chunk.error)throw apiError(400,JSON.stringify(chunk.error));
        const choice=chunk.choices?.[0];append(choice?.delta?.content);
        if(choice?.finish_reason){finished=true;lengthLimit=choice.finish_reason==='length';}
      }
      try {
        while(!done){const r=await reader.read();if(r.done)break;buffer+=decoder.decode(r.value,{stream:true});if(buffer.length>1000000)throw new AIError('format','流式回答格式异常。');
          let match:RegExpMatchArray|null;while((match=buffer.match(/\r?\n\r?\n/))){event(buffer.slice(0,match.index));buffer=buffer.slice(match.index!+match[0].length);if(done)break;}}
        buffer+=decoder.decode();if(buffer.trim()&&!done)event(buffer);
        if(!done&&!finished)throw new AIError('interrupted','连接提前中断，已保留收到的内容，请手动重试。');
        if(lengthLimit)throw new AIError('length','回答达到模型长度限制，已保留当前内容。');
      }finally{await reader.cancel().catch(()=>{});}
    }
    if(!content.trim())throw new AIError('empty','服务未返回文字回答，请确认模型支持文字对话。');
    options.onText(safeText(true));return safeText(true);
  }catch(e){
    if(timedOut)throw new AIError('timeout','等待回答超时，已保留收到的内容，请检查网络后重试。');
    if(options.signal.aborted)throw new AIError('cancelled','已停止生成');
    if(e instanceof AIError)throw e;
    throw new AIError('network','无法连接 AI 服务，请检查网络、代理和 API 地址。');
  }finally{clearTimeout(timeout);options.signal.removeEventListener('abort',cancel);}
}
