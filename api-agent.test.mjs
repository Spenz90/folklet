import test from 'node:test';
import assert from 'node:assert/strict';
import {runApiAgent} from './api-agent.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from './store.mjs';
import {Engine} from './engine.mjs';
import {Learning} from './learning.mjs';
const tool={name:'crew_check',description:'Read a test page',inputSchema:{type:'object',properties:{value:{type:'number'}},required:['value']}};
const connection={type:'openai',baseUrl:'https://api.openai.com/v1',key:'test-only-secret'};
const response=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
const completion=message=>({choices:[{message,finish_reason:'stop'}]});
test('OpenAI-compatible agent executes tools and sends image results before finishing',async()=>{
 const requests=[],outputs=[];let calls=0;
 const result=await runApiAgent({connection,model:'test-model',system:'Instructions',messages:[{role:'user',content:'Check'}],tools:[tool],onMessage:text=>outputs.push(text),executeTool:async(name,args)=>{assert.equal(name,'crew_check');assert.equal(args.value,4);calls++;return [{type:'inputText',text:'Page found'},{type:'inputImage',imageUrl:'data:image/png;base64,YQ=='}];},fetchImpl:async(url,options)=>{requests.push(JSON.parse(options.body));assert.equal(options.headers.Authorization,'Bearer test-only-secret');return response(requests.length===1?completion({content:'Checking.',tool_calls:[{id:'call-1',type:'function',function:{name:'crew_check',arguments:'{"value":4}'}}]}):completion({content:'Verified result.'}));}});
 assert.equal(calls,1);assert.equal(result.text,'Verified result.');assert.deepEqual(outputs,['Checking.','Verified result.']);
 assert.equal(requests[1].messages.find(m=>m.role==='tool').tool_call_id,'call-1');assert.ok(requests[1].messages.some(m=>Array.isArray(m.content)&&m.content.some(c=>c.type==='image_url')));
});
test('Anthropic adapter uses Messages and tool_result image blocks',async()=>{
 const requests=[];
 const result=await runApiAgent({connection:{...connection,type:'anthropic',baseUrl:'https://api.anthropic.com/v1'},model:'test-claude',system:'Instructions',messages:[{role:'user',content:'Look'}],tools:[tool],executeTool:async()=>[{type:'inputText',text:'Page'},{type:'inputImage',imageUrl:'data:image/jpeg;base64,YQ=='}],fetchImpl:async(url,options)=>{assert.equal(url,'https://api.anthropic.com/v1/messages');assert.equal(options.headers['x-api-key'],'test-only-secret');requests.push(JSON.parse(options.body));return response(requests.length===1?{content:[{type:'tool_use',id:'use-1',name:'crew_check',input:{value:1}}],stop_reason:'tool_use'}:{content:[{type:'text',text:'Done'}],stop_reason:'end_turn'});}});
 assert.equal(result.text,'Done');const block=requests[1].messages.at(-1).content[0];assert.equal(block.type,'tool_result');assert.equal(block.content[1].source.media_type,'image/jpeg');assert.ok(requests[0].tools[0].input_schema);
});
test('API tool loop is bounded and cannot execute unknown shell requests',async()=>{
 let executed=0,rounds=0;
 await assert.rejects(runApiAgent({connection,model:'model',tools:[tool],maxIterations:2,messages:[{role:'user',content:'Task'}],executeTool:async()=>{executed++;return [];},fetchImpl:async()=>{rounds++;return response(completion({content:null,tool_calls:[{id:'shell-'+rounds,type:'function',function:{name:'exec_shell',arguments:'{}'}}]}));}}),/step API limit/);
 assert.equal(executed,0);assert.equal(rounds,2);
});
test('API cancellation ends waiting tool work and starts no further model request',async()=>{
 const controller=new AbortController();let requests=0;
 const promise=runApiAgent({connection,model:'model',tools:[tool],signal:controller.signal,messages:[{role:'user',content:'Task'}],executeTool:async()=>{controller.abort();return new Promise(()=>{});},fetchImpl:async()=>{requests++;return response(completion({tool_calls:[{id:'call-1',type:'function',function:{name:'crew_check',arguments:'{"value":1}'}}]}));}});
 await assert.rejects(promise,error=>error.name==='AbortError');assert.equal(requests,1);
});
test('API errors never surface provider response bodies or transport secrets',async()=>{
 await assert.rejects(runApiAgent({connection,model:'model',tools:[],executeTool:async()=>[],fetchImpl:async()=>new Response('test-only-secret',{status:401})}),error=>error.message.includes('401')&&!error.message.includes('test-only-secret'));
 await assert.rejects(runApiAgent({connection,model:'model',tools:[],executeTool:async()=>[],fetchImpl:async()=>response(completion({content:null}))}),/no text/);
});
test('Engine routes API bots through shared tools without starting a Codex process',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'crew-api-engine-'));const store=new Store(directory);let engine;
 try{
  const bot=store.create({name:'API helper',role:'Test'});bot.providerId='test-provider';bot.model='test-model';let invoked=false;
  engine=new Engine(store,{async close(){}},{providers:{getConnection:()=>connection},spawnProcess(){throw Error('API bots must not launch Codex');},apiRunner:async({executeTool,onMessage,tools})=>{assert.ok(tools.some(t=>t.name==='crew_memory'));const memory=await executeTool('crew_memory',{action:'read',scope:'bot'});assert.match(memory[0].text,/No notes/);invoked=true;onMessage('Shared tool verified.');return {text:'Shared tool verified.'};}});clearInterval(engine.timer);
  engine.learning=new Learning({dataRoot:directory,store});const task=store.enqueue(bot.id,'Check memory');await engine.start(bot,task);assert.equal(invoked,true);assert.equal(task.status,'completed');assert.equal(task.result,'Shared tool verified.');assert.equal(bot.threadId,undefined);assert.equal(engine.learning.readMemory(bot.id,'bot'),'');assert.equal(fs.existsSync(path.join(bot.cwd,'MEMORY.md')),false);
 }finally{await engine?.close();fs.rmSync(directory,{recursive:true,force:true});}
});
test('Engine stopping an API bot clears its pending question and marks it interrupted',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'crew-api-stop-'));const store=new Store(directory);let engine;
 try{
  const bot=store.create({name:'API helper'});bot.providerId='test-provider';bot.model='test-model';
  engine=new Engine(store,{async close(){}},{providers:{getConnection:()=>connection},apiRunner:async({executeTool})=>executeTool('crew_ask',{question:'Continue?'})});clearInterval(engine.timer);
  const task=store.enqueue(bot.id,'Ask me');const running=engine.start(bot,task);await new Promise(resolve=>setImmediate(resolve));assert.equal(task.status,'waiting');
  await engine.interrupt(bot);await running;assert.equal(task.status,'interrupted');assert.equal(engine.live.get(bot.id).requests.size,0);
 }finally{await engine?.close();fs.rmSync(directory,{recursive:true,force:true});}
});
test('reasoning dispatch sends only each provider supported request fields',async()=>{
 const cases=[
  {type:'openai',model:'gpt-5.5',effort:'none',expected:{reasoning:{effort:'none'}},endpoint:'/responses'},
  {type:'openai',model:'gpt-6-astra',effort:'max',expected:{reasoning:{effort:'max'}},endpoint:'/responses'},
  {type:'anthropic',model:'claude-opus-4-7',effort:'xhigh',expected:{output_config:{effort:'xhigh'},thinking:{type:'adaptive'}},endpoint:'/messages'},
  {type:'anthropic',model:'claude-opus-4-5',effort:'low',expected:{output_config:{effort:'low'}},endpoint:'/messages'},
  {type:'gemini',model:'gemini-2.5-flash',effort:'none',expected:{reasoning_effort:'none'},endpoint:'/chat/completions'},
  {type:'openrouter',model:'vendor/test',effort:'high',metadata:{reasoning:{supported_efforts:['low','high']}},expected:{reasoning:{effort:'high'}},endpoint:'/chat/completions'}
 ];
 for(const c of cases){
  let request;
  await runApiAgent({connection:{...connection,type:c.type},model:c.model,reasoningEffort:c.effort,modelMetadata:c.metadata,executeTool:async()=>[],fetchImpl:async(url,options)=>{
   assert.ok(url.endsWith(c.endpoint));request=JSON.parse(options.body);
   return response(c.endpoint==='/responses'?{status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'Done'}]}]}:c.type==='anthropic'?{content:[{type:'text',text:'Done'}],stop_reason:'end_turn'}:completion({content:'Done'}));
  }});
  assert.deepEqual(Object.fromEntries(['reasoning','reasoning_effort','output_config','thinking'].filter(key=>key in request).map(key=>[key,request[key]])),c.expected);
  if(c.type==='anthropic')assert.equal(request.max_tokens,c.expected.thinking?16384:4096);
 }
});
test('default reasoning is omitted and unsupported choices fail before making a paid request',async()=>{
 for(const type of ['openai','anthropic','gemini','openrouter','ollama','custom']){
  let calls=0;
  const fetchImpl=async(url,options)=>{calls++;const body=JSON.parse(options.body);for(const field of ['reasoning','reasoning_effort','thinking','output_config'])assert.equal(field in body,false);return response(type==='anthropic'?{content:[{type:'text',text:'Done'}]}:completion({content:'Done'}));};
  await runApiAgent({connection:{...connection,type},model:'unknown',reasoningEffort:'',executeTool:async()=>[],fetchImpl});assert.equal(calls,1);
  await assert.rejects(runApiAgent({connection:{...connection,type},model:'unknown',reasoningEffort:'max',executeTool:async()=>[],fetchImpl}),/does not support/);assert.equal(calls,1);
 }
});
test('Responses tool continuation preserves encrypted reasoning, assistant phase, and images',async()=>{
 const requests=[],messages=[];let calls=0;
 const output=[{id:'rs_1',type:'reasoning',summary:[],encrypted_content:'opaque-test-reasoning'},{id:'msg_1',type:'message',role:'assistant',phase:'commentary',status:'completed',content:[{type:'output_text',text:'Checking.',annotations:[]}]},{id:'fc_1',type:'function_call',call_id:'call_1',name:'crew_check',arguments:'{"value":4}',status:'completed'}];
 const result=await runApiAgent({connection,model:'gpt-6-astra',reasoningEffort:'high',system:'Instructions',messages:[{role:'user',text:'Check'}],tools:[tool],onMessage:text=>messages.push(text),executeTool:async(name,args)=>{calls++;assert.equal(name,'crew_check');assert.equal(args.value,4);return [{type:'inputText',text:'Test result'},{type:'inputImage',imageUrl:'data:image/png;base64,YQ=='}];},fetchImpl:async(url,options)=>{
  assert.equal(url,connection.baseUrl+'/responses');requests.push(JSON.parse(options.body));return response({status:'completed',output:requests.length===1?output:[{type:'message',role:'assistant',phase:'final_answer',content:[{type:'output_text',text:'Verified.'}]}]});
 }});
 assert.equal(result.text,'Verified.');assert.equal(calls,1);assert.deepEqual(messages,['Checking.','Verified.']);
 assert.equal(requests[0].store,false);assert.equal(requests[0].instructions,'Instructions');assert.equal(requests[0].tools[0].strict,false);assert.equal(requests[0].tools[0].name,'crew_check');assert.equal('messages' in requests[0],false);
 assert.deepEqual(requests[1].input.slice(1,4),output);assert.deepEqual(requests[1].input[4],{type:'function_call_output',call_id:'call_1',output:'Test result'});
 assert.equal(requests[1].input[5].content[1].type,'input_image');assert.equal(requests[1].input[5].content[1].image_url,'data:image/png;base64,YQ==');assert.equal('previous_response_id' in requests[1],false);
});
test('Responses rejects duplicate or incomplete tool batches before side effects',async()=>{
 let executed=0;
 const call={type:'function_call',call_id:'one',name:'crew_check',arguments:'{"value":1}'};
 for(const result of [{status:'completed',output:[call,call]},{status:'completed',output:[{...call,call_id:null}]},{status:'incomplete',output:[call]},{status:'failed',error:{message:'test-only-secret'},output:[]}]){
  await assert.rejects(runApiAgent({connection,model:'gpt-6-astra',tools:[tool],executeTool:async()=>{executed++;return [];},fetchImpl:async()=>response(result)}),e=>!e.message.includes(connection.key));
 }
 assert.equal(executed,0);
});
test('Responses never runs unknown tools and rejects repeated call IDs across rounds',async()=>{
 let requests=0,executed=0;
 await assert.rejects(runApiAgent({connection,model:'gpt-5.5',tools:[tool],executeTool:async()=>{executed++;return [];},fetchImpl:async(url,options)=>{
  requests++;if(requests===2)assert.match(JSON.parse(options.body).input.find(item=>item.type==='function_call_output').output,/not available/);
  return response({status:'completed',output:[{type:'function_call',call_id:'repeat',name:'shell',arguments:'{}'}]});
 }}),/repeated/);assert.equal(requests,2);assert.equal(executed,0);
});
test('Responses cancellation prevents a second model request',async()=>{
 const controller=new AbortController();let requests=0;
 await assert.rejects(runApiAgent({connection,model:'gpt-5.5',signal:controller.signal,tools:[tool],executeTool:async()=>{controller.abort();return new Promise(()=>{});},fetchImpl:async()=>{requests++;return response({status:'completed',output:[{type:'function_call',call_id:'one',name:'crew_check',arguments:'{"value":1}'}]});}}),e=>e.name==='AbortError');assert.equal(requests,1);
});
for(const type of ['anthropic','custom']){
 const protocol=type==='anthropic'?'Anthropic':'Chat Completions';
 const toolReply=calls=>type==='anthropic'?{content:calls.map(call=>({type:'tool_use',id:call.id,name:call.name,input:{value:1}})),stop_reason:'tool_use'}:completion({content:null,tool_calls:calls.map(call=>({type:'function',id:call.id,function:{name:call.name,arguments:'{"value":1}'}}))});
 test(`${protocol} rejects duplicate IDs and empty identities before any action in the batch`,async()=>{
  const valid={id:'first',name:'crew_check'};
  for(const invalid of [valid,{id:'',name:'crew_check'},{id:'  ',name:'crew_check'},{id:'second',name:''},{id:'second',name:'  '}]){
   let executed=0,requests=0;
   await assert.rejects(runApiAgent({connection:{...connection,type},model:'test-model',tools:[tool],executeTool:async()=>{executed++;return [];},fetchImpl:async()=>{requests++;return response(toolReply([valid,invalid]));}}),/invalid or repeated tool calls/);
   assert.equal(executed,0);assert.equal(requests,1);
  }
 });
 test(`${protocol} rejects a replayed ID in a later round before running that batch`,async()=>{
  let executed=0,requests=0;const first={id:'first',name:'crew_check'},fresh={id:'second',name:'crew_check'};
  await assert.rejects(runApiAgent({connection:{...connection,type},model:'test-model',tools:[tool],executeTool:async()=>{executed++;return [{type:'inputText',text:'Completed once'}];},fetchImpl:async()=>{requests++;return response(toolReply(requests===1?[first]:[fresh,first]));}}),/repeated tool calls/);
  assert.equal(executed,1);assert.equal(requests,2);
 });
}
for(const type of ['openai','anthropic','custom']){
 const protocol=type==='openai'?'Responses':type==='anthropic'?'Anthropic':'Chat Completions';
 async function sentToolOutput(text){
  let requests=0,sent;
  await runApiAgent({connection:{...connection,type},model:type==='openai'?'gpt-6-astra':'test-model',tools:[{...tool,name:'crew_files'}],executeTool:async()=>[{type:'inputText',text}],fetchImpl:async(url,options)=>{
   const first=++requests===1,body=JSON.parse(options.body);
   if(!first)sent=type==='openai'?body.input.find(item=>item.type==='function_call_output').output:type==='anthropic'?body.messages.at(-1).content[0].content[0].text:body.messages.at(-1).content;
   return response(type==='openai'?{status:'completed',output:first?[{type:'function_call',call_id:'file',name:'crew_files',arguments:'{"value":1}'}]:[{type:'message',role:'assistant',content:[{type:'output_text',text:'Done'}]}]}:type==='anthropic'?{stop_reason:first?'tool_use':'end_turn',content:first?[{type:'tool_use',id:'file',name:'crew_files',input:{value:1}}]:[{type:'text',text:'Done'}]}:completion(first?{content:null,tool_calls:[{id:'file',type:'function',function:{name:'crew_files',arguments:'{"value":1}'}}]}:{content:'Done'}));
  }});return sent;
 }
 test(`${protocol} preserves large valid file JSON including its tail and escaped text`,async()=>{
  for(const content of ['x'.repeat(70000)+'TAIL42','\u0000'.repeat(256000)]){
   const file={path:'fixture.txt',bytes:Buffer.byteLength(content),text:content},json=JSON.stringify(file),sent=await sentToolOutput(json);
   assert.equal(sent,json);assert.deepEqual(JSON.parse(sent),file);
  }
 });
 test(`${protocol} explicitly identifies exceptional oversized tool output as truncated`,async()=>{
  const sent=await sentToolOutput('x'.repeat(2*1024*1024+100)+'OMITTED_TAIL');
  assert.match(sent,/^\[Crew truncated this tool output/);assert.match(sent,/may not be valid JSON/);assert.equal(sent.length,2*1024*1024);assert.equal(sent.includes('OMITTED_TAIL'),false);
 });
}
