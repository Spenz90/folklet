import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Engine,crewTools} from './engine.mjs';
import {Store} from './store.mjs';
import {PluginConnections} from './plugin-connections.mjs';

const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function harness(t){
 const bot={id:'bot',name:'Fixture bot',messages:[],events:[]},task={id:'task',botId:'bot',status:'running'};
 const store={db:{bots:[bot],tasks:[task],channels:[],routines:[],notifications:[]},save(){},due(){},bot(id){assert.equal(id,bot.id);return bot;},notify(){},event(b,e){b.events.push(e);}};
 const engine=new Engine(store,{async close(){}});clearInterval(engine.timer);engine.drain=()=>{};
 const live={task,status:'Working',seq:0,requests:new Map(),pending:new Map()};engine.live.set(bot.id,live);t.after(()=>engine.close());return {engine,bot,task,live};
}
test('plugin discovery exposes selected schemas and cannot configure or install',async t=>{
 const {engine,bot,live}=harness(t);engine.plugins={list:()=>[{id:'connection',name:'Tools',type:'mcp',allowedTools:['visible'],tools:[{name:'visible',inputSchema:{type:'object'}},{name:'hidden'}],token:'must-not-leak'}]};
 const result=JSON.parse((await engine.dynamic(bot,live,'crew_plugins',{action:'list'}))[0].text);
 assert.deepEqual(result,[{id:'connection',name:'Tools',type:'mcp',tools:[{name:'visible',inputSchema:{type:'object'}}]}]);
 await assert.rejects(engine.dynamic(bot,live,'crew_plugins',{action:'install'}),/Manage plugin access/);
 assert.deepEqual(crewTools.find(tool=>tool.name==='crew_plugins').inputSchema.properties.action.enum,['list','call']);
});
test('plugin invocation waits for the concrete owner approval',async t=>{
 const {engine,bot,live}=harness(t),asked=deferred();let invoked=false;
 engine.plugins={async run(b,input,{approve}){const permitted=await approve({connectionName:'Fixture MCP',tool:'write_note',arguments:input.arguments,access:'Plugin server'});if(!permitted)throw Error('Declined');invoked=true;return {content:[{type:'text',text:'Saved'}]};}};
 const ask=engine.ask.bind(engine);engine.ask=(...args)=>{const result=ask(...args);asked.resolve();return result;};
 const result=engine.dynamic(bot,live,'crew_plugins',{action:'call',connectionId:'c',tool:'write_note',arguments:{text:'Fixture'}});
 await asked.promise;assert.equal(invoked,false);assert.equal(live.approval.kind,'approval');assert.deepEqual(live.approval.details.arguments,{text:'Fixture'});
 engine.answer(bot,live.approval.id,'accept');assert.match((await result)[0].text,/Saved/);assert.equal(invoked,true);
});
test('an answer to an ended task cannot authorize a plugin call for the next task',async t=>{
 const {engine,bot,live}=harness(t),asked=deferred();let invoked=false;
 engine.plugins={async run(b,input,{approve}){if(!await approve({connectionName:'Fixture',tool:'change',arguments:{}}))throw Error('Declined');invoked=true;}};
 const ask=engine.ask.bind(engine);engine.ask=(...args)=>{const result=ask(...args);asked.resolve();return result;};
 const promise=engine.dynamic(bot,live,'crew_plugins',{action:'call',connectionId:'c',tool:'change',arguments:{}});await asked.promise;
 const request=live.approval.id;live.task={id:'different-task',botId:bot.id,status:'running'};engine.answer(bot,request,'accept');await assert.rejects(promise,/Declined/);assert.equal(invoked,false);
});
test('stopping a Codex task aborts its outstanding plugin request',async t=>{
 const {engine,bot,live}=harness(t),started=deferred();let cancelled=false;
 engine.plugins={run(b,input,{signal}){started.resolve();return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{cancelled=true;reject(Error('Plugin cancelled'));},{once:true}));}};
 const promise=engine.dynamic(bot,live,'crew_plugins',{action:'call',connectionId:'c',tool:'slow',arguments:{}});await started.promise;await engine.interrupt(bot);
 await assert.rejects(promise,/cancelled/);assert.equal(cancelled,true);assert.equal(live.pluginCalls.size,0);
});
test('late plugin results are discarded if the active task changes',async t=>{
 const {engine,bot,live}=harness(t),result=deferred();engine.plugins={run:()=>result.promise};
 const promise=engine.dynamic(bot,live,'crew_plugins',{action:'call',connectionId:'c',tool:'slow',arguments:{}});
 live.task={id:'next-task',status:'running'};result.resolve({text:'stale'});await assert.rejects(promise,/no longer belongs/);
});

async function integrated(t,result={content:[{type:'text',text:'done'}]}){
 const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'folklet-engine-plugins-')),store=new Store(root),bot=store.create({name:'Fixture'}),task=store.enqueue(bot.id,'Fixture task');task.status='running';store.save();
 const calls=[],fetchImpl=async(_url,options)=>{
  const request=JSON.parse(options.body);calls.push(request);
  if(!request.id)return new Response(null,{status:202});
  return Response.json({jsonrpc:'2.0',id:request.id,result:request.method==='initialize'?{protocolVersion:'2025-11-25',capabilities:{tools:{}}}:request.method==='tools/list'?{tools:[{name:'echo',description:'Fixture',inputSchema:{type:'object'}}]}:result});
 };
 const connections=new PluginConnections({dataRoot:root,store,fetchImpl}),engine=new Engine(store,{async close(){}});engine.plugins=connections;clearInterval(engine.timer);engine.drain=()=>{};
 const live={task,status:'Working',seq:0,requests:new Map(),pending:new Map()};engine.live.set(bot.id,live);
 t.after(async()=>{connections.close();await engine.close();fs.rmSync(root,{recursive:true,force:true});});
 const connection=connections.save({name:'Fixture MCP',type:'mcp',transport:'streamable-http',url:'https://mcp.example.invalid/mcp',botIds:[bot.id],allowedTools:['echo'],token:'fixture-private-token'});await connections.connect({id:connection.id,confirmed:true});
 return {engine,bot,task,live,store,connections,calls,id:connection.id};
}
test('removing a real connection cancels and persists its pending engine approval without dispatch',async t=>{
 const f=await integrated(t),asked=deferred(),ask=f.engine.ask.bind(f.engine);f.engine.ask=(...args)=>{const promise=ask(...args);asked.resolve();return promise;};
 const work=f.engine.dynamic(f.bot,f.live,'crew_plugins',{action:'call',connectionId:f.id,tool:'echo',arguments:{}});await asked.promise;
 const requestId=f.live.approval.id;assert.equal(f.task.status,'waiting');f.connections.remove(f.id);
 await assert.rejects(work,/cancelled/);assert.equal(f.calls.filter(call=>call.method==='tools/call').length,0);
 assert.equal(f.live.requests.size,0);assert.equal(f.live.approval,null);assert.equal(f.live.status,'Working');assert.equal(f.task.status,'running');assert.equal(f.live.pluginCalls.size,0);
 assert.equal(JSON.parse(fs.readFileSync(f.store.file,'utf8')).tasks.find(task=>task.id===f.task.id).status,'running');
 assert.throws(()=>f.engine.answer(f.bot,requestId,'accept'),/no longer active/);
});
test('revoking one plugin approval preserves an unrelated pending question',async t=>{
 const f=await integrated(t),asked=deferred(),ask=f.engine.ask.bind(f.engine);
 const other=f.engine.ask(f.bot,f.live,{kind:'question',title:'Unrelated question'}),otherId=f.live.approval.id;
 f.engine.ask=(...args)=>{const promise=ask(...args);asked.resolve();return promise;};
 const work=f.engine.dynamic(f.bot,f.live,'crew_plugins',{action:'call',connectionId:f.id,tool:'echo',arguments:{}});await asked.promise;
 f.connections.save({id:f.id,botIds:[]});await assert.rejects(work,/cancelled/);
 assert.equal(f.live.requests.size,1);assert.equal(f.live.approval.id,otherId);assert.equal(f.live.status,'Needs you');assert.equal(f.task.status,'waiting');
 f.engine.answer(f.bot,otherId,'answer');assert.equal(await other,'answer');assert.equal(f.live.status,'Working');assert.equal(f.calls.some(call=>call.method==='tools/call'),false);
});
test('approval cancellation cannot restore ended or replacement tasks to running',async t=>{
 for(const state of ['completed','stopping','replacement']){
  const {engine,bot,task,live}=harness(t),controller=new AbortController(),pending=engine.ask(bot,live,{kind:'approval',title:'Fixture',signal:controller.signal});
  if(state==='replacement')live.task={id:'new',status:'queued'};else if(state==='stopping')task.cancelRequested=true;else task.status='completed';
  live.status=state==='replacement'?'Starting':state==='stopping'?'Stopping':'Ready';const expectedTaskStatus=live.task.status,expectedStatus=live.status;
  controller.abort();await assert.rejects(pending,{name:'AbortError'});assert.equal(live.requests.size,0);assert.equal(live.approval,null);assert.equal(live.task.status,expectedTaskStatus);assert.equal(live.status,expectedStatus);
 }
});

const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ9sAAAAASUVORK5CYII=';
test('real MCP images reach the model separately from compact sanitized structured text',async t=>{
 const result={content:[{type:'text',text:'Image fixture-private-token'},{type:'image',mimeType:'image/png',data:png}],structuredContent:{note:'fixture-private-token',value:12}},f=await integrated(t,result),asked=deferred(),ask=f.engine.ask.bind(f.engine);
 f.engine.ask=(...args)=>{const promise=ask(...args);asked.resolve();return promise;};
 const work=f.engine.dynamic(f.bot,f.live,'crew_plugins',{action:'call',connectionId:f.id,tool:'echo',arguments:{}});await asked.promise;f.engine.answer(f.bot,f.live.approval.id,'accept');
 const content=await work,summary=JSON.parse(content[0].text);assert.equal(content[0].text.includes(png),false);assert.equal(content[0].text.includes('fixture-private-token'),false);assert.equal(summary.untrustedContent,true);
 assert.deepEqual(summary.result.structuredContent,{note:'[redacted]',value:12});assert.deepEqual(summary.result.content[1],{type:'image',mimeType:'image/png',bytes:Buffer.from(png,'base64').length,imageIndex:1});
 assert.deepEqual(content[1],{type:'inputImage',imageUrl:'data:image/png;base64,'+png});assert.equal(f.calls.filter(call=>call.method==='tools/call').length,1);assert.equal(result.content[1].data,png);
});
test('malformed MIME, base64, mismatched raster signatures and remote image URLs are omitted',async t=>{
 let fetches=0;t.mock.method(globalThis,'fetch',async()=>{fetches++;throw Error('No remote images should be fetched.');});
 const {engine,bot,live}=harness(t),invalid=[
  {type:'image',mimeType:'image/svg+xml',data:Buffer.from('<svg/>').toString('base64')},
  {type:'image',mimeType:{toString:'invalid'},data:png},
  {type:'image',mimeType:'image/png',data:png+'!'},
  {type:'image',mimeType:'image/png',data:png.replace(/=$/,'')},
  {type:'image',mimeType:'image/png',data:'A==='},
  {type:'image',mimeType:'image/jpeg',data:png},
  {type:'image',mimeType:'image/png',data:Buffer.from('<html>not an image</html>').toString('base64')},
  {type:'image',mimeType:'image/png',url:'https://private.example.invalid/never-fetched'},
  {type:'image',mimeType:'image/png',data:'A'.repeat(3*1024*1024)}
 ];
 engine.plugins={run:async()=>({content:invalid,structuredContent:{source:'fixture'}})};
 const content=await engine.dynamic(bot,live,'crew_plugins',{action:'call',connectionId:'fixture',tool:'echo',arguments:{}}),summary=JSON.parse(content[0].text);
 assert.equal(content.length,1);assert.equal(summary.content.length,invalid.length);assert.equal(content[0].text.includes('private.example.invalid'),false);assert.equal(content[0].text.includes(png),false);
 for(const item of summary.content)assert.match(item.omitted,/invalid embedded image/);assert.deepEqual(summary.structuredContent,{source:'fixture'});assert.equal(fetches,0);
});
test('plugin image count is bounded and long useful structured text is preserved',async t=>{
 const {engine,bot,live}=harness(t),text='x'.repeat(70000)+'TAIL';engine.plugins={run:async()=>({content:Array.from({length:10},()=>({type:'image',mimeType:'image/png',data:png})),structuredContent:{text}})};
 const content=await engine.dynamic(bot,live,'crew_plugins',{action:'call',connectionId:'fixture',tool:'echo',arguments:{}}),summary=JSON.parse(content[0].text);
 assert.equal(content.filter(item=>item.type==='inputImage').length,8);assert.equal(summary.structuredContent.text,text);assert.match(summary.content[8].omitted,/limit reached/);
});
