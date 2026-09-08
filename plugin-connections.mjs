import {isSealed,protectSecret,revealSecret,secretStorage} from './credential-vault.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {loadReviewData,saveReviewData} from './review-data.mjs';
import {managedBrowserHeader} from './http.mjs';
import {MCPClient,MCP_MAX_BYTES,safePluginURL,normalizeTools,redactPlugin,readBoundedBody,cancelled} from './mcp-client.mjs';

const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const clone=value=>structuredClone(value),MAX_STORE=8*1024*1024;
const packageRunners=new Set(['npx','npm','pnpm','yarn','bun','bunx','uv','uvx','pip','pip3','easy_install']);
const executableName=value=>value.replace(/\\/g,'/').split('/').at(-1).replace(/\.(exe|cmd|bat)$/i,'').toLowerCase();
function text(value,max,label,{empty=false}={}){if(typeof value!=='string'||value.length>max||/[\x00-\x1f\x7f]/.test(value)||!empty&&!value.trim())throw Error('Enter a valid '+label+'.');return value.trim();}
function idValue(value){const id=text(value,100,'connection ID');if(!/^[A-Za-z0-9_-]+$/.test(id))throw Error('Enter a valid connection ID.');return id;}
function names(value,max,label){if(!Array.isArray(value)||value.length>max||value.some(name=>typeof name!=='string'||! /^[A-Za-z0-9_.:-]{1,128}$/.test(name)))throw Error('Choose valid '+label+'.');return [...new Set(value)];}
function record(value,label){if(!object(value)||Object.keys(value).length>64)throw Error('Enter a valid '+label+' object.');const out={};for(const [name,valueText] of Object.entries(value)){if(! /^[A-Za-z_][A-Za-z0-9_-]{0,127}$/.test(name)||typeof valueText!=='string'||valueText.length>16000||/[\x00\r\n]/.test(valueText)||['__proto__','constructor','prototype'].includes(name))throw Error('Enter valid '+label+' names and values.');out[name]=valueText;}return out;}
function secretsFor(input){const result={token:text(input.token??'',16000,'plugin token',{empty:true}),headers:record(input.headers??{},'headers'),env:record(input.env??{},'environment')};
 for(const name of Object.keys(result.headers))if(/^(?:sec-|x-crew-|host$|cookie$|connection$|content-length$|content-type$|accept$|mcp-|proxy-|forwarded$|x-forwarded-|x-real-ip$)/i.test(name))throw Error('That header is reserved and cannot be supplied to a plugin.');
 return result;
}
function secretValues(secret){return [secret?.token,...Object.values(secret?.headers||{}),...Object.values(secret?.env||{})].filter(Boolean);}
function noSecrets(secret){return !secret.token&&!Object.keys(secret.headers).length&&!Object.keys(secret.env).length;}
function cleanJSON(value,secrets){if(typeof value==='string')return redactPlugin(value,secrets);if(Array.isArray(value))return value.map(item=>cleanJSON(item,secrets));if(object(value))return Object.fromEntries(Object.entries(value).map(([key,item])=>[redactPlugin(key,secrets),cleanJSON(item,secrets)]));return value;}
export function pluginEnvironment(env={}){
 // Only runtime necessities are inherited. API/account tokens, NODE_OPTIONS,
 // CODEX_HOME and arbitrary parent application secrets are never inherited.
 const result={};for(const key of ['PATH','Path','SystemRoot','WINDIR','SystemDrive','COMSPEC','PATHEXT','TEMP','TMP','TMPDIR','LANG','LC_ALL'])if(process.env[key]!==undefined)result[key]=process.env[key];
 return {...result,...env};
}
const warning=item=>item.type==='openclaw'?'OpenClaw gateway credentials grant operator access to that gateway. FOLKLET asks before every tool call; the gateway applies its own tool policy. Native plugins execute in OpenClaw, not inside FOLKLET.':item.transport==='stdio'?'This starts trusted local code with your computer account’s access. It is not a sandbox. '+(item.allowPackageInstall?'You allowed this command to download and run packages. ':'Recognized package-runner commands require a separate opt-in. ')+'Trusted code can still use the network. FOLKLET asks before every tool call.':'This sends approved tool arguments to the configured MCP service. FOLKLET asks before every tool call. This connection does not authorize server-initiated actions.';
const access=item=>item.type==='openclaw'?'OpenClaw gateway operator access':item.transport==='stdio'?'Trusted local executable; computer account access':'Remote MCP service';
function definition(input){
 const id=idValue(input.id||randomUUID()),type=input.type??'mcp';if(!['mcp','openclaw'].includes(type))throw Error('Choose MCP or OpenClaw.');
 const transport=type==='openclaw'?'streamable-http':input.transport;if(!['stdio','streamable-http'].includes(transport))throw Error('Choose stdio or Streamable HTTP.');
 const result={id,name:text(input.name,100,'connection name'),type,transport,botIds:names(input.botIds??[],100,'bots'),allowedTools:names(input.allowedTools??[],128,'tools'),tools:normalizeTools(input.tools??[]),enabled:false};
 if(input.sourcePackageId)result.sourcePackageId=idValue(input.sourcePackageId);
 for(const key of ['packageRoot','packageData'])if(input[key]!==undefined){if(!result.sourcePackageId)throw Error('Package paths require a source package.');result[key]=text(input[key],4096,'package directory');if(!path.isAbsolute(result[key]))throw Error('Package directories must be absolute paths.');}
 if(transport==='stdio'){
  result.command=text(input.command,4096,'executable');if(!path.isAbsolute(result.command)&&(/[\/\\\s]/.test(result.command)||result.command.startsWith('.')))throw Error('Use one executable name or an absolute executable path, with arguments listed separately.');
  const executable=executableName(result.command);
  if(['sh','bash','zsh','dash','fish','cmd','powershell','pwsh','wscript','cscript'].includes(executable)||/\.bat$/i.test(result.command)||/\.cmd$/i.test(result.command)&&!['npx','npm'].includes(executable))throw Error('Choose the real server executable. General shell wrappers are not launched by plugin connections.');
  if(input.allowPackageInstall!==undefined&&typeof input.allowPackageInstall!=='boolean')throw Error('Choose whether this command may download and run packages.');result.allowPackageInstall=input.allowPackageInstall===true;
  if(!Array.isArray(input.args??[])||(input.args??[]).length>128||(input.args??[]).some(arg=>typeof arg!=='string'||arg.length>16000||arg.includes('\0'))||Buffer.byteLength(JSON.stringify(input.args??[]))>128000)throw Error('Enter an argument array under 128 KB.');result.args=clone(input.args??[]);
  if(input.cwd){result.cwd=text(input.cwd,4096,'working directory');if(!path.isAbsolute(result.cwd))throw Error('The plugin working directory must be an absolute path.');}
 }else{
  const url=new URL(safePluginURL(text(input.url,4096,'plugin endpoint')));if(type==='openclaw'){if(url.pathname==='/'||url.pathname==='')url.pathname='/tools/invoke';else if(!url.pathname.endsWith('/tools/invoke'))throw Error('Use the OpenClaw gateway URL or its /tools/invoke endpoint.');result.sessionKey=text(input.sessionKey??'',500,'OpenClaw session',{empty:true});}result.url=url.href;
 }
 return result;
}
export function pluginLaunch(item,{platform=process.platform,exists=file=>fs.statSync(file,{throwIfNoEntry:false})?.isFile()===true,env=process.env,nodePath=process.execPath}={}){
 const name=executableName(item.command);if(packageRunners.has(name)&&item.allowPackageInstall!==true)throw Error('This command may download and run packages. Enable that separate permission, then confirm Connect.');
 if(platform==='win32'&&['npx','npm'].includes(name)){
  const roots=path.isAbsolute(item.command)?[path.dirname(item.command)]:[path.dirname(nodePath),...(env.PATH||env.Path||'').split(path.delimiter).filter(Boolean)];
  for(const root of roots){const script=path.join(root,'node_modules','npm','bin',name+'-cli.js');if(exists(script))return {command:nodePath,args:[script,...item.args]};}
  throw Error('This Windows installation has no npm CLI script available. Install Node.js with npm, or install the MCP server separately and choose its executable. FOLKLET will not run a command shell.');
 }
 return {command:item.command,args:item.args};
}
function argumentsValue(value){if(!object(value))throw Error('Plugin arguments must be a JSON object.');let raw;try{raw=JSON.stringify(value);}catch{throw Error('Plugin arguments must be JSON.');}if(Buffer.byteLength(raw)>128000)throw Error('Plugin arguments exceed 128 KB.');return JSON.parse(raw);}
async function abortable(work,signal){
 signal.throwIfAborted();let listener;
 try{return await Promise.race([work,new Promise((_,reject)=>{listener=()=>reject(cancelled());signal.addEventListener('abort',listener,{once:true});if(signal.aborted)listener();})]);}
 finally{signal.removeEventListener('abort',listener);}
}
async function awaitApproval(approve,request,signal){if(typeof approve!=='function')throw Error('A user approval is required for every plugin tool call.');return abortable(Promise.resolve().then(()=>{signal.throwIfAborted();return approve(request,signal);}),signal);}
export class PluginConnections{
 constructor({dataRoot,store,fetchImpl=fetch,spawnProcess=spawn,vault}={}){
  const stat=fs.lstatSync(dataRoot,{throwIfNoEntry:false});if(stat?.isSymbolicLink()||stat&&!stat.isDirectory())throw Error('Plugin data must use a private regular directory.');fs.mkdirSync(dataRoot,{recursive:true});
  this.vault=vault;this.file=path.join(dataRoot,'plugin-connections.json');this.store=store;this.fetchImpl=fetchImpl;this.spawnProcess=spawnProcess;this.sessionSecrets=new Map();this.runtimes=new Map();this.active=new Map();this.controlOrigins=new Set();this.closed=false;
  const data=loadReviewData(this.file,{version:1,connections:[]},MAX_STORE);if(data.version!==1||!Array.isArray(data.connections)||data.connections.length>32)throw Error('Plugin connection storage is invalid.');
  this.items=data.connections.map(item=>({...definition(item),...(item.savedSecrets?{savedSecrets:isSealed(item.savedSecrets)?item.savedSecrets:secretsFor(item.savedSecrets)}:{})}));if(new Set(this.items.map(item=>item.id)).size!==this.items.length)throw Error('Plugin connection storage contains duplicate IDs.');
 }
 protectControlOrigin(value){const url=new URL(value);this.controlOrigins.add(url.origin);if(['127.0.0.1','localhost','[::1]'].includes(url.hostname))for(const host of ['127.0.0.1','localhost','[::1]'])this.controlOrigins.add(`${url.protocol}//${host}${url.port?':'+url.port:''}`);for(const item of this.items)if(item.url&&this.controlOrigins.has(new URL(item.url).origin))this.cancel(item.id);}
 assertURL(value){const url=safePluginURL(value);if(this.controlOrigins.has(new URL(url).origin))throw Error('Plugin connections cannot access FOLKLET owner or phone control endpoints.');return url;}
 secret(item){return this.sessionSecrets.get(item.id)||revealSecret(this.vault,item.savedSecrets,'plugin:'+item.id)||{token:'',headers:{},env:{}};}
 public(item){const {savedSecrets,...rest}=item,secret=this.secret(item),runtime=this.runtimes.get(item.id);return cleanJSON({...clone(rest),connected:!!runtime&&!runtime.client?.closed,enabled:item.enabled===true&&!!runtime&&!runtime.client?.closed,hasSecrets:!!savedSecrets||!noSecrets(secret),secretStorage:this.sessionSecrets.has(item.id)?'session':secretStorage(this.vault,savedSecrets),envKeys:Object.keys(secret.env),headerNames:Object.keys(secret.headers),warning:warning(item),access:access(item)},secretValues(secret));}
 list({botId}={}){if(botId!==undefined)this.store.bot(botId);return this.items.filter(item=>botId===undefined||item.enabled&&this.runtimes.has(item.id)&&!this.runtimes.get(item.id).client?.closed&&item.botIds.includes(botId)&&item.allowedTools.length).map(item=>{const value=this.public(item);if(botId!==undefined)return {id:value.id,name:value.name,type:value.type,tools:value.tools.filter(tool=>item.allowedTools.includes(tool.name)),access:value.access,warning:value.warning};return value;});}
 persist(items){const sealed=items.map(item=>({...item,...(item.savedSecrets?{savedSecrets:this.vault?.key?protectSecret(this.vault,item.savedSecrets,'plugin:'+item.id):item.savedSecrets}:{})}));saveReviewData(this.file,{version:1,connections:sealed},MAX_STORE);for(let i=0;i<items.length;i++)Object.assign(items[i],sealed[i]);}
 validate(input){const item=definition(input);item.botIds.forEach(id=>this.store.bot(id));if(item.url)this.assertURL(item.url);secretsFor(input);return clone(item);}
 cancel(id){this.runtimes.get(id)?.client?.close();this.runtimes.delete(id);for(const controller of this.active.get(id)||[])controller.abort();this.active.delete(id);}
 save(input){
  if(this.closed)throw Error('Plugin connections are closed.');if(!object(input))throw Error('Enter a plugin connection.');const old=this.items.find(item=>item.id===input.id);if(isSealed(old?.savedSecrets)&&!this.vault?.key)throw Error('Unlock Credential protection before editing this connection.');
  if(input.id&&!old)idValue(input.id);if(!old&&this.items.length>=32)throw Error('Remove a connection before adding another (limit 32).');
  const next=definition({...old,...input,...(old?{tools:old.type==='mcp'&&input.type!=='openclaw'?old.tools:input.tools??old.tools,sourcePackageId:old.sourcePackageId,packageRoot:old.packageRoot,packageData:old.packageData}: {})});next.botIds.forEach(id=>this.store.bot(id));if(next.url)this.assertURL(next.url);
  if(input.persistSecrets!==undefined&&typeof input.persistSecrets!=='boolean')throw Error('Choose whether to remember plugin credentials.');
  const sameTarget=old&&['type','transport','url','command','cwd','sessionKey'].every(key=>old[key]===next[key])&&JSON.stringify(old.args)===JSON.stringify(next.args);
  if(!sameTarget&&input.allowPackageInstall===undefined&&next.transport==='stdio')next.allowPackageInstall=false;
  const previous=sameTarget?this.secret(old):{token:'',headers:{},env:{}},secret=secretsFor({token:input.token??previous.token,headers:input.headers??previous.headers,env:input.env??previous.env});
  const persist=input.persistSecrets??(sameTarget&&!!old?.savedSecrets);if(persist&&!noSecrets(secret))next.savedSecrets=protectSecret(this.vault,secret,'plugin:'+next.id);
  if(next.type==='openclaw'&&next.allowedTools.some(name=>!next.tools.some(tool=>tool.name===name)))throw Error('Select only tools declared for this OpenClaw connection.');
  const items=this.items.filter(item=>item.id!==next.id).concat(next);this.persist(items);this.cancel(next.id);this.items=items;this.sessionSecrets.delete(next.id);if(!persist&&!noSecrets(secret))this.sessionSecrets.set(next.id,secret);return this.public(next);
 }
 async connect({id,confirmed}={}){
  if(this.closed)throw Error('Plugin connections are closed.');if(confirmed!==true)throw Error('Review and confirm the plugin executable or endpoint before connecting.');const item=this.items.find(item=>item.id===id);if(!item)throw Error('Plugin connection not found.');
  if(isSealed(item.savedSecrets)&&!this.vault?.key)throw Error('Unlock Credential protection before connecting this plugin.');
  this.cancel(id);const controller=this.track(id),secret=this.secret(item);let client;
  try{
   let tools=item.tools;if(item.type==='mcp'){
    client=new MCPClient({...item,...(item.transport==='stdio'?pluginLaunch(item):{}),env:{...pluginEnvironment(secret.env),...(item.packageRoot?{PLUGIN_ROOT:item.packageRoot}:{}),...(item.packageData?{PLUGIN_DATA:item.packageData}:{})},headers:{...secret.headers,...(secret.token?{Authorization:'Bearer '+secret.token}:{})},fetchImpl:this.fetchImpl,spawnProcess:this.spawnProcess,assertURL:url=>this.assertURL(url)});
    tools=await client.connect({signal:controller.signal});
   }else{this.assertURL(item.url);if(!item.tools.length)throw Error('Declare the OpenClaw tools you want to use before connecting.');}
   this.current(item,controller.signal);const next={...item,tools,enabled:true,allowedTools:item.allowedTools.filter(name=>tools.some(tool=>tool.name===name))};const items=this.items.map(value=>value===item?next:value);this.persist(items);this.items=items;this.runtimes.set(id,{client,queue:Promise.resolve()});return this.public(next);
  }catch(error){client?.close();throw this.safeError(error,item,controller.signal);}
  finally{this.untrack(id,controller);}
 }
 track(id){const controller=new AbortController();if(!this.active.has(id))this.active.set(id,new Set());this.active.get(id).add(controller);return controller;}
 untrack(id,controller){const active=this.active.get(id);active?.delete(controller);if(!active?.size)this.active.delete(id);}
 current(item,signal,botId,tool){signal?.throwIfAborted();if(this.closed||this.items.find(current=>current.id===item.id)!==item)throw Error('Plugin settings changed. Review the current connection and try again.');if(item.url)this.assertURL(item.url);if(botId!==undefined){this.store.bot(botId);if(!item.enabled||!item.botIds.includes(botId)||!item.allowedTools.includes(tool)||!this.runtimes.has(item.id)||this.runtimes.get(item.id).client?.closed)throw Error('This bot is not allowed to use that plugin tool.');}}
 safeError(error,item,signal){if(signal?.aborted||error?.name==='AbortError')return cancelled();return Error(redactPlugin(error?.message||'Plugin request failed.',secretValues(this.secret(item))).slice(0,1000));}
 async run(bot,{connectionId,tool,arguments:inputArguments}={}, {signal,approve}={}){
  const item=this.items.find(item=>item.id===connectionId);if(!item)throw Error('Plugin connection not found.');this.current(item,signal,bot?.id,tool);if(!bot?.id)throw Error('Choose a valid bot.');
  const toolDefinition=item.tools.find(value=>value.name===tool);if(!toolDefinition)throw Error('That plugin tool is not available.');const args=argumentsValue(inputArguments??{}),schema=JSON.stringify(toolDefinition),controller=this.track(item.id),requestSignal=signal?AbortSignal.any([signal,controller.signal]):controller.signal,runtime=this.runtimes.get(item.id);
  try{
   if(await awaitApproval(approve,{connectionName:item.name,tool,arguments:clone(args),access:access(item),warning:warning(item)},requestSignal)!==true)throw Error('The user declined this plugin tool call.');
   this.current(item,requestSignal,bot.id,tool);
   const execute=async()=>{
    this.current(item,requestSignal,bot.id,tool);if(this.runtimes.get(item.id)!==runtime)throw Error('Plugin connection changed. Review and retry.');const secret=this.secret(item);let result;
    if(item.type==='mcp'){
     // Discovery is read-only. Bind every approval to the exact selected schema;
     // never dispatch a silently replaced tool after approval or a list change.
     const revision=runtime.client.revision,tools=await runtime.client.listTools({signal:requestSignal});this.current(item,requestSignal,bot.id,tool);
     if(JSON.stringify(tools.find(value=>value.name===tool))!==schema){this.cancel(item.id);throw Error('Plugin tool details changed. Reconnect and review its tools before using it again.');}
     this.current(item,requestSignal,bot.id,tool);if(revision!==runtime.client.revision)throw Error('Plugin tools changed. Reconnect and review them.');
     result=await runtime.client.callTool(tool,args,{signal:requestSignal});
    }else{
     // https://docs.openclaw.ai/gateway/tools-invoke-http-api
     const response=await this.fetchImpl(this.assertURL(item.url),{method:'POST',headers:{...secret.headers,...(secret.token?{Authorization:'Bearer '+secret.token}:{}),'Content-Type':'application/json',[managedBrowserHeader]:'1'},body:JSON.stringify({tool,args,sessionKey:item.sessionKey||'agent:main:folklet-'+bot.id,idempotencyKey:randomUUID()}),redirect:'error',signal:AbortSignal.any([requestSignal,AbortSignal.timeout(60000)])});
     if(!response.ok){await response.body?.cancel().catch(()=>{});throw Error('OpenClaw tool request failed (HTTP '+response.status+'). Its gateway may deny this tool or require different access.');}
     const body=JSON.parse(await readBoundedBody(response,{signal:requestSignal}));if(!object(body)||body.ok!==true||!Object.hasOwn(body,'result'))throw Error('OpenClaw did not return a successful tool result.');result=body.result;
    }
    this.current(item,requestSignal,bot.id,tool);const safe=cleanJSON(result,[...secretValues(secret),runtime.client?.sessionId]);if(Buffer.byteLength(JSON.stringify(safe))>MCP_MAX_BYTES)throw Error('Plugin result exceeds its size limit.');return {connectionId:item.id,tool,untrustedContent:true,result:safe};
   };
   const work=runtime.queue.then(execute);runtime.queue=work.catch(()=>{});return await abortable(work,requestSignal);
  }catch(error){throw this.safeError(error,item,requestSignal);}
  finally{this.untrack(item.id,controller);}
 }
 remove(id){const item=this.items.find(item=>item.id===id);if(!item)throw Error('Plugin connection not found.');const items=this.items.filter(value=>value!==item);this.persist(items);this.cancel(id);this.items=items;this.sessionSecrets.delete(id);return {ok:true};}
 close(){if(this.closed)return;this.closed=true;for(const id of new Set([...this.active.keys(),...this.runtimes.keys()]))this.cancel(id);this.sessionSecrets.clear();}
}
