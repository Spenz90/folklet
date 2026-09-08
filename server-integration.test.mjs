import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import yazl from 'yazl';
import {csrfFor} from './mobile.mjs';

const appRoot=path.dirname(fileURLToPath(import.meta.url));
const fakeKey='local-integration-fixture-secret';
const note='A private fixture attachment — café and 日本語.';
const learned='Use short numbered instructions for fixture reports.';
const listen=server=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve(server.address().port));});
const closeServer=server=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);});
function request(port,url,{method='GET',body,headers={}}={}){
 return new Promise((resolve,reject)=>{
  const payload=body===undefined?undefined:JSON.stringify(body);
  const req=http.request({hostname:'127.0.0.1',port,path:url,method,headers:{...(payload?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)}:{}),...headers}},res=>{
   const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>{const text=Buffer.concat(chunks).toString('utf8');let data;try{data=JSON.parse(text);}catch{}resolve({status:res.statusCode,headers:res.headers,text,data});});res.on('error',reject);
  });
  req.setTimeout(5000,()=>req.destroy(Error('Fixture HTTP request timed out.')));req.on('error',reject);req.end(payload);
 });
}
const completion=content=>({choices:[{message:{role:'assistant',content},finish_reason:'stop'}]});
const toolCalls=calls=>({choices:[{message:{role:'assistant',content:null,tool_calls:calls.map(([name,args],i)=>({id:'fixture-call-'+i,type:'function',function:{name,arguments:JSON.stringify(args)}}))},finish_reason:'tool_calls'}]});
const pluginRoutes=[['plugins','GET'],['plugin-packages','GET'],...['plugin-save','plugin-connect','plugin-remove','plugin-inspect','plugin-file','plugin-install','plugin-package-remove'].map(route=>[route,'POST'])];
const pluginTools=[{name:'fixture_echo',description:'Return the exact reviewed fixture text.',inputSchema:{type:'object',properties:{text:{type:'string'}},required:['text'],additionalProperties:false}},{name:'fixture_unselected',description:'An unselected fixture capability.',inputSchema:{type:'object'}}];
async function zipFiles(files){const archive=new yazl.ZipFile();for(const file of files)archive.addBuffer(Buffer.from(file.content),file.path);archive.end();const chunks=[];for await(const chunk of archive.outputStream)chunks.push(chunk);return Buffer.concat(chunks).toString('base64');}

// This test launches only its own loopback host and a synthetic model endpoint.
// It never loads an account, launches a browser, or captures/controls a desktop.
test('isolated host integrates providers, workspace tools, learning and phone boundaries',{timeout:30000},async t=>{
 const fixture=fs.mkdtempSync(path.join(os.tmpdir(),'crew-server-integration-'));
 const dataRoot=path.join(fixture,'data'),accountRoot=path.join(fixture,'unused-account');
 fs.mkdirSync(accountRoot);let child,port,token,stderr='',stdout='',modelFailure=false,releaseHeldTurn;
 const calls=[],pluginCalls=[];let pluginConnectionId;
 const mock=http.createServer(async(req,res)=>{
  try{
   const chunks=[];for await(const chunk of req)chunks.push(chunk);
   const body=chunks.length?JSON.parse(Buffer.concat(chunks)):undefined;
   res.setHeader('Content-Type','application/json');
   if(req.url==='/mcp'){
    pluginCalls.push({method:req.method,headers:req.headers,body});
    if(req.method==='DELETE'){res.writeHead(204);return res.end();}
    if(body?.id===undefined){res.writeHead(202);return res.end();}
    res.setHeader('Mcp-Session-Id','fixture-plugin-session');
    const result=body.method==='initialize'?{protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:{name:'HTTP fixture',version:'1'}}:body.method==='tools/list'?{tools:pluginTools}:body.method==='tools/call'?{content:[{type:'text',text:'Reviewed plugin result: '+body.params.arguments.text}]}:undefined;
    return res.end(JSON.stringify({jsonrpc:'2.0',id:body.id,...(result?{result}:{error:{code:-32601,message:'Fixture method unavailable'}})}));
   }
   calls.push({url:req.url,headers:req.headers,body});
   if(req.headers.authorization!=='Bearer '+fakeKey){res.writeHead(401);return res.end(JSON.stringify({error:fakeKey}));}
   if(req.url==='/v1/models'){
    if(modelFailure){res.writeHead(503);return res.end(JSON.stringify({error:'Fixture error containing '+fakeKey}));}
    return res.end(JSON.stringify({data:[{id:'fixture-model',name:'Fixture model',privateField:fakeKey,supported_parameters:['reasoning','reasoning_effort'],supportedReasoningEfforts:[{reasoningEffort:'high'}]}],privateField:fakeKey}));
   }
   if(req.url!=='/v1/chat/completions'){res.writeHead(404);return res.end('{}');}
   const prompt=body.messages.findLast(m=>m.role==='user')?.content||'';
   const results=body.messages.filter(m=>m.role==='tool');
   if(prompt.includes('FIXTURE_REASONING_WAIT'))await new Promise(resolve=>{releaseHeldTurn=resolve;});
   let response;
   if(results.length)response=completion('Fixture completed: '+results.map(r=>r.content).join('\n'));
   else if(prompt.includes('FIXTURE_PLUGIN_LIST'))response=toolCalls([['crew_plugins',{action:'list'}]]);
   else if(prompt.includes('FIXTURE_PLUGIN_CALL'))response=toolCalls([['crew_plugins',{action:'call',connectionId:pluginConnectionId,tool:'fixture_echo',arguments:{text:'Only this exact fixture action.'}}]]);
   else if(prompt.includes('FIXTURE_FILES'))response=toolCalls([
    ['crew_files',{action:'write',path:'outputs/fixture.txt',text:note}],
    ['crew_files',{action:'read',path:'outputs/fixture.txt'}]
   ]);
   else if(prompt.includes('FIXTURE_LEARNING'))response=toolCalls([
    ['crew_learning',{action:'propose',kind:'preference',title:'Fixture preference',text:learned}],
    ['crew_learning',{action:'propose',kind:'workflow',title:'Fixture workflow',text:'Prepare the fixture report.',schedule:{scheduleKind:'interval',minutes:60}}],
    ['crew_learning',{action:'propose',kind:'app-change',title:'Fixture app suggestion',text:'Consider larger buttons; review the interface before changing code.'}]
   ]);
   else if(prompt.includes('FIXTURE_ROADMAP'))response=toolCalls([
    ['crew_memory',{action:'write',scope:'bot',text:'Prefer reviewed fixture notes.'}],
    ['crew_skills',{action:'list'}],
    ['crew_recall',{action:'search',query:'FIXTURE_FILES'}],
    ['crew_integrations',{action:'list'}]
   ]);
   else if(prompt.includes('FIXTURE_NATIVE_DISABLED'))response=toolCalls([['crew_computer',{action:'look'}]]);
   else if(prompt.includes('FIXTURE_ATTACHMENT')){
    const relative=prompt.split('Attached workspace files (relative to your workspace):\n')[1]?.split('\n')[0];
    response=toolCalls([['crew_files',{action:'read',path:relative}]]);
   }else response=completion('Fixture response.');
   res.end(JSON.stringify(response));
  }catch(error){res.writeHead(500);res.end(JSON.stringify({error:error.message}));}
 });
 const mockPort=await listen(mock);
 // Reserve then release an ephemeral loopback port for the separate phone listener.
 const reservation=http.createServer();const mobilePort=await listen(reservation);await closeServer(reservation);
 t.after(async()=>{
  releaseHeldTurn?.();
  if(child&&child.exitCode===null&&child.signalCode===null){
   if(port&&token)await request(port,'/api/shutdown',{method:'POST',body:{},headers:{'X-Crew-Token':token}}).catch(()=>{});
   const until=Date.now()+3000;while(child.exitCode===null&&child.signalCode===null&&Date.now()<until)await delay(20);
   if(child.exitCode===null&&child.signalCode===null){child.kill();await Promise.race([new Promise(resolve=>child.once('exit',resolve)),delay(1000)]);}
  }
  await closeServer(mock);
  const resolved=path.resolve(fixture),base=path.resolve(os.tmpdir());
  assert.equal(path.dirname(resolved),base);assert.ok(path.basename(resolved).startsWith('crew-server-integration-'));
  fs.rmSync(resolved,{recursive:true,force:true});
 });
 const env={...process.env,CREW_DATA:dataRoot,CODEX_HOME:accountRoot,CREW_PORT:'0',CREW_MOBILE_PORT:String(mobilePort),CREW_CODEX_OVERRIDE:process.execPath};
 for(const name of ['OPENAI_API_KEY','CODEX_API_KEY','CODEX_ACCESS_TOKEN','CODEX_AUTH_TOKEN','ANTHROPIC_API_KEY','GEMINI_API_KEY','NODE_OPTIONS'])delete env[name];
 child=spawn(process.execPath,[path.join(appRoot,'server.mjs')],{cwd:appRoot,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',chunk=>{stdout=(stdout+chunk).slice(-10000);port=Number(stdout.match(/FOLKLET is running at http:\/\/127\.0\.0\.1:(\d+)/)?.[1])||port;});
 child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-10000);});
 let spawnError;child.on('error',error=>{spawnError=error;});
 const startup=Date.now()+6000;while(!port&&child.exitCode===null&&!spawnError&&Date.now()<startup)await delay(20);
 assert.ok(port,'Isolated server failed to start: '+(spawnError?.message||stderr));
 assert.equal((await request(port,'/health')).data.pid,child.pid);
 const html=await request(port,'/');token=html.text.match(/window\.CREW_TOKEN='([a-f0-9]{64})';/)?.[1];assert.ok(token);
 const api=async(url,body,expected=200)=>{const result=await request(port,url,{method:body===undefined?'GET':'POST',body,headers:{'X-Crew-Token':token}});assert.equal(result.status,expected,result.text);assert.ok(!result.text.includes(fakeKey),'Public response exposed the fixture key');return result.data;};
 assert.deepEqual((await api('/api/state')).bots,[],'Fixture must start with no production data');
 assert.deepEqual(fs.readdirSync(accountRoot),[],'Starting the host must not access or create account credentials');
 const state=()=>api('/api/state');
 await t.test('managed browsers cannot bootstrap owner credentials or invoke owner routes',async()=>{
  for(const marker of ['1',''])for(const [url,method] of [['/','GET'],['/health','GET'],['/api/state','GET'],['/auth/openrouter/callback?code=fixture&state=fixture','GET'],['/api/native-enable','POST']]){
   const result=await request(port,url,{method,headers:{'X-Crew-Token':token,'Sec-Crew-Browser':marker},...(method==='POST'?{body:{enabled:true}}:{})});
   assert.equal(result.status,403,url);assert.ok(!result.text.includes(token));assert.doesNotMatch(result.text,/window\.CREW_TOKEN/);
  }
  assert.equal((await api('/api/native-status')).enabled,false);
 });
 const finishTask=async taskId=>{let task;
  const until=Date.now()+5000;
  do{task=(await state()).tasks.find(task=>task.id===taskId);if(['completed','failed','interrupted','cancelled'].includes(task.status))break;await delay(25);}while(Date.now()<until);
  assert.equal(task.status,'completed',JSON.stringify(task));return task;
 };
 const runTask=async(id,text,extra={})=>finishTask((await api('/api/send',{id,text,...extra})).id);
 const waitApproval=async botId=>{const until=Date.now()+5000;let current;do{current=(await state()).bots.find(bot=>bot.id===botId);if(current.approval)break;await delay(25);}while(Date.now()<until);assert.ok(current.approval,'Fixture plugin call did not request approval');assert.equal(current.status,'Needs you');return current.approval;};
 let provider,bot,secondBot;
 await t.test('connection secrets stay private and API tools complete a task',async()=>{
  provider=await api('/api/provider-save',{type:'custom',name:'Fixture connection',baseUrl:`http://127.0.0.1:${mockPort}/v1`,defaultModel:'fixture-model',apiKey:fakeKey,persistKey:false});
  assert.equal(provider.hasKey,true);assert.equal(provider.keyStorage,'session');
  assert.ok(!(fs.readFileSync(path.join(dataRoot,'providers.json'),'utf8')).includes(fakeKey));
  assert.equal(fs.existsSync(path.join(dataRoot,'provider-secrets.json')),false);
  assert.deepEqual((await api('/api/provider-models?id='+provider.id)).map(({id,name})=>({id,name})),[{id:'fixture-model',name:'Fixture model'}]);
  assert.ok((await api('/api/providers')).some(p=>p.id===provider.id&&p.hasKey));
  bot=await api('/api/create',{name:'Fixture writer'});
  await api('/api/update',{id:bot.id,providerId:provider.id});
  assert.equal((await state()).bots.find(b=>b.id===bot.id).modelPreference,'fixture-model');
  assert.equal((await api('/api/models?id='+bot.id)).data[0].id,'fixture-model');
  await runTask(bot.id,'FIXTURE_FILES');
  const file=await request(port,'/api/file?id='+bot.id+'&path=outputs%2Ffixture.txt',{headers:{'X-Crew-Token':token}});
  assert.equal(file.status,200);assert.equal(file.text,note);
  assert.ok(calls.filter(c=>c.url==='/v1/chat/completions').every(c=>c.body.model==='fixture-model'));
  await api('/api/provider-remove',{id:provider.id},400);
  modelFailure=true;try{const failure=await api('/api/provider-models?id='+provider.id,undefined,400);assert.match(failure.error,/HTTP 503/);}finally{modelFailure=false;}
 });
 await t.test('provider edits retain keys and invalid model switches are atomic',async()=>{
  assert.ok(provider&&bot);
  const updated=await api('/api/provider-save',{id:provider.id,name:'Renamed fixture'});assert.equal(updated.hasKey,true);
  await api('/api/provider-models?id='+provider.id);
  await api('/api/provider-save',{id:provider.id,persistKey:true},400);
  await api('/api/vault-configure',{mode:'password',password:'isolated integration vault password'});
  const persisted=await api('/api/provider-save',{id:provider.id,persistKey:true});assert.equal(persisted.keyStorage,'vault');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataRoot,'provider-secrets.json'),'utf8')).keys[provider.id].format,'folklet-secret-v1');
  assert.ok(!fs.readFileSync(path.join(dataRoot,'provider-secrets.json'),'utf8').includes(fakeKey));
  assert.ok(!fs.readFileSync(path.join(dataRoot,'providers.json'),'utf8').includes(fakeKey));
  const session=await api('/api/provider-save',{id:provider.id,persistKey:false});assert.equal(session.keyStorage,'session');
  assert.equal(fs.existsSync(path.join(dataRoot,'provider-secrets.json')),false);await api('/api/provider-models?id='+provider.id);
  const incomplete=await api('/api/provider-save',{type:'custom',name:'No default model',baseUrl:`http://127.0.0.1:${mockPort}/v1`});
  await api('/api/update',{id:bot.id,providerId:incomplete.id,name:'Should not change'},400);
  await api('/api/update',{id:bot.id,providerId:incomplete.id,model:'x'.repeat(201)},400);
  const unchanged=(await state()).bots.find(b=>b.id===bot.id);assert.equal(unchanged.providerId,provider.id);assert.equal(unchanged.name,'Fixture writer');assert.equal(unchanged.modelPreference,'fixture-model');
  await api('/api/provider-remove',{id:incomplete.id});
  const oauth=await request(port,'/auth/openrouter/callback?code=fixture&state=invalid');assert.equal(oauth.status,400);assert.match(oauth.text,/Connection not completed/);
 });
 await t.test('model settings reject unsupported reasoning atomically and default reaches the API',async()=>{
  assert.ok(provider&&bot);
  const metadata=await api('/api/model-settings?providerId='+provider.id+'&model=fixture-model');
  assert.ok(metadata.models.some(model=>model.id==='fixture-model'));
  assert.deepEqual(metadata.options.map(option=>option.value),['']);
  assert.equal(metadata.defaultModelId,'fixture-model');
  await api('/api/model-settings?providerId=missing-fixture-provider&model=fixture-model',undefined,400);
  const current=(await state()).bots.find(b=>b.id===bot.id);
  for(const effort of ['high','unsupported-fixture-effort',42,null,{}]){
   await api('/api/update',{id:bot.id,name:'Rejected reasoning change',reasoningEffort:effort},400);
   const unchanged=(await state()).bots.find(b=>b.id===bot.id);
   for(const field of ['name','providerId','modelPreference','reasoningEffort'])assert.equal(unchanged[field],current[field],'Invalid reasoning changed '+field);
  }
  await api('/api/update',{id:bot.id,reasoningEffort:''});
  assert.equal((await state()).bots.find(b=>b.id===bot.id).reasoningEffort,'');
  await runTask(bot.id,'FIXTURE_REASONING_DEFAULT');
  const outgoing=calls.findLast(call=>call.url==='/v1/chat/completions').body;
  assert.equal(outgoing.model,'fixture-model');
  for(const field of ['reasoning_effort','reasoning','thinking','output_config'])assert.equal(Object.hasOwn(outgoing,field),false,'Default sent an unsupported '+field+' setting');
  const manual=await api('/api/model-settings?providerId='+provider.id+'&model=fixture-manual-model');
  assert.deepEqual(manual.options.map(option=>option.value),['']);
  const familiarName=await api('/api/model-settings?providerId='+provider.id+'&model=o3');
  assert.deepEqual(familiarName.options.map(option=>option.value),[''],'A custom endpoint must not inherit another provider’s reasoning protocol from its model name');
  await api('/api/update',{id:bot.id,model:'fixture-manual-model',reasoningEffort:'high'},400);
  assert.equal((await state()).bots.find(b=>b.id===bot.id).modelPreference,'fixture-model');
  const held=await api('/api/send',{id:bot.id,text:'FIXTURE_REASONING_WAIT'});
  try{
   const until=Date.now()+2000;while(!releaseHeldTurn&&Date.now()<until)await delay(20);assert.equal(typeof releaseHeldTurn,'function');
   const rejected=await api('/api/update',{id:bot.id,reasoningEffort:'high'},400);
   assert.doesNotMatch(rejected.error,/Stop or finish/i,'Unsupported effort reached engine disconnect before validation');
   const running=(await state()).tasks.find(task=>task.id===held.id);assert.equal(running.status,'running');assert.equal(running.cancelRequested,undefined);
  }finally{releaseHeldTurn?.();releaseHeldTurn=undefined;}
  const finishBy=Date.now()+2000;let finished;
  do{finished=(await state()).tasks.find(task=>task.id===held.id);if(finished.status==='completed')break;await delay(20);}while(Date.now()<finishBy);
  assert.equal(finished.status,'completed','Rejected settings interrupted an existing task');
 });
 await t.test('attachments follow a changed recipient and invalid selections enqueue nothing',async()=>{
  assert.ok(bot&&provider);secondBot=await api('/api/create',{name:'Fixture reader'});
  await api('/api/update',{id:secondBot.id,providerId:provider.id});
  const upload=await api('/api/upload',{id:bot.id,name:'fixture.txt',base64:Buffer.from(note).toString('base64')});
  const sent=await runTask(secondBot.id,'FIXTURE_ATTACHMENT',{attachments:[{owner:bot.id,path:upload.path}]});
  assert.ok(!sent.prompt.includes(dataRoot));assert.match(sent.result,/café and 日本語/);
  const attached=sent.prompt.split('Attached workspace files (relative to your workspace):\n')[1];assert.match(attached,/^attachments\//);assert.notEqual(attached,upload.path);
  const preview=await api('/api/preview?id='+secondBot.id+'&path='+encodeURIComponent(attached));assert.equal(preview.text,note);
  const count=(await state()).tasks.length;
  await api('/api/send',{id:secondBot.id,text:'Fixture invalid selection',attachments:[{owner:bot.id,path:'outputs/fixture.txt'}]},400);
  await api('/api/send',{id:secondBot.id,text:'Fixture invalid normalized selection',attachments:[{owner:bot.id,path:'attachments/../outputs/fixture.txt'}]},400);
  // Links may stay within a bot workspace yet still leave the uploads subtree.
  assert.ok(path.resolve(bot.cwd).startsWith(path.resolve(dataRoot)+path.sep));
  fs.symlinkSync(path.join(bot.cwd,'outputs'),path.join(bot.cwd,'attachments','linked-outputs'),process.platform==='win32'?'junction':'dir');
  await api('/api/send',{id:secondBot.id,text:'Fixture invalid linked selection',attachments:[{owner:bot.id,path:'attachments/linked-outputs/fixture.txt'}]},400);
  assert.equal((await state()).tasks.length,count);
 });
 await t.test('learning requires a user review and accepted workflows stay paused',async()=>{
  assert.ok(bot);await runTask(bot.id,'FIXTURE_LEARNING');
  const proposals=await api('/api/learning');assert.equal(proposals.length,3);assert.ok(proposals.every(p=>p.status==='pending'));
  assert.equal((await state()).routines.length,0);
  for(const proposal of proposals){const accepted=await api('/api/learning-accept',{id:proposal.id});assert.equal(accepted.status,proposal.kind==='app-change'?'reviewed':'accepted');}
  const workflow=proposals.find(p=>p.kind==='workflow');await api('/api/learning-accept',{id:workflow.id});
  const routines=(await state()).routines;assert.equal(routines.length,1);assert.equal(routines[0].enabled,false);assert.equal(routines[0].learningId,workflow.id);
  await runTask(bot.id,'FIXTURE_CONTEXT');const latest=calls.findLast(c=>c.url==='/v1/chat/completions');assert.ok(latest.body.messages.find(m=>m.role==='system').content.includes(learned));
  await api('/api/learning-reject',{id:workflow.id},400);
 });
 await t.test('native control starts off and model screen requests fail without desktop access',async()=>{
  const before=await api('/api/native-status');assert.equal(before.enabled,false);assert.equal(before.frameId,null);
  await api('/api/native-enable',{enabled:'true'},400);
  await runTask(bot.id,'FIXTURE_NATIVE_DISABLED');
  const completionRequest=calls.findLast(c=>c.url==='/v1/chat/completions');assert.match(completionRequest.body.messages.find(m=>m.role==='tool').content,/disabled/i);
  const after=await api('/api/native-status');assert.equal(after.enabled,false);assert.equal(after.frameId,null);assert.equal((await state()).bots.find(b=>b.id===bot.id).approval,null);
 });
 await t.test('roadmap routes connect reviewed skills, recall, learning, routine policy and fallback',async()=>{
  for(const name of ['FEATURES.md','SECURITY.md','RELEASE-CHECKS.md','FEATURE-ROADMAP.md'])assert.ok((await api('/api/guide?name='+name)).text);
  for(const asset of ['skills-ui.mjs','review-ui-common.mjs','learning-review-ui.mjs','recall-ui.mjs','integrations-ui.mjs','notifications-ui.mjs','routine-policy-ui.mjs','fallback-ui.mjs'])assert.equal((await request(port,'/'+asset)).status,200,asset);
  const skill=await api('/api/skill-propose',{title:'Fixture review',whenToUse:'When checking fixture work',steps:['Read the source','Verify the result'],examples:['Review a fixture'],checklist:['Result matches source']});
  await api('/api/skill-enable',{id:skill.skillId,botId:bot.id,enabled:true},400);
  await api('/api/skill-accept',{id:skill.skillId,revisionId:skill.revisionId});
  await api('/api/skill-enable',{id:skill.skillId,botId:bot.id,enabled:true});
  assert.equal((await api('/api/skill-export?id='+skill.skillId)).format,'crew-instruction-skill');
  assert.equal((await api('/api/recall-settings?botId='+bot.id)).includeShared,false);
  assert.ok((await api('/api/recall-search',{botId:bot.id,query:'FIXTURE_FILES'})).some(m=>m.url.includes('message=')));
  assert.deepEqual(await api('/api/recall-search',{botId:secondBot.id,query:'FIXTURE_FILES'}),[]);
  await api('/api/recall-settings-save',{botId:bot.id,includeShared:true});
  const integration=await api('/api/integration-save',{repo:'example/fixture',botIds:[bot.id],enabled:true,persistToken:false});
  assert.equal((await api('/api/integrations')).length,1);
  const initialMemory=await api('/api/learning-memory?botId='+bot.id+'&scope=bot');
  await runTask(bot.id,'FIXTURE_ROADMAP');
  const outgoing=calls.findLast(c=>c.url==='/v1/chat/completions'),toolResults=outgoing.body.messages.filter(m=>m.role==='tool').map(m=>m.content);
  assert.ok(toolResults.some(text=>text.includes('Fixture review')));assert.ok(toolResults.some(text=>text.includes('example/fixture')));assert.ok(toolResults.some(text=>text.includes('snippet')));
  assert.equal((await api('/api/learning-memory?botId='+bot.id+'&scope=bot')).text,initialMemory.text,'Model notes must await review');
  const proposal=(await api('/api/learning')).find(p=>p.kind==='memory'&&p.status==='pending');assert.ok(proposal.source.taskId);
  await api('/api/learning-accept',{id:proposal.id});assert.equal((await api('/api/memory?id='+bot.id)).bot,'Prefer reviewed fixture notes.');
  await api('/api/learning-undo',{id:proposal.id});assert.equal((await api('/api/memory?id='+bot.id)).bot,initialMemory.text);
  const routine=(await state()).routines[0];assert.match(routine.policySummary.nextExplanation,/Paused/);
  await api('/api/routine-policy-save',{routineId:routine.id,missedRunPolicy:'skip',retryLimit:2,retryDelayMinutes:1,notificationPolicy:'changes'});
  assert.equal((await api('/api/routine-policy?routineId='+routine.id)).retryLimit,2);
  const fallback={enabled:true,contentSharingApproved:true,choices:[{providerId:provider.id,model:'fixture-backup',reasoningEffort:''}]};
  await api('/api/fallback-save',{id:bot.id,fallback});assert.equal((await api('/api/fallback-settings?id='+bot.id)).fallback.enabled,true);
  await api('/api/fallback-save',{id:bot.id,fallback:{...fallback,contentSharingApproved:false}},400);
  await api('/api/fallback-save',{id:bot.id,fallback:{...fallback,choices:[{providerId:'codex',model:'example'}]}},400);
  await api('/api/integration-remove',{id:integration.id});assert.equal((await api('/api/integrations')).length,0);
  const status=await api('/api/notification-status');assert.equal(status.enabled,false);assert.equal(status.hasToken,false);
 });
 await t.test('plugin management requires owner credentials and cannot be reached by managed browsers',async()=>{
  for(const [route,method] of pluginRoutes){
   const options={method,...(method==='POST'?{body:{}}:{})};
   for(const headers of [{},{'X-Crew-Token':'incorrect-fixture-token'},{'X-Crew-Token':token,'Sec-Crew-Browser':'1'},{'X-Crew-Token':token,'Sec-Crew-Browser':''}]){
    const denied=await request(port,'/api/'+route,{...options,headers});assert.equal(denied.status,403,route);assert.ok(!denied.text.includes(token));
   }
  }
  assert.deepEqual(await api('/api/plugins'),[]);assert.deepEqual(await api('/api/plugin-packages'),[]);assert.equal(pluginCalls.length,0);
  await api('/api/plugin-save',{name:'Owner endpoint is forbidden',type:'mcp',transport:'streamable-http',url:`http://127.0.0.1:${port}/api/plugins`},400);
 });
 await t.test('portable package routes preview exact files and install only disabled definitions and pending skills',async()=>{
  const markdown='---\nname: fixture-review\ndescription: Check a synthetic fixture\n---\nRead the fixture and verify its exact text.\n';
  const file=(path,content)=>({path,content:typeof content==='string'?content:JSON.stringify(content)});
  const files=[file('plugin.json',{$schema:'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',name:'fixture-package',version:'1.0.0'}),file('skills/fixture-review/SKILL.md',markdown),file('mcp.json',{$schema:'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',mcpServers:{fixture:{type:'streamable-http',url:`http://127.0.0.1:${mockPort}/mcp`}}})];
  const archive=await zipFiles(files),review=await api('/api/plugin-inspect',{archive});
  assert.deepEqual([...review.files].sort(),files.map(file=>file.path).sort());
  assert.equal(review.format,'agent-plugins-v1');assert.match(review.reviewHash,/^[a-f0-9]{64}$/);assert.equal(pluginCalls.length,0);assert.deepEqual(await api('/api/plugins'),[]);
  const preview=await api('/api/plugin-file',{id:review.id,path:'skills/fixture-review/SKILL.md',reviewHash:review.reviewHash});assert.equal(preview.text,markdown);assert.equal(preview.truncated,false);
  await api('/api/plugin-file',{id:review.id,path:'skills/fixture-review/SKILL.md',reviewHash:'0'.repeat(64)},400);
  await api('/api/plugin-file',{id:review.id,path:'../store.json'},400);
  await api('/api/plugin-install',{id:review.id,reviewHash:review.reviewHash},400);
  await api('/api/plugin-install',{id:review.id,reviewHash:'0'.repeat(64),confirmed:true},400);
  assert.deepEqual(await api('/api/plugins'),[]);
  const installed=await api('/api/plugin-install',{id:review.id,reviewHash:review.reviewHash,confirmed:true});assert.equal(installed.status,'installed');assert.equal(installed.connectionIds.length,1);assert.equal(installed.skillIds.length,1);
  const definition=(await api('/api/plugins'))[0];assert.equal(definition.enabled,false);assert.equal(definition.connected,false);assert.deepEqual(definition.botIds,[]);assert.deepEqual(definition.allowedTools,[]);assert.equal(definition.hasSecrets,false);assert.equal(pluginCalls.length,0);
  const skill=await api('/api/skill-get?id='+installed.skillIds[0]);assert.equal(skill.activeRevisionId,null);assert.equal(skill.revisions[0].status,'pending');assert.deepEqual(skill.enabledBotIds,[]);
  assert.equal((await api('/api/plugin-file',{id:installed.id,path:'skills/fixture-review/SKILL.md',reviewHash:review.reviewHash})).text,markdown);
  await api('/api/plugin-package-remove',{id:installed.id});assert.deepEqual(await api('/api/plugins'),[]);assert.deepEqual(await api('/api/plugin-packages'),[]);await api('/api/skill-get?id='+skill.id,undefined,400);
 });
 await t.test('real HTTP MCP discovery and per-bot tools require an exact owner approval before dispatch',async()=>{
  const saved=await api('/api/plugin-save',{name:'Fixture MCP',type:'mcp',transport:'streamable-http',url:`http://127.0.0.1:${mockPort}/mcp`,botIds:[bot.id],allowedTools:['fixture_echo']});pluginConnectionId=saved.id;assert.equal(saved.connected,false);assert.equal(pluginCalls.length,0);
  await api('/api/plugin-connect',{id:saved.id},400);assert.equal(pluginCalls.length,0);
  const connected=await api('/api/plugin-connect',{id:saved.id,confirmed:true});assert.equal(connected.connected,true);assert.deepEqual(connected.tools.map(tool=>tool.name),['fixture_echo','fixture_unselected']);assert.deepEqual(connected.allowedTools,['fixture_echo']);
  assert.ok(pluginCalls.every(call=>call.headers['sec-crew-browser']==='1'));assert.equal(pluginCalls.filter(call=>call.body?.method==='tools/call').length,0);
  await runTask(bot.id,'FIXTURE_PLUGIN_LIST');let result=calls.findLast(call=>call.url==='/v1/chat/completions').body.messages.find(message=>message.role==='tool').content;assert.match(result,/fixture_echo/);assert.doesNotMatch(result,/fixture_unselected|127\.0\.0\.1|secretStorage|headerNames/);
  await runTask(secondBot.id,'FIXTURE_PLUGIN_LIST');result=calls.findLast(call=>call.url==='/v1/chat/completions').body.messages.find(message=>message.role==='tool').content;assert.doesNotMatch(result,/Fixture MCP|fixture_echo/);
  await runTask(secondBot.id,'FIXTURE_PLUGIN_CALL');assert.equal(pluginCalls.filter(call=>call.body?.method==='tools/call').length,0);assert.equal((await state()).bots.find(value=>value.id===secondBot.id).approval,null);
  const created=await api('/api/send',{id:bot.id,text:'FIXTURE_PLUGIN_CALL'}),approval=await waitApproval(bot.id);assert.equal(approval.kind,'approval');assert.equal(approval.details.connectionName,'Fixture MCP');assert.equal(approval.details.tool,'fixture_echo');assert.deepEqual(approval.details.arguments,{text:'Only this exact fixture action.'});assert.equal(pluginCalls.filter(call=>call.body?.method==='tools/call').length,0);
  await api('/api/answer',{id:bot.id,requestId:'wrong-fixture-request',answer:'accept'},400);assert.equal(pluginCalls.filter(call=>call.body?.method==='tools/call').length,0);
  await api('/api/answer',{id:bot.id,requestId:approval.id,answer:'accept'});const finished=await finishTask(created.id);assert.match(finished.result,/Reviewed plugin result/);const invocation=pluginCalls.filter(call=>call.body?.method==='tools/call');assert.equal(invocation.length,1);assert.deepEqual(invocation[0].body.params,{name:'fixture_echo',arguments:{text:'Only this exact fixture action.'}});assert.equal((await state()).bots.find(value=>value.id===bot.id).approval,null);
 });
 await t.test('reliability routes encrypt and restore a separate copy and enforce API usage limits',async()=>{
  const before=await api('/api/state'),first=await api('/api/state-delta');assert(first.full);assert.equal(first.state.workspaceId,before.workspaceId);
  const next=await api('/api/state-delta?cursor='+encodeURIComponent(first.cursor));assert(next.unchanged);
  const history=await api('/api/history?id='+bot.id);assert(history.messages.length>0&&history.messages.length<=60);
  await api('/api/history?id='+bot.id+'&before=missing',undefined,400);
  const password='HTTP fixture backup password';await api('/api/backup-create',{password},400);
  const fixtureLink=path.join(bot.cwd,'attachments','linked-outputs');assert(fs.lstatSync(fixtureLink).isSymbolicLink());fs.unlinkSync(fixtureLink);
  const created=await api('/api/backup-create',{password});
  const file=path.join(dataRoot,'backups',created.id),base64=fs.readFileSync(file).toString('base64');
  assert(!fs.readFileSync(file).includes(Buffer.from(note)));
  assert((await api('/api/backup-inspect',{base64,password})).files>0);
  await api('/api/backup-inspect',{base64,password:'wrong fixture password'},400);
  const restored=await api('/api/backup-restore',{base64,password});assert.equal(path.dirname(restored.destination),path.join(dataRoot,'restored-workspaces'));
  assert.notEqual(JSON.parse(fs.readFileSync(path.join(restored.destination,'crew.json'))).workspaceId,before.workspaceId);
  assert.equal((await api('/api/state')).workspaceId,before.workspaceId);
  const usage=await api('/api/usage-status');assert(usage.today.requests>0);assert(usage.today.unknownUsage>0);
  await api('/api/usage-configure',{...usage.settings,dailyRequests:usage.today.requests});
  const count=calls.length,task=await api('/api/send',{id:secondBot.id,text:'FIXTURE_BUDGET_BLOCK'});
  let status;const until=Date.now()+4000;do{status=(await state()).tasks.find(t=>t.id===task.id);if(status.status==='failed')break;await delay(20);}while(Date.now()<until);
  assert.equal(status.status,'failed');assert.match(status.error,/Daily API request limit/);assert.equal(calls.length,count,'A blocked request must not reach the provider');
  await api('/api/usage-configure',usage.settings);
  await api('/api/push-configure',{enabled:true});await api('/api/push-subscribe',{subscription:{}},400);assert.equal((await api('/api/push-status')).deviceCount,0);
  assert.equal((await api('/api/plugin-catalog')).length,3);
 });
 await t.test('paired phones can use provider reads but cannot administer host connections',async()=>{
  const origin='https://crew-integration.example.ts.net';await api('/api/mobile-configure',{origin});
  for(const url of [`http://127.0.0.1:${mobilePort}/api/plugins`,origin+'/api/plugins'])await api('/api/plugin-save',{name:'Phone endpoint is forbidden',type:'mcp',transport:'streamable-http',url},400);
  const pairing=await api('/api/mobile-pair',{});
  const headers={Host:new URL(origin).host,Origin:origin};
  assert.equal((await request(mobilePort,'/api/providers',{headers})).status,401);
  const paired=await request(mobilePort,'/pair',{method:'POST',body:{code:pairing.code,name:'Fixture phone'},headers});assert.equal(paired.status,200,paired.text);
  const cookie=paired.headers['set-cookie'][0].split(';')[0],secret=cookie.split('=')[1];
  const authorized={...headers,Cookie:cookie,'X-Crew-Token':csrfFor(secret)};
  const phone=async(url,body,expected=200)=>{const response=await request(mobilePort,url,{method:body===undefined?'GET':'POST',body,headers:authorized});assert.equal(response.status,expected,response.text);assert.ok(!response.text.includes(fakeKey));assert.ok(!response.text.includes(token));return response;};
  const home=await phone('/');assert.ok(home.text.includes("window.CREW_TOKEN='"+csrfFor(secret)+"'"));assert.ok(home.text.includes('window.CREW_MOBILE=true'));
  await phone('/settings-ui.mjs');await phone('/connection-state.mjs');await phone('/hosting-ui.mjs');await phone('/api/providers');await phone('/api/provider-models?id='+provider.id);await phone('/api/native-status');await phone('/api/learning');
  assert.equal((await request(mobilePort,'/api/host-status',{headers})).status,401);
  const hostStatus=await phone('/api/host-status');assert.equal(hostStatus.data.phone.enabled,true);assert.ok(Array.isArray(hostStatus.data.checks));assert.equal(hostStatus.headers['cache-control'],'no-store');
  assert.ok(!hostStatus.text.includes(dataRoot));assert.ok(!hostStatus.text.includes(secret));assert.ok(!hostStatus.text.includes('Fixture phone'));
  const modelSettings=await phone('/api/model-settings?providerId='+provider.id+'&model=fixture-model');assert.deepEqual(modelSettings.data.options.map(option=>option.value),['']);
  await phone('/api/update',{id:bot.id,reasoningEffort:''});
  await phone('/api/update',{id:bot.id,reasoningEffort:'high'},400);
  assert.equal((await state()).bots.find(b=>b.id===bot.id).reasoningEffort,'');
  for(const route of ['provider-save','provider-remove','provider-login','native-enable','account-login','shutdown','mobile-pair','integration-save','integration-remove','notification-configure','notification-pair','notification-check','notification-activate','notification-revoke','app-change-tests','app-change-apply','app-change-undo'])await phone('/api/'+route,{},403);
  for(const [route,method] of pluginRoutes)await phone('/api/'+route,method==='POST'?{}:undefined,403);
  for(const route of ['vault-status','backup-status','backup-download','plugin-catalog'])await phone('/api/'+route,undefined,403);
  for(const route of ['vault-configure','vault-unlock','backup-create','backup-configure','backup-inspect','backup-restore','usage-configure','push-configure','catalog-prepare','catalog-skill','update-check'])await phone('/api/'+route,{},403);
  for(const asset of ['draft-storage.mjs','sync-client.mjs','reliability-ui.mjs'])await phone('/'+asset);
  await phone('/api/state-delta');await phone('/api/history?id='+bot.id);await phone('/api/usage-status');
  const pushInput={endpoint:'https://fcm.googleapis.com/fcm/send/http-fixture',keys:{auth:Buffer.alloc(16).toString('base64url'),p256dh:Buffer.alloc(65,1).toString('base64url')}};
  assert.equal((await phone('/api/push-subscribe',{subscription:pushInput})).data.subscribed,true);
  assert.equal((await phone('/api/push-status')).data.deviceCount,1);
  await phone('/api/push-unsubscribe',{});assert.equal((await phone('/api/push-status')).data.subscribed,false);
  const created=await api('/api/send',{id:bot.id,text:'FIXTURE_PLUGIN_CALL'}),approval=await waitApproval(bot.id),before=pluginCalls.filter(call=>call.body?.method==='tools/call').length;
  await phone('/api/answer',{id:bot.id,requestId:approval.id,answer:'accept'});await finishTask(created.id);assert.equal(pluginCalls.filter(call=>call.body?.method==='tools/call').length,before+1);
  const pending=await api('/api/send',{id:bot.id,text:'FIXTURE_PLUGIN_CALL'}),revoked=await waitApproval(bot.id);
  await api('/api/plugin-remove',{id:pluginConnectionId});await finishTask(pending.id);assert.deepEqual(await api('/api/plugins'),[]);assert.equal((await state()).bots.find(value=>value.id===bot.id).approval,null);assert.equal(pluginCalls.filter(call=>call.body?.method==='tools/call').length,before+1);
  await phone('/api/answer',{id:bot.id,requestId:revoked.id,answer:'accept'},400);await runTask(bot.id,'FIXTURE_PLUGIN_CALL');assert.equal(pluginCalls.filter(call=>call.body?.method==='tools/call').length,before+1);
  for(const asset of ['skills-ui.mjs','review-ui-common.mjs','learning-review-ui.mjs','recall-ui.mjs','routine-policy-ui.mjs','fallback-ui.mjs'])await phone('/'+asset);
  assert.equal((await request(mobilePort,'/api/providers',{headers:{...authorized,'X-Crew-Token':token}})).status,403);
  const mobile=await api('/api/mobile-status');await api('/api/mobile-revoke',{deviceId:mobile.devices[0].id});await phone('/api/providers',undefined,401);
 });
 assert.deepEqual(fs.readdirSync(accountRoot),[],'API-only operation must not touch an account');
});
