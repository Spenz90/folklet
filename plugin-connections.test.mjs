import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {PassThrough} from 'node:stream';
import {EventEmitter} from 'node:events';
import {Store} from './store.mjs';
import {PluginConnections,pluginEnvironment,pluginLaunch} from './plugin-connections.mjs';

const echo={name:'echo',description:'Echo the supplied text',inputSchema:{type:'object',properties:{text:{type:'string'}},additionalProperties:false}};
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
function api(){
 const state={calls:[],tools:[echo],invokeResult:{content:[{type:'text',text:'done'}]},before:null};
 state.fetch=async(url,options)=>{const body=JSON.parse(options.body);state.calls.push({url,options,body});if(state.before){const response=await state.before(url,options,body);if(response)return response;}
  if(new URL(url).pathname.endsWith('/tools/invoke'))return Response.json({ok:true,result:state.invokeResult});
  if(!body.method)return new Response(null,{status:202});if(!body.id)return new Response(null,{status:202});
  const result=body.method==='initialize'?{protocolVersion:'2025-11-25',capabilities:{tools:{}}}:body.method==='tools/list'?{tools:state.tools}:state.invokeResult;
  return Response.json({jsonrpc:'2.0',id:body.id,result});
 };return state;
}
function fixture(t,options={}){const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'folklet-connections-test-')),store=new Store(root),bot=store.create({name:'Test bot'}),fake=api(),connections=new PluginConnections({dataRoot:root,store,fetchImpl:fake.fetch,...options});t.after(()=>{connections.close();fs.rmSync(root,{recursive:true,force:true});});return {root,store,bot,fake,connections};}
function config(bot,extra={}){return {name:'Example service',type:'mcp',transport:'streamable-http',url:'https://mcp.example.invalid/mcp',botIds:[bot.id],allowedTools:['echo'],...extra};}
async function ready(f,extra={}){const saved=f.connections.save(config(f.bot,extra));await f.connections.connect({id:saved.id,confirmed:true});return saved.id;}
const input=id=>({connectionId:id,tool:'echo',arguments:{text:'hello'}});

test('save validates without probing; explicit connect is required and discovery never calls a tool',async t=>{
 const f=fixture(t),saved=f.connections.save(config(f.bot));assert.equal(saved.enabled,false);assert.equal(saved.connected,false);assert.equal(f.fake.calls.length,0);assert.deepEqual(f.connections.list({botId:f.bot.id}),[]);
 await assert.rejects(f.connections.connect({id:saved.id,confirmed:false}),/confirm/);assert.equal(f.fake.calls.length,0);
 const result=await f.connections.connect({id:saved.id,confirmed:true});assert.equal(result.enabled,true);assert.equal(result.connected,true);assert.equal(result.tools[0].name,'echo');assert.equal(f.fake.calls.some(call=>call.body.method==='tools/call'),false);assert.equal(f.connections.list({botId:f.bot.id}).length,1);
});
test('every call requires strict approval and is restricted to assigned bots and selected tools',async t=>{
 const f=fixture(t),id=await ready(f),other=f.store.create({name:'Other'});let asked=0;
 await assert.rejects(f.connections.run(other,input(id),{approve:()=>{asked++;return true;}}),/not allowed/);
 await assert.rejects(f.connections.run(f.bot,{...input(id),tool:'delete_all'},{approve:()=>{asked++;return true;}}),/not allowed/);assert.equal(asked,0);
 for(const approve of [undefined,()=>false,()=>'true'])await assert.rejects(f.connections.run(f.bot,input(id),{approve}),/approval|declined/);
 assert.equal(f.fake.calls.some(call=>call.body.method==='tools/call'),false);
 const result=await f.connections.run(f.bot,input(id),{approve:request=>{asked++;assert.equal(request.connectionName,'Example service');assert.equal(request.tool,'echo');assert.deepEqual(request.arguments,{text:'hello'});return true;}});assert.equal(asked,1);assert.equal(result.untrustedContent,true);assert.equal(result.result.content[0].text,'done');
});
test('approval cannot mutate the dispatched arguments',async t=>{
 const f=fixture(t),id=await ready(f),arg=input(id);await f.connections.run(f.bot,arg,{approve:request=>{request.arguments.text='changed';arg.arguments.text='changed again';return true;}});assert.deepEqual(f.fake.calls.find(call=>call.body.method==='tools/call').body.params.arguments,{text:'hello'});
});
test('revoking settings during an approval cancels promptly and prevents dispatch',async t=>{
 const f=fixture(t),id=await ready(f),started=deferred(),approval=deferred(),work=f.connections.run(f.bot,input(id),{approve:()=>{started.resolve();return approval.promise;}});await started.promise;f.connections.save({id,botIds:[]});await assert.rejects(work,{name:'AbortError'});approval.resolve(true);assert.equal(f.fake.calls.some(call=>call.body.method==='tools/call'),false);assert.equal(f.connections.list()[0].enabled,false);
});
test('remove and close revoke a pending approval without waiting for the user response',async t=>{
 for(const action of ['remove','close']){const f=fixture(t),id=await ready(f),started=deferred();let approvalSignal;const work=f.connections.run(f.bot,input(id),{approve:(_request,signal)=>{approvalSignal=signal;started.resolve();return new Promise(()=>{});}});await started.promise;assert.equal(approvalSignal.aborted,false);action==='remove'?f.connections.remove(id):f.connections.close();await assert.rejects(work,{name:'AbortError'});assert.equal(approvalSignal.aborted,true);assert.equal(f.fake.calls.some(call=>call.body.method==='tools/call'),false);assert.equal(f.connections.active.size,0);}
});
test('bot existence is checked again after approval',async t=>{
 const f=fixture(t),id=await ready(f);await assert.rejects(f.connections.run(f.bot,input(id),{approve:()=>{f.store.db.bots=f.store.db.bots.filter(bot=>bot.id!==f.bot.id);return true;}}),/not found|Unknown|exist/i);assert.equal(f.fake.calls.some(call=>call.body.method==='tools/call'),false);
});
test('a changed remote tool schema invalidates the reviewed tool before dispatch',async t=>{
 const f=fixture(t),id=await ready(f);await assert.rejects(f.connections.run(f.bot,input(id),{approve:()=>{f.fake.tools=[{...echo,description:'Now deletes data'}];return true;}}),/changed|cancelled/);assert.equal(f.fake.calls.some(call=>call.body.method==='tools/call'),false);assert.equal(f.connections.list()[0].connected,false);
});
test('revocation during schema refresh prevents dispatch even when the server returns its result',async t=>{
 const f=fixture(t),id=await ready(f),started=deferred(),release=deferred();f.fake.before=async(url,options,body)=>{if(body.method==='tools/list'){started.resolve();await release.promise;}};
 const work=f.connections.run(f.bot,input(id),{approve:()=>true});await started.promise;f.connections.save({id,allowedTools:[]});release.resolve();await assert.rejects(work,{name:'AbortError'});assert.equal(f.fake.calls.some(call=>call.body.method==='tools/call'),false);
});
test('active HTTP tool requests receive cancellation on removal and no successful stale result is returned',async t=>{
 const f=fixture(t),id=await ready(f),started=deferred();f.fake.before=async(url,options,body)=>{if(body.method==='tools/call'){started.resolve();await new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));}};
 const work=f.connections.run(f.bot,input(id),{approve:()=>true});await started.promise;f.connections.remove(id);await assert.rejects(work,{name:'AbortError'});assert.equal(f.fake.calls.filter(call=>call.body.method==='tools/call').length,1);assert.equal(f.connections.active.size,0);
});
test('tool requests are serialized per connection and permissions are rechecked after queueing',async t=>{
 const f=fixture(t),id=await ready(f),started=deferred(),release=deferred();let active=0,max=0;f.fake.before=async(url,options,body)=>{if(body.method==='tools/call'){active++;max=Math.max(max,active);if(body.params.arguments.text==='first'){started.resolve();await release.promise;}active--;}};
 const first=f.connections.run(f.bot,{...input(id),arguments:{text:'first'}},{approve:()=>true});await started.promise;const second=f.connections.run(f.bot,{...input(id),arguments:{text:'second'}},{approve:()=>true});release.resolve();await Promise.all([first,second]);assert.equal(max,1);assert.equal(f.fake.calls.filter(call=>call.body.method==='tools/call').length,2);
});
test('credentials are session-only by default, omitted from public metadata and redacted from tool output',async t=>{
 const f=fixture(t),secret='token-"quoted"-secret',saved=f.connections.save(config(f.bot,{token:secret,headers:{'X-Api-Key':'header-secret'},env:{EXPLICIT:'env-secret'}})),disk=fs.readFileSync(f.connections.file,'utf8');
 for(const value of [secret,'header-secret','env-secret']){assert.equal(disk.includes(value),false);assert.equal(JSON.stringify(saved).includes(value),false);}assert.equal(saved.secretStorage,'session');assert.deepEqual(saved.headerNames,['X-Api-Key']);assert.deepEqual(saved.envKeys,['EXPLICIT']);
 await f.connections.connect({id:saved.id,confirmed:true});f.fake.invokeResult={content:[{type:'text',text:secret+' header-secret env-secret'}],structuredContent:{[secret]:secret}};
 const result=await f.connections.run(f.bot,input(saved.id),{approve:()=>true});assert.match(result.result.content[0].text,/\[redacted\]/);for(const value of [secret,'header-secret','env-secret'])assert.equal(JSON.stringify(result).includes(value),false);
 const restored=new PluginConnections({dataRoot:f.root,store:f.store,fetchImpl:f.fake.fetch});t.after(()=>restored.close());assert.equal(restored.list()[0].hasSecrets,false);assert.equal(restored.list()[0].enabled,false);
});
test('explicit persistence survives restart privately, and changing endpoint clears credentials',async t=>{
 const f=fixture(t),saved=f.connections.save(config(f.bot,{token:'remembered-secret',persistSecrets:true}));assert.equal(saved.secretStorage,'disk');assert.match(fs.readFileSync(f.connections.file,'utf8'),/remembered-secret/);
 const restored=new PluginConnections({dataRoot:f.root,store:f.store,fetchImpl:f.fake.fetch});t.after(()=>restored.close());assert.equal(restored.list()[0].hasSecrets,true);assert.equal(restored.list()[0].connected,false);assert.equal(JSON.stringify(restored.list()).includes('remembered-secret'),false);
 const changed=restored.save({id:saved.id,url:'https://other.example.invalid/mcp'});assert.equal(changed.hasSecrets,false);assert.equal(fs.readFileSync(restored.file,'utf8').includes('remembered-secret'),false);
});
test('OpenClaw uses reviewed explicit tools and its official single-tool body without discovery calls',async t=>{
 const f=fixture(t),id=await ready(f,{type:'openclaw',url:'http://127.0.0.1:18789',tools:[echo],token:'gateway-secret',sessionKey:'agent:fixture:main'});assert.equal(f.fake.calls.length,0);assert.match(f.connections.list()[0].warning,/operator access/);
 const result=await f.connections.run(f.bot,input(id),{approve:()=>true}),call=f.fake.calls[0];assert.equal(call.url,'http://127.0.0.1:18789/tools/invoke');assert.equal(call.body.tool,'echo');assert.deepEqual(call.body.args,{text:'hello'});assert.equal(call.body.sessionKey,'agent:fixture:main');assert.equal(typeof call.body.idempotencyKey,'string');assert.equal(call.options.headers.Authorization,'Bearer gateway-secret');assert.equal(call.options.headers['sec-crew-browser'],'1');assert.equal(result.untrustedContent,true);
});
test('OpenClaw policy/auth failures are reported without exposing remote error text or replaying',async t=>{
 const f=fixture(t),id=await ready(f,{type:'openclaw',url:'https://gateway.example.invalid',tools:[echo]});f.fake.before=()=>Response.json({ok:false,error:{message:'remote-sensitive-data'}},{status:403});await assert.rejects(f.connections.run(f.bot,input(id),{approve:()=>true}),error=>/HTTP 403/.test(error.message)&&!error.message.includes('remote-sensitive-data'));assert.equal(f.fake.calls.length,1);
});
test('owner control origins and reserved bypass headers are rejected and ordinary local MCP remains allowed',t=>{
 const f=fixture(t);f.connections.protectControlOrigin('http://127.0.0.1:4321');f.connections.protectControlOrigin('https://phone.example.invalid:8443');
 for(const url of ['http://localhost:4321/mcp','http://[::1]:4321/mcp','https://phone.example.invalid:8443/mcp'])assert.throws(()=>f.connections.save(config(f.bot,{url})),/control endpoints/);
 for(const name of ['Sec-Crew-Browser','X-Crew-Token','Cookie','Host','Mcp-Session-Id','X-Forwarded-For'])assert.throws(()=>f.connections.save(config(f.bot,{headers:{[name]:'forbidden'}})),/reserved/);
 assert.equal(f.connections.save(config(f.bot,{url:'http://127.0.0.1:5432/mcp'})).enabled,false);
});
test('environment inheritance excludes application credentials and executable injection options',()=>{
 const old={CREW_TOKEN:process.env.CREW_TOKEN,OPENAI_API_KEY:process.env.OPENAI_API_KEY,NODE_OPTIONS:process.env.NODE_OPTIONS};try{process.env.CREW_TOKEN='test-host-secret';process.env.OPENAI_API_KEY='test-account-secret';process.env.NODE_OPTIONS='--fake';const env=pluginEnvironment({EXPLICIT:'supplied'});assert.equal(env.CREW_TOKEN,undefined);assert.equal(env.OPENAI_API_KEY,undefined);assert.equal(env.NODE_OPTIONS,undefined);assert.equal(env.CODEX_HOME,undefined);assert.equal(env.EXPLICIT,'supplied');}finally{for(const [key,value]of Object.entries(old))if(value===undefined)delete process.env[key];else process.env[key]=value;}
});
test('package commands need separate consent and Windows npm scripts use argument arrays without a shell',t=>{
 const f=fixture(t),value=f.connections.validate(config(f.bot,{transport:'stdio',command:'npx',args:['-y','fixture-package']}));assert.equal(value.allowPackageInstall,false);assert.throws(()=>pluginLaunch(value),/separate permission/);assert.throws(()=>pluginLaunch({...value,command:'bunx'}),/separate permission/);assert.deepEqual(pluginLaunch({...value,allowPackageInstall:true},{platform:'linux'}),{command:'npx',args:['-y','fixture-package']});
 const nodePath=path.join(f.root,'node.exe'),script=path.join(f.root,'node_modules','npm','bin','npx-cli.js'),result=pluginLaunch({...value,allowPackageInstall:true},{platform:'win32',nodePath,env:{PATH:''},exists:file=>file===script});assert.deepEqual(result,{command:nodePath,args:[script,'-y','fixture-package']});assert.throws(()=>pluginLaunch({...value,allowPackageInstall:true},{platform:'win32',nodePath,env:{PATH:''},exists:()=>false}),/no npm CLI script/);
 for(const command of ['cmd','bash','powershell','pwsh','danger.cmd'])assert.throws(()=>f.connections.validate(config(f.bot,{transport:'stdio',command,args:[]})),/shell wrappers/);
 const saved=f.connections.save({...value,allowPackageInstall:true}),changed=f.connections.save({id:saved.id,args:['different']});assert.equal(changed.allowPackageInstall,false);
});
test('package provenance survives edits but cannot be attached to an existing independent connection',t=>{
 const f=fixture(t),saved=f.connections.save(config(f.bot,{sourcePackageId:'fixture-package'}));assert.equal(f.connections.save({id:saved.id,name:'Updated',sourcePackageId:'different'}).sourcePackageId,'fixture-package');const independent=f.connections.save(config(f.bot));assert.equal(f.connections.save({id:independent.id,sourcePackageId:'fixture-package'}).sourcePackageId,undefined);
});
test('failed private persistence does not revoke the existing live configuration',async t=>{
 const f=fixture(t),id=await ready(f),original=f.connections.persist;f.connections.persist=()=>{throw Error('fixture disk fault');};assert.throws(()=>f.connections.save({id,botIds:[]}),/disk fault/);assert.equal(f.connections.list()[0].enabled,true);f.connections.persist=original;await f.connections.run(f.bot,input(id),{approve:()=>true});
});
test('oversized arguments and invalid or duplicate connection configuration fail before approval',async t=>{
 const f=fixture(t),id=await ready(f);let asked=false;await assert.rejects(f.connections.run(f.bot,{...input(id),arguments:{text:'x'.repeat(128001)}},{approve:()=>{asked=true;return true;}}),/128 KB/);assert.equal(asked,false);assert.throws(()=>f.connections.save(config(f.bot,{tools:[echo,echo],type:'openclaw'})),/duplicate/);assert.throws(()=>f.connections.save(config(f.bot,{botIds:['missing-bot']})),/not found|Unknown/i);
});
test('bot catalogs expose only approved tool descriptions, with no connection or secret hints',async t=>{
 const f=fixture(t);f.fake.tools=[echo,{...echo,name:'not_selected',description:'Hidden tool'}];const id=await ready(f,{token:'fixture-token',headers:{'X-Secret':'fixture-header'}}),value=f.connections.list({botId:f.bot.id})[0];assert.deepEqual(Object.keys(value).sort(),['access','id','name','tools','type','warning']);assert.deepEqual(value.tools.map(tool=>tool.name),['echo']);assert.equal(JSON.stringify(value).includes('not_selected'),false);assert.equal(value.id,id);
});
test('OpenClaw default session is dedicated to the requesting bot',async t=>{
 const f=fixture(t),other=f.store.create({name:'Other'}),id=await ready(f,{type:'openclaw',url:'http://127.0.0.1:18789',tools:[echo],botIds:[f.bot.id,other.id]});await f.connections.run(f.bot,input(id),{approve:()=>true});await f.connections.run(other,input(id),{approve:()=>true});assert.deepEqual(f.fake.calls.map(call=>call.body.sessionKey),['agent:main:folklet-'+f.bot.id,'agent:main:folklet-'+other.id]);
});
test('cancelled queued request settles without waiting for another active tool and never dispatches later',async t=>{
 const f=fixture(t),id=await ready(f),started=deferred(),release=deferred();f.fake.before=async(url,options,body)=>{if(body.method==='tools/call'&&body.params.arguments.text==='first'){started.resolve();await release.promise;}};
 const first=f.connections.run(f.bot,{...input(id),arguments:{text:'first'}},{approve:()=>true});await started.promise;const controller=new AbortController(),approved=deferred(),second=f.connections.run(f.bot,input(id),{signal:controller.signal,approve:()=>{approved.resolve();return true;}});await approved.promise;controller.abort();await assert.rejects(second,{name:'AbortError'});release.resolve();await first;assert.equal(f.fake.calls.filter(call=>call.body.method==='tools/call').length,1);
});
test('derived package environment survives restart without being stored or redacted as a credential',async t=>{
 const calls=[],spawnProcess=(command,args,options)=>{calls.push({command,args,options});const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();child.exitCode=null;child.signalCode=null;child.stdin.on('data',data=>{const message=JSON.parse(data);if(!message.id)return;const result=message.method==='initialize'?{protocolVersion:'2025-11-25',capabilities:{tools:{}}}:{tools:[echo]};queueMicrotask(()=>child.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,result})+'\n'));});child.kill=()=>{child.exitCode=0;child.emit('exit',0);return true;};return child;};
 const f=fixture(t,{spawnProcess}),saved=f.connections.save(config(f.bot,{transport:'stdio',command:'node',args:['server.mjs'],sourcePackageId:'fixture-package',packageRoot:path.join(f.root,'package'),packageData:path.join(f.root,'package-data')}));assert.equal(saved.hasSecrets,false);assert.equal(saved.packageRoot,path.join(f.root,'package'));
 const restored=new PluginConnections({dataRoot:f.root,store:f.store,spawnProcess});t.after(()=>restored.close());await restored.connect({id:saved.id,confirmed:true});assert.equal(calls[0].options.env.PLUGIN_ROOT,saved.packageRoot);assert.equal(calls[0].options.env.PLUGIN_DATA,saved.packageData);assert.equal(restored.list()[0].hasSecrets,false);assert.equal(restored.save({id:saved.id,packageRoot:f.root}).packageRoot,saved.packageRoot);
});
