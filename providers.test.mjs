import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {ProviderStore,providerBaseUrl} from './providers.mjs';
const response=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
function fixture(options={}){const root=fs.mkdtempSync(path.join(os.tmpdir(),'crew-provider-test-'));const store=new ProviderStore(root,options);return {root,store,close(){store.close();fs.rmSync(root,{recursive:true,force:true});}};}
test('provider keys remain session-only unless saving is explicit',()=>{
 const f=fixture();try{
  const p=f.store.save({type:'openai',apiKey:'test-only-secret'});
  assert.equal(p.keyStorage,'session');assert.equal(JSON.stringify(f.store.list()).includes('test-only-secret'),false);
  assert.equal(fs.readFileSync(path.join(f.root,'providers.json'),'utf8').includes('test-only-secret'),false);
  assert.equal(fs.existsSync(path.join(f.root,'provider-secrets.json')),false);
  assert.equal(new ProviderStore(f.root).list().find(x=>x.id===p.id).hasKey,false);
  f.store.save({id:p.id,type:'openai',apiKey:'saved-test-secret',persistKey:true});
  assert.equal(new ProviderStore(f.root).getConnection(p.id).key,'saved-test-secret');
  if(process.platform!=='win32')assert.equal(fs.statSync(path.join(f.root,'provider-secrets.json')).mode&0o777,0o600);
  f.store.save({id:p.id,type:'openai',persistKey:false});
  assert.equal(fs.existsSync(path.join(f.root,'provider-secrets.json')),false);
  assert.equal(f.store.getConnection(p.id).key,'saved-test-secret');
  f.store.remove(p.id);assert.deepEqual(f.store.list().map(p=>p.id),['codex']);
 }finally{f.close();}
});
test('provider endpoint validation prevents remote HTTP and accidental key forwarding',()=>{
 assert.throws(()=>providerBaseUrl('openai','https://example.test/v1'),/custom/);
 assert.throws(()=>providerBaseUrl('custom','http://example.test/v1'),/HTTPS/);
 assert.throws(()=>providerBaseUrl('custom','https://key@example.test/v1'),/HTTPS/);
 assert.equal(providerBaseUrl('ollama','http://127.0.0.1:11434/v1/'),'http://127.0.0.1:11434/v1');
 const f=fixture();try{const p=f.store.save({type:'custom',baseUrl:'https://one.example/v1',apiKey:'test-secret',persistKey:true});f.store.save({id:p.id,type:'custom',baseUrl:'https://two.example/v1'});assert.equal(f.store.getConnection(p.id).key,'');}finally{f.close();}
});
test('model discovery uses provider headers and redacts HTTP/transport errors',async()=>{
 let request;const f=fixture({fetchImpl:async(url,options)=>{request={url,options};return response({data:[{id:'model-a',display_name:'Model A'}]});}});
 try{
  const p=f.store.save({type:'anthropic',apiKey:'never-public'});assert.deepEqual(await f.store.modelList(p.id),[{id:'model-a',name:'Model A'}]);assert.equal(request.options.headers['x-api-key'],'never-public');assert.equal(request.options.redirect,'error');
  f.store.fetchImpl=async()=>new Response('never-public',{status:401});await assert.rejects(f.store.modelList(p.id),error=>!error.message.includes('never-public')&&error.message.includes('401'));
  f.store.fetchImpl=async()=>{throw Error('never-public');};await assert.rejects(f.store.modelList(p.id),error=>!error.message.includes('never-public'));
 }finally{f.close();}
});
test('OpenRouter PKCE binds callback state, verifier, expiry, and single use',async()=>{
 let request,now=1000;const f=fixture({now:()=>now,fetchImpl:async(url,options)=>{request={url,body:JSON.parse(options.body)};return response({key:'oauth-test-secret'});}});
 try{
  assert.throws(()=>f.store.beginOpenRouterLogin({callbackUrl:'https://example.test/callback'}),/loopback/);
  const start=f.store.beginOpenRouterLogin({callbackUrl:'http://127.0.0.1:4318/api/provider-oauth-callback'});
  const auth=new URL(start.authUrl),callback=new URL(auth.searchParams.get('callback_url')),state=callback.searchParams.get('state');
  assert.equal(auth.origin,'https://openrouter.ai');assert.equal(auth.searchParams.get('code_challenge_method'),'S256');assert.ok(state.length>=40);
  await assert.rejects(f.store.handleOAuthCallback({state:'wrong',code:'code'}),/invalid/);
  const p=await f.store.handleOAuthCallback({state,code:'one-time-code'});
  assert.equal(p.auth,'oauth');assert.equal(p.keyStorage,'session');assert.equal(JSON.stringify(p).includes('oauth-test-secret'),false);
  assert.equal(request.url,'https://openrouter.ai/api/v1/auth/keys');assert.equal(createHash('sha256').update(request.body.code_verifier).digest('base64url'),auth.searchParams.get('code_challenge'));
  await assert.rejects(f.store.handleOAuthCallback({state,code:'one-time-code'}),/already been used/);
  const second=f.store.beginOpenRouterLogin({callbackUrl:'http://localhost:9999/callback'});const nextState=new URL(new URL(second.authUrl).searchParams.get('callback_url')).searchParams.get('state');now+=600001;
  await assert.rejects(f.store.handleOAuthCallback({state:nextState,code:'late'}),/expired/);
 }finally{f.close();}
});
test('OpenRouter discovery sanitizes effort metadata and caches it for task validation',async()=>{
 let calls=0,now=1000;
 const f=fixture({now:()=>now,fetchImpl:async()=>{calls++;return response({data:[{id:'vendor/reasoner',name:'Reasoner',key:'do-not-keep',reasoning:{supported_efforts:['high','none','low','invented'],default_effort:'high',mandatory:true,private:'do-not-keep'}},{id:'vendor/unknown',supported_parameters:['reasoning']},{id:'',name:'invalid'}]});}});
 try{
  const p=f.store.save({type:'openrouter',apiKey:'test-only-key'}),models=await f.store.modelList(p.id);
  assert.equal(models.length,2);assert.equal(JSON.stringify(models).includes('do-not-keep'),false);
  assert.deepEqual(models[0].supportedReasoningEfforts.map(x=>x.reasoningEffort),['low','high']);assert.equal(models[0].defaultReasoningEffort,'high');
  models[0].reasoning.supported_efforts.push('max');
  const cached=await f.store.modelMetadata(p.id,'vendor/reasoner');assert.equal(calls,1);assert.equal(cached.reasoning.supported_efforts.includes('max'),false);
  cached.reasoning.mandatory=false;assert.equal((await f.store.modelMetadata(p.id,'vendor/reasoner')).reasoning.mandatory,true);
  assert.equal(await f.store.modelMetadata(p.id,'missing'),undefined);assert.equal(calls,1);
  now+=300001;await f.store.modelMetadata(p.id,'vendor/reasoner');assert.equal(calls,2);
  f.store.save({id:p.id,name:'Renamed'});await f.store.modelMetadata(p.id,'vendor/reasoner');assert.equal(calls,3);
  const controller=new AbortController();controller.abort();await assert.rejects(f.store.modelMetadata(p.id,'vendor/reasoner',{signal:controller.signal}),e=>e.name==='AbortError');assert.equal(calls,3);
  f.store.remove(p.id);assert.equal(f.store.modelCache.has(p.id),false);
 }finally{f.close();}
});
test('custom discovery ignores reasoning claims and removed providers cannot restore a stale cache',async()=>{
 let release;const f=fixture({fetchImpl:async()=>new Promise(resolve=>{release=()=>resolve(response({data:[{id:'gpt-6-astra',reasoning:{supported_efforts:null},supportedReasoningEfforts:['max']}]}));})});
 try{
  const p=f.store.save({type:'custom',baseUrl:'http://127.0.0.1:8080/v1'}),pending=f.store.modelList(p.id);f.store.remove(p.id);release();
  assert.deepEqual(await pending,[{id:'gpt-6-astra',name:'gpt-6-astra'}]);assert.equal(f.store.modelCache.has(p.id),false);
 }finally{f.close();}
});
