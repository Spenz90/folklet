import fs from 'node:fs';
import path from 'node:path';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {reasoningOptions,sanitizeReasoningMetadata} from './reasoning.mjs';

export const providerCatalog=Object.freeze([
 {type:'openai',name:'OpenAI API',baseUrl:'https://api.openai.com/v1'},
 {type:'anthropic',name:'Anthropic API',baseUrl:'https://api.anthropic.com/v1'},
 {type:'gemini',name:'Google Gemini',baseUrl:'https://generativelanguage.googleapis.com/v1beta/openai'},
 {type:'openrouter',name:'OpenRouter',baseUrl:'https://openrouter.ai/api/v1'},
 {type:'ollama',name:'Ollama',baseUrl:'http://127.0.0.1:11434/v1'},
 {type:'custom',name:'OpenAI-compatible API',baseUrl:''}
]);
const builtIn=Object.freeze({id:'codex',name:'ChatGPT (Codex)',type:'codex',baseUrl:'',defaultModel:'',hasKey:false,keyStorage:'none',auth:'chatgpt'});
const types=new Map(providerCatalog.map(p=>[p.type,p]));
const loopback=url=>['localhost','127.0.0.1','[::1]'].includes(url.hostname);
export function providerBaseUrl(type,value){
 const definition=types.get(type);if(!definition)throw Error('Choose a supported provider.');
 let url;try{url=new URL(value||definition.baseUrl);}catch{throw Error('Enter a valid provider API base URL.');}
 if(url.username||url.password||url.search||url.hash||!['https:','http:'].includes(url.protocol)||(url.protocol==='http:'&&!loopback(url)))throw Error('Use HTTPS for remote APIs; HTTP is allowed only on this computer.');
 const result=url.href.replace(/\/+$/,'');
 if(!['ollama','custom'].includes(type)&&result!==definition.baseUrl)throw Error('Use a custom provider for a different API endpoint.');
 return result;
}
export function providerHeaders(connection){
 return {'Content-Type':'application/json',...(connection.type==='anthropic'?{'anthropic-version':'2023-06-01',...(connection.key?{'x-api-key':connection.key}:{})}:connection.key?{Authorization:'Bearer '+connection.key}:{})};
}
export async function providerJson(url,{fetchImpl=fetch,signal,timeoutMs=120000,...options}={}){
 try{
  const requestSignal=signal?AbortSignal.any([signal,AbortSignal.timeout(timeoutMs)]):AbortSignal.timeout(timeoutMs);
  const response=await fetchImpl(url,{...options,signal:requestSignal,redirect:'error'});
  if(!response.ok)throw Object.assign(Error(`Provider request failed (HTTP ${response.status}). Check the connection, model access, and account balance.`),{safe:true,status:response.status});
  if(Number(response.headers?.get?.('content-length'))>12*1024*1024)throw Object.assign(Error('Provider response exceeded the size limit.'),{safe:true});
  if(response.body?.getReader){
   const reader=response.body.getReader();let bytes=0;const parts=[];
   try{while(true){const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>12*1024*1024){await reader.cancel();throw Object.assign(Error('Provider response exceeded the size limit.'),{safe:true});}parts.push(Buffer.from(value));}}
   finally{reader.releaseLock();}
   return JSON.parse(Buffer.concat(parts).toString('utf8'));
  }
  return await response.json();
 }catch(error){
  if(signal?.aborted)throw Object.assign(Error('This task was stopped.'),{name:'AbortError'});
  if(error.safe)throw error;
  if(error.name==='TimeoutError'||['ETIMEDOUT','ECONNRESET','ECONNREFUSED','EAI_AGAIN','ENETUNREACH','EHOSTUNREACH','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT'].includes(error.code||error.cause?.code))throw Object.assign(Error('The provider connection failed. Check your connection and try again.'),{code:error.name==='TimeoutError'?'ETIMEDOUT':error.code||error.cause.code});
  throw Error('The provider could not complete the request. Check the connection and try again.');
 }
}
function text(value,max,label){if(typeof value!=='string'||value.length>max||/[\u0000-\u001f]/.test(value))throw Error(`Invalid ${label}.`);return value.trim();}
function readPrivate(file,fallback){if(!fs.existsSync(file))return fallback;if(fs.lstatSync(file).isSymbolicLink())throw Error('Provider configuration cannot be a symbolic link.');try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{throw Error('Provider configuration could not be read. Restore its private backup.');}}
function writePrivate(file,value){if(fs.lstatSync(file,{throwIfNoEntry:false})?.isSymbolicLink())throw Error('Provider configuration cannot be a symbolic link.');const temporary=file+'.'+randomUUID()+'.tmp';try{fs.writeFileSync(temporary,JSON.stringify(value,null,2)+'\n',{mode:0o600});fs.renameSync(temporary,file);fs.chmodSync(file,0o600);}finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}}
export class ProviderStore{
 constructor(dataRoot,{fetchImpl=fetch,now=Date.now}={}){
  this.root=dataRoot;this.fetchImpl=fetchImpl;this.now=now;this.sessionKeys=new Map();this.logins=new Map();this.modelCache=new Map();
  fs.mkdirSync(dataRoot,{recursive:true});this.configFile=path.join(dataRoot,'providers.json');this.keyFile=path.join(dataRoot,'provider-secrets.json');
  const config=readPrivate(this.configFile,{providers:[]});this.providers=Array.isArray(config.providers)?config.providers.map(p=>this.definition(p)):[];
  const secrets=readPrivate(this.keyFile,{keys:{}});this.savedKeys=new Map();
  for(const p of this.providers)if(typeof secrets.keys?.[p.id]==='string')this.savedKeys.set(p.id,secrets.keys[p.id]);
 }
 definition(input){
  const type=input.type;if(!types.has(type))throw Error('Choose a supported provider.');
  const id=input.id||randomUUID();if(typeof id!=='string'||! /^[a-zA-Z0-9_-]{1,100}$/.test(id)||id==='codex')throw Error('Invalid provider ID.');
  return {id,type,name:text(input.name||types.get(type).name,80,'provider name'),baseUrl:providerBaseUrl(type,input.baseUrl),defaultModel:text(input.defaultModel||'',200,'model name'),auth:input.auth==='oauth'&&type==='openrouter'?'oauth':type==='ollama'?'none':'key'};
 }
 public(provider){const key=this.sessionKeys.has(provider.id)||this.savedKeys.has(provider.id);return {...provider,hasKey:key,keyStorage:this.sessionKeys.has(provider.id)?'session':this.savedKeys.has(provider.id)?'disk':'none'};}
 list(){return [{...builtIn},...this.providers.map(p=>this.public(p))];}
 save(input){
  const old=this.providers.find(p=>p.id===input.id),definition=this.definition({...old,...input});
  const changedEndpoint=old&&(old.baseUrl!==definition.baseUrl||old.type!==definition.type);
  if(input.apiKey!==undefined){const key=text(input.apiKey,16000,'API key');if(key&&/\s/.test(key))throw Error('API keys cannot contain spaces.');this.sessionKeys.delete(definition.id);this.savedKeys.delete(definition.id);if(key)(input.persistKey===true?this.savedKeys:this.sessionKeys).set(definition.id,key);}
  else if(changedEndpoint){this.sessionKeys.delete(definition.id);this.savedKeys.delete(definition.id);}
  else if(input.persistKey===true&&this.sessionKeys.has(definition.id)){this.savedKeys.set(definition.id,this.sessionKeys.get(definition.id));this.sessionKeys.delete(definition.id);}
  else if(input.persistKey===false&&this.savedKeys.has(definition.id)){this.sessionKeys.set(definition.id,this.savedKeys.get(definition.id));this.savedKeys.delete(definition.id);}
  this.modelCache.delete(definition.id);this.providers=this.providers.filter(p=>p.id!==definition.id);this.providers.push(definition);this.persist();return this.public(definition);
 }
 persist(){
  writePrivate(this.configFile,{schemaVersion:1,providers:this.providers});
  if(this.savedKeys.size)writePrivate(this.keyFile,{schemaVersion:1,keys:Object.fromEntries(this.savedKeys)});
  else if(fs.existsSync(this.keyFile)){if(fs.lstatSync(this.keyFile).isSymbolicLink())throw Error('Provider configuration cannot be a symbolic link.');fs.unlinkSync(this.keyFile);}
 }
 remove(id){if(id==='codex')throw Error('The default ChatGPT connection cannot be removed here.');if(!this.providers.some(p=>p.id===id))throw Error('Provider not found.');this.providers=this.providers.filter(p=>p.id!==id);this.sessionKeys.delete(id);this.savedKeys.delete(id);this.modelCache.delete(id);this.persist();return {ok:true};}
 getConnection(id){const provider=this.providers.find(p=>p.id===id);if(!provider)throw Error('Choose a configured provider.');const key=this.sessionKeys.get(id)||this.savedKeys.get(id)||'';if(!key&&!['ollama','custom'].includes(provider.type))throw Error('Add an API key for this provider in Connections.');return {...provider,key};}
 async modelList(id,{signal}={}){
  const connection=this.getConnection(id),definition=this.providers.find(p=>p.id===id);const body=await providerJson(connection.baseUrl+'/models',{fetchImpl:this.fetchImpl,signal,timeoutMs:20000,headers:providerHeaders(connection)});
  if(!Array.isArray(body.data))throw Error('This provider did not return a model list. Enter a model ID manually.');
  const models=body.data.filter(model=>model&&typeof model.id==='string'&&model.id.length>0&&model.id.length<=200&&!/[\u0000-\u001f]/.test(model.id)).slice(0,2000).map(model=>{
   const name=(typeof model.name==='string'?model.name:typeof model.display_name==='string'?model.display_name:model.id).slice(0,200).replace(/[\u0000-\u001f]/g,'');
   const metadata=sanitizeReasoningMetadata(connection.type,model),options=reasoningOptions(connection.type,model.id,metadata).filter(option=>option.value);
   return {id:model.id,name,...metadata,...(options.length?{supportedReasoningEfforts:options.map(option=>({reasoningEffort:option.value,description:option.label}))}:{}),...(metadata.reasoning?.default_effort?{defaultReasoningEffort:metadata.reasoning.default_effort}:{})};
  });
  if(this.providers.find(p=>p.id===id)===definition)this.modelCache.set(id,{expiresAt:this.now()+300000,models:structuredClone(models)});
  return models;
 }
 async modelMetadata(id,model,{signal}={}){
  this.getConnection(id);if(signal?.aborted)throw Object.assign(Error('This task was stopped.'),{name:'AbortError'});
  const cached=this.modelCache.get(id),models=cached&&cached.expiresAt>this.now()?cached.models:await this.modelList(id,{signal});
  const selected=models.find(entry=>entry.id===model);return selected?structuredClone(selected):undefined;
 }
 beginOpenRouterLogin({callbackUrl,name='OpenRouter',persistKey=false}={}){
  let callback;try{callback=new URL(callbackUrl);}catch{throw Error('Invalid local sign-in callback.');}
  if(callback.protocol!=='http:'||!loopback(callback)||!callback.port||callback.username||callback.password||callback.hash||callback.search)throw Error('OpenRouter sign-in needs a loopback callback with an explicit local port.');
  const state=randomBytes(32).toString('base64url'),verifier=randomBytes(48).toString('base64url'),loginId=randomUUID(),expiresAt=this.now()+600000;
  for(const [key,login] of this.logins)if(login.expiresAt<=this.now())this.logins.delete(key);
  if(this.logins.size>=4)throw Error('Finish an existing sign-in before starting another.');
  callback.searchParams.set('state',state);
  const url=new URL('https://openrouter.ai/auth');url.searchParams.set('callback_url',callback.href);url.searchParams.set('code_challenge',createHash('sha256').update(verifier).digest('base64url'));url.searchParams.set('code_challenge_method','S256');
  this.logins.set(state,{loginId,verifier,expiresAt,name:text(name,80,'provider name'),persistKey:persistKey===true});return {loginId,authUrl:url.href,expiresAt};
 }
 async handleOAuthCallback({code,state,error}={}){
  const login=this.logins.get(state);if(!login)throw Error('This sign-in is invalid or has already been used.');this.logins.delete(state);
  if(login.expiresAt<=this.now())throw Error('This sign-in expired. Start again in Crew.');
  if(error)throw Error('OpenRouter sign-in was not completed.');
  if(typeof code!=='string'||!code||code.length>4096||/[\s\u0000-\u001f]/.test(code))throw Error('OpenRouter returned an invalid authorization code.');
  const result=await providerJson('https://openrouter.ai/api/v1/auth/keys',{fetchImpl:this.fetchImpl,timeoutMs:30000,method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code,code_verifier:login.verifier,code_challenge_method:'S256'})});
  if(typeof result.key!=='string'||!result.key)throw Error('OpenRouter did not return an API key.');
  return this.save({type:'openrouter',name:login.name,apiKey:result.key,persistKey:login.persistKey,auth:'oauth'});
 }
 close(){this.sessionKeys.clear();this.logins.clear();this.modelCache.clear();}
}
