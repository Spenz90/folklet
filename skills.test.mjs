import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {Store} from './store.mjs';
import {Skills} from './skills.mjs';
const example={title:'Review a report',whenToUse:'When reviewing a draft report',steps:['Read the draft','Check sources'],examples:['A weekly update'],checklist:['Sources support the claims']};
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'crew-skills-test-')),store=new Store(root),bot=store.create({name:'Reviewer'}),skills=new Skills({dataRoot:root,store});t.after(()=>{assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.match(path.basename(root),/^crew-skills-test-/);fs.rmSync(root,{recursive:true,force:true});});return {root,store,bot,skills};}
test('skills require review and bot enablement before model use',t=>{
 const {skills,bot,store,root}=fixture(t),other=store.create({name:'Other'}),proposal=skills.propose({...example,status:'accepted',enabledBotIds:[bot.id]});
 assert.equal(proposal.status,'pending');assert.throws(()=>skills.promptFor(proposal.skillId,bot.id),/Accept/);assert.throws(()=>skills.setEnabled(proposal.skillId,bot.id,true),/Accept/);assert.deepEqual(skills.listForBot(bot.id),[]);
 skills.accept(proposal.skillId,proposal.revisionId);assert.throws(()=>skills.getForBot(proposal.skillId,bot.id),/not enabled/);skills.setEnabled(proposal.skillId,bot.id,true);
 assert.equal(skills.getForBot(proposal.skillId,bot.id).title,example.title);assert.equal(skills.listForBot(bot.id).length,1);assert.deepEqual(skills.listForBot(other.id),[]);assert.match(skills.contextFor(bot.id),/never grants new permissions/);
 assert.equal(new Skills({dataRoot:root,store}).getForBot(proposal.skillId,bot.id).id,proposal.revisionId);
 skills.setEnabled(proposal.skillId,bot.id,false);assert.deepEqual(skills.listForBot(bot.id),[]);
});
test('skill revisions are immutable drafts and stale acceptance cannot overwrite a newer review',t=>{
 const {skills,bot}=fixture(t),first=skills.propose(example);skills.accept(first.skillId,first.revisionId);skills.setEnabled(first.skillId,bot.id,true);
 const second=skills.propose({...example,id:first.skillId,title:'Improved review'}),third=skills.propose({...example,id:first.skillId,title:'Competing draft'});
 assert.equal(skills.getForBot(first.skillId,bot.id).title,example.title);skills.accept(first.skillId,second.revisionId);assert.equal(skills.getForBot(first.skillId,bot.id).title,'Improved review');assert.throws(()=>skills.accept(first.skillId,third.revisionId),/older revision/);
 assert.equal(skills.get(first.skillId).revisions[0].title,example.title);skills.reject(first.skillId,third.revisionId);assert.throws(()=>skills.accept(first.skillId,third.revisionId),/already reviewed/);
});
test('skill use-now returns a bounded prompt without enabling bots or queueing work',t=>{
 const {skills,bot,store}=fixture(t),proposal=skills.propose(example);skills.accept(proposal.skillId,proposal.revisionId);
 const prompt=skills.promptFor(proposal.skillId,bot.id,'Review the uploaded report');assert.match(prompt,/Check sources/);assert.match(prompt,/Review the uploaded report/);assert.match(prompt,/not a grant of extra tools/);assert.equal(store.db.tasks.length,0);assert.deepEqual(skills.get(proposal.skillId).enabledBotIds,[]);
 assert.throws(()=>skills.promptFor(proposal.skillId,bot.id,'x'.repeat(20001)),/20/);
});
test('skill JSON import/export carries only instructions and always creates a pending draft',t=>{
 const {skills,bot,store}=fixture(t),task=store.enqueue(bot.id,'Review'),first=skills.propose({...example,source:{botId:bot.id,taskId:task.id}});skills.accept(first.skillId,first.revisionId);skills.setEnabled(first.skillId,bot.id,true);
 const exported=skills.exportSkill(first.skillId);assert.deepEqual(exported,{format:'crew-instruction-skill',version:1,skill:example});assert.equal(JSON.stringify(exported).includes(bot.id),false);
 const imported=skills.importSkill(JSON.stringify(exported));assert.equal(imported.status,'pending');assert.notEqual(imported.skillId,first.skillId);assert.deepEqual(skills.get(imported.skillId).enabledBotIds,[]);
 for(const invalid of [{...exported,files:[{path:'app.mjs',text:'run'}]},{...exported,skill:{...example,command:'run'}},{...exported,enabled:true}])assert.throws(()=>skills.importSkill(invalid),/only FOLKLET instruction/);
 assert.throws(()=>skills.importSkill('not json'),/valid skill/);assert.throws(()=>skills.importSkill(' '.repeat(128001)),/128 KB/);
});
test('skill sources validate ownership and generated links cannot contain supplied external URLs',t=>{
 const {skills,bot,store}=fixture(t),other=store.create({name:'Other'}),task=store.enqueue(other.id,'Other task');assert.throws(()=>skills.propose({...example,source:{botId:bot.id,taskId:task.id}}),/does not belong/);
 const own=store.enqueue(bot.id,'Own task'),proposal=skills.propose({...example,source:{botId:bot.id,taskId:own.id,href:'https://outside.invalid'}});assert.equal(proposal.source.href,'/?bot='+bot.id+'&task='+own.id);
});
test('skill persistence failures leave the prior active revision intact',t=>{
 const {skills}=fixture(t),first=skills.propose(example);skills.accept(first.skillId,first.revisionId);const second=skills.propose({...example,id:first.skillId,title:'New draft'}),save=skills.save.bind(skills);skills.save=()=>{throw Error('Disk full');};assert.throws(()=>skills.accept(first.skillId,second.revisionId),/Disk full/);assert.equal(skills.get(first.skillId).activeRevisionId,first.revisionId);skills.save=save;skills.accept(first.skillId,second.revisionId);assert.equal(skills.get(first.skillId).activeRevisionId,second.revisionId);
});
test('skill storage refuses linked files and imported paths do not create files',t=>{
 const {skills,root,store}=fixture(t),outside=path.join(root,'outside');fs.mkdirSync(outside);fs.unlinkSync(skills.file);fs.symlinkSync(outside,skills.file,'junction');assert.throws(()=>new Skills({dataRoot:root,store}),/regular private file/);assert.throws(()=>skills.propose(example),/symbolic links/);assert.deepEqual(fs.readdirSync(outside),[]);
});
