import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {normalizeRoutinePolicy,missedRunDecision,recordRoutineOutcome,routineSummary} from './routine-policy.mjs';
import {normalizeFallback} from './fallback.mjs';
export const uid=()=>randomUUID();

// Restore the last committed state without replacing bot/task objects held by
// an active engine connection. A failed save must not leave a ghost task or a
// changed permission that a later successful write could accidentally commit.
function restoreValue(current,saved){
 if(Array.isArray(saved)){
  const array=Array.isArray(current)?current:[],byId=new Map(array.filter(item=>item&&typeof item==='object'&&item.id).map(item=>[item.id,item]));
  const values=saved.map((item,index)=>restoreValue(item?.id?byId.get(item.id):array[index],item));array.length=values.length;for(let index=0;index<values.length;index++)array[index]=values[index];return array;
 }
 if(saved&&typeof saved==='object'){const object=current&&typeof current==='object'&&!Array.isArray(current)?current:{};for(const key of Object.keys(object))if(!Object.hasOwn(saved,key))delete object[key];for(const [key,value] of Object.entries(saved))Object.defineProperty(object,key,{value:restoreValue(Object.hasOwn(object,key)?object[key]:undefined,value),enumerable:true,writable:true,configurable:true});return object;}
 return saved;
}

const scheduleKinds=new Set(['interval','daily','weekdays','weekly']);
function scheduleValues(input){
 const scheduleKind=input.scheduleKind??'interval';
 if(!scheduleKinds.has(scheduleKind))throw Error('Choose an interval, daily, weekdays, or weekly schedule.');
 if(scheduleKind==='interval'){
  const minutes=Number(input.minutes);
  if(!Number.isFinite(minutes)||minutes<5||minutes>525600)throw Error('Choose an interval of at least 5 minutes and no more than one year.');
  return {scheduleKind,minutes,time:null,weekday:null};
 }
 if(typeof input.time!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time))throw Error('Choose a time in HH:MM format.');
 let weekday=null;
 if(scheduleKind==='weekly'){
  weekday=Number(input.weekday);
  if(input.weekday==null||input.weekday===''||!Number.isInteger(weekday)||weekday<0||weekday>6)throw Error('Choose a day of the week.');
 }
 return {scheduleKind,minutes:null,time:input.time,weekday};
}

// Calendar routines follow the host computer's local clock. Construct each day
// separately so daylight-saving changes do not shift future wall-clock times.
// Missing spring-forward times use Date's next valid time; repeated fall-back
// times run once, at their first occurrence.
export function nextOccurrence(r,now=Date.now()){
 const schedule=scheduleValues(r),timestamp=Number(now);
 if(!Number.isFinite(timestamp)||!Number.isFinite(new Date(timestamp).getTime()))throw Error('Invalid schedule reference time.');
 if(schedule.scheduleKind==='interval')return timestamp+schedule.minutes*60000;
 const from=new Date(timestamp),[hour,minute]=schedule.time.split(':').map(Number);
 for(let offset=0;offset<=7;offset++){
  const candidate=new Date(from.getFullYear(),from.getMonth(),from.getDate()+offset,hour,minute,0,0);
  const day=candidate.getDay();
  if(schedule.scheduleKind==='weekdays'&&(day===0||day===6))continue;
  if(schedule.scheduleKind==='weekly'&&day!==schedule.weekday)continue;
  if(candidate.getTime()>timestamp)return candidate.getTime();
 }
 throw Error('Unable to calculate the next schedule occurrence.');
}
export class Store {
 constructor(root){root=path.resolve(root);this.root=root;fs.mkdirSync(root,{recursive:true});this.file=path.join(root,'crew.json');
  const databaseStat=fs.lstatSync(this.file,{throwIfNoEntry:false});if(databaseStat&&(databaseStat.isSymbolicLink()||!databaseStat.isFile()||databaseStat.nlink>1))throw Error('Crew storage must be a regular private file, not a link.');
  if(fs.existsSync(this.file))this.db=JSON.parse(fs.readFileSync(this.file,'utf8'));
  else {const old=path.join(root,'bots.json');this.db={bots:fs.existsSync(old)?JSON.parse(fs.readFileSync(old,'utf8')):[],tasks:[],routines:[],channels:[],notifications:[]};}
  for(const b of this.db.bots){
   // Portable data copies keep managed workspaces beside crew.json. Never
   // recreate their saved location on the previous PC or installation path.
   const parts=String(b.cwd||'').replace(/[\\/]+$/,'').split(/[\\/]/);
   if(parts.at(-2)?.toLowerCase()==='workspaces'&&parts.at(-1)===b.id&&/^[a-z\d_-]+$/i.test(b.id)){
    const local=path.join(root,'workspaces',b.id);
    if(path.resolve(b.cwd)!==local){
     if(!fs.existsSync(local))throw Error('A copied bot workspace is missing. Restore the entire data folder, including its workspaces folder, before starting Crew.');
     b.cwd=local;
    }
   }
   b.color??=['#c2ad87','#9dacc5','#a6bca9'][this.db.bots.indexOf(b)%3];b.icon??='spark';b.createdAt??=Date.now();b.events??=[];b.archived??=false;fs.mkdirSync(b.cwd,{recursive:true});
   try{b.fallback=normalizeFallback(b.fallback);}catch{b.fallback=normalizeFallback();}
  }
  for(const r of this.db.routines){try{Object.assign(r,normalizeRoutinePolicy(r));}catch{Object.assign(r,normalizeRoutinePolicy());r.enabled=false;r.lastError='Review this routine’s reliability settings before enabling it.';}}
  for(const t of this.db.tasks)if(['running','waiting'].includes(t.status)){t.status='interrupted';t.finishedAt=Date.now();t.error='The app stopped during this task. You can retry it.';}
  this.save();
 }
 save(){
  const temporary=this.file+'.'+uid()+'.tmp';let text;
  try{const stat=fs.lstatSync(this.file,{throwIfNoEntry:false});if(stat&&(stat.isSymbolicLink()||!stat.isFile()||stat.nlink>1))throw Error('Crew storage must be a regular private file, not a link.');text=JSON.stringify(this.db,null,2);fs.writeFileSync(temporary,text,{flag:'wx',mode:0o600});fs.renameSync(temporary,this.file);this.lastSaved=text;}
  catch(error){if(this.lastSaved)this.db=restoreValue(this.db,JSON.parse(this.lastSaved));throw Object.assign(Error('Crew could not save its data. Check the data folder’s permissions and free disk space, then retry.',{cause:error}),{code:'CREW_STORAGE'});}
  finally{try{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}catch{}}
 }
 bot(id){const b=this.db.bots.find(b=>b.id===id&&!b.archived);if(!b)throw Error('Bot not found');return b;}
 create({name,role='',memory='',color='#c2ad87',icon='spark'}){if(!String(name||'').trim())throw Error('Give your bot a name.');const id=uid(),cwd=path.join(this.root,'workspaces',id);fs.mkdirSync(cwd,{recursive:true});const b={id,name:String(name).trim().slice(0,60),role:String(role).slice(0,12000),memory:String(memory).slice(0,24000),color:/^#[a-f0-9]{6}$/i.test(color)?color:'#c2ad87',icon,cwd,messages:[],events:[],createdAt:Date.now(),archived:false};this.db.bots.push(b);this.save();return b;}
 message(b,role,text,extra={}){const m={id:uid(),role,text,at:Date.now(),...extra};const old=b.messages.find(x=>x.id===m.id);if(old)Object.assign(old,m);else b.messages.push(m);this.save();return m;}
 event(b,event){const old=b.events.find(x=>x.id===event.id);if(old)Object.assign(old,event);else b.events.push({id:uid(),at:Date.now(),...event});b.events=b.events.slice(-400);this.save();}
 enqueue(botId,prompt,{channelId=null,source='chat',parentId=null,depth=0}={}){this.bot(botId);if(!String(prompt||'').trim())throw Error('Enter a task.');if(this.db.tasks.filter(t=>t.botId===botId&&t.status==='queued').length>=30)throw Error('This bot already has 30 queued tasks.');const t={id:uid(),botId,prompt:String(prompt).slice(0,60000),channelId,source,parentId,depth,status:'queued',createdAt:Date.now()};this.db.tasks.push(t);this.save();return t;}
 notify(botId,title,text,taskId){this.db.notifications.unshift({id:uid(),botId,title,text:String(text||'').slice(0,300),taskId,at:Date.now(),read:false});this.db.notifications=this.db.notifications.slice(0,100);this.save();}
 routine(input){const b=this.bot(input.botId),schedule=scheduleValues(input);if(!String(input.prompt||'').trim())throw Error('Describe the routine.');let r=this.db.routines.find(x=>x.id===input.id);const policy=normalizeRoutinePolicy({...r,...input}),val={botId:b.id,name:String(input.name||'Routine').slice(0,100),prompt:String(input.prompt).slice(0,20000),...schedule,...policy,enabled:input.enabled===true,nextRun:nextOccurrence(schedule),retry:null};if(r)Object.assign(r,val);else{r={id:uid(),...val};this.db.routines.push(r);}this.save();return r;}
 routinePolicy(id){const r=this.db.routines.find(item=>item.id===id);if(!r)throw Error('Routine not found');return {routineId:r.id,name:r.name,...routineSummary(r)};}
 updateRoutinePolicy(id,input){const r=this.db.routines.find(item=>item.id===id);if(!r)throw Error('Routine not found');const policy=normalizeRoutinePolicy({...r,...input});Object.assign(r,policy);if(!r.enabled||!policy.retryLimit||r.retry?.attempt>policy.retryLimit)r.retry=null;this.save();return this.routinePolicy(id);}
 setRoutineEnabled(id,enabled,now=Date.now()){const r=this.db.routines.find(item=>item.id===id);if(!r)throw Error('Routine not found');if(typeof enabled!=='boolean')throw Error('Choose whether the routine is enabled.');if(r.enabled!==enabled){r.enabled=enabled;r.retry=null;if(enabled)r.nextRun=nextOccurrence(r,now);}this.save();return r;}
 completeRoutineTask(task,flags={},now=Date.now()){
  const id=typeof task.source==='string'&&task.source.startsWith('routine:')?task.source.slice(8):null;
  const r=id&&this.db.routines.find(item=>item.id===id&&item.botId===task.botId);if(!r)return {handled:false};
  const outcome=recordRoutineOutcome(r,task,flags,now);this.save();return outcome;
 }
 due(now=Date.now()){
  const out=[];
  for(const r of this.db.routines){
   if(!r.enabled){r.retry=null;continue;}
   const source='routine:'+r.id,active=this.db.tasks.some(t=>t.source===source&&['queued','running','waiting'].includes(t.status));
   const b=this.db.bots.find(item=>item.id===r.botId&&!item.archived);if(!b){r.enabled=false;r.retry=null;continue;}
   let scheduleReady=false;
   try{
    scheduleValues(r);normalizeRoutinePolicy(r);if(!Number.isFinite(r.nextRun))throw Error('Review this routine’s next run time.');
    const decision=missedRunDecision(r,now),scheduledFor=r.nextRun;
    if(decision.due)r.nextRun=nextOccurrence(r,now);
    scheduleReady=true;
    if(active){if(decision.due)r.lastSkipped={at:now,scheduledFor,reason:'Previous run is still active.'};continue;}
    let retry=null;
    if(r.retry){
     if(decision.due)r.lastSkipped={at:now,scheduledFor,reason:'A retry is pending for the previous run.'};
     if(r.retry.at>now)continue;
     const previous=this.db.tasks.find(t=>t.id===r.retry.afterTaskId&&t.botId===r.botId&&t.source===source);
     if(!previous||previous.status!=='failed'||r.retry.attempt<1||r.retry.attempt>normalizeRoutinePolicy(r).retryLimit){r.retry=null;continue;}
     retry=r.retry;
    }else if(!decision.due)continue;
    else if(!decision.run){r.lastSkipped={at:now,scheduledFor,reason:'Missed run skipped by your policy.'};continue;}
    const task=this.enqueue(r.botId,r.prompt,{source});
    Object.assign(task,{routineId:r.id,routineRunId:retry?.runId||task.id,retryAttempt:retry?.attempt||0,scheduledFor:retry?null:scheduledFor,...(retry?{retryOf:retry.afterTaskId}:{})});
    r.retry=null;r.lastRun=now;if(!retry)delete r.lastError;out.push(task);
   }catch(error){r.lastError=error.message;if(!scheduleReady){r.enabled=false;r.retry=null;}}
  }
  this.save();return out;
 }
 files(b,dir=b.cwd,prefix=''){const out=[];for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(e.isSymbolicLink()||e.name.startsWith('.')||['node_modules','browser-profile'].includes(e.name))continue;const full=path.join(dir,e.name),rel=prefix+e.name;if(e.isDirectory()){if(rel.split('/').length<5)out.push(...this.files(b,full,rel+'/'));}else {const st=fs.statSync(full);out.push({path:rel,size:st.size,modified:st.mtimeMs});}if(out.length>200)break;}return out;}
 safeFile(b,rel,mustExist=true){
  if(typeof rel!=='string'||!rel||path.isAbsolute(rel)||rel.split(/[\\/]/).some(x=>x==='..'||x===''))throw Error('Invalid file path');
  const full=path.resolve(b.cwd,rel),base=fs.realpathSync(b.cwd);
  if(!full.startsWith(path.resolve(b.cwd)+path.sep))throw Error('Invalid file path');
  // lstat sees dangling links; existsSync would mistake one for a new file.
  let check=full;
  while(!fs.lstatSync(check,{throwIfNoEntry:false})){
   const parent=path.dirname(check);if(parent===check)throw Error('Invalid file path');check=parent;
  }
  let real;try{real=fs.realpathSync(check);}catch{throw Error('Broken file links are not allowed');}
  if(real!==base&&!real.startsWith(base+path.sep))throw Error('File links outside the workspace are not allowed');
  if(mustExist&&!fs.existsSync(full))throw Error('File not found');return full;
 }
}
