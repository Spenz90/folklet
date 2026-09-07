import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {StringDecoder} from 'node:string_decoder';
import path from 'node:path';
import {managedBrowserHeader} from './http.mjs';

// Tools-only MCP client. No sampling, roots, elicitation, OAuth or background
// server-initiated execution. Never retry tools/call after an uncertain result.
// https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
// https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle
export const MCP_MAX_BYTES=2*1024*1024;
const versions=new Set(['2025-11-25','2025-06-18','2025-03-26','2024-11-05']);
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
export const cancelled=()=>Object.assign(Error('Plugin request was cancelled. Its external action may already have happened; check before retrying.'),{name:'AbortError'});
export function safePluginURL(value){
 let url;try{url=new URL(value);}catch{throw Error('Enter a valid plugin endpoint URL.');}
 const loopback=url.hostname==='localhost'||url.hostname==='[::1]'||/^127\./.test(url.hostname);
 if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.hash||url.search||url.protocol==='http:'&&!loopback)throw Error('Plugin endpoints require HTTPS (HTTP is allowed on loopback only), without credentials, query parameters or fragments.');
 return url.href;
}
export function redactPlugin(value,secrets=[]){let text=String(value??'');for(const secret of [...secrets].filter(value=>typeof value==='string'&&value).sort((a,b)=>b.length-a.length))text=text.split(secret).join('[redacted]');return text;}
export async function readBoundedBody(response,{signal,maxBytes=MCP_MAX_BYTES}={}){
 if(Number(response.headers?.get('content-length'))>maxBytes){await response.body?.cancel().catch(()=>{});throw Error('Plugin response exceeds the 2 MB limit.');}
 const reader=response.body?.getReader();if(!reader)throw Error('Plugin returned an empty response.');const chunks=[];let size=0;
 try{while(true){signal?.throwIfAborted();const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes)throw Error('Plugin response exceeds the 2 MB limit.');chunks.push(Buffer.from(value));}return Buffer.concat(chunks).toString('utf8');}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
export function normalizeTools(tools){
 if(!Array.isArray(tools)||tools.length>128)throw Error('A plugin connection supports at most 128 tools.');const names=new Set();
 return tools.map(tool=>{if(!object(tool)||typeof tool.name!=='string'||! /^[A-Za-z0-9_.:-]{1,128}$/.test(tool.name)||names.has(tool.name))throw Error('Plugin returned an invalid or duplicate tool name.');names.add(tool.name);
  if(tool.description!==undefined&&(typeof tool.description!=='string'||tool.description.length>12000))throw Error('A plugin tool description must be text under 12,000 characters.');
  if(!object(tool.inputSchema)||tool.inputSchema.type!=='object'||Buffer.byteLength(JSON.stringify(tool.inputSchema))>64000)throw Error('Each plugin tool needs an object inputSchema under 64 KB.');
  return {name:tool.name,description:tool.description??'',inputSchema:structuredClone(tool.inputSchema)};
 });
}
export class MCPClient{
 constructor({transport,url,headers={},command,args=[],cwd,env={},fetchImpl=fetch,spawnProcess=spawn,assertURL=()=>{},timeoutMs=30000,onToolsChanged=()=>{}}={}){
  this.config={transport,url,headers,command,args,cwd,env};this.fetchImpl=fetchImpl;this.spawnProcess=spawnProcess;this.assertURL=assertURL;this.timeoutMs=timeoutMs;this.onToolsChanged=onToolsChanged;
  this.closed=false;this.started=false;this.ready=false;this.pending=new Map();this.controller=new AbortController();this.sessionId='';this.version='';this.revision=0;this.stderrBytes=0;
 }
 startProcess(){
  const c=this.config;this.child=this.spawnProcess(c.command,c.args,{cwd:c.cwd,env:c.env,stdio:['pipe','pipe','pipe'],shell:false,windowsHide:true,detached:process.platform!=='win32'});
  const decoder=new StringDecoder('utf8');let buffer='';
  this.child.stdout.on('data',chunk=>{if(this.closed)return;buffer+=decoder.write(chunk);if(Buffer.byteLength(buffer)>MCP_MAX_BYTES){this.fail(Error('Plugin stdout exceeds its size limit.'));return;}
   let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end).replace(/\r$/,'');buffer=buffer.slice(end+1);if(!line.trim())continue;try{this.receive(JSON.parse(line));}catch{this.fail(Error('Plugin returned invalid JSON-RPC.'));return;}}
  });
  // Stderr is intentionally not retained or exposed: plugins may print credentials.
  this.child.stderr.on('data',chunk=>{this.stderrBytes=Math.min(this.stderrBytes+chunk.length,16384);});
  this.child.once('error',()=>this.fail(Error('Could not start the plugin executable. Check its installation and command.')));
  this.child.once('exit',()=>this.fail(Error('Plugin process exited. Reconnect it before using its tools.')));
  this.child.stdin.on('error',()=>this.fail(Error('Plugin input stream closed. Reconnect it before using its tools.')));
 }
 receive(message){
  if(!object(message)||message.jsonrpc!=='2.0')throw Error('Invalid JSON-RPC');
  if(typeof message.method==='string'){
   if(Object.hasOwn(message,'id'))this.write({jsonrpc:'2.0',id:message.id,...(message.method==='ping'?{result:{}}:{error:{code:-32601,message:'FOLKLET does not permit server-initiated requests.'}})});
   else if(message.method==='notifications/tools/list_changed'){this.revision++;this.onToolsChanged();}
   return;
  }
  const pending=this.pending.get(message.id);if(!pending)return;
  if(Object.hasOwn(message,'result')===Object.hasOwn(message,'error'))throw Error('Invalid JSON-RPC response');
  if(message.error)pending.reject(Error('MCP server rejected the request (code '+(Number.isInteger(message.error.code)?message.error.code:'unknown')+').'));
  else pending.resolve(message.result);
 }
 write(message){if(this.closed)throw Error('Plugin connection is closed.');this.child.stdin.write(JSON.stringify(message)+'\n');}
 fail(error){if(this.closed)return;this.failure=error;this.close();}
 requestSignal(signal){return AbortSignal.any([this.controller.signal,AbortSignal.timeout(this.timeoutMs),...(signal?[signal]:[])]);}
 httpHeaders(){return {...this.config.headers,'Content-Type':'application/json',Accept:'application/json, text/event-stream',[managedBrowserHeader]:'1',...(this.version?{'MCP-Protocol-Version':this.version}:{}),...(this.sessionId?{'MCP-Session-Id':this.sessionId}:{})};}
 cleanupRequest(method,body){
  // Cleanup is bounded and best effort. Aborting a request is not proof that a
  // remote action stopped; cancellation never resends the original tool call.
  try{this.assertURL(this.config.url);return Promise.resolve(this.fetchImpl(this.config.url,{method,headers:this.httpHeaders(),...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(1500),redirect:'error'})).then(response=>response.body?.cancel()).catch(()=>{});}catch{return Promise.resolve();}
 }
 async post(message,{signal,expectResponse=true}={}){
  const c=this.config;this.assertURL(c.url);signal?.throwIfAborted();
  const response=await this.fetchImpl(c.url,{method:'POST',headers:this.httpHeaders(),body:JSON.stringify(message),signal,redirect:'error'});
  if(response.status>=300&&response.status<400){await response.body?.cancel().catch(()=>{});throw Error('Plugin redirects are not allowed.');}
  if(!response.ok){await response.body?.cancel().catch(()=>{});const error=Error(response.status===404&&this.sessionId?'Plugin session expired. Reconnect it; the last action was not replayed.':'Plugin request failed (HTTP '+response.status+'). Check its endpoint and access.');if(response.status===404&&this.sessionId){this.sessionExpired=true;this.fail(error);}throw error;}
  if(message.method==='initialize'){const id=response.headers.get('mcp-session-id');if(id){if(id.length>1024||/[^\x21-\x7e]/.test(id))throw Error('Invalid MCP session ID.');this.sessionId=id;}}
  if(!expectResponse){await response.body?.cancel().catch(()=>{});if(response.status!==202&&response.status!==204)throw Error('MCP notification was not acknowledged.');return;}
  const contentType=(response.headers.get('content-type')||'').split(';')[0].trim();
  const handle=async value=>{
   if(!object(value)||value.jsonrpc!=='2.0')throw Error('Plugin returned invalid JSON-RPC.');
   if(typeof value.method==='string'){
    if(Object.hasOwn(value,'id'))await this.post({jsonrpc:'2.0',id:value.id,...(value.method==='ping'?{result:{}}:{error:{code:-32601,message:'FOLKLET does not permit server-initiated requests.'}})},{signal,expectResponse:false});
    else if(value.method==='notifications/tools/list_changed'){this.revision++;this.onToolsChanged();}
    return {matched:false};
   }
   if(value.id!==message.id)throw Error('Plugin returned a response for a different request.');
   if(Object.hasOwn(value,'result')===Object.hasOwn(value,'error'))throw Error('Plugin returned an invalid response.');
   if(value.error)throw Error('MCP server rejected the request (code '+(Number.isInteger(value.error.code)?value.error.code:'unknown')+').');
   return {matched:true,result:value.result};
  };
  if(contentType==='application/json'){const out=await handle(JSON.parse(await readBoundedBody(response,{signal})));if(!out.matched)throw Error('Plugin did not return the requested result.');return out.result;}
  if(contentType!=='text/event-stream'){await response.body?.cancel().catch(()=>{});throw Error('Plugin must return JSON or a Streamable HTTP event stream.');}
  const reader=response.body?.getReader();if(!reader)throw Error('Plugin event stream was empty.');const decoder=new TextDecoder();let buffer='',size=0;
  try{while(true){signal?.throwIfAborted();const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>MCP_MAX_BYTES)throw Error('Plugin response exceeds the 2 MB limit.');buffer+=decoder.decode(value,{stream:true});
    let match;while((match=/\r?\n\r?\n/.exec(buffer))){const event=buffer.slice(0,match.index);buffer=buffer.slice(match.index+match[0].length);const data=event.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).replace(/^ /,'')).join('\n');if(!data.trim())continue;const out=await handle(JSON.parse(data));if(out.matched)return out.result;}
   }
   throw Error('Plugin stream ended before its result. The action was not replayed. Reconnect and check before retrying.');
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 }
 async request(method,params={}, {signal}={}){
  if(this.closed)throw this.failure||Error('Plugin connection is closed.');const requestSignal=this.requestSignal(signal),id=randomUUID(),message={jsonrpc:'2.0',id,method,params};
  try{
   requestSignal.throwIfAborted();
   if(this.config.transport==='streamable-http')return await this.post(message,{signal:requestSignal});
   if(this.pending.size>=32)throw Error('Too many plugin requests.');
   return await new Promise((resolve,reject)=>{const finish=(fn,value)=>{requestSignal.removeEventListener('abort',aborted);this.pending.delete(id);fn(value);};const aborted=()=>{try{this.write({jsonrpc:'2.0',method:'notifications/cancelled',params:{requestId:id,reason:'Client cancelled'}});}catch{}finish(reject,cancelled());this.close();};
    this.pending.set(id,{resolve:value=>finish(resolve,value),reject:error=>finish(reject,error)});requestSignal.addEventListener('abort',aborted,{once:true});try{this.write(message);}catch(error){finish(reject,error);}
   });
  }catch(error){if(requestSignal.aborted){if(this.config.transport==='streamable-http'&&!this.sessionExpired)void this.cleanupRequest('POST',{jsonrpc:'2.0',method:'notifications/cancelled',params:{requestId:id,reason:'Client cancelled'}});this.close();throw this.failure||cancelled();}throw error;}
 }
 async connect({signal}={}){
  signal?.throwIfAborted();if(this.closed)throw Error('Plugin connection is closed.');
  if(this.started)throw Error('This MCP client has already connected.');this.started=true;
  if(this.config.transport==='stdio')this.startProcess();else if(this.config.transport!=='streamable-http')throw Error('Choose stdio or Streamable HTTP.');
  try{const init=await this.request('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'folklet',version:'0.6.1'}},{signal});
   if(!object(init)||!versions.has(init.protocolVersion)||!object(init.capabilities)||!object(init.capabilities.tools))throw Error('Plugin did not negotiate a supported MCP tools capability.');this.version=init.protocolVersion;
   if(this.config.transport==='streamable-http'&&this.version==='2024-11-05')throw Error('Legacy HTTP+SSE is not supported. Use Streamable HTTP.');
   const notice={jsonrpc:'2.0',method:'notifications/initialized'};if(this.config.transport==='stdio')this.write(notice);else await this.post(notice,{signal:this.requestSignal(signal),expectResponse:false});
   this.ready=true;return await this.listTools({signal});
  }catch(error){this.close();throw error;}
 }
 async listTools({signal}={}){
  if(!this.ready)throw Error('Connect the plugin before discovering tools.');const rows=[],seen=new Set();let cursor;
  for(let page=0;page<20;page++){
   const result=await this.request('tools/list',cursor?{cursor}:{},{signal});if(!object(result)||!Array.isArray(result.tools))throw Error('Plugin returned an invalid tool list.');rows.push(...result.tools.map(tool=>({...tool,description:tool.description??''})));
   if(rows.length>128)throw Error('A plugin connection supports at most 128 tools.');
   if(!result.nextCursor)return normalizeTools(rows);
   if(typeof result.nextCursor!=='string'||result.nextCursor.length>4096||seen.has(result.nextCursor))throw Error('Plugin returned an invalid pagination cursor.');seen.add(result.nextCursor);cursor=result.nextCursor;
  }throw Error('Plugin tool discovery exceeded its page limit.');
 }
 async callTool(name,args,{signal}={}){if(!this.ready)throw Error('Connect the plugin first.');const result=await this.request('tools/call',{name,arguments:args},{signal});if(!object(result)||!Array.isArray(result.content)||result.content.length>128||result.isError!==undefined&&typeof result.isError!=='boolean')throw Error('Plugin returned an unsupported tool result.');return result;}
 close(){
  if(this.closed)return;this.closed=true;this.ready=false;this.controller.abort();for(const pending of [...this.pending.values()])pending.reject(this.failure||cancelled());this.pending.clear();
  if(this.config.transport==='streamable-http'&&this.sessionId&&!this.sessionExpired)this.cleanup=this.cleanupRequest('DELETE');
  if(this.child){
   const child=this.child,validPID=Number.isSafeInteger(child.pid)&&child.pid>0;
   const direct=()=>{try{child.stdin.end();}catch{}if(child.exitCode===null&&child.signalCode===null)try{child.kill();}catch{}};
   if(process.platform==='win32'&&validPID&&child.exitCode===null&&child.signalCode===null){
    // Terminate descendants while their launcher still exists. Never compose a
    // shell command from package arguments, and never target unrelated PIDs.
    try{const killer=spawn(path.join(process.env.SystemRoot||'C:\\Windows','System32','taskkill.exe'),['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore',shell:false});killer.once('error',direct);killer.once('exit',direct);}catch{direct();}
   }else{if(process.platform!=='win32'&&validPID)try{process.kill(-child.pid,'SIGTERM');}catch{}direct();}
   const timer=setTimeout(()=>{if(process.platform!=='win32'&&validPID)try{process.kill(-child.pid,'SIGKILL');}catch{}if(child.exitCode===null&&child.signalCode===null)try{child.kill('SIGKILL');}catch{}},1500);timer.unref?.();
  }
 }
}
