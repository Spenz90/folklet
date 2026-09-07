import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {readPrivateJson,writePrivateJson,remoteJson} from './integrations.mjs';

// https://core.telegram.org/bots/api#getupdates and #sendmessage
const clone=value=>structuredClone(value),emptyQuiet=()=>({enabled:false,start:'22:00',end:'08:00',timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone});
function tokenValue(value){if(typeof value!=='string'||value.length>500||value&&!/^\d{5,20}:[A-Za-z0-9_-]{20,150}$/.test(value))throw Error('Enter the Telegram bot token from BotFather.');return value;}
function privateBase(value){if(value==='')return '';let url;try{url=new URL(value);}catch{throw Error('Use your private Crew HTTPS address.');}if(url.protocol!=='https:'||!url.hostname.endsWith('.ts.net')||!['','8443'].includes(url.port)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('Use the private Crew root HTTPS address ending in .ts.net, on port 443 or 8443.');return url.origin;}
function quietValue(value){
 if(!value||typeof value.enabled!=='boolean'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(value.start)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(value.end)||typeof value.timeZone!=='string'||value.timeZone.length>100)throw Error('Choose valid quiet hours and a time zone.');
 try{new Intl.DateTimeFormat('en',{timeZone:value.timeZone}).format();}catch{throw Error('Choose a valid IANA time zone.');}
 if(value.enabled&&value.start===value.end)throw Error('Quiet hours must have different start and end times.');return {enabled:value.enabled,start:value.start,end:value.end,timeZone:value.timeZone};
}
export function inQuietHours(quiet,now){if(!quiet.enabled)return false;const parts=new Intl.DateTimeFormat('en-GB',{timeZone:quiet.timeZone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(now));const time=parts.find(p=>p.type==='hour').value+':'+parts.find(p=>p.type==='minute').value;return quiet.start<quiet.end?time>=quiet.start&&time<quiet.end:time>=quiet.start||time<quiet.end;}
function recipient(value){if(!value||!/^\d{1,16}$/.test(value.id)||!Number.isSafeInteger(Number(value.id))||Number(value.id)<1||typeof value.name!=='string')throw Error('Stored Telegram recipient is invalid.');return {id:value.id,name:value.name.slice(0,150),username:typeof value.username==='string'?value.username.slice(0,40):''};}
export class TelegramNotifications{
 constructor({dataRoot,fetchImpl=fetch,now=Date.now}={}){
  this.file=path.join(dataRoot,'telegram-notifications.json');this.fetchImpl=fetchImpl;this.now=now;this.sessionToken='';this.pending=null;this.controller=new AbortController();this.closed=false;this.revision=0;this.queue=Promise.resolve();this.queued=0;this.seen=new Set();this.lastError='';this.lastDelivery=null;this.checkPromise=null;this.beginPromise=null;
  const saved=readPrivateJson(this.file,{version:1,enabled:false,quietHours:emptyQuiet(),baseUrl:'',recipient:null});if(saved.version!==1||typeof saved.enabled!=='boolean')throw Error('Telegram notification storage is invalid.');
  this.config={version:1,enabled:saved.enabled,quietHours:quietValue(saved.quietHours),baseUrl:privateBase(saved.baseUrl||''),recipient:saved.recipient?recipient(saved.recipient):null,...(saved.savedToken?{savedToken:tokenValue(saved.savedToken)}:{})};
 }
 token(){return this.sessionToken||this.config.savedToken||'';}
 status(){const {savedToken,...safe}=this.config;return {...clone(safe),enabled:!this.closed&&safe.enabled&&!!this.token()&&!!safe.recipient,hasToken:!!this.token(),tokenStorage:this.sessionToken?'session':savedToken?'disk':'none',error:this.lastError,lastDelivery:clone(this.lastDelivery),pairing:this.pending?{pairingId:this.pending.id,expiresAt:this.pending.expiresAt,preview:clone(this.pending.preview)}:null};}
 reset(){this.revision++;this.controller.abort();this.controller=new AbortController();this.pending=null;this.lastError='';}
 configure(input){
  if(this.closed)throw Error('Notifications are closed.');if(input.persistToken!==undefined&&typeof input.persistToken!=='boolean')throw Error('Choose whether to remember the token.');
  const token=input.token!==undefined?tokenValue(input.token):this.token(),changed=input.token!==undefined&&token!==this.token();
  const persist=input.persistToken??!!this.config.savedToken,next={...this.config,quietHours:input.quietHours===undefined?this.config.quietHours:quietValue(input.quietHours),baseUrl:input.baseUrl===undefined?this.config.baseUrl:privateBase(input.baseUrl)};
  if(changed){next.enabled=false;next.recipient=null;}delete next.savedToken;if(persist&&token)next.savedToken=token;
  writePrivateJson(this.file,next);this.reset();this.config=next;this.sessionToken=persist?'':token;return this.status();
 }
 async request(method,body={},signal=this.controller.signal){
  if(this.closed||!this.token())throw Error('Add a Telegram bot token on the host computer first.');
  if(!['getMe','getUpdates','sendMessage'].includes(method))throw Error('Unsupported Telegram method.');
  const {data}=await remoteJson('https://api.telegram.org/bot'+this.token()+'/'+method,{fetchImpl:this.fetchImpl,signal,label:'Telegram',maxBytes:2*1024*1024,method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(data?.ok!==true)throw Error('Telegram could not complete the request. Check the bot token, private chat, and access.');return data.result;
 }
 async beginPairing(){
  if(this.beginPromise)return this.beginPromise;
  const revision=this.revision;const work=(async()=>{const me=await this.request('getMe');if(this.closed||this.revision!==revision)throw Error('Telegram settings changed. Start pairing again.');if(me?.is_bot!==true||typeof me.username!=='string'||!/^[A-Za-z0-9_]{5,32}$/.test(me.username))throw Error('Telegram returned an invalid bot identity.');
   const code='crew_'+randomBytes(12).toString('hex');this.pending={id:randomUUID(),code,createdAt:this.now(),expiresAt:this.now()+300000,offset:0,preview:null};
   return {pairingId:this.pending.id,code,message:'/start '+code,url:'https://t.me/'+me.username+'?start='+code,expiresAt:this.pending.expiresAt};})();this.beginPromise=work;try{return await work;}finally{if(this.beginPromise===work)this.beginPromise=null;}
 }
 async checkPairing(){
  if(this.checkPromise)return this.checkPromise;const pending=this.pending;if(!pending||pending.expiresAt<=this.now())throw Error('Pairing expired. Create a new code.');if(pending.preview)return this.status().pairing;
  const revision=this.revision,work=(async()=>{
   const updates=await this.request('getUpdates',{offset:pending.offset,limit:100,timeout:0,allowed_updates:['message']});if(this.closed||this.pending!==pending||this.revision!==revision||pending.expiresAt<=this.now())throw Error('Pairing expired or changed. Start again.');if(!Array.isArray(updates))throw Error('Telegram returned an invalid pairing response.');
   for(const update of updates){
    if(Number.isSafeInteger(update?.update_id)&&update.update_id>=0)pending.offset=Math.max(pending.offset,update.update_id+1);
    const message=update?.message,chat=message?.chat,from=message?.from;
    if(chat?.type!=='private'||!Number.isSafeInteger(chat.id)||chat.id<1||from?.id!==chat.id||from?.is_bot!==false||message.forward_origin||message.via_bot||message.business_connection_id||!Number.isFinite(message.date)||message.date*1000<pending.createdAt-5000||message.date*1000>this.now()+30000)continue;
    if(![pending.code,'/start '+pending.code].includes(message.text))continue;
    pending.preview=recipient({id:String(chat.id),name:[from.first_name,from.last_name].filter(v=>typeof v==='string').join(' ')||'Telegram user',username:from.username});break;
   }
   return this.status().pairing;
  })();this.checkPromise=work;try{return await work;}finally{if(this.checkPromise===work)this.checkPromise=null;}
 }
 activate({pairingId,recipientId}={}){
  const pending=this.pending;if(this.closed||!pending||pending.expiresAt<=this.now()||pending.id!==pairingId||!pending.preview||pending.preview.id!==recipientId||!this.token())throw Error('Review a fresh paired recipient before activating notifications.');
  const next={...this.config,enabled:true,recipient:clone(pending.preview)};writePrivateJson(this.file,next);this.reset();this.config=next;return this.status();
 }
 revoke(){const next={...this.config,enabled:false,recipient:null};writePrivateJson(this.file,next);this.reset();this.config=next;return this.status();}
 notify(event){
  if(this.closed||!this.status().enabled)return Promise.resolve({delivered:false,reason:'disabled'});
  if(!event||typeof event.id!=='string'||!event.id||event.id.length>200||!['completed','failed','approval'].includes(event.kind))return Promise.resolve({delivered:false,reason:'unsupported'});
  if(this.seen.has(event.id))return Promise.resolve({delivered:false,reason:'duplicate'});this.seen.add(event.id);while(this.seen.size>500)this.seen.delete(this.seen.values().next().value);
  if(inQuietHours(this.config.quietHours,this.now())){this.lastDelivery={at:this.now(),status:'quiet-hours'};return Promise.resolve({delivered:false,reason:'quiet-hours'});}
  if(this.queued>=30)return Promise.resolve({delivered:false,reason:'queue-full'});const revision=this.revision,input={id:event.id,kind:event.kind,botId:event.botId,taskId:event.taskId};this.queued++;
  const work=this.queue.then(async()=>{
   if(this.closed||this.revision!==revision||!this.status().enabled)return {delivered:false,reason:'changed'};
   if(inQuietHours(this.config.quietHours,this.now()))return {delivered:false,reason:'quiet-hours'};
   let text={completed:'Crew: a task is complete.',failed:'Crew: a task needs attention.',approval:'Crew: your approval or answer is needed. Open Crew to review it.'}[input.kind];
   if(this.config.baseUrl){const url=new URL(this.config.baseUrl);for(const [key,value]of [['bot',input.botId],['task',input.taskId]])if(typeof value==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(value))url.searchParams.set(key,value);text+='\n'+url.href;}
   try{await this.request('sendMessage',{chat_id:this.config.recipient.id,text,link_preview_options:{is_disabled:true},protect_content:true});if(this.revision===revision){this.lastError='';this.lastDelivery={at:this.now(),status:'sent'};}return {delivered:true};}
   catch(error){if(this.revision===revision&&!this.closed){this.lastError=error.message;this.lastDelivery={at:this.now(),status:'failed'};}return {delivered:false,reason:error.name==='AbortError'?'cancelled':'request-failed'};}
  });this.queue=work.catch(()=>{}).finally(()=>{this.queued--;});return work;
 }
 close(){this.closed=true;this.reset();this.sessionToken='';delete this.config.savedToken;return this.queue;}
}
