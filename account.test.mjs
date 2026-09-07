import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {setTimeout as delay} from 'node:timers/promises';
import {AccountConnection} from './account.mjs';

const AUTH_URL='https://auth.openai.com/oauth/authorize?state=private-state&redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback';
class FakeProcess extends EventEmitter {
  constructor(handle){
    super();this.killed=false;this.stdout=new PassThrough();this.stderr=new PassThrough();this.requests=[];
    this.stdin=new Writable({write:(chunk,encoding,done)=>{
      for(const line of chunk.toString().trim().split('\n')){
        const message=JSON.parse(line);this.requests.push(message);
        queueMicrotask(()=>handle(message,this));
      }
      done();
    }});
  }
  result(id,result){this.stdout.write(JSON.stringify({id,result})+'\n');}
  notify(method,params){this.stdout.write(JSON.stringify({method,params})+'\n');}
  kill(){this.killed=true;this.emit('close',0);return true;}
}
function setup(t,{handle,account=null,...options}={}){
  const processes=[],spawns=[],changes=[];
  const broker=new AccountConnection({executable:'C:\\Crew\\runtime\\codex.exe',requestTimeoutMs:250,loginTimeoutMs:60000,...options,onChange:s=>changes.push(s),spawnProcess:(...args)=>{
    spawns.push(args);
    const proc=new FakeProcess((message,p)=>{
      if(handle?.(message,p)===true)return;
      if(message.id===undefined)return;
      if(message.method==='initialize')p.result(message.id,{userAgent:'test'});
      else if(message.method==='account/read')p.result(message.id,{account,requiresOpenaiAuth:true});
      else if(message.method==='account/login/start')p.result(message.id,{type:'chatgpt',loginId:'login-1',authUrl:AUTH_URL});
      else if(message.method==='account/login/cancel')p.result(message.id,{status:'canceled'});
    });processes.push(proc);return proc;
  }});
  t.after(()=>broker.close());return {broker,processes,spawns,changes};
}

test('concurrent status callers share one hidden initialized process and return no account secrets',async t=>{
  const env={CODEX_HOME:'C:\\isolated-test-auth'},account={type:'chatgpt',planType:'pro',email:'private@example.com',accessToken:'secret-token'};
  const {broker,processes,spawns}=setup(t,{env,account});
  const states=await Promise.all([broker.status(),broker.status(),broker.status()]);
  assert.equal(processes.length,1);assert.equal(spawns[0][0],'C:\\Crew\\runtime\\codex.exe');
  assert.deepEqual(spawns[0][1],['app-server']);assert.equal(spawns[0][2].windowsHide,true);assert.equal(spawns[0][2].env,env);
  assert.deepEqual(processes[0].requests.map(x=>x.method),['initialize','initialized','account/read']);
  assert.deepEqual(processes[0].requests.at(-1).params,{refreshToken:false});
  assert.deepEqual(states[0],{connected:true,type:'chatgpt',plan:'pro',requiresOpenaiAuth:true,login:null,error:null});
  assert.doesNotMatch(JSON.stringify(states),/private@|secret-token|accessToken/);
});

test('login is deduplicated, tracks completion, and notifications sanitize status',async t=>{
  const {broker,processes,changes}=setup(t);
  const [first,second]=await Promise.all([broker.beginLogin(),broker.beginLogin()]);
  assert.deepEqual(first,second);assert.deepEqual(await broker.beginLogin(),first);
  assert.equal(processes[0].requests.filter(x=>x.method==='account/login/start').length,1);
  assert.deepEqual(processes[0].requests.find(x=>x.method==='account/login/start').params,{type:'chatgpt'});
  assert.equal(broker.snapshot().login.status,'pending');
  processes[0].notify('account/login/completed',{loginId:'unrelated',success:true});
  assert.equal(broker.snapshot().login.status,'pending');
  processes[0].notify('account/login/completed',{loginId:'login-1',success:true,error:'secret-error'});
  processes[0].notify('account/updated',{authMode:'chatgpt',planType:'plus',accessToken:'secret-token'});
  assert.equal(broker.snapshot().connected,true);assert.equal(broker.snapshot().plan,'plus');assert.equal(broker.snapshot().login.status,'completed');
  assert.doesNotMatch(JSON.stringify(changes),/private-state|authUrl|secret-token|secret-error/);
});

test('completion can arrive before the login-start response',async t=>{
  const {broker}=setup(t,{handle:(m,p)=>{
    if(m.method!=='account/login/start')return false;
    p.notify('account/login/completed',{loginId:'early-login',success:true});
    p.result(m.id,{type:'chatgpt',loginId:'early-login',authUrl:'https://chatgpt.com/auth/login?redirect_uri=http%3A%2F%2Flocalhost%3A1455'});
    return true;
  }});
  await broker.beginLogin();assert.equal(broker.snapshot().login.status,'completed');assert.equal(broker.snapshot().connected,true);
});

test('cancel waits for a starting login and never sends logout',async t=>{
  let start;
  const {broker,processes}=setup(t,{handle:(m,p)=>{if(m.method==='account/login/start'){start={m,p};return true;}}});
  const beginning=broker.beginLogin();await delay(5);assert.ok(start);
  const canceling=broker.cancel();
  start.p.result(start.m.id,{type:'chatgpt',loginId:'login-1',authUrl:AUTH_URL});
  await beginning;const result=await canceling;
  assert.equal(result.status,'canceled');assert.equal(broker.snapshot().login.status,'cancelled');
  assert.deepEqual(processes[0].requests.find(x=>x.method==='account/login/cancel').params,{loginId:'login-1'});
  assert.ok(!processes[0].requests.some(x=>x.method==='account/logout'));
  const count=processes[0].requests.length;assert.equal((await broker.cancel('stale-login')).status,'notFound');assert.equal(processes[0].requests.length,count);
});

test('failed completion hides upstream error details and supports a new attempt',async t=>{
  const {broker,processes}=setup(t);await broker.beginLogin();
  processes[0].notify('account/login/completed',{loginId:'login-1',success:false,error:'access_token=TOP_SECRET'});
  assert.equal(broker.snapshot().login.status,'failed');assert.doesNotMatch(JSON.stringify(broker.snapshot()),/TOP_SECRET|access_token/);
  await broker.beginLogin();assert.equal(processes[0].requests.filter(x=>x.method==='account/login/start').length,2);
});

test('only exact official HTTPS authentication hosts are accepted',async t=>{
  for(const authUrl of ['https://evil.example/login','https://auth.openai.com.evil.example/login','http://auth.openai.com/login','http://localhost:1455/auth/callback','https://user@auth.openai.com/login','https://auth.openai.com:8443/login','javascript:alert(1)','https://auth.openai.com\\@evil.example/login']){
    const {broker,processes}=setup(t,{handle:(m,p)=>{if(m.method==='account/login/start'){p.result(m.id,{type:'chatgpt',loginId:'login-1',authUrl});return true;}}});
    await assert.rejects(broker.beginLogin(),/sign-in address/);
    assert.equal(broker.snapshot().login.status,'failed');
    assert.equal(processes[0].requests.filter(x=>x.method==='account/login/cancel').length,1);
    assert.doesNotMatch(JSON.stringify(broker.snapshot()),/evil\.example|8443/);
    broker.close();
  }
});

test('login expiry cancels its callback without logging out an existing account',async t=>{
  const {broker,processes}=setup(t,{loginTimeoutMs:15,account:{type:'chatgpt',planType:'plus'}});
  await broker.status();await broker.beginLogin();await delay(35);
  assert.equal(broker.snapshot().login.status,'expired');assert.equal(broker.snapshot().connected,true);
  assert.equal(processes[0].requests.filter(x=>x.method==='account/login/cancel').length,1);
  assert.ok(!processes[0].requests.some(x=>x.method==='account/logout'));
});

test('timeouts reject pending RPCs, stop the orphan process, and permit reconnect',async t=>{
  let hang=true;
  const {broker,processes}=setup(t,{requestTimeoutMs:15,handle:m=>m.method==='account/login/start'&&hang});
  await assert.rejects(broker.beginLogin(),/timed out/);assert.equal(processes[0].killed,true);
  hang=false;const state=await broker.status();assert.equal(state.error,null);assert.equal(processes.length,2);
  await broker.beginLogin();assert.equal(broker.snapshot().login.status,'pending');
});

test('process close rejects in-flight login and explicit close prevents reopening',async t=>{
  const {broker,processes}=setup(t,{handle:m=>m.method==='account/login/start'});
  const login=broker.beginLogin();await delay(5);processes[0].emit('close',1);
  await assert.rejects(login,/connection stopped/);assert.equal(broker.snapshot().login.status,'failed');
  broker.close();assert.match((await broker.status()).error,/closed/);
  await assert.rejects(broker.beginLogin(),/closed/);assert.equal(processes.length,1);
});

test('RPC errors and server token requests cannot leak auth values',async t=>{
  const {broker,processes}=setup(t,{handle:(m,p)=>{
    if(m.method==='account/read'){p.stdout.write(JSON.stringify({id:m.id,error:{message:'TOKEN_SECRET https://auth.openai.com/?token=secret'}})+'\n');return true;}
  }});
  assert.doesNotMatch(JSON.stringify(await broker.status()),/TOKEN_SECRET|token=secret/);
  processes[0].stdout.write(JSON.stringify({id:99,method:'account/chatgptAuthTokens/refresh',params:{reason:'unauthorized'}})+'\n');
  await delay(1);
  const reply=processes[0].requests.find(x=>x.id===99);assert.equal(reply.error.code,-32601);assert.ok(!reply.result);
});

test('a newer account notification is not overwritten by a preceding read response',async t=>{
  const {broker}=setup(t,{handle:(m,p)=>{
    if(m.method!=='account/read')return false;
    p.result(m.id,{account:null,requiresOpenaiAuth:true});
    p.notify('account/updated',{authMode:'chatgpt',planType:'pro'});return true;
  }});
  const state=await broker.status();assert.equal(state.connected,true);assert.equal(state.plan,'pro');
});

test('a new login waits for expired-login cancellation to finish',async t=>{
  let cancellation;
  const {broker,processes}=setup(t,{loginTimeoutMs:15,handle:(m,p)=>{
    if(m.method==='account/login/cancel'){cancellation={m,p};return true;}
  }});
  await broker.beginLogin();await delay(30);assert.ok(cancellation);
  const next=broker.beginLogin();await delay(1);
  assert.equal(processes[0].requests.filter(x=>x.method==='account/login/start').length,1);
  cancellation.p.result(cancellation.m.id,{status:'canceled'});
  await next;assert.equal(processes[0].requests.filter(x=>x.method==='account/login/start').length,2);
});
