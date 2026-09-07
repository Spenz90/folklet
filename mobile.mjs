import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomBytes,randomInt,timingSafeEqual} from 'node:crypto';
import {Readable} from 'node:stream';
import {isManagedBrowserRequest} from './http.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const safeEqual=(a,b)=>{if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;const left=Buffer.from(a),right=Buffer.from(b);return left.length===right.length&&timingSafeEqual(left,right);};
const cookieName='__Host-CrewDevice',lifetime=30*24*60*60*1000;
export const csrfFor=secret=>hash('crew-mobile-csrf:'+secret);
export function mobileOrigin(value){const u=new URL(String(value));if(u.protocol!=='https:'||!u.hostname.endsWith('.ts.net')||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw Error('Use your private Tailscale HTTPS address, ending in .ts.net.');return u.origin;}
function json(res,status,value,extra={}){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store',...extra});res.end(JSON.stringify(value));}
async function body(req,max=16000000){let n=0,chunks=[];for await(const chunk of req){n+=chunk.length;if(n>max)throw Error('Request too large');chunks.push(chunk);}return Buffer.concat(chunks);}

export class MobileAccess {
 constructor({dataRoot,appRoot,localPort,localToken,port=4320,clock=Date.now,protectOrigin=()=>{}}){
  Object.assign(this,{appRoot,localPort,localToken,port,clock,protectOrigin});this.file=path.join(dataRoot,'mobile.json');this.server=null;this.pairing=null;this.lastError='';
  this.config=fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file,'utf8')):{enabled:false,origin:'',devices:[]};
 }
 save(){fs.mkdirSync(path.dirname(this.file),{recursive:true});fs.writeFileSync(this.file+'.tmp',JSON.stringify(this.config,null,2),{mode:0o600});fs.renameSync(this.file+'.tmp',this.file);}
 status(){return {enabled:!!this.server,configured:this.config.enabled,origin:this.config.origin,error:this.lastError,devices:this.config.devices.filter(d=>d.expiresAt>this.clock()).map(({hash,...d})=>d),pairingExpiresAt:this.pairing?.expiresAt||null};}
 async start(){if(!this.config.enabled)return;mobileOrigin(this.config.origin);this.protectOrigin(this.config.origin);if(this.server)return;const server=http.createServer((req,res)=>this.handle(req,res));server.requestTimeout=30000;server.headersTimeout=15000;await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(this.port,'127.0.0.1',resolve);});this.server=server;this.port=server.address().port;this.protectOrigin(`http://127.0.0.1:${this.port}`);this.lastError='';}
 async configure(origin){const next=mobileOrigin(origin);if(next!==this.config.origin){this.config.devices=[];this.pairing=null;}this.config.origin=next;this.config.enabled=true;try{await this.start();this.save();return this.status();}catch(e){this.config.enabled=false;this.lastError=e.message;this.save();throw e;}}
 async disable(){this.config.enabled=false;this.config.devices=[];this.pairing=null;this.save();await this.close();return this.status();}
 async close(){if(this.server){const server=this.server;this.server=null;server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}}
 createPairing(){if(!this.server)throw Error('Connect Tailscale first.');const code=String(randomInt(10000000,100000000));this.pairing={hash:hash(code),expiresAt:this.clock()+5*60000,attempts:0};return {code,expiresAt:this.pairing.expiresAt,origin:this.config.origin};}
 pair(code,name){const p=this.pairing;if(!p||p.expiresAt<=this.clock()||p.attempts>=10)throw Error('Request a new pairing code in Crew on your PC.');p.attempts++;if(!safeEqual(p.hash,hash(String(code).replace(/[ -]/g,''))))throw Error('That code is incorrect.');this.pairing=null;const secret=randomBytes(32).toString('hex'),device={id:randomBytes(12).toString('hex'),hash:hash(secret),name:String(name||'iPhone').trim().slice(0,60)||'iPhone',createdAt:this.clock(),expiresAt:this.clock()+lifetime};this.config.devices=this.config.devices.filter(d=>d.expiresAt>this.clock());this.config.devices.push(device);this.save();return secret;}
 device(req){const match=String(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='));if(!match)return null;const secret=match.slice(cookieName.length+1);if(!/^[a-f0-9]{64}$/.test(secret))return null;const d=this.config.devices.find(d=>safeEqual(d.hash,hash(secret))&&d.expiresAt>this.clock());return d?{...d,secret}:null;}
 revoke(id){this.config.devices=this.config.devices.filter(d=>d.id!==id);this.save();return this.status();}
 async handle(req,res){try{
  if(isManagedBrowserRequest(req))return json(res,403,{error:'Use the Crew app to manage permissions. Managed browsers cannot access Crew.'});
  if(!this.config.enabled)return json(res,503,{error:'Phone access is disabled.'});
  // This listener is reachable only on loopback. Tailscale Serve terminates HTTPS.
  const allowedHosts=[new URL(this.config.origin).host,`127.0.0.1:${this.port}`,`localhost:${this.port}`];
  if(!allowedHosts.includes(req.headers.host))return json(res,403,{error:'Invalid host'});
  const url=new URL(req.url,this.config.origin);
  if(req.headers.origin&&req.headers.origin!==this.config.origin)return json(res,403,{error:'Invalid origin'});
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  if(req.method==='POST'&&url.pathname==='/pair'){
   if(req.headers.origin!==this.config.origin)return json(res,403,{error:'Open the private HTTPS address to pair.'});
   const a=JSON.parse((await body(req,2048)).toString()),secret=this.pair(a.code,a.name);
   return json(res,200,{ok:true},{'Set-Cookie':`${cookieName}=${secret}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${lifetime/1000}`});
  }
  const publicAssets=['/manifest.webmanifest','/service-worker.js','/offline.html','/pwa.js','/icons/crew-192.png','/icons/crew-512.png','/icons/crew-maskable-512.png','/icons/apple-touch-icon.png','/icons/crew.ico'];
  const paired=this.device(req);
  if(req.method==='POST'&&url.pathname==='/unpair'&&paired){if(!safeEqual(req.headers['x-crew-token'],csrfFor(paired.secret)))return json(res,403,{error:'Refresh Crew before disconnecting.'});this.revoke(paired.id);return json(res,200,{ok:true},{'Set-Cookie':`${cookieName}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0`});}
  if(!paired&&!publicAssets.includes(url.pathname)){
   if(req.method==='GET'&&url.pathname==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'"});return res.end(fs.readFileSync(path.join(this.appRoot,'pair.html'),'utf8'));}
   return json(res,401,{error:'Pair this device again from Crew on your PC.'});
  }
  if(url.pathname.startsWith('/api/mobile')||url.pathname.startsWith('/api/account')||(url.pathname.startsWith('/api/provider')&&!(req.method==='GET'&&['/api/providers','/api/provider-models'].includes(url.pathname)))||url.pathname.startsWith('/api/notification-')||url.pathname.startsWith('/api/integration-')||url.pathname.startsWith('/api/app-change')||url.pathname==='/api/native-enable'||url.pathname==='/api/shutdown'||url.pathname==='/health')return json(res,403,{error:'Manage Crew from your host computer.'});
  const api=url.pathname.startsWith('/api/');
  if(api&&(!paired||!safeEqual(req.headers['x-crew-token'],csrfFor(paired.secret))))return json(res,403,{error:'Refresh Crew to reconnect.'});
  if(!['GET','POST'].includes(req.method)||(!api&&!['/','/app.js','/markdown.mjs','/settings-ui.mjs','/model-settings-ui.mjs','/review-ui-common.mjs','/skills-ui.mjs','/learning-review-ui.mjs','/recall-ui.mjs','/integrations-ui.mjs','/notifications-ui.mjs','/routine-policy-ui.mjs','/fallback-ui.mjs','/app-changes-ui.mjs','/style.css',...publicAssets].includes(url.pathname)))return json(res,404,{error:'Not found'});
  if(req.method==='POST'&&!api)return json(res,404,{error:'Not found'});
  const payload=req.method==='POST'?await body(req):undefined;
  const upstream=await fetch(`http://127.0.0.1:${this.localPort}${url.pathname}${url.search}`,{method:req.method,headers:{'X-Crew-Token':this.localToken,'Content-Type':'application/json'},body:payload,redirect:'error',signal:AbortSignal.timeout(api?120000:15000)});
  const headers={};for(const key of ['content-type','content-disposition','content-security-policy'])if(upstream.headers.has(key))headers[key]=upstream.headers.get(key);headers['Cache-Control']='no-store';
  if(url.pathname==='/'&&paired){const original=await upstream.text(),marker="window.CREW_TOKEN='"+this.localToken+"';";if(!original.includes(marker))throw Error('Crew needs an update before phone access can continue.');const content=original.replace(marker,"window.CREW_TOKEN='"+csrfFor(paired.secret)+"';window.CREW_MOBILE=true;");if(content.includes(this.localToken))throw Error('Crew could not establish a private phone session.');res.writeHead(upstream.status,headers);return res.end(content);}
  res.writeHead(upstream.status,headers);if(upstream.body){const stream=Readable.fromWeb(upstream.body);stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);}else res.end();
 }catch(e){if(!res.headersSent)json(res,400,{error:e.message});else res.end();}}
}
