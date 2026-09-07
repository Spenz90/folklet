import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {Engine,crewTools} from './engine.mjs';
import {Store} from './store.mjs';
import {Learning} from './learning.mjs';
import {Skills} from './skills.mjs';
import {Recall} from './recall.mjs';

// The in-memory store and disconnected processes keep these tests independent
// of the running app, saved user data, Codex accounts, and network access.
function harness(t,options={}){
 let next=0;
 const store={
  root:'.',db:{bots:[],tasks:[],routines:[],channels:[],notifications:[]},
  save(){},due(){},
  bot(id){const b=this.db.bots.find(x=>x.id===id&&!x.archived);if(!b)throw Error('Bot not found');return b;},
  enqueue(botId,prompt,extra={}){this.bot(botId);const task={id:'task-'+ ++next,botId,prompt,status:'queued',depth:0,...extra};this.db.tasks.push(task);return task;},
  notify(botId,title,text,taskId){this.db.notifications.push({botId,title,text,taskId});},
  message(b,role,text,extra={}){b.messages.push({role,text,...extra});},
  event(b,event){const old=b.events.find(x=>x.id===event.id);if(old)Object.assign(old,event);else b.events.push(event);}
 };
 const computers={async close(){},async act(){throw Error('Unexpected browser action');}};
 const engine=new Engine(store,computers,{executable:'test-only-engine',...options});
 clearInterval(engine.timer);
 engine.drain=()=>{};
 t.after(async()=>{await engine.close();});
 function bot(id){const b={id,name:id,role:'Helper',cwd:'.',messages:[],events:[]};store.db.bots.push(b);return b;}
 function running(b,task=store.enqueue(b.id,'Do useful work')){
  task.status='running';
  const live={task,status:'Working',activity:'',approval:null,requests:new Map(),pending:new Map(),proc:{kill(){},killed:false,stdin:{write(){}}}};
  engine.live.set(b.id,live);return live;
 }
 function finish(b,live,status='completed',error){engine.closing=true;engine.finish(b,live,status,error);engine.closing=false;}
 return {engine,store,bot,running,finish};
}
const decoded=items=>JSON.parse(items[0].text);
const nextTick=()=>new Promise(resolve=>setImmediate(resolve));

test('retired turns cannot write messages, finish a newer task or request side effects on a reused connection',async t=>{
 const {engine,store,bot,running,finish}=harness(t),b=bot('Scout'),live=running(b);b.threadId='thread-active';live.turnId='turn-old';finish(b,live);const next=store.enqueue(b.id,'New work');next.status='running';live.task=next;live.turnId='turn-new';live.status='Working';
 engine.event(b,live,{method:'item/agentMessage/delta',params:{threadId:b.threadId,turnId:'turn-old',itemId:'old-message',delta:'Stale text'}});engine.event(b,live,{method:'turn/started',params:{threadId:b.threadId,turn:{id:'turn-old'}}});engine.event(b,live,{method:'turn/completed',params:{threadId:b.threadId,turn:{id:'turn-old',status:'completed'}}});
 assert.equal(next.status,'running');assert.equal(live.turnId,'turn-new');assert.equal(b.messages.length,0);
 let actions=0;engine.computers.act=async()=>{actions++;return {image:''};};await assert.rejects(engine.request(b,live,{id:17,method:'item/tool/call',params:{threadId:b.threadId,turnId:'turn-old',tool:'crew_browser',arguments:{action:'click',name:'Send'}}}),/no longer active/);assert.equal(actions,0);
 live.turnId=null;engine.event(b,live,{method:'turn/completed',params:{threadId:b.threadId,turn:{id:'turn-old',status:'completed'}}});assert.equal(next.status,'running','A retired turn also stays ignored while the next turn is still starting');
 finish(b,live);await assert.rejects(engine.dynamic(b,live,'crew_browser',{action:'click',name:'Send'}),/no longer active/);assert.equal(actions,0);
});

test('unidentified or wrong-thread turn traffic cannot affect a newer task on a reused connection',async t=>{
 const {engine,store,bot,running,finish}=harness(t),b=bot('Scout'),live=running(b);b.threadId='thread-active';live.turnId='turn-old';finish(b,live);
 const next=store.enqueue(b.id,'New work');next.status='running';live.task=next;live.turnId='turn-new';live.status='Working';
 const invalid=[{}, {threadId:b.threadId}, {turnId:'turn-new'}, {threadId:'another-thread',turnId:'turn-new'}];
 let actions=0;engine.computers.act=async()=>{actions++;return {image:''};};
 for(const identity of invalid){
  engine.event(b,live,{method:'item/agentMessage/delta',params:{...identity,itemId:'stale-message',delta:'Stale text'}});
  await assert.rejects(engine.request(b,live,{id:17,method:'item/tool/call',params:{...identity,tool:'crew_browser',arguments:{action:'click',name:'Send'}}}),/no longer active/);
 }
 engine.event(b,live,{method:'turn/completed',params:{threadId:b.threadId,turn:{status:'completed'}}});
 assert.equal(actions,0);assert.equal(next.status,'running');assert.equal(live.turnId,'turn-new');assert.equal(b.messages.length,0);
 engine.event(b,live,{method:'item/agentMessage/delta',params:{threadId:b.threadId,turnId:'turn-new',itemId:'current-message',delta:'Current answer'}});
 assert.equal(b.messages[0].text,'Current answer');assert.equal(b.messages[0].taskId,next.id);
});

test('thread-scoped MCP elicitation requires the matching connection and task through the user answer',async t=>{
 const {engine,store,bot,running,finish}=harness(t),b=bot('Scout'),live=running(b);b.threadId='thread-active';live.turnId='turn-active';const replies=[];engine.reply=(connection,id,result)=>replies.push({connection,id,result});
 const request=id=>({id,method:'mcpServer/elicitation/request',params:{threadId:b.threadId,serverName:'fixture',turnId:null,message:'Choose fixture input',mode:'form',requestedSchema:{type:'object',properties:{}}}});
 const accepted=engine.request(b,live,request(1));assert.equal(live.approval.kind,'elicitation');engine.answer(b,live.approval.id,'{"choice":"fixture"}');await accepted;assert.equal(replies[0].result.action,'accept');
 await assert.rejects(engine.request(b,live,{...request(2),params:{...request(2).params,threadId:'wrong-thread'}}),/no longer active/);assert.equal(live.approval,null);
 const racing=assert.rejects(engine.request(b,live,request(3)),/no longer active/);engine.answer(b,live.approval.id,'{"choice":"stale"}');finish(b,live);live.task=store.enqueue(b.id,'Next task');live.task.status='running';live.turnId='turn-next';await racing;assert.equal(replies.length,1,'An answer cannot carry over to the replacement task');
});

test('handoff checks cannot bypass private recall and recheck sharing after a wait',async t=>{
 const {engine,store,bot,running,finish}=harness(t),a=bot('Scout'),b=bot('Writer'),live=running(a),privateTask=store.enqueue(b.id,'Private task');privateTask.status='completed';privateTask.result='Private result';
 await assert.rejects(engine.dynamic(a,live,'crew_team',{action:'check',taskId:privateTask.id}),/unavailable/);
 const delegated=store.enqueue(b.id,'Delegated task',{parentId:live.task.id});delegated.status='completed';delegated.result='Delegated result';assert.equal(decoded(await engine.dynamic(a,live,'crew_team',{action:'check',taskId:delegated.id})).result,'Delegated result');
 const current=live.task;finish(a,live);live.task=store.enqueue(a.id,'Later task');live.task.status='running';assert.equal(decoded(await engine.dynamic(a,live,'crew_team',{action:'check',taskId:delegated.id})).result,'Delegated result');assert.equal(current.status,'completed');
 const shared=store.enqueue(b.id,'Shared task',{channelId:'shared'}),writer=running(b,shared);store.db.channels.push({id:'shared',members:[a.id,b.id]});await assert.rejects(engine.dynamic(a,live,'crew_team',{action:'check',taskId:shared.id}),/unavailable/);a.recallShared=true;
 const waiting=assert.rejects(engine.dynamic(a,live,'crew_team',{action:'check',taskId:shared.id,waitForResult:true}),/no longer shared/);a.recallShared=false;finish(b,writer);await waiting;
});

test('a stopped turn completing before its start reply is still retired before later work',t=>{
 const {engine,store,bot,running}=harness(t),b=bot('Scout'),live=running(b),old=live.task;b.threadId='thread-active';old.cancelRequested=true;live.turnId=null;
 engine.event(b,live,{method:'turn/completed',params:{threadId:b.threadId,turn:{id:'early-completion',status:'interrupted'}}});assert.equal(old.status,'interrupted');assert.ok(live.finishedTurns.has('early-completion'));
 const next=store.enqueue(b.id,'Later work');next.status='running';live.task=next;engine.event(b,live,{method:'turn/completed',params:{threadId:b.threadId,turn:{id:'early-completion',status:'interrupted'}}});assert.equal(next.status,'running');
});

test('background storage failures stop active work and remain visible without escaping the scheduler',async t=>{
 const {engine,store,bot,running}=harness(t),b=bot('Scout'),live=running(b);let killed=0;live.proc.kill=()=>{killed++;};store.due=()=>{throw Error('Fixture data disk is full');};
 assert.doesNotThrow(()=>engine.tick());assert.equal(live.task,null);assert.equal(store.db.tasks[0].status,'interrupted');assert.equal(killed,1);assert.match(engine.status(b).activity,/disk is full/);assert.equal(engine.status(b).status,'Needs attention');
 store.due=()=>{};engine.tick();assert.equal(engine.backgroundError,'');assert.equal(store.db.tasks[0].status,'interrupted','Restoring storage must not automatically replay an uncertain task');
});

test('a failed initial task save releases the start lock and reports a recoverable background failure',async t=>{
 const {engine,store,bot}=harness(t),b=bot('Scout'),task=store.enqueue(b.id,'Never dispatched');let connections=0;engine.connect=async()=>{connections++;throw Error('Should not connect');};store.save=()=>{throw Error('Fixture write denied');};
 // Exercise the same rejected-start containment used by the production queue.
 engine.drain=Engine.prototype.drain.bind(engine);assert.doesNotThrow(()=>engine.drain());await nextTick();assert.equal(engine.starting.has(b.id),false);assert.equal(connections,0);assert.match(engine.backgroundError,/write denied/);
});

test('a real protocol-stream persistence failure retires the connection instead of crashing or continuing tools',async t=>{
 const {engine,store,b,live:unused}=reviewedTools(t),mock=mockCodex();unused.task.status='completed';engine.live.delete(b.id);engine.spawnProcess=()=>mock.proc;
 const task=store.enqueue(b.id,'Fixture streamed answer');await engine.start(b,task);const live=engine.live.get(b.id),rename=fs.renameSync;fs.renameSync=(from,to)=>{if(to===store.file)throw Error('Fixture write denied');return rename(from,to);};
 try{assert.doesNotThrow(()=>mock.proc.stdout.write(JSON.stringify({method:'item/agentMessage/delta',params:{threadId:b.threadId,turnId:live.turnId,itemId:'fixture-message',delta:'Partial fixture answer'}})+'\n'));}finally{fs.renameSync=rename;}
 assert.equal(mock.proc.killed,true);assert.equal(engine.live.has(b.id),false);assert.equal(task.status,'interrupted');assert.match(engine.backgroundError,/could not save/);assert.equal(b.messages.some(message=>message.id==='fixture-message'),false);assert.equal(engine.taskRuns.size,0);
});

for(const failingWrite of [1,2])test(`completion write ${failingWrite} failure interrupts the owned task before any waiter or channel receives success`,async t=>{
 const {engine,store,b,other,live:unused}=reviewedTools(t),mock=mockCodex();unused.task.status='completed';engine.live.delete(b.id);engine.spawnProcess=()=>mock.proc;
 const task=store.enqueue(b.id,'Fixture completed answer');await engine.start(b,task);const live=engine.live.get(b.id),parent=store.enqueue(other.id,'Wait for fixture');parent.status='running';store.save();
 const waiting=engine.waitForTask(task,{task:parent}),notifications=[];engine.notifyChannel=event=>notifications.push(event);
 const rename=fs.renameSync;let commits=0;fs.renameSync=(from,to)=>{if(to===store.file&&++commits===failingWrite)throw Error('Fixture completion commit denied');return rename(from,to);};
 try{assert.doesNotThrow(()=>mock.proc.stdout.write(JSON.stringify({method:'turn/completed',params:{threadId:b.threadId,turn:{id:live.turnId,status:'completed'}}})+'\n'));}finally{fs.renameSync=rename;}
 const result=await waiting;assert.equal(result.status,'interrupted');assert.equal(task.status,'interrupted');assert.equal(live.task,null);assert.equal(engine.live.has(b.id),false);assert.equal(mock.proc.killed,true);assert.equal(engine.taskRuns.has(task.id),false);assert.equal(engine.taskWaiters.size,0);assert.match(engine.backgroundError,/could not save/);assert.equal(notifications.length,0);
});

test('accepted learning is refreshed for each task on an existing Codex connection',async t=>{
 const mock=mockCodex(),{engine,store,bot}=harness(t,{spawnProcess:()=>mock.proc}),b=bot('Learner');let context='Earlier preference';
 engine.learning={contextFor:()=>context};await engine.connect(b);context='Newly accepted preference';
 const task=store.enqueue(b.id,'Use my preferences');await engine.start(b,task);
 const turn=mock.calls.find(call=>call.method==='turn/start');assert.match(turn.params.input[0].text,/Newly accepted preference/);
 const persistent=mock.calls.find(call=>call.method==='thread/start').params.developerInstructions;assert.doesNotMatch(persistent,/Earlier preference|Newly accepted preference/);assert.match(persistent,/snapshot replaces every earlier/);
});

test('undoing learning and disabling skills replaces their active snapshots on the same Codex thread',async t=>{
 const {engine,store,b,live:unused}=reviewedTools(t),mock=mockCodex();unused.task.status='completed';engine.live.delete(b.id);engine.spawnProcess=()=>mock.proc;
 const preference=engine.learning.propose({botId:b.id,kind:'preference',title:'Brief fixture',text:'Keep fixture reports under four sentences.'});engine.learning.accept(preference.id);
 const skill=engine.skills.propose({title:'Fixture report procedure',whenToUse:'For fixture reports',steps:['Read the supplied fixture'],examples:[],checklist:['Confirm the fixture result']});engine.skills.accept(skill.skillId,skill.revisionId);engine.skills.setEnabled(skill.skillId,b.id,true);
 await engine.connect(b);const persistent=mock.calls.find(call=>call.method==='thread/start').params.developerInstructions;assert.doesNotMatch(persistent,/Keep fixture reports|Fixture report procedure/);
 const first=store.enqueue(b.id,'First fixture report');await engine.start(b,first);const connected=engine.live.get(b.id),firstInput=mock.calls.filter(call=>call.method==='turn/start').at(-1).params.input[0].text;
 assert.match(firstInput,/Keep fixture reports under four sentences/);assert.match(firstInput,/Fixture report procedure/);
 engine.closing=true;engine.finish(b,connected,'completed');engine.closing=false;engine.learning.undo(preference.id);engine.skills.setEnabled(skill.skillId,b.id,false);
 const second=store.enqueue(b.id,'Second fixture report');await engine.start(b,second);const turns=mock.calls.filter(call=>call.method==='turn/start'),secondInput=turns.at(-1).params.input[0].text;
 assert.equal(engine.live.get(b.id),connected);assert.equal(mock.calls.filter(call=>call.method==='thread/start').length,1);assert.equal(turns[0].params.threadId,turns[1].params.threadId);
 assert.match(secondInput,/Accepted learning:\nNone\. No learned preferences or workflows are currently active/);assert.match(secondInput,/Enabled skills:\nNone\. No skills are currently enabled/);assert.match(secondInput,/replaces earlier learned preferences/);assert.doesNotMatch(secondInput,/Keep fixture reports under four sentences|Fixture report procedure/);
});

function mockCodex({holdInitialize=false,holdTurn=false,holdModels=false,resumeError=null,startError=null,turnError=null,signedIn=true,models=[{id:'test-model',model:'test-model',defaultReasoningEffort:'medium',supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'medium'},{reasoningEffort:'high'},{reasoningEffort:'ultra'}]}]}={}){
 const proc=new EventEmitter(),calls=[];
 proc.stdout=new PassThrough();proc.stderr=new PassThrough();proc.killed=false;
 const reply=(request,result,error)=>proc.stdout.write(JSON.stringify({id:request.id,...(error?{error:{message:error}}:{result})})+'\n');
 proc.stdin=new Writable({write(chunk,encoding,done){
  for(const line of String(chunk).trim().split('\n')){
   const request=JSON.parse(line);calls.push(request);
   if(request.id===undefined)continue;
   if(request.method==='initialize'&&holdInitialize)continue;
   if(request.method==='turn/start'&&holdTurn)continue;
   if(request.method==='model/list'&&holdModels)continue;
   const threadError=request.method==='thread/resume'?resumeError:request.method==='thread/start'?startError:request.method==='turn/start'?turnError:null;
   if(threadError){queueMicrotask(()=>reply(request,null,threadError));continue;}
   const result=request.method==='account/read'?(signedIn?{account:{type:'chatgpt'}}:{account:null,requiresOpenaiAuth:true}):
    request.method==='thread/start'||request.method==='thread/resume'?{thread:{id:'thread-ready'},model:'test-model',reasoningEffort:'medium'}:
    request.method==='turn/start'?{turn:{id:'turn-ready'}}:
    request.method==='model/list'?{data:models,nextCursor:null}:{};
   queueMicrotask(()=>reply(request,result));
  }
  done();
 }});
 proc.kill=()=>{if(proc.killed)return;proc.killed=true;proc.emit('exit');proc.stdout.end();proc.stderr.end();proc.stdin.end();};
 return {proc,calls,reply};
}

test('model discovery and task start share one complete Codex initialization',async t=>{
 const mock=mockCodex({holdInitialize:true});let spawned=0;
 const {engine,store,bot}=harness(t,{spawnProcess:()=>{spawned++;return mock.proc;}}),b=bot('Scout');
 const first=engine.connect(b),second=engine.connect(b);
 assert.equal(first,second,'Concurrent connections must share the same pending promise');
 let modelReady=false;
 const models=second.then(live=>engine.rpc(live,'model/list')).then(result=>{modelReady=true;return result;});
 const task=store.enqueue(b.id,'Build the report'),starting=engine.start(b,task);
 await nextTick();
 assert.equal(spawned,1);
 assert.equal(modelReady,false);
 assert.deepEqual(mock.calls.map(x=>x.method),['initialize']);
 assert.equal(b.threadId,undefined);
 mock.reply(mock.calls[0],{});
 await Promise.all([models,starting]);
 const live=await first;
 assert.equal(live.task,task);
 assert.equal(live.turnId,'turn-ready');
 assert.equal(b.threadId,'thread-ready');
 assert.equal(spawned,1);
 const methods=mock.calls.map(x=>x.method);
 assert.equal(methods.filter(x=>x==='thread/start').length,1);
 assert.ok(methods.indexOf('model/list')>methods.indexOf('thread/start'));
 assert.ok(methods.indexOf('turn/start')>methods.indexOf('thread/start'));
 assert.equal(mock.calls.find(x=>x.method==='turn/start').params.threadId,'thread-ready');
 assert.equal(live.pending.size,0);
});

test('Codex reasoning selection uses supported catalog values and reuses metadata across tasks',async t=>{
 const mock=mockCodex(),{engine,store,bot,finish}=harness(t,{spawnProcess:()=>mock.proc}),b=bot('Reasoner');b.reasoningEffort='high';
 const first=store.enqueue(b.id,'First task');await engine.start(b,first);const live=engine.live.get(b.id);
 assert.equal(mock.calls.find(call=>call.method==='turn/start').params.effort,'high');
 assert.equal(engine.status(b).reasoningEffort,'high');assert.equal(engine.status(b).effectiveReasoningEffort,'high');
 finish(b,live);b.reasoningEffort='ultra';const second=store.enqueue(b.id,'Second task');await engine.start(b,second);
 assert.equal(mock.calls.filter(call=>call.method==='model/list').length,1);
 assert.equal(mock.calls.filter(call=>call.method==='turn/start').at(-1).params.effort,'ultra');
});

test('Default omits Codex effort on a fresh thread and reports the actual thread default separately',async t=>{
 const mock=mockCodex(),{engine,store,bot}=harness(t,{spawnProcess:()=>mock.proc}),b=bot('Default reasoning');b.reasoningEffort='';
 await engine.start(b,store.enqueue(b.id,'Use the model default'));
 const turn=mock.calls.find(call=>call.method==='turn/start');assert.equal(Object.hasOwn(turn.params,'effort'),false);
 assert.equal(mock.calls.some(call=>call.method==='model/list'),false);
 assert.equal(engine.status(b).reasoningEffort,'');assert.equal(engine.status(b).effectiveReasoningEffort,'medium');
 // The settings endpoint clears threadId/toolVersion before switching an
 // explicit effort back to Default; omitting effort on a reused thread is sticky.
});

test('Codex rejects unsupported reasoning and absent model metadata before starting generation',async t=>{
 for(const models of [[{id:'test-model',supportedReasoningEfforts:[{reasoningEffort:'low'}]}],[]]){
  const mock=mockCodex({models}),{engine,store,bot}=harness(t,{spawnProcess:()=>mock.proc}),b=bot('Unsupported');b.reasoningEffort='high';
  const task=store.enqueue(b.id,'Should not run');await engine.start(b,task);
  assert.equal(task.status,'failed');assert.match(task.error,/reasoning level is unavailable/);
  assert.equal(mock.calls.some(call=>call.method==='turn/start'),false);
 }
});

test('a prior model picker RPC seeds the Codex reasoning cache and paginated metadata is completed',async t=>{
 const mock=mockCodex({holdModels:true}),{engine,store,bot}=harness(t,{spawnProcess:()=>mock.proc}),b=bot('Paged');b.reasoningEffort='high';
 const live=await engine.connect(b),catalog=engine.rpc(live,'model/list',{limit:1,includeHidden:false});await nextTick();
 mock.reply(mock.calls.at(-1),{data:[{id:'other-model',supportedReasoningEfforts:[]}],nextCursor:'next'});await catalog;
 const running=engine.start(b,store.enqueue(b.id,'Use the second model'));await nextTick();
 const firstPage=mock.calls.at(-1);assert.equal(firstPage.method,'model/list');
 mock.reply(firstPage,{data:[{id:'other-model',supportedReasoningEfforts:[]}],nextCursor:'next'});await nextTick();
 const nextPage=mock.calls.at(-1);assert.equal(nextPage.params.cursor,'next');
 mock.reply(nextPage,{data:[{id:'test-model',supportedReasoningEfforts:[{reasoningEffort:'high'}]}],nextCursor:null});await running;
 assert.equal(mock.calls.at(-1).method,'turn/start');assert.equal(mock.calls.at(-1).params.effort,'high');
});

test('stopping during Codex reasoning discovery prevents a later turn and settles the task',async t=>{
 const mock=mockCodex({holdModels:true}),{engine,store,bot}=harness(t,{spawnProcess:()=>mock.proc}),b=bot('Stopped');b.reasoningEffort='high';
 const task=store.enqueue(b.id,'Will stop'),running=engine.start(b,task);await nextTick();await engine.interrupt(b);
 const request=mock.calls.find(call=>call.method==='model/list');mock.reply(request,{data:[{id:'test-model',supportedReasoningEfforts:[{reasoningEffort:'high'}]}],nextCursor:null});await running;
 assert.equal(task.status,'interrupted');assert.equal(mock.calls.some(call=>call.method==='turn/start'),false);assert.equal(engine.live.get(b.id).task,null);
});

test('API reasoning passes selected level and provider model metadata through the adapter',async t=>{
 const received=[],metadata={id:'test-api-model',supportedParameters:['reasoning']};
 const {engine,store,bot}=harness(t,{providers:{getConnection:()=>({type:'openrouter',defaultModel:'test-api-model'}),modelMetadata:async(id,model,{signal})=>{assert.equal(id,'api');assert.equal(model,'test-api-model');assert.equal(signal.aborted,false);return metadata;}},apiRunner:async options=>{received.push(options);return {text:'Done'};}}),b=bot('API reasoning');b.providerId='api';b.reasoningEffort='high';
 const task=store.enqueue(b.id,'Use the chosen reasoning');await engine.start(b,task);
 assert.equal(task.status,'completed');assert.equal(received[0].reasoningEffort,'high');assert.equal(received[0].modelMetadata,metadata);
});

test('stopping during API reasoning metadata lookup never starts the model request',async t=>{
 let resolveMetadata,called=false;
 const {engine,store,bot}=harness(t,{providers:{getConnection:()=>({type:'openrouter',defaultModel:'test-api-model'}),modelMetadata:()=>new Promise(resolve=>{resolveMetadata=resolve;})},apiRunner:async()=>{called=true;}}),b=bot('API stopped');b.providerId='api';b.reasoningEffort='high';
 const task=store.enqueue(b.id,'Will stop'),running=engine.start(b,task);await nextTick();await engine.interrupt(b);resolveMetadata({});await running;
 assert.equal(task.status,'interrupted');assert.equal(called,false);
});

test('concurrent callers see the same initialization failure and a later retry reconnects',async t=>{
 const failed=mockCodex({holdInitialize:true}),retry=mockCodex();let spawned=0;
 const {engine,bot}=harness(t,{spawnProcess:()=>++spawned===1?failed.proc:retry.proc}),b=bot('Scout');
 const first=engine.connect(b),second=engine.connect(b),checked=Promise.all([assert.rejects(first,/Initialization refused/),assert.rejects(second,/Initialization refused/)]);
 await nextTick();failed.reply(failed.calls[0],null,'Initialization refused');
 await checked;
 assert.equal(engine.live.has(b.id),false);
 assert.equal(failed.proc.killed,true);
 const live=await engine.connect(b);
 assert.equal(live.status,'Ready');
 assert.equal(spawned,2);
 assert.equal(b.threadId,'thread-ready');
});

test('a fresh signed-out workspace shows sign-in guidance without starting a model turn',async t=>{
 const mock=mockCodex({signedIn:false}),{engine,store,bot}=harness(t,{spawnProcess:()=>mock.proc}),b=bot('Scout');
 const task=store.enqueue(b.id,'My first task');await engine.start(b,task);
 assert.equal(task.status,'failed');assert.match(task.error,/My workspace → Connections → ChatGPT/);assert.equal(mock.proc.killed,true);
 assert.equal(mock.calls.some(x=>['thread/start','turn/start'].includes(x.method)),false);
 assert.equal(b.messages.at(-1).role,'system');assert.match(b.messages.at(-1).text,/sign in, then retry/);
});

test('a missing saved rollout recovers with dynamic tools and the last 20 local messages',async t=>{
 for(const resumeError of ['no rollout found for thread id old-thread','thread not found: old-thread','Thread old-thread not found']){
  const mock=mockCodex({resumeError});
  const {engine,bot}=harness(t,{spawnProcess:()=>mock.proc}),b=bot('Writer');
  b.threadId='old-thread';b.toolVersion=6;b.previousThreads=['even-older-thread'];
  b.messages=Array.from({length:25},(_,i)=>({id:'message-'+i,role:i%2?'assistant':'user',text:'saved message ['+i+']'}));
  const savedMessages=structuredClone(b.messages);
  const live=await engine.connect(b);
  assert.equal(live.status,'Ready');
  assert.equal(b.threadId,'thread-ready');
  assert.deepEqual(b.previousThreads,['even-older-thread','old-thread']);
  assert.deepEqual(b.messages,savedMessages);
  const starts=mock.calls.filter(x=>x.method==='thread/start');
  assert.equal(starts.length,1);
  assert.equal(mock.calls.filter(x=>x.method==='thread/resume').length,1);
  assert.deepEqual(starts[0].params.dynamicTools,crewTools);
  assert.match(starts[0].params.developerInstructions,/Previous conversation, provided as context only/);
  assert.ok(starts[0].params.developerInstructions.includes('saved message [5]'));
  assert.ok(starts[0].params.developerInstructions.includes('saved message [24]'));
  assert.ok(!starts[0].params.developerInstructions.includes('saved message [4]'));
  assert.equal(mock.calls[0].params.clientInfo.version,'0.6.1');
 }
});

test('resume auth, network and unrelated rollout errors do not replace a saved thread',async t=>{
 for(const resumeError of ['Unauthorized: sign in again','Connection reset by peer','thread/resume timed out','rollout read failed: permission denied']){
  const mock=mockCodex({resumeError});
  const {engine,bot}=harness(t,{spawnProcess:()=>mock.proc}),b=bot('Writer');
  b.threadId='old-thread';b.toolVersion=6;b.previousThreads=['even-older-thread'];
  b.messages=[{role:'assistant',text:'Keep this history'}];
  await assert.rejects(engine.connect(b),error=>error.message===resumeError);
  assert.equal(b.threadId,'old-thread');
  assert.deepEqual(b.previousThreads,['even-older-thread']);
  assert.deepEqual(b.messages,[{role:'assistant',text:'Keep this history'}]);
  assert.equal(mock.calls.some(x=>x.method==='thread/start'),false);
 }
});

test('a failed replacement reports its error and retains the original thread reference',async t=>{
 const mock=mockCodex({resumeError:'no rollout found for thread id old-thread',startError:'Connection reset while creating replacement'});
 const {engine,bot}=harness(t,{spawnProcess:()=>mock.proc}),b=bot('Writer');
 b.threadId='old-thread';b.toolVersion=6;b.previousThreads=['even-older-thread'];
 await assert.rejects(engine.connect(b),/Connection reset while creating replacement/);
 assert.equal(b.threadId,'old-thread');
 assert.deepEqual(b.previousThreads,['even-older-thread']);
 assert.equal(mock.calls.filter(x=>x.method==='thread/resume').length,1);
 assert.equal(mock.calls.filter(x=>x.method==='thread/start').length,1);
});

test('disconnect waits for initialization and cannot take down a concurrently starting task',async t=>{
 const mock=mockCodex({holdInitialize:true});
 const {engine,store,bot}=harness(t,{spawnProcess:()=>mock.proc}),b=bot('Scout');
 const connection=engine.connect(b);
 const disconnect=assert.rejects(engine.disconnect(b),/Stop or finish/);
 const task=store.enqueue(b.id,'A real task'),starting=engine.start(b,task);
 await nextTick();mock.reply(mock.calls[0],{});
 await Promise.all([connection,disconnect,starting]);
 assert.equal(mock.proc.killed,false);
 assert.equal(engine.live.get(b.id).task,task);
});

test('disconnect promptly rejects an outstanding RPC instead of leaving its timeout alive',async t=>{
 const mock=mockCodex({holdTurn:true});
 const {engine,bot}=harness(t,{spawnProcess:()=>mock.proc}),b=bot('Scout');
 const live=await engine.connect(b);
 const pending=assert.rejects(engine.rpc(live,'turn/start',{threadId:b.threadId}),/disconnected/);
 await engine.disconnect(b);
 await pending;
 assert.equal(live.pending.size,0);
 assert.equal(mock.proc.killed,true);
 assert.equal(engine.live.has(b.id),false);
});

test('a failed turn start closes the uncertain session and retry gets a fresh connection',async t=>{
 const failed=mockCodex({turnError:'turn/start timed out'}),retry=mockCodex();let spawned=0;
 const {engine,store,bot}=harness(t,{spawnProcess:()=>++spawned===1?failed.proc:retry.proc}),b=bot('Scout');
 const first=store.enqueue(b.id,'The failed task');await engine.start(b,first);
 assert.equal(first.status,'failed');assert.equal(failed.proc.killed,true);assert.equal(engine.live.has(b.id),false);
 const second=store.enqueue(b.id,'The next task');await engine.start(b,second);
 assert.equal(spawned,2);assert.equal(engine.live.get(b.id).task,second);assert.equal(second.status,'running');
});

test('a synchronous transport write failure releases the RPC timer and pending entry',async t=>{
 const {engine,bot,running}=harness(t),b=bot('Scout'),live=running(b);live.seq=0;
 live.proc.stdin.write=()=>{throw Error('Pipe closed');};
 await assert.rejects(engine.rpc(live,'model/list'),/Pipe closed/);assert.equal(live.pending.size,0);
});

test('late notifications from a retired connection cannot overwrite the new task',async t=>{
 const {engine,store,bot,running}=harness(t),b=bot('Scout'),retired=running(b),live=running(b);
 engine.event(b,retired,{method:'item/agentMessage/delta',params:{itemId:'old-message',delta:'Obsolete reply'}});
 engine.event(b,retired,{method:'turn/completed',params:{turn:{status:'completed'}}});
 assert.equal(b.messages.length,0);assert.equal(live.task.status,'running');assert.equal(store.db.notifications.length,0);
});

test('stop during initialization cancels the task before any turn is sent',async t=>{
 const mock=mockCodex({holdInitialize:true});
 const {engine,store,bot}=harness(t,{spawnProcess:()=>mock.proc}),b=bot('Scout'),task=store.enqueue(b.id,'Do not start after Stop');
 const starting=engine.start(b,task);
 await nextTick();
 await engine.interrupt(b);
 assert.equal(task.status,'cancelled');
 mock.reply(mock.calls[0],{});
 await starting;
 assert.equal(mock.calls.some(x=>x.method==='turn/start'),false);
 assert.equal(engine.live.get(b.id).task,undefined);
 assert.equal(engine.starting.size,0);
});

test('stop while turn/start is pending interrupts as soon as its turn ID arrives',async t=>{
 const mock=mockCodex({holdTurn:true});
 const {engine,store,bot}=harness(t,{spawnProcess:()=>mock.proc}),b=bot('Scout'),task=store.enqueue(b.id,'Start then stop');
 const starting=engine.start(b,task);
 await nextTick();
 const request=mock.calls.find(x=>x.method==='turn/start');assert.ok(request);
 await engine.interrupt(b);
 assert.equal(task.cancelRequested,true);
 mock.reply(request,{turn:{id:'late-turn'}});
 await starting;
 assert.equal(mock.calls.find(x=>x.method==='turn/interrupt')?.params.turnId,'late-turn');
 assert.equal(engine.live.get(b.id).status,'Stopping');
});

test('Stop wins before an approved browser action resumes',async t=>{
 const {engine,bot,running}=harness(t),b=bot('Scout'),live=running(b);let actions=0;
 engine.computers.act=async()=>{actions++;return {};};
 const action=engine.dynamic(b,live,'crew_browser',{action:'click',name:'Send',requiresApproval:true,reason:'Send the report'});
 engine.answer(b,live.approval.id,'accept');
 await engine.interrupt(b);
 await assert.rejects(action,/stopping/);
 assert.equal(actions,0);
 assert.equal(live.approval,null);
});

test('parallel approvals stay visible in FIFO order and keep the task paused',async t=>{
 const {engine,store,bot,running}=harness(t),b=bot('Scout'),live=running(b);
 const first=engine.ask(b,live,{kind:'approval',title:'Send report'}),firstId=live.approval.id;
 const second=engine.ask(b,live,{kind:'question',title:'Which audience?'});
 assert.equal(live.approval.id,firstId);
 assert.equal(engine.status(b).approvalCount,2);
 assert.equal(store.db.notifications.length,1);
 engine.answer(b,firstId,'accept');
 assert.equal(await first,'accept');
 assert.equal(live.approval.title,'Which audience?');
 assert.equal(live.status,'Needs you');
 assert.equal(live.task.status,'waiting');
 assert.equal(store.db.notifications.length,2);
 b.threadId='thread-active';engine.event(b,live,{method:'turn/started',params:{threadId:b.threadId,turn:{id:'turn-1'}}});
 assert.equal(live.status,'Needs you');
 engine.answer(b,live.approval.id,'The team');
 assert.equal(await second,'The team');
 assert.equal(live.approval,null);
 assert.equal(engine.status(b).approvalCount,0);
 assert.equal(live.task.status,'running');
 assert.equal(live.status,'Working');
 assert.throws(()=>engine.answer(b,firstId,'accept'),/no longer active/);
});

test('ending a task rejects every queued request and clears the approval display',async t=>{
 const {engine,bot,running,finish}=harness(t),b=bot('Scout'),live=running(b);
 const first=assert.rejects(engine.ask(b,live,{kind:'approval',title:'One'}),/Task ended/);
 const second=assert.rejects(engine.ask(b,live,{kind:'approval',title:'Two'}),/Task ended/);
 finish(b,live,'interrupted');
 await Promise.all([first,second]);
 assert.equal(live.requests.size,0);
 assert.equal(live.approval,null);
 assert.equal(live.status,'Ready');
});

test('handoffs remain asynchronous by default and preserve their shared channel',async t=>{
 const {engine,store,bot,running}=harness(t),a=bot('Scout'),b=bot('Writer'),live=running(a);
 live.task.channelId='launch';
 store.db.channels.push({id:'launch',members:[a.id,b.id]});
 const response=decoded(await engine.dynamic(a,live,'crew_team',{action:'handoff',botId:b.id,task:'Summarize the findings'}));
 const child=store.db.tasks.find(x=>x.id===response.taskId);
 assert.equal(response.status,'queued');
 assert.equal(child.parentId,live.task.id);
 assert.equal(child.channelId,'launch');
 assert.equal(child.depth,1);
 assert.equal(child.source,'handoff');
 assert.equal(engine.taskWaiters.size,0);
 assert.equal(crewTools.find(x=>x.name==='crew_team').inputSchema.properties.waitForResult.type,'boolean');
});

test('delegating to a nonmember does not share the private channel history or add membership',async t=>{
 const {engine,store,bot,running}=harness(t),a=bot('Scout'),b=bot('Writer'),live=running(a);live.task.channelId='private';store.db.channels.push({id:'private',members:[a.id]});
 const response=decoded(await engine.dynamic(a,live,'crew_team',{action:'handoff',botId:b.id,task:'Review this explicitly shared excerpt'})),child=store.db.tasks.find(task=>task.id===response.taskId);
 assert.equal(child.channelId,null);assert.match(child.prompt,/explicitly shared excerpt/);assert.deepEqual(store.db.channels[0].members,[a.id]);assert.equal(engine.canReadTask(a,child),true);
});

test('waitForResult returns the finished teammate result without polling',async t=>{
 const {engine,store,bot,running,finish}=harness(t),a=bot('Scout'),b=bot('Writer'),live=running(a);
 const pending=engine.dynamic(a,live,'crew_team',{action:'handoff',botId:b.id,task:'Write the answer',waitForResult:true});
 const child=store.db.tasks.find(x=>x.parentId===live.task.id),childLive=running(b,child);
 store.message(b,'assistant','A useful finished answer.',{taskId:child.id});
 finish(b,childLive);
 const result=decoded(await pending);
 assert.equal(result.taskId,child.id);
 assert.equal(result.status,'completed');
 assert.equal(result.result,'A useful finished answer.');
 assert.equal(engine.taskWaiters.size,0);
});

test('waitForResult has a bounded timeout and leaves the delegated task available',async t=>{
 const {engine,store,bot,running}=harness(t,{handoffWaitMs:10}),a=bot('Scout'),b=bot('Writer'),live=running(a);
 const response=decoded(await engine.dynamic(a,live,'crew_team',{action:'handoff',botId:b.id,task:'Long research',waitForResult:true}));
 assert.equal(response.timedOut,true);
 assert.equal(response.status,'queued');
 assert.match(response.message,/check this task later/);
 assert.equal(store.db.tasks.find(x=>x.id===response.taskId).status,'queued');
 assert.equal(engine.taskWaiters.size,0);
});

test('a waiting check returns child failure and queued cancellation promptly',async t=>{
 const {engine,store,bot,running,finish}=harness(t),a=bot('Scout'),b=bot('Writer'),live=running(a);
 const child=store.enqueue(b.id,'Research',{parentId:live.task.id}),childLive=running(b,child);
 const pending=engine.dynamic(a,live,'crew_team',{action:'check',taskId:child.id,waitForResult:true});
 finish(b,childLive,'failed','Source unavailable');
 assert.deepEqual(decoded(await pending),{taskId:child.id,botId:b.id,status:'failed',result:'',error:'Source unavailable'});
 const queued=store.enqueue(b.id,'Another research task',{parentId:live.task.id});
 const cancelled=engine.dynamic(a,live,'crew_team',{action:'check',taskId:queued.id,waitForResult:true});
 await engine.interrupt(b);
 assert.equal(decoded(await cancelled).status,'cancelled');
 assert.equal(engine.taskWaiters.size,0);
});

test('connection failure settles the parent handoff even before a child live session exists',async t=>{
 const {engine,store,bot,running}=harness(t),a=bot('Scout'),b=bot('Writer'),live=running(a);
 const child=store.enqueue(b.id,'Research',{parentId:live.task.id});
 const pending=engine.dynamic(a,live,'crew_team',{action:'check',taskId:child.id,waitForResult:true});
 engine.connect=async()=>{throw Error('Mock connection failed');};
 await engine.start(b,child);
 const result=decoded(await pending);
 assert.equal(result.status,'failed');
 assert.equal(result.error,'Mock connection failed');
 assert.equal(engine.taskWaiters.size,0);
});

test('stopping a parent clears its waiting tool without cancelling useful child work',async t=>{
 const {engine,store,bot,running,finish}=harness(t),a=bot('Scout'),b=bot('Writer'),live=running(a);
 const child=store.enqueue(b.id,'Research',{parentId:live.task.id});
 const pending=assert.rejects(engine.dynamic(a,live,'crew_team',{action:'check',taskId:child.id,waitForResult:true}),/parent task ended/);
 finish(a,live,'interrupted');
 await pending;
 assert.equal(child.status,'queued');
 assert.equal(engine.taskWaiters.size,0);
});

test('handoff guards reject ancestor cycles, excess depth, empty assignments and fan-out',async t=>{
 const {engine,store,bot,running}=harness(t),a=bot('Scout'),b=bot('Writer'),c=bot('Researcher'),live=running(a);
 assert.throws(()=>engine.handoff(a,live,{botId:a.id,task:'Self'}),/another bot/);
 assert.throws(()=>engine.handoff(a,live,{botId:b.id,task:'  '}),/bounded task/);
 const child=engine.handoff(a,live,{botId:b.id,task:'Research'}),childLive=running(b,child);
 assert.throws(()=>engine.handoff(b,childLive,{botId:a.id,task:'Ask the parent'}),/ancestor teammate/);
 child.depth=3;
 assert.throws(()=>engine.handoff(b,childLive,{botId:c.id,task:'One more layer'}),/depth reached/);
 for(let i=1;i<4;i++)engine.handoff(a,live,{botId:c.id,task:'Bounded part '+i});
 assert.throws(()=>engine.handoff(a,live,{botId:c.id,task:'Too much'}),/4-handoff limit/);
 assert.equal(store.db.tasks.filter(x=>x.parentId===live.task.id).length,4);
});

test('wait cycle detection includes queued work behind another active parent',async t=>{
 const {engine,store,bot,running,finish}=harness(t),a=bot('Scout'),b=bot('Writer'),aLive=running(a),bLive=running(b);
 const pending=engine.dynamic(a,aLive,'crew_team',{action:'handoff',botId:b.id,task:'Help Scout',waitForResult:true});
 const total=store.db.tasks.length;
 await assert.rejects(engine.dynamic(b,bLive,'crew_team',{action:'handoff',botId:a.id,task:'Help Writer',waitForResult:true}),/circular dependency/);
 assert.equal(store.db.tasks.length,total,'Rejected waits must not enqueue orphan handoffs');
 const rejected=assert.rejects(pending,/parent task ended/);
 finish(a,aLive,'interrupted');
 await rejected;
});

test('routine proposals forward calendar schedules and always remain paused',async t=>{
 const {engine,store,bot,running}=harness(t),b=bot('Scout'),live=running(b),proposals=[];
 store.routine=input=>{proposals.push(input);return input;};
 for(const schedule of [{},{scheduleKind:'daily',time:'08:30'},{scheduleKind:'weekdays',time:'09:15'},{scheduleKind:'weekly',time:'18:00',weekday:0}]){
  const result=decoded(await engine.dynamic(b,live,'crew_routines',{action:'propose',name:'Briefing',prompt:'Review the latest work',...schedule,enabled:true}));
  assert.equal(result.enabled,false);
  assert.equal(result.botId,b.id);
  assert.equal(result.scheduleKind,schedule.scheduleKind??'interval');
  assert.equal(result.time,schedule.time);
  assert.equal(result.weekday,schedule.weekday);
 }
 assert.equal(proposals[0].minutes,1440);
 assert.equal(proposals[3].weekday,0,'Sunday must survive forwarding');
 const schema=crewTools.find(x=>x.name==='crew_routines').inputSchema;
 assert.deepEqual(schema.properties.scheduleKind.enum,['interval','daily','weekdays','weekly']);
 assert.equal(schema.properties.weekday.minimum,0);
 assert.equal(schema.properties.weekday.maximum,6);
 assert.deepEqual(schema.required,['action']);
});

function reviewedTools(t){
 const tempRoot=fs.realpathSync(os.tmpdir()),root=fs.mkdtempSync(path.join(tempRoot,'crew-engine-test-')),store=new Store(root),b=store.create({name:'Scout'}),other=store.create({name:'Writer'}),task=store.enqueue(b.id,'Review the report');task.status='running';
 const engine=new Engine(store,{async close(){}},{executable:'test-only-engine'});clearInterval(engine.timer);engine.drain=()=>{};
 engine.learning=new Learning({dataRoot:root,store});engine.skills=new Skills({dataRoot:root,store});engine.recall=new Recall({store});
 const live={task,status:'Working',activity:'',approval:null,requests:new Map(),pending:new Map(),proc:{kill(){},killed:false,stdin:{write(){}}}};engine.live.set(b.id,live);
 t.after(async()=>{await engine.close();assert.equal(path.dirname(path.resolve(root)),tempRoot);assert.match(path.basename(root),/^crew-engine-test-/);fs.rmSync(root,{recursive:true,force:true});});return {engine,store,b,other,live,root};
}
test('memory tools propose scoped revisions with trusted task sources and read only canonical notes',async t=>{
 const {engine,b,other,live,root}=reviewedTools(t),memory=path.join(b.cwd,'MEMORY.md');fs.writeFileSync(memory,'Original notes');
 const bot=decoded(await engine.dynamic(b,live,'crew_memory',{action:'write',scope:'bot',text:'Likes concise results.',botId:other.id,status:'accepted',source:{botId:other.id}}));
 const team=decoded(await engine.dynamic(b,live,'crew_memory',{action:'write',scope:'team',text:'Launch on Friday.'}));
 assert.equal(bot.status,'pending');assert.equal(team.status,'pending');assert.equal(bot.botId,b.id);assert.equal(bot.source.taskId,live.task.id);assert.equal(bot.source.botId,b.id);
 assert.equal((await engine.dynamic(b,live,'crew_memory',{action:'read',scope:'bot'}))[0].text,'Original notes');assert.equal(fs.existsSync(path.join(root,'TEAM_MEMORY.md')),false);
 fs.writeFileSync(memory,'Unreviewed workspace edit');assert.equal(engine.learning.readMemory(b.id,'bot'),'Original notes');engine.learning.accept(bot.id);
 assert.equal((await engine.dynamic(b,live,'crew_memory',{action:'read',scope:'bot'}))[0].text,'Likes concise results.');assert.equal(engine.learning.readMemory(other.id,'bot'),'');
 await assert.rejects(engine.dynamic(b,live,'crew_memory',{action:'write',scope:'elsewhere',text:'No'}),/bot or team/);await assert.rejects(engine.dynamic(b,live,'crew_memory',{action:'write',scope:'bot',text:'x'.repeat(40001)}),/40000/);
 await assert.rejects(engine.dynamic(b,live,'crew_memory',{action:'accept',scope:'bot',id:bot.id}),/read or write/);
 engine.learning.setMemoryPolicy({teamNotes:'automatic'});const automatic=decoded(await engine.dynamic(b,live,'crew_memory',{action:'write',scope:'team',text:'Approved automatic scope'}));assert.equal(automatic.status,'accepted');assert.equal(automatic.decisionMode,'automatic');assert.equal(engine.learning.readMemory(b.id,'team'),'Approved automatic scope');
});
test('legacy memory import rejects existing and dangling links before any review record is created',async t=>{
 const {engine,b,live,root}=reviewedTools(t),target=path.join(root,'outside');fs.mkdirSync(target);fs.symlinkSync(target,path.join(b.cwd,'MEMORY.md'),'junction');
 await assert.rejects(engine.dynamic(b,live,'crew_memory',{action:'read',scope:'bot'}),/link/);fs.rmdirSync(target);
 await assert.rejects(engine.dynamic(b,live,'crew_memory',{action:'write',scope:'bot',text:'Escape'}),/link/);assert.equal(fs.existsSync(target),false);assert.equal(engine.learning.list().length,0);
});
test('skill tools only expose enabled accepted revisions and cannot activate their own proposals',async t=>{
 const {engine,b,other,live}=reviewedTools(t),input={action:'propose',title:'Review procedure',whenToUse:'Reviewing reports',steps:['Read sources'],examples:[],checklist:['Confirm facts'],enabledBotIds:[b.id],status:'accepted',source:{botId:other.id}};
 const proposed=decoded(await engine.dynamic(b,live,'crew_skills',input));assert.equal(proposed.status,'pending');assert.equal(proposed.source.botId,b.id);assert.equal(proposed.source.taskId,live.task.id);assert.deepEqual(decoded(await engine.dynamic(b,live,'crew_skills',{action:'list',botId:other.id})),[]);
 engine.skills.accept(proposed.skillId,proposed.revisionId);await assert.rejects(engine.dynamic(b,live,'crew_skills',{action:'load',id:proposed.skillId}),/not enabled/);engine.skills.setEnabled(proposed.skillId,b.id,true);
 const next=engine.skills.propose({...input,id:proposed.skillId,title:'Pending secret revision'});const listed=decoded(await engine.dynamic(b,live,'crew_skills',{action:'list'}));assert.equal(listed[0].title,'Review procedure');assert.equal(JSON.stringify(listed).includes('Pending secret'),false);
 assert.equal(decoded(await engine.dynamic(b,live,'crew_skills',{action:'load',id:proposed.skillId})).id,proposed.revisionId);await assert.rejects(engine.dynamic(b,live,'crew_skills',{action:'accept',id:proposed.skillId,revisionId:next.id}),/Only the user/);assert.deepEqual(engine.skills.listForBot(other.id),[]);
});
test('recall tools cannot spoof another bot and recheck shared-chat access on every source read',async t=>{
 const {engine,store,b,other,live}=reviewedTools(t),own=store.message(b,'assistant','Report original',{}),privateOther=store.message(other,'assistant','Report private',{}),current=store.message(b,'assistant','Report active',{taskId:live.task.id});
 store.db.channels.push({id:'shared',members:[b.id,other.id]});const shared=store.message(other,'assistant','Report shared',{channelId:'shared'});
 const initial=decoded(await engine.dynamic(b,live,'crew_recall',{action:'search',query:'Report',botId:other.id}));assert.deepEqual(initial.map(hit=>hit.messageId),[own.id]);assert.equal(initial.some(hit=>hit.messageId===current.id),false);
 await assert.rejects(engine.dynamic(b,live,'crew_recall',{action:'read',ownerId:other.id,messageId:privateOther.id}),/unavailable/);await assert.rejects(engine.dynamic(b,live,'crew_recall',{action:'read',ownerId:other.id,messageId:shared.id}),/unavailable/);
 engine.recall.configure({botId:b.id,includeShared:true});assert.equal(decoded(await engine.dynamic(b,live,'crew_recall',{action:'read',ownerId:other.id,messageId:shared.id})).text,'Report shared');engine.recall.configure({botId:b.id,includeShared:false});await assert.rejects(engine.dynamic(b,live,'crew_recall',{action:'read',ownerId:other.id,messageId:shared.id}),/unavailable/);
});
