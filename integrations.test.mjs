import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {IntegrationStore} from './integrations.mjs';
const reply=(data,headers={})=>new Response(JSON.stringify(data),{headers});
function fixture(t,fetchImpl=async()=>reply([])){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'crew-integration-unit-')),store={bot(id){if(!['a','b'].includes(id))throw Error('Bot not found');return {id};}},integrations=new IntegrationStore({dataRoot:root,store,fetchImpl});
 t.after(()=>{integrations.close();assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.match(path.basename(root),/^crew-integration-unit-/);fs.rmSync(root,{recursive:true,force:true});});return {root,store,integrations};
}
test('repository access is explicitly per bot and tokens default to session-only',async t=>{
 let calls=0;const f=fixture(t,async()=>{calls++;return reply([]);}),item=f.integrations.save({repo:'example/project',botIds:['a'],token:'fixture-private-token'});
 assert.equal(item.tokenStorage,'session');assert.ok(!JSON.stringify(f.integrations.list()).includes('fixture-private-token'));assert.ok(!fs.readFileSync(f.integrations.file,'utf8').includes('fixture-private-token'));
 assert.equal(new IntegrationStore({dataRoot:f.root,store:f.store}).list()[0].hasToken,false);
 await assert.rejects(f.integrations.read({id:'b'},{integrationId:item.id,action:'issues'}),/not allowed/);assert.equal(calls,0);assert.deepEqual(f.integrations.list({botId:'b'}),[]);
 await f.integrations.read({id:'a'},{integrationId:item.id,action:'issues'});assert.equal(calls,1);
 f.integrations.save({id:item.id,persistToken:true});assert.ok(fs.readFileSync(f.integrations.file,'utf8').includes('fixture-private-token'));assert.equal(new IntegrationStore({dataRoot:f.root,store:f.store}).list()[0].tokenStorage,'disk');
 f.integrations.save({id:item.id,persistToken:false});assert.ok(!fs.readFileSync(f.integrations.file,'utf8').includes('fixture-private-token'));f.integrations.remove(item.id);assert.deepEqual(f.integrations.list(),[]);
});
test('GitHub dispatch is fixed GET and distinguishes issues from pull requests',async t=>{
 const calls=[],f=fixture(t,async(url,options)=>{calls.push({url,options});return reply([{number:3,title:'Issue',body:'fixture-private-token information',state:'open',user:{login:'reporter'}},{number:4,title:'Pull',pull_request:{},state:'open'}],{link:'<https://api.github.com/repos/example/project/issues?page=2>; rel="next"'});});
 const item=f.integrations.save({repo:'example/project',botIds:['a'],token:'fixture-private-token'}),result=await f.integrations.read({id:'a'},{integrationId:item.id,action:'issues'});
 assert.equal(calls[0].options.method,'GET');assert.equal(calls[0].options.redirect,'error');assert.equal(new URL(calls[0].url).origin,'https://api.github.com');assert.equal(new URL(calls[0].url).pathname,'/repos/example/project/issues');assert.equal(calls[0].options.headers.Authorization,'Bearer fixture-private-token');
 assert.equal(result.items.length,1);assert.equal(result.items[0].number,3);assert.equal(result.items[0].url,'https://github.com/example/project/issues/3');assert.equal(result.nextPage,2);assert.ok(!JSON.stringify(result).includes('fixture-private-token'));assert.equal(result.untrustedContent,true);
 const pulls=await f.integrations.read({id:'a'},{integrationId:item.id,action:'pulls',state:'closed',page:2});assert.equal(new URL(calls[1].url).pathname,'/repos/example/project/pulls');assert.equal(pulls.items[0].kind,'pull');
});
test('integration validation and revoked access stop requests before external access',async t=>{
 let calls=0;const f=fixture(t,async()=>{calls++;return reply([]);});
 for(const repo of ['../project','https://github.com/example/project','example/..','example/project/more'])assert.throws(()=>f.integrations.save({repo,botIds:['a']}));
 assert.throws(()=>f.integrations.save({repo:'example/project',botIds:['missing']}),/Bot not found/);assert.deepEqual(f.integrations.list(),[]);
 const item=f.integrations.save({repo:'example/project',botIds:['a']});
 for(const input of [{action:'write'},{action:'issue',number:0},{action:'pulls',page:21},{action:'issues',state:'invented'}])await assert.rejects(f.integrations.read({id:'a'},{integrationId:item.id,...input}));
 assert.equal(calls,0);f.integrations.save({id:item.id,enabled:false});await assert.rejects(f.integrations.read({id:'a'},{integrationId:item.id,action:'issues'}),/not allowed/);assert.equal(calls,0);
});
test('changing repository drops credentials and permissions cannot be mutated through a public response',async t=>{
 const calls=[],f=fixture(t,async(url,options)=>{calls.push(options);return reply([]);}),item=f.integrations.save({repo:'example/project',botIds:['a'],token:'fixture-private-token',persistToken:true});
 item.botIds.push('b');assert.deepEqual(f.integrations.list({botId:'b'}),[]);f.integrations.save({id:item.id,repo:'example/other'});
 await f.integrations.read({id:'a'},{integrationId:item.id,action:'issues'});assert.equal(calls[0].headers.Authorization,undefined);assert.ok(!fs.readFileSync(f.integrations.file,'utf8').includes('fixture-private-token'));
});
test('removal cancels an in-flight repository read and never returns late private data',async t=>{
 let release;const f=fixture(t,async()=>new Promise(resolve=>{release=()=>resolve(reply([{number:1,title:'Private result'}]));})),item=f.integrations.save({repo:'example/project',botIds:['a']});
 const pending=f.integrations.read({id:'a'},{integrationId:item.id,action:'issues'});f.integrations.remove(item.id);release();await assert.rejects(pending,/cancelled/);
});
test('GitHub response errors are bounded and never echo secrets or upstream bodies',async t=>{
 const f=fixture(t,async()=>new Response('fixture-private-token',{status:403})),item=f.integrations.save({repo:'example/project',botIds:['a'],token:'fixture-private-token'});
 await assert.rejects(f.integrations.read({id:'a'},{integrationId:item.id,action:'issues'}),error=>error.message.includes('HTTP 403')&&!error.message.includes('fixture-private-token'));
 f.integrations.fetchImpl=async()=>reply([],{ 'content-length':String(5*1024*1024)});await assert.rejects(f.integrations.read({id:'a'},{integrationId:item.id,action:'issues'}),/could not complete/);
});
test('a long valid repository gets a bounded default name without requiring a token or bot access',t=>{
 const f=fixture(t),repo='owner/'+('repository'.repeat(10)),item=f.integrations.save({repo,botIds:[]});assert.equal(item.repo,repo);assert.equal(item.name,repo.slice(0,100));assert.equal(item.hasToken,false);assert.equal(item.enabled,true);assert.deepEqual(f.integrations.list({botId:'a'}),[]);
});
