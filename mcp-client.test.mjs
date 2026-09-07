import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {once} from 'node:events';
import {MCPClient,MCP_MAX_BYTES,safePluginURL,normalizeTools} from './mcp-client.mjs';

const tool={name:'echo',description:'Echo harmless text',inputSchema:{type:'object',properties:{text:{type:'string'}}}};
const initialized={protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}};
async function host(t,handler){const requests=[],server=http.createServer(async(req,res)=>{try{const chunks=[];for await(const chunk of req)chunks.push(chunk);const message=JSON.parse(Buffer.concat(chunks).toString()||'{}');requests.push({message,headers:req.headers,method:req.method});await handler(message,req,res);}catch(error){if(!res.headersSent)res.writeHead(500);res.end();}});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});return {url:'http://127.0.0.1:'+server.address().port+'/mcp',requests};}
function answer(res,message,result,headers={}){res.writeHead(200,{'Content-Type':'application/json',...headers});res.end(JSON.stringify({jsonrpc:'2.0',id:message.id,result}));}
function basic(message,req,res){if(message.method==='initialize')answer(res,message,initialized,{'Mcp-Session-Id':'fixture-session'});else if(!message.id){res.writeHead(202);res.end();}else if(message.method==='tools/list')answer(res,message,{tools:[tool]});else answer(res,message,{content:[{type:'text',text:JSON.stringify(message.params.arguments)}]});}
const processRoots=new Map();
function client(t,options){const value=new MCPClient(options);processRoots.get(options.cwd)?.add(value);t.after(()=>value.close());return value;}

test('Streamable HTTP negotiates capabilities, session headers, initialized notice and paginated tools',async t=>{
 const fixture=await host(t,(message,req,res)=>{if(message.method==='tools/list')answer(res,message,message.params.cursor?{tools:[{...tool,name:'second'}]}:{tools:[tool],nextCursor:'second-page'});else basic(message,req,res);});
 const c=client(t,{transport:'streamable-http',url:fixture.url}),tools=await c.connect();assert.deepEqual(tools.map(value=>value.name),['echo','second']);
 const result=await c.callTool('echo',{text:'hello'});assert.equal(JSON.parse(result.content[0].text).text,'hello');
 assert.equal(fixture.requests[0].message.method,'initialize');assert.deepEqual(fixture.requests[0].message.params.capabilities,{});
 assert.equal(fixture.requests[1].message.method,'notifications/initialized');
 for(const request of fixture.requests){assert.equal(request.headers['sec-crew-browser'],'1');assert.match(request.headers.accept,/application\/json.*text\/event-stream/);if(request.message.method!=='initialize'){assert.equal(request.headers['mcp-session-id'],'fixture-session');assert.equal(request.headers['mcp-protocol-version'],'2025-11-25');}}
});
test('SSE handles split UTF-8 and refuses server sampling/elicitation before delivering exact result',async t=>{
 const fixture=await host(t,async(message,req,res)=>{
  if(message.method==='tools/call'){
   res.writeHead(200,{'Content-Type':'text/event-stream'});
   res.write('id: prime\ndata:\n\n');
   res.write('data: '+JSON.stringify({jsonrpc:'2.0',id:'server-sample',method:'sampling/createMessage',params:{}})+'\n\n');
   res.write('data: '+JSON.stringify({jsonrpc:'2.0',id:'server-ask',method:'elicitation/create',params:{}})+'\n\n');
   const bytes=Buffer.from('data: '+JSON.stringify({jsonrpc:'2.0',id:message.id,result:{content:[{type:'text',text:'Résumé 🐝'}]}})+'\r\n\r\n');const at=bytes.indexOf(Buffer.from('🐝'))+1;res.write(bytes.subarray(0,at));setImmediate(()=>res.end(bytes.subarray(at)));
  }else if(message.error){res.writeHead(202);res.end();}else basic(message,req,res);
 });
 const c=client(t,{transport:'streamable-http',url:fixture.url});await c.connect();assert.equal((await c.callTool('echo',{})).content[0].text,'Résumé 🐝');
 const rejected=fixture.requests.filter(value=>value.message.error);assert.deepEqual(rejected.map(value=>value.message.error.code),[-32601,-32601]);assert.deepEqual(rejected.map(value=>value.message.id),['server-sample','server-ask']);
});
test('MCP tools may omit their optional description without blocking discovery or calls',async t=>{
 const {description,...minimal}=tool,fixture=await host(t,(message,req,res)=>{if(message.method==='tools/list')answer(res,message,{tools:[minimal]});else basic(message,req,res);});
 const c=client(t,{transport:'streamable-http',url:fixture.url});assert.deepEqual(await c.connect(),[{...minimal,description:''}]);assert.equal(JSON.parse((await c.callTool('echo',{text:'minimal schema'})).content[0].text).text,'minimal schema');
 for(const description of [null,7,{},'x'.repeat(12001)])assert.throws(()=>normalizeTools([{...minimal,description}]),/description/);
});
test('HTTP redirects never receive connection credentials at the redirect target',async t=>{
 let leaked=0;const destination=await host(t,()=>{leaked++;}),fixture=await host(t,(message,req,res)=>{res.writeHead(302,{Location:destination.url});res.end();});
 const c=client(t,{transport:'streamable-http',url:fixture.url,headers:{Authorization:'Bearer fixture-secret'}});await assert.rejects(c.connect());assert.equal(leaked,0);
});
test('expired HTTP session is not silently reinitialized or replayed',async t=>{
 let calls=0;const fixture=await host(t,(message,req,res)=>{if(message.method==='tools/call'){calls++;res.writeHead(404);res.end();}else basic(message,req,res);});const c=client(t,{transport:'streamable-http',url:fixture.url});await c.connect();await assert.rejects(c.callTool('echo',{}),/expired/);assert.equal(calls,1);assert.equal(fixture.requests.filter(value=>value.message.method==='initialize').length,1);assert.equal(c.closed,true);assert.equal(c.ready,false);
});
test('unsupported versions and missing tools capabilities fail before initialized notification',async t=>{
 for(const result of [{...initialized,protocolVersion:'2099-01-01'},{...initialized,capabilities:{sampling:{}}}]){const fixture=await host(t,(message,req,res)=>answer(res,message,result));const c=client(t,{transport:'streamable-http',url:fixture.url});await assert.rejects(c.connect(),/supported MCP tools/);assert.equal(fixture.requests.length,1);assert.equal(c.closed,true);}
});
test('oversized HTTP result, wrong response identity and broken SSE cannot become tool results',async t=>{
 for(const mode of ['large','wrong','broken']){const fixture=await host(t,(message,req,res)=>{if(message.method!=='tools/call')return basic(message,req,res);if(mode==='large')answer(res,message,{content:[{type:'text',text:'x'.repeat(MCP_MAX_BYTES)}]});else if(mode==='wrong')answer(res,{id:'someone-else'},{content:[]});else{res.writeHead(200,{'Content-Type':'text/event-stream'});res.end('data: '+JSON.stringify({jsonrpc:'2.0',method:'notifications/progress',params:{}})+'\n\n');}});const c=client(t,{transport:'streamable-http',url:fixture.url});await c.connect();await assert.rejects(c.callTool('echo',{}),mode==='large'?/limit/:mode==='wrong'?/different request/:/ended before/);}
});
test('tool discovery rejects duplicate names and repeating cursors',async t=>{
 for(const mode of ['duplicate','cursor']){const fixture=await host(t,(message,req,res)=>{if(message.method==='tools/list')answer(res,message,mode==='duplicate'?{tools:[tool,tool]}:{tools:[],nextCursor:'again'});else basic(message,req,res);});const c=client(t,{transport:'streamable-http',url:fixture.url});await assert.rejects(c.connect(),/duplicate|cursor/);}
});
test('abort cancels a pending HTTP read and does not replay its action',async t=>{
 let started;const began=new Promise(resolve=>started=resolve),fixture=await host(t,(message,req,res)=>{if(message.method==='tools/call'){started();return;}basic(message,req,res);});const c=client(t,{transport:'streamable-http',url:fixture.url});await c.connect();const controller=new AbortController(),work=c.callTool('echo',{}, {signal:controller.signal});await began;controller.abort();await assert.rejects(work,{name:'AbortError'});assert.equal(fixture.requests.filter(value=>value.message.method==='tools/call').length,1);assert.equal(c.closed,true);
});

function processFixture(t){const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'folklet-mcp-test-')),file=path.join(root,'server.mjs');processRoots.set(root,new Set());fs.writeFileSync(file,`import readline from 'node:readline';import {spawn} from 'node:child_process';
const send=value=>process.stdout.write(JSON.stringify(value)+'\\n');
const line=readline.createInterface({input:process.stdin});
line.on('line',data=>{const m=JSON.parse(data);if(m.error){globalThis.denied=(globalThis.denied||0)+1;return;}
if(m.method==='initialize'){send({jsonrpc:'2.0',id:m.id,result:${JSON.stringify(initialized)}});}
else if(m.method==='tools/list')send({jsonrpc:'2.0',id:m.id,result:{tools:[${JSON.stringify(tool)}]}});
else if(m.method==='tools/call'){
 if(m.params.arguments.descendant){const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});send({jsonrpc:'2.0',id:m.id,result:{content:[{type:'text',text:String(child.pid)}]}});return;}
 if(m.params.arguments.hang)return;
 if(m.params.arguments.invalid){process.stdout.write('not-json\\n');return;}
 if(m.params.arguments.big){process.stdout.write('x'.repeat(2200000));return;}
 send({jsonrpc:'2.0',id:m.id,result:{content:[{type:'text',text:JSON.stringify({text:'hello 🐝',denied:globalThis.denied||0,env:process.env.EXPLICIT,ambient:process.env.CREW_TOKEN||null})},{type:'image',mimeType:'image/png',data:'ZmFrZQ=='}]}});
}else if(m.method==='notifications/initialized'){
process.stderr.write('fixture-secret'.repeat(4000));
send({jsonrpc:'2.0',id:'ask',method:'elicitation/create',params:{}});
send({jsonrpc:'2.0',id:'sample',method:'sampling/createMessage',params:{}});
}
});
line.on('close',()=>process.exit(0));`);
 t.after(async()=>{for(const c of processRoots.get(root)){const child=c.child,ended=child&&child.exitCode===null&&child.signalCode===null?once(child,'exit'):Promise.resolve();c.close();await ended;}processRoots.delete(root);fs.rmSync(root,{recursive:true,force:true});});return {root,file};}
test('real stdio process negotiates newline JSON-RPC, denies requests and preserves structured content',async t=>{
 const {root,file}=processFixture(t),c=client(t,{transport:'stdio',command:process.execPath,args:[file],cwd:root,env:{EXPLICIT:'fixture-only'}});await c.connect();const result=await c.callTool('echo',{}),info=JSON.parse(result.content[0].text);assert.equal(info.text,'hello 🐝');assert.equal(info.denied,2);assert.equal(info.env,'fixture-only');assert.equal(info.ambient,null);assert.equal(result.content[1].data,'ZmFrZQ==');assert.equal(c.stderrBytes,16384);assert.equal(c.stderr,undefined);
});
test('aborting a real stdio task terminates its owned process and clears pending requests',async t=>{
 const {root,file}=processFixture(t),c=client(t,{transport:'stdio',command:process.execPath,args:[file],cwd:root,env:{}});await c.connect();const controller=new AbortController(),work=c.callTool('echo',{hang:true},{signal:controller.signal}),ended=once(c.child,'exit');controller.abort();await assert.rejects(work,{name:'AbortError'});await ended;assert.equal(c.closed,true);assert.equal(c.pending.size,0);
});
test('malformed and oversized stdout fail closed and settle pending calls',async t=>{
 for(const args of [{invalid:true},{big:true}]){const {root,file}=processFixture(t),c=client(t,{transport:'stdio',command:process.execPath,args:[file],cwd:root,env:{}});await c.connect();await assert.rejects(c.callTool('echo',args),/invalid|limit/);assert.equal(c.closed,true);assert.equal(c.pending.size,0);}
});
test('endpoint and tool validation reject ambiguous unsafe configuration',()=>{
 for(const url of ['file:///tmp/a','http://example.com/mcp','https://user:secret@example.com/mcp','https://example.com/mcp?token=secret','https://example.com/#x'])assert.throws(()=>safePluginURL(url));assert.match(safePluginURL('http://localhost:1234/mcp'),/localhost/);assert.throws(()=>normalizeTools([{...tool,inputSchema:{type:'array'}}]),/object/);
});
test('an already-cancelled connection never starts a local executable',async()=>{
 let launched=0;const controller=new AbortController();controller.abort();const c=new MCPClient({transport:'stdio',command:'unused',spawnProcess:()=>{launched++;throw Error('must not launch');}});await assert.rejects(c.connect({signal:controller.signal}),{name:'AbortError'});assert.equal(launched,0);assert.equal(c.started,false);
});
test('closing a stdio launcher also terminates its live descendant server',async t=>{
 const {root,file}=processFixture(t),c=client(t,{transport:'stdio',command:process.execPath,args:[file],cwd:root,env:{}});await c.connect();const result=await c.callTool('echo',{descendant:true}),pid=Number(result.content[0].text);assert.equal(Number.isSafeInteger(pid)&&pid>0,true);process.kill(pid,0);
 t.after(()=>{try{process.kill(pid);}catch{}});const ended=once(c.child,'exit');c.close();await ended;
 const alive=()=>{try{process.kill(pid,0);return true;}catch{return false;}};for(let attempt=0;attempt<60&&alive();attempt++)await new Promise(resolve=>setTimeout(resolve,25));assert.equal(alive(),false);
});
test('HTTP cancellation sends a request-bound cancelled notification and deletes its session without replay',async t=>{
 let started,cancelledMessage,deleted;const began=new Promise(resolve=>started=resolve),cancelledNotice=new Promise(resolve=>cancelledMessage=resolve),deleteNotice=new Promise(resolve=>deleted=resolve);
 const fixture=await host(t,(message,req,res)=>{if(message.method==='tools/call'){started(message.id);return;}if(message.method==='notifications/cancelled'){cancelledMessage(message);res.writeHead(202);res.end();return;}if(req.method==='DELETE'){deleted(req.headers);res.writeHead(204);res.end();return;}basic(message,req,res);});
 const c=client(t,{transport:'streamable-http',url:fixture.url,headers:{Authorization:'Bearer fixture-secret'}});await c.connect();const controller=new AbortController(),work=c.callTool('echo',{}, {signal:controller.signal}),requestId=await began;controller.abort();await assert.rejects(work,{name:'AbortError'});
 const notice=await cancelledNotice,headers=await deleteNotice;await c.cleanup;assert.equal(notice.params.requestId,requestId);assert.equal(headers['mcp-session-id'],'fixture-session');assert.equal(headers['sec-crew-browser'],'1');assert.equal(headers.authorization,'Bearer fixture-secret');assert.equal(fixture.requests.filter(value=>value.message.method==='tools/call').length,1);
});
test('HTTP cleanup honors newly protected owner origins',async()=>{
 let protectedNow=false,requests=0;const c=new MCPClient({transport:'streamable-http',url:'https://mcp.example.invalid',assertURL:()=>{if(protectedNow)throw Error('protected');},fetchImpl:async()=>{requests++;return new Response(null,{status:204});}});c.sessionId='fixture-session';protectedNow=true;c.close();await c.cleanup;assert.equal(requests,0);
});
