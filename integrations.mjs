import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

// Official contracts: https://docs.github.com/en/rest/issues/issues#list-repository-issues
// https://docs.github.com/en/rest/pulls/pulls#list-pull-requests
const clone=value=>structuredClone(value);
export function readPrivateJson(file,fallback){
 const st=fs.lstatSync(file,{throwIfNoEntry:false});if(!st)return clone(fallback);
 if(st.isSymbolicLink()||!st.isFile()||st.size>4*1024*1024)throw Error('Integration storage must be a regular private file under 4 MB.');
 try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{throw Error('Integration storage could not be read. Restore its private backup.');}
}
export function writePrivateJson(file,value){
 const st=fs.lstatSync(file,{throwIfNoEntry:false});if(st&&(st.isSymbolicLink()||!st.isFile()))throw Error('Integration storage must be a regular private file.');
 fs.mkdirSync(path.dirname(file),{recursive:true});const temporary=file+'.'+randomUUID()+'.tmp';
 try{fs.writeFileSync(temporary,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});fs.renameSync(temporary,file);}finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
}
export async function remoteJson(url,{fetchImpl=fetch,signal,timeoutMs=15000,maxBytes=4*1024*1024,label='Integration',...options}={}){
 try{
  const requestSignal=signal?AbortSignal.any([signal,AbortSignal.timeout(timeoutMs)]):AbortSignal.timeout(timeoutMs);requestSignal.throwIfAborted();
  const response=await fetchImpl(url,{...options,signal:requestSignal,redirect:'error'});
  if(!response.ok)throw Object.assign(Error(label+' request failed (HTTP '+response.status+'). Check access and try again.'),{safe:true});
  if(Number(response.headers?.get?.('content-length'))>maxBytes)throw Error('Too large');
  const chunks=[];let size=0;const reader=response.body?.getReader();
  if(!reader)throw Error('No response');
  try{while(true){requestSignal.throwIfAborted();const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes){await reader.cancel();throw Error('Too large');}chunks.push(Buffer.from(value));}}finally{reader.releaseLock();}
  requestSignal.throwIfAborted();return {data:JSON.parse(Buffer.concat(chunks).toString('utf8')),headers:response.headers};
 }catch(error){
  if(signal?.aborted)throw Object.assign(Error(label+' request was cancelled.'),{name:'AbortError'});
  if(error.safe)throw error;
  throw Error(label+' could not complete the request. Check access and try again.');
 }
}
function valueText(value,max,label){if(typeof value!=='string'||value.length>max||/[\u0000-\u001f\u007f]/.test(value))throw Error('Choose a valid '+label+'.');return value.trim();}
function repoName(value){const repo=valueText(value,140,'repository');if(!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/.test(repo)||['.','..'].includes(repo.split('/')[1]))throw Error('Use a GitHub repository in owner/repository form.');return repo;}
function tokenValue(value){const token=valueText(value,16000,'GitHub token');if(/\s/.test(token))throw Error('GitHub tokens cannot contain spaces.');return token;}
function definition(input){
 const id=input.id||randomUUID();if(typeof id!=='string'||! /^[A-Za-z0-9_-]{1,100}$/.test(id))throw Error('Choose a valid integration ID.');
 if(!Array.isArray(input.botIds)||input.botIds.length>100||input.botIds.some(id=>typeof id!=='string'||! /^[A-Za-z0-9_-]{1,100}$/.test(id)))throw Error('Choose the bots allowed to use this repository.');
 if(input.enabled!==undefined&&typeof input.enabled!=='boolean')throw Error('Choose whether the integration is enabled.');
 const repo=repoName(input.repo);return {id,type:'github',name:valueText(input.name||repo.slice(0,100),100,'integration name'),repo,botIds:[...new Set(input.botIds)],enabled:input.enabled!==false};
}
export class IntegrationStore{
 constructor({dataRoot,store,fetchImpl=fetch}={}){
  this.file=path.join(dataRoot,'integrations.json');this.store=store;this.fetchImpl=fetchImpl;this.sessionTokens=new Map();this.active=new Map();this.closed=false;
  const state=readPrivateJson(this.file,{version:1,integrations:[]});if(state.version!==1||!Array.isArray(state.integrations)||state.integrations.length>50)throw Error('Integration storage is invalid.');
  this.items=state.integrations.map(item=>({...definition(item),...(item.savedToken?{savedToken:tokenValue(item.savedToken)}:{})}));if(new Set(this.items.map(item=>item.id)).size!==this.items.length)throw Error('Integration storage has duplicate IDs.');
 }
 public(item){const {savedToken,...safe}=item;return {...clone(safe),hasToken:!!(this.sessionTokens.get(item.id)||savedToken),tokenStorage:this.sessionTokens.has(item.id)?'session':savedToken?'disk':'none',permissions:['Read repository issues','Read repository pull requests']};}
 list({botId}={}){return this.items.filter(item=>botId===undefined||item.enabled&&item.botIds.includes(botId)).map(item=>this.public(item));}
 persist(items){writePrivateJson(this.file,{version:1,integrations:items});}
 cancel(id){for(const controller of this.active.get(id)||[])controller.abort();this.active.delete(id);}
 save(input){
  if(this.closed)throw Error('Integrations are closed.');const old=this.items.find(item=>item.id===input.id),next=definition({...old,...input});next.botIds.forEach(id=>this.store.bot(id));
  if(!old&&this.items.length>=50)throw Error('Remove an integration before adding another (limit 50).');
  if(input.persistToken!==undefined&&typeof input.persistToken!=='boolean')throw Error('Choose whether to remember the token.');
  const changingRepo=old&&old.repo.toLowerCase()!==next.repo.toLowerCase();
  const token=input.token!==undefined?tokenValue(input.token):changingRepo?'':this.sessionTokens.get(next.id)||old?.savedToken||'';
  const persist=input.persistToken??!!old?.savedToken;if(persist&&token)next.savedToken=token;
  const items=this.items.filter(item=>item.id!==next.id).concat(next);this.persist(items);this.cancel(next.id);this.items=items;this.sessionTokens.delete(next.id);if(token&&!persist)this.sessionTokens.set(next.id,token);return this.public(next);
 }
 remove(id){if(!this.items.some(item=>item.id===id))throw Error('Integration not found.');const items=this.items.filter(item=>item.id!==id);this.persist(items);this.cancel(id);this.items=items;this.sessionTokens.delete(id);return {ok:true};}
 async read(bot,input,{signal}={}){
  if(this.closed)throw Error('Integrations are closed.');this.store.bot(bot.id);
  const item=this.items.find(item=>item.id===input.integrationId);if(!item||!item.enabled||!item.botIds.includes(bot.id))throw Error('This bot is not allowed to read that integration.');
  const action=input.action;if(!['issues','pulls','issue','pull'].includes(action))throw Error('Choose issues, pulls, issue, or pull. This integration is read-only.');
  const list=['issues','pulls'].includes(action),state=input.state??'open',page=input.page??1;
  if(!['open','closed','all'].includes(state)||!Number.isInteger(page)||page<1||page>20)throw Error('Choose a valid state and page (1–20).');
  if(!list&&(!Number.isSafeInteger(input.number)||input.number<1))throw Error('Choose a positive issue or pull request number.');
  const route=(action.startsWith('issue')?'issues':'pulls')+(list?'':'/'+input.number),url=new URL('https://api.github.com/repos/'+item.repo+'/'+route);
  if(list){url.searchParams.set('state',state);url.searchParams.set('per_page','50');url.searchParams.set('page',String(page));url.searchParams.set('sort','updated');url.searchParams.set('direction','desc');}
  const token=this.sessionTokens.get(item.id)||item.savedToken||'',controller=new AbortController();if(!this.active.has(item.id))this.active.set(item.id,new Set());this.active.get(item.id).add(controller);
  try{
   const {data,headers}=await remoteJson(url.href,{fetchImpl:this.fetchImpl,signal:signal?AbortSignal.any([signal,controller.signal]):controller.signal,label:'GitHub',method:'GET',headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10','User-Agent':'Crew',...(token?{Authorization:'Bearer '+token}:{})}});
   if(this.items.find(current=>current.id===item.id)!==item||this.closed)throw Error('This integration changed. Read it again using its current permissions.');
   if(list&&!Array.isArray(data)||!list&&(!data||typeof data!=='object'||Array.isArray(data)))throw Error('GitHub returned an invalid repository response.');
   const clean=(value,max)=>{let text=String(value??'');if(token)text=text.split(token).join('[redacted]');return text.slice(0,max);};
   const rows=(list?data:[data]).filter(row=>row&&Number.isSafeInteger(row.number)&&row.number>0).filter(row=>action!=='issues'||!row.pull_request);
   if(!list&&!rows.length)throw Error('GitHub returned no matching item.');
   const items=rows.slice(0,50).map(row=>({number:row.number,kind:row.pull_request||action.startsWith('pull')?'pull':'issue',title:clean(row.title,500),body:clean(row.body,list?2000:32000),bodyTruncated:String(row.body??'').length>(list?2000:32000),state:['open','closed'].includes(row.state)?row.state:'unknown',author:clean(row.user?.login,100),updatedAt:clean(row.updated_at,40),url:'https://github.com/'+item.repo+(row.pull_request||action.startsWith('pull')?'/pull/':'/issues/')+row.number}));
   return {repository:item.repo,readOnly:true,untrustedContent:true,items,...(list?{page,nextPage:page<20&&/rel="next"/.test(headers.get('link')||'')?page+1:null}:{})};
  }finally{const active=this.active.get(item.id);active?.delete(controller);if(!active?.size)this.active.delete(item.id);}
 }
 close(){this.closed=true;for(const id of this.active.keys())this.cancel(id);this.sessionTokens.clear();}
}
