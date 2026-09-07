import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {Store} from './store.mjs';
import {Learning} from './learning.mjs';

function fixture(t){
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'crew-learning-test-')),store=new Store(path.join(base,'data')),bot=store.create({name:'Test bot'}),learning=new Learning({dataRoot:store.root,store});
 t.after(()=>{assert.equal(path.dirname(path.resolve(base)),path.resolve(os.tmpdir()));assert.match(path.basename(base),/^crew-learning-test-/);fs.rmSync(base,{recursive:true,force:true});});
 return {base,store,bot,learning};
}

test('preferences remain pending until user acceptance and persist privately across restart',t=>{
 const {store,bot,learning}=fixture(t);
 const proposal=learning.propose({botId:bot.id,kind:'preference',title:'Brief answers',text:'Prefer short answers with concrete next steps.',status:'accepted'});
 assert.equal(proposal.status,'pending');assert.equal(learning.contextFor(bot.id),'');
 const accepted=learning.accept(proposal.id);assert.equal(accepted.status,'accepted');assert.ok(accepted.reviewedAt);assert.match(learning.contextFor(bot.id),/Prefer short answers/);
 const restored=new Learning({dataRoot:store.root,store});assert.equal(restored.get(proposal.id).status,'accepted');assert.equal(restored.contextFor(bot.id),learning.contextFor(bot.id));
 if(process.platform!=='win32')assert.equal(fs.statSync(learning.file).mode&0o777,0o600);
});

test('accepted workflows create one paused routine and never queue work',t=>{
 const {store,bot,learning}=fixture(t),proposal=learning.propose({botId:bot.id,kind:'workflow',title:'Daily review',text:'Review my completed tasks.',schedule:{scheduleKind:'weekdays',time:'09:30'},enabled:true});
 assert.equal(store.db.routines.length,0);assert.equal(store.db.tasks.length,0);
 const accepted=learning.accept(proposal.id),routine=store.db.routines[0];
 assert.equal(accepted.status,'accepted');assert.equal(routine.id,accepted.routineId);assert.equal(routine.learningId,proposal.id);assert.equal(routine.enabled,false);assert.equal(routine.scheduleKind,'weekdays');assert.equal(routine.time,'09:30');assert.equal(routine.prompt,proposal.text);
 learning.accept(proposal.id);assert.equal(store.db.routines.length,1);assert.equal(store.due(Date.now()+365*86400000).length,0);
});

test('retrying a failed final decision save reuses its reserved paused routine',t=>{
 const {store,bot,learning}=fixture(t),proposal=learning.propose({botId:bot.id,kind:'workflow',title:'Review',text:'Review notes.'});
 const realSave=learning.save.bind(learning);let writes=0;learning.save=()=>{if(++writes===2)throw Error('Disk error');return realSave();};
 assert.throws(()=>learning.accept(proposal.id),/Disk error/);assert.equal(store.db.routines.length,1);assert.equal(learning.get(proposal.id).status,'pending');
 const restored=new Learning({dataRoot:store.root,store});const accepted=restored.accept(proposal.id);assert.equal(store.db.routines.length,1);assert.equal(store.db.routines[0].id,accepted.routineId);assert.equal(store.db.routines[0].enabled,false);
});

test('a failed routine save leaves a retryable proposal without an in-memory orphan',t=>{
 const {store,bot,learning}=fixture(t),proposal=learning.propose({botId:bot.id,kind:'workflow',title:'Review',text:'Review notes.'});
 const realSave=store.save.bind(store);store.save=()=>{throw Error('Routine disk error');};assert.throws(()=>learning.accept(proposal.id),/Routine disk error/);assert.equal(store.db.routines.length,0);assert.equal(learning.get(proposal.id).status,'pending');
 store.save=realSave;learning.accept(proposal.id);assert.equal(store.db.routines.length,1);
});

test('app-change acceptance records review but never applies code or creates work',t=>{
 const {base,store,bot,learning}=fixture(t),source=path.join(base,'application.mjs');fs.writeFileSync(source,'export const original = true;');
 const proposal=learning.propose({botId:bot.id,kind:'app-change',title:'Improve the app',text:'Replace application.mjs with a different implementation. Check it with the existing tests.'});
 const result=learning.accept(proposal.id);assert.equal(result.status,'reviewed');assert.equal(result.routineId,undefined);assert.equal(fs.readFileSync(source,'utf8'),'export const original = true;');assert.equal(store.db.routines.length,0);assert.equal(store.db.tasks.length,0);assert.equal(learning.contextFor(bot.id),'');
});

test('rejected proposals have no effect and cannot be accepted afterward',t=>{
 const {store,bot,learning}=fixture(t),proposal=learning.propose({botId:bot.id,kind:'workflow',title:'Unwanted',text:'Do not run this.'});
 assert.equal(learning.reject(proposal.id).status,'rejected');assert.throws(()=>learning.accept(proposal.id),/already rejected/);assert.equal(store.db.routines.length,0);assert.equal(learning.contextFor(bot.id),'');
});

test('bot learning includes accepted team preferences but excludes another bot and unapproved proposals',t=>{
 const {store,bot,learning}=fixture(t),other=store.create({name:'Other'});
 for(const [botId,title] of [[null,'Team'],[bot.id,'Own'],[other.id,'Other']])learning.accept(learning.propose({botId,kind:'preference',title,text:title+' preference'}).id);
 learning.propose({botId:bot.id,kind:'preference',title:'Pending',text:'Not approved'});
 assert.deepEqual(learning.list({botId:bot.id,status:'accepted'}).map(x=>x.title).sort(),['Own','Team']);assert.doesNotMatch(learning.contextFor(bot.id),/Other|Not approved/);
 const listed=learning.list();listed[0].status='reviewed';assert.equal(learning.get(listed[0].id).status,'pending','Returned objects cannot mutate stored decisions');
});

test('invalid schedules and oversized proposals are rejected before persistence',t=>{
 const {bot,learning}=fixture(t);
 for(const input of [{kind:'invalid',title:'A',text:'B'},{kind:'preference',title:'',text:'B'},{kind:'preference',title:'A',text:'x'.repeat(12001)},{kind:'workflow',title:'A',text:'B',botId:bot.id,schedule:{scheduleKind:'interval',minutes:0}},{kind:'workflow',title:'A',text:'B'}])assert.throws(()=>learning.propose(input));
 assert.equal(learning.list().length,0);assert.throws(()=>learning.list({status:'applied'}),/valid proposal status/);
});

test('learning persistence refuses a linked data file without changing its target',t=>{
 const {base,store,learning}=fixture(t),target=path.join(base,'external');fs.mkdirSync(target);fs.unlinkSync(learning.file);fs.symlinkSync(target,learning.file,'junction');
 assert.throws(()=>new Learning({dataRoot:store.root,store}),/regular private data file/);assert.throws(()=>learning.propose({kind:'preference',title:'A',text:'B'}),/symbolic link/);assert.deepEqual(fs.readdirSync(target),[]);
});
test('memory writes are proposals by default and legacy notes are snapshotted exactly once',t=>{
 const {bot,learning}=fixture(t),file=path.join(bot.cwd,'MEMORY.md');fs.writeFileSync(file,'Original notes');assert.equal(learning.readMemory(bot.id,'bot'),'Original notes');fs.writeFileSync(file,'Bypass attempt');assert.equal(learning.readMemory(bot.id,'bot'),'Original notes');
 const pending=learning.proposeMemory({botId:bot.id,scope:'bot',text:'Reviewed notes'});assert.equal(pending.status,'pending');assert.equal(learning.readMemory(bot.id,'bot'),'Original notes');learning.accept(pending.id);assert.equal(learning.readMemory(bot.id,'bot'),'Reviewed notes');assert.equal(fs.readFileSync(file,'utf8'),'Bypass attempt','Canonical history does not mutate unrelated file edits');
 learning.undo(pending.id);assert.equal(learning.readMemory(bot.id,'bot'),'Original notes');assert.equal(learning.get(pending.id).status,'undone');
});
test('an initially empty notes snapshot cannot be bypassed by creating a file later',t=>{
 const {bot,learning}=fixture(t);assert.equal(learning.readMemory(bot.id,'bot'),'');fs.writeFileSync(path.join(bot.cwd,'MEMORY.md'),'Later file content');assert.equal(learning.readMemory(bot.id,'bot'),'');
});
test('memory policy is scoped and direct user edits always have accepted undoable history',t=>{
 const {bot,learning}=fixture(t);assert.deepEqual(learning.memoryPolicy(),{botNotes:'review',teamNotes:'review'});learning.setMemoryPolicy({botNotes:'automatic'});
 const auto=learning.proposeMemory({botId:bot.id,scope:'bot',text:'Auto notes'}),team=learning.proposeMemory({botId:bot.id,scope:'team',text:'Team proposal'});assert.equal(auto.status,'accepted');assert.equal(auto.decisionMode,'automatic');assert.equal(team.status,'pending');assert.equal(learning.readMemory(bot.id,'team'),'');
 const user=learning.saveMemory({botId:bot.id,scope:'bot',text:'User revision'});assert.equal(user.decisionMode,'user');assert.equal(learning.readMemory(bot.id,'bot'),'User revision');assert.throws(()=>learning.undo(auto.id),/current accepted/);learning.undo(user.id);assert.equal(learning.readMemory(bot.id,'bot'),'Auto notes');assert.equal(learning.history(auto.id).length,2);
 assert.throws(()=>learning.setMemoryPolicy({all:true}),/separately/);assert.throws(()=>learning.setMemoryPolicy({teamNotes:'yes'}),/separately/);
});
test('preference revisions keep prior approved context until review and undo restores it',t=>{
 const {bot,learning}=fixture(t),first=learning.propose({botId:bot.id,kind:'preference',title:'Length',text:'Keep replies short'});learning.accept(first.id);
 const revised=learning.revise(first.id,{text:'Give detailed replies'});assert.match(learning.contextFor(bot.id),/Keep replies short/);assert.doesNotMatch(learning.contextFor(bot.id),/Give detailed/);learning.accept(revised.id);assert.match(learning.contextFor(bot.id),/Give detailed replies/);assert.doesNotMatch(learning.contextFor(bot.id),/Keep replies/);
 assert.equal(learning.get(first.id).status,'superseded');learning.undo(revised.id);assert.match(learning.contextFor(bot.id),/Keep replies short/);learning.undo(first.id);assert.equal(learning.contextFor(bot.id),'');
});
test('stale note revisions cannot overwrite a newer accepted user edit',t=>{
 const {bot,learning}=fixture(t),pending=learning.proposeMemory({botId:bot.id,scope:'bot',text:'Draft'});learning.saveMemory({botId:bot.id,scope:'bot',text:'New user notes'});assert.throws(()=>learning.accept(pending.id),/older revision/);assert.equal(learning.readMemory(bot.id,'bot'),'New user notes');
 const edited=learning.revise(pending.id,{text:'Reconciled draft'});assert.equal(learning.get(pending.id).status,'superseded');learning.accept(edited.id);assert.equal(learning.readMemory(bot.id,'bot'),'Reconciled draft');
});
test('memory sources are checked and accepted canonical notes survive restart',t=>{
 const {bot,store,learning}=fixture(t),other=store.create({name:'Other'}),task=store.enqueue(bot.id,'Own task');assert.throws(()=>learning.proposeMemory({botId:bot.id,scope:'bot',text:'Notes',source:{botId:other.id,taskId:task.id}}),/does not belong/);
 const item=learning.saveMemory({botId:bot.id,scope:'bot',text:'Stable notes',source:{botId:bot.id,taskId:task.id}});assert.equal(item.source.href,'/?bot='+bot.id+'&task='+task.id);const restored=new Learning({dataRoot:store.root,store});assert.equal(restored.readMemory(bot.id,'bot'),'Stable notes');assert.equal(restored.history(item.id)[0].source.taskId,task.id);
});
test('failed review persistence preserves accepted notes and a retryable revision',t=>{
 const {bot,learning}=fixture(t);learning.saveMemory({botId:bot.id,scope:'bot',text:'Before'});const pending=learning.proposeMemory({botId:bot.id,scope:'bot',text:'After'}),save=learning.save.bind(learning);learning.save=()=>{throw Error('Disk unavailable');};assert.throws(()=>learning.accept(pending.id),/Disk unavailable/);assert.equal(learning.readMemory(bot.id,'bot'),'Before');assert.equal(learning.get(pending.id).status,'pending');learning.save=save;learning.accept(pending.id);assert.equal(learning.readMemory(bot.id,'bot'),'After');
});
