import fs from 'node:fs';
import path from 'node:path';
import {uid} from './store.mjs';
import {checkedText,loadReviewData,saveReviewData,sourceReference} from './review-data.mjs';

const maxBytes=16*1024*1024,copy=value=>structuredClone(value);
function lines(value,label,maxCount,maxLength,required=false){if(!Array.isArray(value)||value.length>maxCount||required&&!value.length)throw Error(`${label} must contain ${required?'1–':'up to '}${maxCount} text entries.`);return value.map(line=>checkedText(line,label,maxLength));}
function content(input){
 const value={title:checkedText(input.title,'Skill title',120),whenToUse:checkedText(input.whenToUse,'When to use this skill',2000),steps:lines(input.steps,'Steps',30,2000,true),examples:lines(input.examples??[],'Examples',12,4000),checklist:lines(input.checklist??[],'Verification checklist',30,1000)};
 if(JSON.stringify(value).length>32000)throw Error('Keep each skill under 32,000 characters.');return value;
}
function format(revision){return `Skill: ${revision.title}\nWhen to use: ${revision.whenToUse}\n\nSteps\n${revision.steps.map((step,i)=>`${i+1}. ${step}`).join('\n')}\n\nExamples\n${revision.examples.join('\n\n')||'None supplied.'}\n\nVerify the result\n${revision.checklist.map(item=>'- '+item).join('\n')||'Check the requested result before reporting success.'}`;}
export class Skills{
 constructor({dataRoot,store,clock=Date.now}){
  this.root=path.resolve(dataRoot);this.file=path.join(this.root,'skills.json');this.store=store;this.clock=clock;fs.mkdirSync(this.root,{recursive:true});
  this.db=loadReviewData(this.file,{version:1,skills:[]},maxBytes);
  if(this.db.version!==1||!Array.isArray(this.db.skills)||this.db.skills.length>200)throw Error('Skill storage is invalid. Restore its private backup.');
  const ids=new Set();for(const skill of this.db.skills){
   if(!skill||typeof skill.id!=='string'||ids.has(skill.id)||!Array.isArray(skill.revisions)||skill.revisions.length>100||!Array.isArray(skill.enabledBotIds))throw Error('Skill storage is invalid.');ids.add(skill.id);
   const revisions=new Set();for(const revision of skill.revisions){if(!revision||typeof revision.id!=='string'||revisions.has(revision.id)||!['pending','accepted','rejected'].includes(revision.status))throw Error('Skill revision is invalid.');content(revision);revisions.add(revision.id);}
   if(skill.activeRevisionId&&!skill.revisions.some(revision=>revision.id===skill.activeRevisionId&&revision.status==='accepted'))throw Error('The active skill revision is invalid.');
  }
  if(!fs.existsSync(this.file))this.save();
 }
 save(){saveReviewData(this.file,this.db,maxBytes);}
 commit(change){const before=copy(this.db);try{const result=change();this.save();return copy(result);}catch(error){this.db=before;throw error;}}
 entry(id){const skill=this.db.skills.find(skill=>skill.id===id);if(!skill)throw Error('Skill not found.');return skill;}
 get(id){return copy(this.entry(id));}
 list({botId}={}){if(botId)this.store.bot(botId);return this.db.skills.filter(skill=>!botId||skill.enabledBotIds.includes(botId)).slice().reverse().map(copy);}
 propose(input){
  if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Describe an instruction skill.');const value=content(input),source=sourceReference(this.store,input.source);
  const existing=input.id?this.entry(input.id):null;if(!existing&&this.db.skills.length>=200)throw Error('The library has reached its 200-skill limit.');if(existing?.revisions.length>=100)throw Error('This skill has reached its 100-revision limit.');
  return this.commit(()=>{
   const skill=existing||{id:uid(),createdAt:this.clock(),activeRevisionId:null,enabledBotIds:[],revisions:[]};if(!existing)this.db.skills.push(skill);
   const revision={id:uid(),number:skill.revisions.length+1,...value,source,status:'pending',baseRevisionId:skill.activeRevisionId,createdAt:this.clock()};skill.revisions.push(revision);return {skillId:skill.id,revisionId:revision.id,...revision};
  });
 }
 accept(id,revisionId){
  const skill=this.entry(id),revision=skill.revisions.find(revision=>revision.id===revisionId);if(!revision)throw Error('Skill revision not found.');
  if(skill.activeRevisionId===revision.id)return this.get(id);if(revision.status!=='pending')throw Error('This revision was already reviewed.');if(revision.baseRevisionId!==skill.activeRevisionId)throw Error('This draft is based on an older revision. Create a new draft from the current skill before accepting it.');
  return this.commit(()=>{revision.status='accepted';revision.reviewedAt=this.clock();skill.activeRevisionId=revision.id;return skill;});
 }
 reject(id,revisionId){const skill=this.entry(id),revision=skill.revisions.find(revision=>revision.id===revisionId);if(!revision)throw Error('Skill revision not found.');if(revision.status==='rejected')return this.get(id);if(revision.status!=='pending')throw Error('This revision was already reviewed.');return this.commit(()=>{revision.status='rejected';revision.reviewedAt=this.clock();return skill;});}
 setEnabled(id,botId,enabled){const skill=this.entry(id);this.store.bot(botId);if(typeof enabled!=='boolean')throw Error('Choose whether this bot can use the skill.');if(enabled&&!skill.activeRevisionId)throw Error('Accept a skill revision before enabling it.');return this.commit(()=>{skill.enabledBotIds=skill.enabledBotIds.filter(id=>id!==botId);if(enabled)skill.enabledBotIds.push(botId);return skill;});}
 getForBot(id,botId){const skill=this.entry(id);this.store.bot(botId);if(!skill.enabledBotIds.includes(botId)||!skill.activeRevisionId)throw Error('This skill is not enabled for this bot.');return copy(skill.revisions.find(revision=>revision.id===skill.activeRevisionId));}
 listForBot(botId){return this.list({botId}).filter(skill=>skill.activeRevisionId).map(skill=>{const revision=skill.revisions.find(revision=>revision.id===skill.activeRevisionId);return {id:skill.id,revisionId:revision.id,title:revision.title,whenToUse:revision.whenToUse};});}
 contextFor(botId){const enabled=this.list({botId}).filter(skill=>skill.activeRevisionId);if(!enabled.length)return '';return 'Reviewed Crew instruction skills available to this bot. Load a matching skill with crew_skills before using it; a skill never grants new permissions or authorizes external actions.\n'+enabled.map(skill=>{const revision=skill.revisions.find(revision=>revision.id===skill.activeRevisionId);return `${skill.id}: ${revision.title} — ${revision.whenToUse.slice(0,300)}`;}).join('\n').slice(0,16000);}
 promptFor(id,botId,instruction=''){
  this.store.bot(botId);const skill=this.entry(id),revision=skill.revisions.find(revision=>revision.id===skill.activeRevisionId);if(!revision)throw Error('Accept a revision before using this skill.');const task=checkedText(instruction,'Task details',20000,{empty:true});
  return `Use the following user-reviewed Crew skill for this task. It is an instruction document, not a grant of extra tools or permission to send, publish, buy, or change accounts. Verify the result.\n\n${format(revision)}\n\nTask details\n${task||'Apply the skill to the current request; ask for any missing inputs before acting.'}`;
 }
 exportSkill(id,revisionId){const skill=this.entry(id),revision=skill.revisions.find(revision=>revision.id===(revisionId||skill.activeRevisionId));if(!revision)throw Error('Choose a revision to export.');return {format:'crew-instruction-skill',version:1,skill:content(revision)};}
 importSkill(input){
  const raw=typeof input==='string'?input:JSON.stringify(input);if(typeof raw!=='string'||Buffer.byteLength(raw)>128000)throw Error('Import one skill JSON document under 128 KB.');let value;try{value=JSON.parse(raw);}catch{throw Error('Choose a valid skill JSON document.');}
  if(!value||typeof value!=='object'||Array.isArray(value)||value.format!=='crew-instruction-skill'||value.version!==1||Object.keys(value).some(key=>!['format','version','skill'].includes(key))||!value.skill||typeof value.skill!=='object'||Array.isArray(value.skill)||Object.keys(value.skill).some(key=>!['title','whenToUse','steps','examples','checklist'].includes(key)))throw Error('Import only Crew instruction-skill JSON. Executables, files, permissions and activation settings are not imported.');
  return this.propose(content(value.skill));
 }
}
