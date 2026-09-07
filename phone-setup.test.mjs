import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {findTailscale,checkServeConfig,tailscaleActionUrl,setupPhone,PhoneSetupRunner} from './mobile/Setup-iPhone.mjs';

const dns='crew.example.ts.net',endpoint=dns+':8443',token='a'.repeat(64);
const crewConfig=()=>({TCP:{8443:{HTTPS:true}},Web:{[endpoint]:{Handlers:{'/':{Proxy:'http://127.0.0.1:4320'}}}}});
function fixture({before={},after=crewConfig(),status={BackendState:'Running',Self:{DNSName:dns+'.'}},serveError=null,exists=()=>true}={}){
 const calls=[],requests=[];let reads=0;
 const options={platform:'linux',env:{PATH:'/usr/bin'},exists,
  runCli:async(command,args)=>{calls.push({command,args});if(args[0]==='status')return {stdout:JSON.stringify(status)};if(args.join(' ')==='serve status --json')return {stdout:JSON.stringify(reads++===0?before:after)};if(serveError)throw serveError;return {stdout:'Serve enabled'};},
  requestCrew:async(port,secret,route,body)=>{requests.push({port,secret,route,body});return {};}
 };
 return {calls,requests,options,input:{localPort:4318,localToken:token,mobilePort:4320}};
}

test('Unix phone setup configures only the private Crew endpoint and verifies before saving',async()=>{
 const before={TCP:{443:{HTTPS:true}},Web:{'other.example.ts.net:443':{Handlers:{'/':{Proxy:'http://127.0.0.1:8080'}}}}};
 const f=fixture({before}),original=JSON.stringify(before),result=await setupPhone(f.input,f.options);
 assert.equal(result.status,'completed');assert.equal(result.origin,'https://'+endpoint);
 assert.deepEqual(f.calls.map(c=>c.args),[['status','--json'],['serve','status','--json'],['serve','--bg','--https=8443','http://127.0.0.1:4320'],['serve','status','--json']]);
 assert.deepEqual(f.requests.map(r=>r.route),['mobile-status','mobile-configure']);assert.equal(f.requests[1].secret,token);assert.deepEqual(f.requests[1].body,{origin:'https://'+endpoint});
 assert.equal(JSON.stringify(before),original,'Existing unrelated configuration is not rewritten');
});

test('an exact existing Crew endpoint is reused without changing Tailscale',async()=>{
 const f=fixture({before:crewConfig()}),result=await setupPhone(f.input,f.options);
 assert.equal(result.status,'completed');assert.equal(f.calls.some(c=>c.args.includes('--bg')),false);
});

test('conflicting handlers, TCP services, foreground services, and Funnel remain unchanged',async()=>{
 const cases=[
  {Web:{[endpoint]:{Handlers:{'/':{Proxy:'http://127.0.0.1:9999'}}}}},
  {Web:{[endpoint]:{Handlers:{'/':{Proxy:'http://127.0.0.1:4320'},'/other':{Text:'Keep'}}}}},
  {Web:{[endpoint]:{Handlers:{'/':{Proxy:'http://127.0.0.1:4320',Text:'Keep'}}}}},
  {Web:{'different.example.ts.net:8443':{Handlers:{'/':{Proxy:'http://127.0.0.1:8080'}}}}},
  {TCP:{8443:{TCPForward:'127.0.0.1:22'}}},
  {TCP:{8443:{HTTPS:true,TCPForward:'127.0.0.1:22'}}},
  {AllowFunnel:{[endpoint]:true}},
  {AllowFunnel:{'different.example.ts.net:8443':true}},
  {Foreground:{session:{TCP:{8443:{HTTPS:true}}}}}
 ];
 for(const before of cases){
  const f=fixture({before}),original=JSON.stringify(before),result=await setupPhone(f.input,f.options);
  assert.equal(result.status,'failed');assert.match(result.error,/8443/);
  assert.equal(f.calls.some(c=>c.args.includes('--bg')),false);assert.equal(f.requests.some(r=>r.route==='mobile-configure'),false);assert.equal(JSON.stringify(before),original);
 }
});

test('Funnel on an unrelated port is preserved while Crew stays private',async()=>{
 const config={...crewConfig(),AllowFunnel:{'other.example.ts.net:443':true,[endpoint]:false}};
 assert.equal(checkServeConfig(config,dns),true);
});

test('a public endpoint found during post-setup verification is not enabled in Crew',async()=>{
 const f=fixture({after:{...crewConfig(),AllowFunnel:{[endpoint]:true}}}),result=await setupPhone(f.input,f.options);
 assert.equal(result.status,'failed');assert.match(result.error,/public Funnel/);assert.equal(f.requests.some(r=>r.route==='mobile-configure'),false);
});

test('signed-out, missing, or malformed Tailscale state cannot trigger a Serve mutation',async()=>{
 for(const args of [{status:{BackendState:'NeedsLogin'}},{exists:()=>false},{status:{BackendState:'Running',Self:{DNSName:'not-a-tailnet.invalid'}}},{before:{Web:[]}}]){
  const f=fixture(args),result=await setupPhone(f.input,f.options);assert.equal(result.status,'failed');assert.equal(f.calls.some(c=>c.args.includes('--bg')),false);
 }
});

test('HTTPS permission errors expose only an official actionable setup link',async()=>{
 const actionUrl='https://login.tailscale.com/f/serve?node=test-node';
 const f=fixture({serveError:{stderr:'Enable HTTPS at '+actionUrl}}),result=await setupPhone(f.input,f.options);
 assert.equal(result.status,'failed');assert.equal(result.actionUrl,actionUrl);assert.match(result.error,/HTTPS permission/);
 assert.equal(f.requests.some(r=>r.route==='mobile-configure'),false);
 for(const output of ['https://login.tailscale.com.evil.invalid/','https://user@login.tailscale.com/','https://login.tailscale.com:444/','http://login.tailscale.com/'])assert.equal(tailscaleActionUrl(output),null);
});

test('macOS and Linux discover existing CLIs without invoking a shell or installer',()=>{
 for(const [platform,expected] of [['darwin','/Applications/Tailscale.app/Contents/MacOS/Tailscale'],['darwin','/opt/homebrew/bin/tailscale'],['linux','/usr/bin/tailscale']])assert.equal(findTailscale({platform,env:{PATH:''},exists:file=>file===expected}),expected);
 const custom='/tmp/a directory/tailscale';assert.equal(findTailscale({platform:'darwin',env:{PATH:'/tmp/a directory:relative'},exists:file=>file===custom}),custom);
 assert.throws(()=>findTailscale({platform:'linux',env:{PATH:'relative'},exists:file=>file==='relative/tailscale'}),/Install Tailscale/);
});

test('invalid local authentication and custom companion ports fail before external setup',async()=>{
 for(const input of [{localPort:4318,localToken:'invalid'},{localPort:4318,localToken:token,mobilePort:9999}]){
  const f=fixture(),result=await setupPhone(input,f.options);assert.equal(result.status,'failed');assert.equal(f.calls.length,0);assert.equal(f.requests.length,0);
 }
});

test('the background runner sends its token over stdin and starts only one helper',async()=>{
 const child=new EventEmitter(),calls=[];let received='';child.stdout=new PassThrough();child.stdin=new Writable({write(chunk,encoding,done){received+=chunk;done();}});child.kill=()=>child.emit('close',0);
 const runner=new PhoneSetupRunner({node:'/crew/runtime/node',script:'/crew/mobile/Setup-iPhone.mjs',spawnProcess:(...args)=>{calls.push(args);return child;}});
 const input={localPort:4318,localToken:token,mobilePort:4320};assert.equal(runner.start(input).status,'running');runner.start(input);
 assert.equal(calls.length,1);assert.deepEqual(calls[0][1],['/crew/mobile/Setup-iPhone.mjs']);assert.equal(calls[0][2].env,undefined);assert.deepEqual(JSON.parse(received),input);
 child.stdout.write(JSON.stringify({status:'completed',origin:'https://'+endpoint}));child.emit('close',0);assert.equal(runner.state.status,'completed');assert.equal(runner.child,null);runner.close();
});
