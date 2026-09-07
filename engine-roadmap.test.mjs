import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from './store.mjs';
import {Engine} from './engine.mjs';
const temporary=()=>Object.assign(Error('Request temporarily unavailable'),{status:503});
const gate=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
async function until(check){const deadline=Date.now()+2000;while(!check()){if(Date.now()>deadline)throw Error('Fixture did not settle');await new Promise(resolve=>setTimeout(resolve,2));}}
const terminal=task=>['completed','failed','interrupted','cancelled'].includes(task.status);
function harness(t,{apiRunner=async args=>args.onMessage('Complete'),getConnection=id=>({id,type:'custom',baseUrl:'http://127.0.0.1:1/v1',defaultModel:'default'})}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'crew-engine-roadmap-')),store=new Store(root),bot=store.create({name:'Fixture',role:'Do only the fixture task'});
 bot.providerId='primary';bot.model='preferred-model';bot.reasoningEffort='';bot.fallback={enabled:true,contentSharingApproved:true,choices:[{providerId:'backup',model:'backup-model',reasoningEffort:''}]};store.save();
 const engine=new Engine(store,{close:async()=>{}},{executable:'unused-fixture-engine',providers:{getConnection},apiRunner});clearInterval(engine.timer);engine.drain=()=>{};
 t.after(async()=>{await engine.close();fs.rmSync(root,{recursive:true,force:true});});
 return {engine,store,bot,task:()=>store.enqueue(bot.id,'An isolated fixture task')};
}
test('connection startup failure selects the approved fallback and preserves bot preferences',async t=>{
 const calls=[],h=harness(t,{getConnection:id=>{if(id==='primary')throw temporary();return {id,type:'custom'};},apiRunner:async args=>{calls.push(args);args.onMessage('Backup completed');}}),task=h.task();
 await h.engine.start(h.bot,task);await until(()=>terminal(task));
 assert.equal(task.status,'completed');assert.equal(task.result,'Backup completed');assert.equal(calls.length,1);assert.equal(calls[0].model,'backup-model');assert.equal(h.bot.providerId,'primary');assert.equal(h.bot.model,'preferred-model');assert.equal(h.bot.threadId,undefined);assert.equal(task.fallbackHistory[0].providerId,'primary');assert.equal(h.engine.taskRuns.size,0);assert.equal(h.engine.live.size,0);
});
test('pre-output API failure carries identical task input and tools to the approved alternate',async t=>{
 const calls=[],h=harness(t,{apiRunner:async args=>{calls.push(args);if(args.connection.id==='primary')throw temporary();args.onMessage('Done');}}),task=h.task();
 await h.engine.start(h.bot,task);await until(()=>terminal(task));assert.equal(task.status,'completed');assert.equal(calls.length,2);
 assert.deepEqual(calls[0].messages,calls[1].messages);assert.deepEqual(calls[0].tools,calls[1].tools);assert.equal(h.bot.messages.filter(m=>m.role==='user').length,1);assert.equal(h.bot.model,'preferred-model');
});
test('partial text or even a read-only tool prevents another API attempt',async t=>{
 for(const action of ['text','tool']){
  let calls=0;const h=harness(t,{apiRunner:async args=>{calls++;if(action==='text')args.onMessage('Partial answer');else await args.executeTool('crew_files',{action:'list'});throw temporary();}}),task=h.task();
  await h.engine.start(h.bot,task);await until(()=>terminal(task));assert.equal(calls,1);assert.equal(task.status,'failed');assert.match(task.fallbackStoppedReason,/Work already began/);assert.equal(h.engine.live.size,0);
 }
});
test('changed role or canonical notes stop fallback before content goes to another provider',async t=>{
 for(const kind of ['role','notes']){
  let notes='Original',calls=0;const h=harness(t,{apiRunner:async()=>{calls++;if(kind==='role')h.bot.role='Changed';else notes='Changed';throw temporary();}}),task=h.task();
  h.engine.learning={contextFor:()=>'',readMemory:()=>notes};await h.engine.start(h.bot,task);await until(()=>terminal(task));assert.equal(calls,1);assert.equal(task.status,'failed');assert.match(task.fallbackStoppedReason,/permissions or context changed/);
 }
});
test('a note-read failure settles task startup without opening any provider',async t=>{
 let calls=0;const h=harness(t,{apiRunner:async()=>{calls++;}}),task=h.task();h.engine.learning={contextFor:()=>'',readMemory(){throw Error('Notes need review');}};
 await h.engine.start(h.bot,task);assert.equal(task.status,'failed');assert.equal(calls,0);assert.equal(h.engine.starting.size,0);assert.equal(h.engine.taskRuns.size,0);
});
test('cancellation interrupts a running fallback and does not mutate the preferred connection',async t=>{
 const begun=gate();let calls=0;const h=harness(t,{apiRunner:async args=>{calls++;if(args.connection.id==='primary')throw temporary();begun.resolve();await new Promise((resolve,reject)=>args.signal.addEventListener('abort',()=>reject(Object.assign(Error('Stopped'),{name:'AbortError'})),{once:true}));}}),task=h.task();
 const starting=h.engine.start(h.bot,task);await begun.promise;await h.engine.interrupt(h.bot);await starting;await until(()=>terminal(task));assert.equal(task.status,'interrupted');assert.equal(calls,2);assert.equal(h.bot.providerId,'primary');assert.equal(h.engine.taskRuns.size,0);assert.equal(h.engine.live.size,0);
});
test('cancellation during fallback initialization clears its run and temporary connection',async t=>{
 const begun=gate(),release=gate();let calls=0;const h=harness(t,{apiRunner:async()=>{calls++;throw temporary();}}),initialize=h.engine.initialize.bind(h.engine),task=h.task();
 h.engine.initialize=async(b,l)=>{if(b.providerId==='backup'){begun.resolve();await release.promise;}return initialize(b,l);};
 await h.engine.start(h.bot,task);await begun.promise;await h.engine.interrupt(h.bot);assert.equal(task.status,'cancelled');release.resolve();await until(()=>h.engine.taskRuns.size===0&&h.engine.live.size===0);assert.equal(calls,1);assert.equal(h.bot.model,'preferred-model');
});
test('a dispatched Codex turn cannot replay through fallback after a transport failure',async t=>{
 let calls=0;const h=harness(t,{apiRunner:async()=>{calls++;}}),task=h.task();h.bot.providerId='codex';
 h.engine.connect=async b=>{const l={pending:new Map(),requests:new Map(),model:'preferred-model',proc:{kill(){},killed:false}};h.engine.live.set(b.id,l);return l;};
 h.engine.rpc=async()=>{throw temporary();};await h.engine.start(h.bot,task);assert.equal(task.status,'failed');assert.equal(calls,0);assert.match(task.fallbackStoppedReason,/Work already began/);assert.equal(h.engine.live.size,0);
});
test('routine completion suppresses unchanged answers while preserving ordinary chat notifications',async t=>{
 const h=harness(t),routine=h.store.routine({botId:h.bot.id,prompt:'Scheduled fixture',minutes:60,enabled:true});h.bot.fallback={enabled:false};
 for(let i=0;i<2;i++){const task=h.store.due(routine.nextRun)[0];await h.engine.start(h.bot,task);await until(()=>terminal(task));}
 assert.equal(h.store.db.notifications.length,1);assert.equal(routine.resultComparison.kind,'unchanged');
 const chat=h.task();await h.engine.start(h.bot,chat);assert.equal(h.store.db.notifications.length,2);
});
test('routine failure schedules a retry only before output or tools and final failure notifies',async t=>{
 let calls=0;const h=harness(t,{apiRunner:async()=>{calls++;throw temporary();}}),r=h.store.routine({botId:h.bot.id,prompt:'Scheduled fixture',minutes:60,enabled:true,retryLimit:1,retryDelayMinutes:1});h.bot.fallback={enabled:false};
 let task=h.store.due(r.nextRun)[0];await h.engine.start(h.bot,task);await until(()=>terminal(task));assert.ok(r.retry);assert.equal(h.store.db.notifications.length,0);
 task=h.store.due(r.retry.at)[0];await h.engine.start(h.bot,task);await until(()=>terminal(task));assert.equal(calls,2);assert.equal(r.retry,null);assert.equal(h.store.db.notifications.length,1);assert.equal(h.store.db.notifications[0].title,'Routine needs attention');
});
