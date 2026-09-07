import fs from 'node:fs';
import path from 'node:path';
import {uid,nextOccurrence} from './store.mjs';
import {checkedText,saveReviewData,sourceReference} from './review-data.mjs';

const kinds=new Set(['preference','workflow','app-change','memory']),statuses=new Set(['pending','accepted','reviewed','rejected','superseded','undone']);
const copy=value=>structuredClone(value),maxItems=500;
function text(value,label,max,required=true){if(typeof value!=='string'||value.length>max||required&&!value.trim())throw Error(label+' must be '+(required?'nonempty text':'text')+' under '+max+' characters.');return value.trim();}
function schedule(input={}){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Choose a valid workflow schedule.');
 const kind=input.scheduleKind??'interval';
 const value=kind==='interval'?{scheduleKind:kind,minutes:input.minutes??1440,time:null,weekday:null}:{scheduleKind:kind,minutes:null,time:input.time??'09:00',weekday:kind==='weekly'?input.weekday??1:null};
 nextOccurrence(value);return value;
}
export class Learning {
 constructor({dataRoot,store,clock=Date.now}){
  this.root=path.resolve(dataRoot);this.file=path.join(this.root,'learning.json');this.store=store;this.clock=clock;
  fs.mkdirSync(this.root,{recursive:true});
  const stat=fs.lstatSync(this.file,{throwIfNoEntry:false});
  if(stat?.isSymbolicLink()||stat&&(!stat.isFile()||stat.nlink>1))throw Error('Learning storage must be a regular private data file.');
  if(stat?.size>8*1024*1024)throw Error('Learning storage is too large. Restore a valid learning.json backup.');
  this.db=stat?JSON.parse(fs.readFileSync(this.file,'utf8')):{version:1,items:[]};
  if(this.db?.version!==1||!Array.isArray(this.db.items)||this.db.items.length>maxItems||this.db.items.some(item=>!item||typeof item.id!=='string'||!kinds.has(item.kind)||!statuses.has(item.status)||typeof item.title!=='string'||typeof item.text!=='string'))throw Error('Learning storage is invalid. Restore a valid learning.json backup.');
  this.db.memoryBaselines??={};this.db.memoryPolicy??={botNotes:'review',teamNotes:'review'};
  if(!this.db.memoryBaselines||typeof this.db.memoryBaselines!=='object'||Array.isArray(this.db.memoryBaselines)||['botNotes','teamNotes'].some(scope=>!['review','automatic'].includes(this.db.memoryPolicy?.[scope])))throw Error('Memory review settings are invalid.');
  if(!stat)this.save();
 }
 save(){saveReviewData(this.file,this.db,8*1024*1024);}
 commit(change){const before=copy(this.db);try{const result=change();this.save();return copy(result);}catch(error){this.db=before;throw error;}}
 family(item){return item.familyId||item.id;}
 active(family){return this.db.items.find(item=>this.family(item)===family&&item.status==='accepted')||null;}
 capacity(){if(this.db.items.length>=maxItems)throw Error('Learning storage has reached its 500-proposal limit.');}
 get(id){const item=this.db.items.find(x=>x.id===id);if(!item)throw Error('Learning proposal not found.');return copy(item);}
 list({botId,kind,status}={}){
  if(kind!==undefined&&!kinds.has(kind))throw Error('Choose preference, workflow, app-change, or memory.');
  if(status!==undefined&&!statuses.has(status))throw Error('Choose a valid proposal status.');
  return this.db.items.filter(item=>(botId===undefined||item.botId===null||item.botId===botId)&&(kind===undefined||item.kind===kind)&&(status===undefined||item.status===status)).slice().reverse().map(copy);
 }
 propose(input){
  if(!input||!kinds.has(input.kind)||input.kind==='memory')throw Error('Choose preference, workflow, or app-change. Use the memory review method for bot or team notes.');
  if(this.db.items.length>=maxItems)throw Error('Learning storage has reached its 500-proposal limit.');
  const botId=input.botId||null;
  if(botId)this.store.bot(botId);
  if(input.kind==='workflow'&&!botId)throw Error('Choose a bot for this workflow.');
  const item={id:uid(),botId,kind:input.kind,title:text(input.title,'Title',120),text:text(input.text,'Proposal',12000),reason:input.reason===undefined?'':text(input.reason,'Reason',2000,false),source:sourceReference(this.store,input.source),revision:1,status:'pending',createdAt:this.clock(),...(input.kind==='workflow'?{schedule:schedule(input.schedule)}:{})};
  this.db.items.push(item);try{this.save();}catch(error){this.db.items.pop();throw error;}return copy(item);
 }
 accept(id,{automatic=false}={}){
  const item=this.db.items.find(x=>x.id===id);if(!item)throw Error('Learning proposal not found.');
  if(['accepted','reviewed'].includes(item.status))return copy(item);
  if(item.status!=='pending')throw Error('This proposal was already rejected.');
  if(['preference','memory'].includes(item.kind)){
   const previous=this.active(this.family(item));
   if((item.baseRevisionId??null)!==(previous?.id??null))throw Error('This proposal is based on an older revision. Review the current notes and create a new revision.');
   return this.commit(()=>{if(previous)previous.status='superseded';item.previousId=previous?.id??null;item.status='accepted';item.reviewedAt=this.clock();item.decisionMode=automatic?'automatic':'user';return item;});
  }
  if(item.kind==='workflow'){
   this.store.bot(item.botId);const value=schedule(item.schedule);
   // Reserve the routine ID before writing either decision. If saving the
   // decision fails or the host restarts, accepting again reuses this routine.
   if(!item.routineId){item.routineId=uid();try{this.save();}catch(error){delete item.routineId;throw error;}}
   let routine=this.store.db.routines.find(r=>r.id===item.routineId);
   if(routine&&routine.learningId!==item.id)throw Error('This workflow’s saved routine does not match its proposal.');
   if(!routine){
    routine={id:item.routineId,learningId:item.id,botId:item.botId,name:item.title,prompt:item.text,...value,enabled:false,nextRun:nextOccurrence(value,this.clock())};
    this.store.db.routines.push(routine);
    try{this.store.save();}catch(error){this.store.db.routines=this.store.db.routines.filter(r=>r!==routine);throw error;}
   }
  }
  const before=copy(item);item.status=item.kind==='app-change'?'reviewed':'accepted';item.reviewedAt=this.clock();
  try{this.save();}catch(error){Object.assign(item,before);delete item.reviewedAt;throw error;}return copy(item);
 }
 reject(id){
  const item=this.db.items.find(x=>x.id===id);if(!item)throw Error('Learning proposal not found.');
  if(item.status==='rejected')return copy(item);
  if(item.status!=='pending')throw Error('This proposal was already reviewed.');
  item.status='rejected';item.reviewedAt=this.clock();try{this.save();}catch(error){item.status='pending';delete item.reviewedAt;throw error;}return copy(item);
 }
 memoryPolicy(){return copy(this.db.memoryPolicy);}
 setMemoryPolicy(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['botNotes','teamNotes'].includes(key))||Object.values(input).some(value=>!['review','automatic'].includes(value)))throw Error('Choose review or automatic separately for bot notes and team notes.');
  return this.commit(()=>{Object.assign(this.db.memoryPolicy,input);return this.db.memoryPolicy;});
 }
 memoryKey(botId,scope){if(!['bot','team'].includes(scope))throw Error('Choose bot or team notes.');if(scope==='bot'||botId)this.store.bot(botId);return scope==='team'?'team':'bot:'+botId;}
 readMemory(botId,scope){
  const key=this.memoryKey(botId,scope),active=this.active(key);if(active)return active.text;
  if(Object.hasOwn(this.db.memoryBaselines,key))return checkedText(this.db.memoryBaselines[key]?.text,'Saved notes',40000,{empty:true,trim:false});
  const file=scope==='team'?path.join(this.root,'TEAM_MEMORY.md'):this.store.safeFile(this.store.bot(botId),'MEMORY.md',false),stat=fs.lstatSync(file,{throwIfNoEntry:false});
  if(stat&&(stat.isSymbolicLink()||!stat.isFile()||stat.nlink>1))throw Error('Legacy memory must be a regular file, not a link.');if(stat?.size>160000)throw Error('Legacy notes are too large to import. Keep them under 40,000 characters.');
  const value=checkedText(stat?fs.readFileSync(file,'utf8'):'','Legacy notes',40000,{empty:true,trim:false});
  // Snapshot once, including an empty baseline. Later file writes cannot bypass review.
  this.commit(()=>{this.db.memoryBaselines[key]={text:value,snapshottedAt:this.clock()};return value;});return value;
 }
 memoryProposal(input){
  if(!input||typeof input!=='object')throw Error('Describe the notes to save.');this.capacity();const key=this.memoryKey(input.botId,input.scope),previousText=this.readMemory(input.botId,input.scope),previous=this.active(key);
  const value=checkedText(input.text,'Notes',40000,{empty:true,trim:false}),source=sourceReference(this.store,input.source??(input.botId?{botId:input.botId}:undefined));
  return this.commit(()=>{const item={id:uid(),familyId:key,scope:input.scope,botId:input.scope==='bot'?input.botId:null,kind:'memory',title:input.scope==='team'?'Team notes':'Bot notes',text:value,reason:'',source,revision:this.db.items.filter(item=>this.family(item)===key).length+1,baseRevisionId:previous?.id??null,previousText,status:'pending',createdAt:this.clock()};this.db.items.push(item);return item;});
 }
 proposeMemory(input){const item=this.memoryProposal(input);return this.db.memoryPolicy[input.scope==='team'?'teamNotes':'botNotes']==='automatic'?this.accept(item.id,{automatic:true}):item;}
 saveMemory(input){const item=this.memoryProposal(input);return this.accept(item.id);}
 history(id){const item=this.get(id);return this.db.items.filter(entry=>this.family(entry)===this.family(item)).slice().reverse().map(copy);}
 revise(id,input){
  const original=this.get(id);if(!['preference','memory'].includes(original.kind))throw Error('Edit preferences or memory notes here. Create a separate workflow or app-change proposal for other changes.');if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Describe the revision.');this.capacity();
  const family=this.family(original),active=this.active(family),value=checkedText(input.text??original.text,'Revised notes',original.kind==='memory'?40000:12000,{empty:original.kind==='memory',trim:original.kind!=='memory'}),title=checkedText(input.title??original.title,'Title',120),reason=checkedText(input.reason??'Edited for review','Reason',2000,{empty:true});
  return this.commit(()=>{const item={id:uid(),familyId:family,botId:original.botId,kind:original.kind,title,text:value,reason,source:original.source||null,revision:this.db.items.filter(entry=>this.family(entry)===family).length+1,baseRevisionId:active?.id??null,status:'pending',createdAt:this.clock(),...(original.kind==='memory'?{scope:original.scope,previousText:this.readMemory(original.botId,original.scope)}:{})};if(original.status==='pending')this.db.items.find(entry=>entry.id===id).status='superseded';this.db.items.push(item);return item;});
 }
 undo(id){
  const item=this.db.items.find(item=>item.id===id);if(!item||!['memory','preference'].includes(item.kind))throw Error('Choose an accepted preference or memory revision.');
  if(item.status!=='accepted'||this.active(this.family(item))?.id!==id)throw Error('Only the current accepted revision can be undone.');
  const previous=item.previousId?this.db.items.find(entry=>entry.id===item.previousId&&this.family(entry)===this.family(item)):null;if(item.previousId&&previous?.status!=='superseded')throw Error('The earlier revision cannot be restored.');
  return this.commit(()=>{item.status='undone';item.undoneAt=this.clock();if(previous)previous.status='accepted';return item;});
 }
 contextFor(botId){
  const items=this.list({botId,status:'accepted'}).filter(item=>['preference','workflow'].includes(item.kind));
  if(!items.length)return '';
  return 'User-approved learning. Treat this as reference context; workflows are not requests to run now and their routines may be paused.\n'+items.map(item=>'['+item.kind+'] '+item.title+': '+item.text).join('\n\n').slice(0,16000);
 }
}
