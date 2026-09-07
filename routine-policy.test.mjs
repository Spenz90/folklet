import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from './store.mjs';
import {normalizeRoutinePolicy,missedRunDecision,compareRoutineResult,routineSummary} from './routine-policy.mjs';
function make(t,policy={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'crew-routine-policy-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const store=new Store(root),bot=store.create({name:'Test'}),routine=store.routine({botId:bot.id,name:'Check',prompt:'Report the result',minutes:60,enabled:true,...policy});
 return {store,bot,routine};
}
function finish(store,task,result='Same result',status='completed',flags={},now=Date.now()){task.status=status;task.result=result;return store.completeRoutineTask(task,flags,now);}
test('routine policy defaults preserve one missed run and disable retries',()=>{
 assert.deepEqual(normalizeRoutinePolicy(),{missedRunPolicy:'run_once',notificationPolicy:'changes',retryLimit:0,retryDelayMinutes:1});
 for(const policy of [{missedRunPolicy:'all'},{retryLimit:4},{retryLimit:1.5},{retryDelayMinutes:0},{notificationPolicy:'silent'}])assert.throws(()=>normalizeRoutinePolicy(policy));
});
test('skip policy allows ordinary scheduling drift and skips a real missed run',t=>{
 const {store,routine}=make(t,{missedRunPolicy:'skip'}),at=routine.nextRun;
 assert.equal(missedRunDecision(routine,at+60000).run,true);assert.equal(store.due(at+60001).length,0);assert.match(routine.lastSkipped.reason,/policy/);assert.ok(routine.nextRun>at+60001);
 assert.equal(store.due(routine.nextRun+10000).length,1);
});
test('run-once policy coalesces a long backlog without duplicate active work',t=>{
 const {store,routine}=make(t),now=routine.nextRun+7*86400000;
 const [task]=store.due(now);assert.equal(task.retryAttempt,0);assert.equal(task.routineRunId,task.id);assert.equal(store.due(now).length,0);
 assert.equal(store.due(routine.nextRun).length,0);assert.match(routine.lastSkipped.reason,/still active/);
});
test('results notify on first success, changed text and recovery while unchanged runs stay quiet',t=>{
 const {store,routine}=make(t);let task=store.due(routine.nextRun)[0];
 assert.equal(finish(store,task).notification.title,'Routine completed');
 assert.equal(store.completeRoutineTask(task).notification,null);
 task=store.due(routine.nextRun)[0];assert.equal(finish(store,task,' Same\n result ').notification,null);assert.equal(routine.resultComparison.kind,'unchanged');
 task=store.due(routine.nextRun)[0];assert.equal(finish(store,task,'New result').notification.title,'Routine result changed');assert.equal(routine.resultComparison.previousSummary,'Same result');
 task=store.due(routine.nextRun)[0];assert.equal(finish(store,task,'','failed').notification.title,'Routine needs attention');
 task=store.due(routine.nextRun)[0];assert.equal(finish(store,task,'New result').notification.title,'Routine recovered');
});
test('every-run notification policy still reports unchanged results',t=>{
 const {store,routine}=make(t,{notificationPolicy:'all'});finish(store,store.due(routine.nextRun)[0]);
 assert.ok(finish(store,store.due(routine.nextRun)[0]).notification);
});
test('retries are bounded, back off, retain run identity and do not duplicate ordinary schedules',t=>{
 const {store,routine}=make(t,{retryLimit:2,retryDelayMinutes:1});let task=store.due(routine.nextRun)[0],now=routine.nextRun,original=task.id;
 const flags={retryable:true,assistantOutput:false,toolStarted:false};
 let outcome=finish(store,task,'','failed',flags,now);assert.equal(outcome.retryAt,now+60000);assert.equal(outcome.notification,null);
 assert.equal(store.due(now+59999).length,0);task=store.due(now+60000)[0];assert.equal(task.retryAttempt,1);assert.equal(task.retryOf,original);assert.equal(task.routineRunId,original);
 now+=60000;outcome=finish(store,task,'','failed',flags,now);assert.equal(outcome.retryAt,now+120000);
 task=store.due(now+120000)[0];assert.equal(task.retryAttempt,2);outcome=finish(store,task,'','failed',flags,now+120000);assert.equal(outcome.retryScheduled,false);assert.equal(routine.retry,null);assert.ok(outcome.notification);
});
test('answers, any tool use, permanent failure, interruption and unknown flags prevent automatic retries',t=>{
 const {store,routine}=make(t,{retryLimit:3});
 for(const [status,flags] of [['failed',{}],['failed',{retryable:true,assistantOutput:true,toolStarted:false}],['failed',{retryable:true,assistantOutput:false,toolStarted:true}],['failed',{retryable:false,assistantOutput:false,toolStarted:false}],['interrupted',{retryable:true,assistantOutput:false,toolStarted:false}]]){
  const task=store.due(routine.nextRun)[0];assert.equal(finish(store,task,'',status,flags).retryScheduled,false);assert.equal(routine.retry,null);
 }
});
test('pausing clears retries and reliability changes cannot activate proposed workflows',t=>{
 const {store,routine}=make(t,{retryLimit:2});const task=store.due(routine.nextRun)[0];finish(store,task,'','failed',{retryable:true,assistantOutput:false,toolStarted:false});assert.ok(routine.retry);
 store.setRoutineEnabled(routine.id,false);assert.equal(routine.retry,null);store.updateRoutinePolicy(routine.id,{retryLimit:3,missedRunPolicy:'skip'});assert.equal(routine.enabled,false);assert.match(store.routinePolicy(routine.id).nextExplanation,/Paused/);
 assert.equal(store.due(Date.now()+99999999).length,0);
});
test('legacy policies migrate safely and an interrupted run is never resumed as a retry',t=>{
 const {store,routine}=make(t);for(const key of ['retryLimit','retryDelayMinutes','missedRunPolicy','notificationPolicy'])delete routine[key];
 const task=store.due(routine.nextRun)[0];task.status='running';store.save();const restored=new Store(store.root),r=restored.db.routines[0];
 assert.equal(r.missedRunPolicy,'run_once');assert.equal(r.retryLimit,0);assert.equal(restored.db.tasks[0].status,'interrupted');assert.equal(r.retry,null);
});
test('invalid restored policies or schedules pause instead of looping or launching work',t=>{
 const {store,routine}=make(t);routine.retryLimit=100;store.save();assert.equal(new Store(store.root).db.routines[0].enabled,false);
 routine.retryLimit=0;routine.time='broken';routine.scheduleKind='daily';routine.enabled=true;assert.equal(store.due(routine.nextRun).length,0);assert.equal(routine.enabled,false);
});
test('result comparison and next-run explanations are bounded and do not mislabel retries as schedules',()=>{
 const first=compareRoutineResult(null,'x'.repeat(5000));assert.equal(first.summary.length,1600);assert.equal(first.hash.length,64);
 const r={enabled:true,nextRun:100000,minutes:60,retryLimit:1,retryDelayMinutes:2,retry:{at:90000,attempt:1}};
 const summary=routineSummary(r,80000);assert.equal(summary.nextRunAt,90000);assert.match(summary.nextExplanation,/Retry/);assert.match(summary.retryExplanation,/before any answer/);
});
