import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {MobileAccess,csrfFor,mobileOrigin} from './mobile.mjs';
import {managedBrowserHeader} from './http.mjs';

const origin='https://crew-test.example.ts.net';
const backendToken='test-only-local-backend-token';
const cookieName='__Host-CrewDevice';
const digest=value=>createHash('sha256').update(value).digest('hex');
const binary=Buffer.from([0,255,128,10,13,42,195,169]);

async function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'crew-mobile-test-'));
 fs.writeFileSync(path.join(dir,'pair.html'),'<html><title>Pair this phone</title><form>Pairing code</form></html>');
 let now=1800000000000;
 let rootHTML=`<html><script>window.CREW_TOKEN='${backendToken}';</script><main>Private conversations</main></html>`;
 const requests=[];
 const backend=http.createServer(async(req,res)=>{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  requests.push({url:req.url,method:req.method,headers:req.headers,body:Buffer.concat(chunks)});
  if(req.headers['x-crew-token']!==backendToken){res.writeHead(403);return res.end('Backend token rejected');}
  if(req.url==='/'){
   res.writeHead(200,{'Content-Type':'text/html','Content-Security-Policy':"default-src 'self'"});
   return res.end(rootHTML);
  }
  if(req.url.startsWith('/api/file?')){
   res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':"attachment; filename*=UTF-8''report%20%C3%A9.bin"});
   return res.end(binary);
  }
  if(req.url==='/api/redirect'){res.writeHead(302,{Location:'http://example.com/'});return res.end();}
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:true,url:req.url}));
 });
 await new Promise(resolve=>backend.listen(0,'127.0.0.1',resolve));
 const gateway=new MobileAccess({dataRoot:dir,appRoot:dir,localPort:backend.address().port,localToken:backendToken,port:0,clock:()=>now});
 t.after(async()=>{
  await gateway.close();backend.closeAllConnections();await new Promise(resolve=>backend.close(resolve));
  const resolved=path.resolve(dir),parent=path.resolve(os.tmpdir());
  assert.equal(path.dirname(resolved),parent);assert.match(path.basename(resolved),/^crew-mobile-test-/);
  fs.rmSync(resolved,{recursive:true,force:true});
 });
 await gateway.configure(origin);
 const request=(route='/',options={})=>new Promise((resolve,reject)=>{
  const headers={Host:new URL(origin).host,...options.headers};
  const payload=options.body===undefined?undefined:Buffer.from(typeof options.body==='string'?options.body:JSON.stringify(options.body));
  if(payload){headers['Content-Type']='application/json';headers['Content-Length']=payload.length;}
  const req=http.request({hostname:'127.0.0.1',port:gateway.port,path:route,method:options.method||'GET',headers},res=>{
   const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>{
    const bytes=Buffer.concat(chunks);resolve({status:res.statusCode,headers:res.headers,bytes,text:bytes.toString()});
   });
  });
  req.on('error',reject);req.setTimeout(5000,()=>req.destroy(new Error('Test request timed out')));req.end(payload);
 });
 const pair=async(name='Test iPhone')=>{
  const {code}=gateway.createPairing();
  const response=await request('/pair',{method:'POST',headers:{Origin:origin},body:{code,name}});
  assert.equal(response.status,200,response.text);
  const setCookie=response.headers['set-cookie'][0],cookie=setCookie.split(';')[0],secret=cookie.slice(cookieName.length+1);
  return {secret,cookie,setCookie,csrf:csrfFor(secret),headers:{Cookie:cookie,'X-Crew-Token':csrfFor(secret)},code};
 };
 return {gateway,request,pair,requests,dir,advance:ms=>{now+=ms;},setRootHTML:value=>{rootHTML=value;}};
}

test('mobile origin accepts only root HTTPS Tailscale URLs',()=>{
 assert.equal(mobileOrigin(origin+'/'),origin);
 for(const value of ['http://crew-test.example.ts.net','https://example.com','https://evil.ts.net.example.com','https://user:password@crew.ts.net','https://crew.ts.net/path','https://crew.ts.net/?code=123','https://crew.ts.net/#secret'])assert.throws(()=>mobileOrigin(value),undefined,value);
});

test('unpaired visitors receive a no-store pairing page without backend access or credentials',async t=>{
 const f=await fixture(t),page=await f.request('/');
 assert.equal(page.status,200);assert.match(page.text,/Pairing code/);
 assert.doesNotMatch(page.text,/Private conversations|CREW_TOKEN|test-only-local-backend-token/);
 assert.equal(page.headers['cache-control'],'no-store');
 assert.match(page.headers['content-security-policy'],/frame-ancestors 'none'/);
 for(const route of ['/api/state','/api/file?id=bot&path=private.txt','/app.js','/style.css','/api/mobile-status']){
  const response=await f.request(route);assert.equal(response.status,401,route);assert.doesNotMatch(response.text,new RegExp(backendToken));
 }
 assert.equal(f.requests.length,0);
});

test('managed browser requests cannot pair or reach a previously paired phone session',async t=>{
 const f=await fixture(t),paired=await f.pair(),{code}=f.gateway.createPairing();
 for(const marker of ['1',''])for(const [route,method] of [['/','GET'],['/api/state','GET'],['/pair','POST']]){
  const response=await f.request(route,{method,headers:{...paired.headers,Origin:origin,[managedBrowserHeader]:marker},...(method==='POST'?{body:{code}}:{})});
  assert.equal(response.status,403);assert.doesNotMatch(response.text,/CREW_TOKEN|Private conversations|test-only-local-backend-token/);
 }
 assert.equal(f.requests.length,0);assert.equal(f.gateway.status().devices.length,1);assert.equal(f.gateway.pairing.attempts,0);
});

test('gateway registers its bound listener and updated private origin with managed browser protection',async t=>{
 const f=await fixture(t),origins=[];f.gateway.protectOrigin=value=>origins.push(value);
 await f.gateway.close();await f.gateway.start();assert.deepEqual(origins,[origin,`http://127.0.0.1:${f.gateway.port}`]);
 await f.gateway.configure('https://changed.example.ts.net:8443');assert.equal(origins.at(-1),'https://changed.example.ts.net:8443');
});

test('pairing saves only a hashed device secret and returns a restricted secure cookie',async t=>{
 const f=await fixture(t),p=await f.pair('My phone');
 assert.match(p.secret,/^[a-f0-9]{64}$/);
 for(const flag of ['Path=/','Secure','HttpOnly','SameSite=Strict','Max-Age=2592000'])assert.ok(p.setCookie.includes(flag),flag);
 const disk=fs.readFileSync(f.gateway.file,'utf8'),saved=JSON.parse(disk);
 assert.equal(saved.devices.length,1);assert.equal(saved.devices[0].name,'My phone');
 assert.equal(saved.devices[0].hash,digest(p.secret));
 assert.ok(!disk.includes(p.secret));assert.ok(!disk.includes(p.code));assert.ok(!disk.includes(p.csrf));
 const status=JSON.stringify(f.gateway.status());assert.ok(!status.includes(saved.devices[0].hash));assert.ok(!status.includes(p.secret));
 assert.equal(f.gateway.device({headers:{cookie:p.cookie}}).id,saved.devices[0].id);
});

test('pairing code works only once and expires after five minutes',async t=>{
 const f=await fixture(t),p=await f.pair();
 const retry=await f.request('/pair',{method:'POST',headers:{Origin:origin},body:{code:p.code}});
 assert.equal(retry.status,400);assert.equal(f.gateway.status().devices.length,1);
 const next=f.gateway.createPairing();f.advance(5*60*1000);
 const expired=await f.request('/pair',{method:'POST',headers:{Origin:origin},body:{code:next.code}});
 assert.equal(expired.status,400);assert.equal(f.gateway.status().devices.length,1);
});

test('ten incorrect pairing attempts lock the current code until a new code is issued locally',async t=>{
 const f=await fixture(t),{code}=f.gateway.createPairing();
 for(let i=0;i<10;i++){
  const denied=await f.request('/pair',{method:'POST',headers:{Origin:origin},body:{code:'00000000'}});assert.equal(denied.status,400);
 }
 const locked=await f.request('/pair',{method:'POST',headers:{Origin:origin},body:{code}});
 assert.equal(locked.status,400);assert.equal(f.gateway.status().devices.length,0);
 await f.pair();assert.equal(f.gateway.status().devices.length,1);
});

test('pairing requires the configured Origin, limits body size, and never forwards malformed input',async t=>{
 const f=await fixture(t),{code}=f.gateway.createPairing();
 for(const headers of [{},{Origin:'https://evil.example'},{Origin:'null'}]){
  const denied=await f.request('/pair',{method:'POST',headers,body:{code}});assert.equal(denied.status,403);
 }
 assert.equal((await f.request('/pair',{method:'POST',headers:{Origin:origin},body:'{broken'})).status,400);
 assert.equal((await f.request('/pair',{method:'POST',headers:{Origin:origin},body:{code,name:'x'.repeat(3000)}})).status,400);
 assert.equal(f.gateway.status().devices.length,0);assert.equal(f.requests.length,0);
});

test('wrong Host or cross-origin requests fail before accessing the backend',async t=>{
 const f=await fixture(t),p=await f.pair();
 for(const headers of [{Host:'evil.example'},{Host:'crew-test.example.ts.net.evil.example'},{Origin:'https://evil.example'},{Origin:'null'}]){
  const response=await f.request('/api/state',{headers:{...p.headers,...headers}});assert.equal(response.status,403);
 }
 assert.equal(f.requests.length,0);
});

test('API authentication requires a valid device cookie and its own CSRF token',async t=>{
 const f=await fixture(t),first=await f.pair('First'),second=await f.pair('Second');
 const deniedHeaders=[{}, {Cookie:first.cookie},{'X-Crew-Token':first.csrf},{...first.headers,'X-Crew-Token':backendToken},{...first.headers,'X-Crew-Token':second.csrf},{...first.headers,Cookie:cookieName+'='+('0'.repeat(64))}];
 for(const headers of deniedHeaders){const response=await f.request('/api/state',{headers});assert.ok([401,403].includes(response.status));}
 assert.equal(f.requests.length,0);
 const response=await f.request('/api/state',{headers:first.headers});assert.equal(response.status,200);
 assert.equal(f.requests[0].headers['x-crew-token'],backendToken);
 assert.equal(f.requests[0].headers.cookie,undefined);
});

test('non-ASCII invalid CSRF values are rejected without a comparison error',async t=>{
 const f=await fixture(t),p=await f.pair();
 const response=await f.request('/api/state',{headers:{...p.headers,'X-Crew-Token':'é'.repeat(p.csrf.length)}});
 assert.equal(response.status,403);assert.equal(f.requests.length,0);
 assert.deepEqual(JSON.parse(response.text),{error:'Refresh FOLKLET to reconnect.'});
});

test('authenticated HTML exposes only mobile CSRF while preserving the app and response protections',async t=>{
 const f=await fixture(t),p=await f.pair(),response=await f.request('/',{headers:{Cookie:p.cookie}});
 assert.equal(response.status,200);assert.match(response.text,/Private conversations/);
 assert.ok(response.text.includes("window.CREW_TOKEN='"+p.csrf+"';window.CREW_MOBILE=true;"));
 assert.ok(!response.text.includes(backendToken));assert.ok(!response.text.includes(p.secret));
 assert.equal(response.headers['cache-control'],'no-store');assert.equal(response.headers['content-security-policy'],"default-src 'self'");
 assert.equal(response.headers['x-content-type-options'],'nosniff');assert.equal(response.headers['referrer-policy'],'no-referrer');
});

test('remote access cannot invoke phone-management or health endpoints even when paired',async t=>{
 const f=await fixture(t),p=await f.pair();
 for(const route of ['/api/mobile-status','/api/mobile-pair','/api/mobile-configure','/api/mobile-disable','/api/mobile-revoke','/api/mobile-setup','/health','/api/x/../mobile-pair']){
  for(const method of ['GET','POST']){
   const response=await f.request(route,{method,headers:{...p.headers,Origin:origin},...(method==='POST'?{body:{}}:{})});
   assert.equal(response.status,403,method+' '+route);
  }
 }
 assert.equal(f.requests.length,0);
});

test('proxy preserves authenticated JSON upload bodies and binary file downloads',async t=>{
 const f=await fixture(t),p=await f.pair();
 const body={id:'bot',name:'résumé.bin',data:binary.toString('base64')};
 const upload=await f.request('/api/upload',{method:'POST',headers:{...p.headers,Origin:origin},body});
 assert.equal(upload.status,200);assert.deepEqual(JSON.parse(f.requests[0].body.toString()),body);
 const route='/api/file?id=bot&path=report%20%C3%A9.bin',download=await f.request(route,{headers:p.headers});
 assert.equal(download.status,200);assert.deepEqual(download.bytes,binary);
 assert.equal(download.headers['content-type'],'application/octet-stream');
 assert.equal(download.headers['content-disposition'],"attachment; filename*=UTF-8''report%20%C3%A9.bin");
 assert.equal(f.requests[1].url,route);assert.equal(download.headers['cache-control'],'no-store');
});

test('paired phones cannot manage any plugin route but can answer a normal scoped approval',async t=>{
 const f=await fixture(t),p=await f.pair();
 const routes=['plugins','plugin-packages','plugin-save','plugin-connect','plugin-remove','plugin-inspect','plugin-file','plugin-install','plugin-package-remove','x/../plugin-file','plugin-future-operation'];
 for(const route of routes)for(const method of ['GET','POST']){
  const response=await f.request('/api/'+route,{method,headers:{...p.headers,Origin:origin},...(method==='POST'?{body:{id:'fixture-package',path:'SKILL.md'}}:{})});assert.equal(response.status,403,method+' '+route);assert.ok(!response.text.includes(backendToken));
 }
 assert.equal(f.requests.length,0,'Plugin management must never reach the owner host');
 const body={id:'fixture-bot',requestId:'fixture-approval',answer:'accept'},answer=await f.request('/api/answer',{method:'POST',headers:{...p.headers,Origin:origin},body});
 assert.equal(answer.status,200);assert.equal(f.requests.length,1);assert.equal(f.requests[0].url,'/api/answer');assert.equal(f.requests[0].headers['x-crew-token'],backendToken);assert.deepEqual(JSON.parse(f.requests[0].body),body);
});

test('revocation immediately removes API and app access without affecting a second device',async t=>{
 const f=await fixture(t),first=await f.pair('First'),second=await f.pair('Second');
 f.gateway.revoke(f.gateway.status().devices.find(d=>d.name==='First').id);
 assert.equal((await f.request('/api/state',{headers:first.headers})).status,401);
 const page=await f.request('/',{headers:first.headers});assert.match(page.text,/Pairing code/);assert.doesNotMatch(page.text,/Private conversations/);
 assert.equal((await f.request('/api/state',{headers:second.headers})).status,200);
 const restored=new MobileAccess({dataRoot:f.dir,appRoot:f.dir,localPort:1,localToken:backendToken,port:0});
 assert.equal(restored.device({headers:{cookie:first.cookie}}),null);
});

test('a phone can unpair only its own session with a matching CSRF token',async t=>{
 const f=await fixture(t),first=await f.pair('First'),second=await f.pair('Second');
 for(const headers of [{},{Cookie:first.cookie},{...first.headers,'X-Crew-Token':second.csrf},{...first.headers,Origin:'https://evil.example'}]){
  const response=await f.request('/unpair',{method:'POST',headers,body:{}});
  assert.ok([401,403].includes(response.status));assert.equal(f.gateway.status().devices.length,2);
 }
 assert.equal((await f.request('/unpair',{headers:first.headers})).status,404);
 const response=await f.request('/unpair',{method:'POST',headers:{...first.headers,Origin:origin},body:{}});
 assert.equal(response.status,200);assert.match(response.headers['set-cookie'][0],/__Host-CrewDevice=; Path=\/; Secure; HttpOnly; SameSite=Strict; Max-Age=0/);
 assert.equal(f.gateway.status().devices.length,1);assert.equal(f.gateway.status().devices[0].name,'Second');
 assert.equal((await f.request('/api/state',{headers:first.headers})).status,401);
 assert.equal((await f.request('/api/state',{headers:second.headers})).status,200);
 assert.equal(f.requests.length,1);
});

test('sessions expire at thirty days and changing origin invalidates existing devices and codes',async t=>{
 const f=await fixture(t),p=await f.pair();f.advance(30*24*60*60*1000);
 assert.equal((await f.request('/api/state',{headers:p.headers})).status,401);assert.equal(f.gateway.status().devices.length,0);
 await f.pair();f.gateway.createPairing();await f.gateway.configure('https://renamed.example.ts.net');
 assert.equal(f.gateway.config.devices.length,0);assert.equal(f.gateway.pairing,null);
 assert.equal((await f.request('/api/state',{headers:p.headers})).status,403);
});

test('unsupported paths and methods do not reach the backend, and redirects are not followed',async t=>{
 const f=await fixture(t),p=await f.pair();
 for(const route of ['/mobile.json','/pair.html','/server.mjs','/data/store.json'])assert.equal((await f.request(route,{headers:p.headers})).status,404);
 for(const method of ['PUT','DELETE','PATCH','OPTIONS'])assert.equal((await f.request('/api/state',{method,headers:p.headers})).status,404);
 assert.equal(f.requests.length,0);
 assert.equal((await f.request('/api/redirect',{headers:p.headers})).status,400);
 assert.equal(f.requests.length,1);
});

test('phone access fails closed if the backend token cannot be safely replaced and cannot shut down the host',async t=>{
 const f=await fixture(t),p=await f.pair();
 for(const html of [`<script>window.CREW_TOKEN = '${backendToken}';</script>`,`<script>window.CREW_TOKEN='${backendToken}';</script><div>${backendToken}</div>`]){
  f.setRootHTML(html);const response=await f.request('/',{headers:p.headers});assert.equal(response.status,400);assert.ok(!response.text.includes(backendToken));
 }
 const before=f.requests.length;
 assert.equal((await f.request('/api/shutdown',{method:'POST',headers:p.headers,body:{}})).status,403);
 for(const route of ['/api/account-status','/api/account-login','/api/account-cancel'])assert.equal((await f.request(route,{method:'POST',headers:p.headers,body:{}})).status,403);
 assert.equal(f.requests.length,before);
});
