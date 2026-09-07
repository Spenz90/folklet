import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';

const execFileAsync=promisify(execFile),target='http://127.0.0.1:4320',servePort='8443';
const stop=new AbortController();
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
class SetupError extends Error {constructor(message,actionUrl){super(message);this.actionUrl=actionUrl;}}
const executable=file=>{try{fs.accessSync(file,fs.constants.X_OK);return fs.statSync(file).isFile();}catch{return false;}};
export function findTailscale({platform=process.platform,env=process.env,exists=executable}={}){
 if(!['darwin','linux'].includes(platform))throw new SetupError('Use FOLKLET’s Windows iPhone setup on this computer.');
 const fromPath=(env.PATH||'').split(':').filter(dir=>path.posix.isAbsolute(dir)).map(dir=>path.posix.join(dir,'tailscale'));
 const defaults=platform==='darwin'?['/Applications/Tailscale.app/Contents/MacOS/Tailscale','/opt/homebrew/bin/tailscale','/usr/local/bin/tailscale']:['/usr/bin/tailscale','/usr/local/bin/tailscale'];
 const command=[...new Set([...fromPath,...defaults])].find(exists);
 if(!command)throw new SetupError('Install Tailscale on this computer and sign in, then choose Set up connection again.','https://tailscale.com/download/'+(platform==='darwin'?'mac':'linux'));
 return command;
}
export function tailscaleActionUrl(output){
 for(const match of String(output||'').matchAll(/https:\/\/[^\s<>"']+/g)){
  try{const url=new URL(match[0].replace(/[),.;]+$/,''));if(url.hostname==='login.tailscale.com'&&url.protocol==='https:'&&!url.username&&!url.password&&(!url.port||url.port==='443'))return url.href;}catch{}
 }
 return null;
}
export function checkServeConfig(value,dns){
 const config=value??{};
 if(!object(config))throw new SetupError('Tailscale returned an unreadable Serve configuration. Update Tailscale and retry.');
 const endpoint=dns+':'+servePort;
 for(const field of ['TCP','Web','AllowFunnel','Foreground'])if(config[field]!==undefined&&config[field]!==null&&!object(config[field]))throw new SetupError('Tailscale returned an unreadable Serve configuration. Update Tailscale and retry.');
 for(const [host,enabled] of Object.entries(config.AllowFunnel||{}))if(host.endsWith(':'+servePort)&&enabled)throw new SetupError('Port 8443 is configured for public Funnel. Disable that endpoint in Tailscale before using it for private FOLKLET access.');
 for(const foreground of Object.values(config.Foreground||{}))if(object(foreground)&&(foreground.TCP?.[servePort]||Object.keys(foreground.Web||{}).some(host=>host.endsWith(':'+servePort))))throw new SetupError('Tailscale port 8443 is already in use by a foreground service. FOLKLET left it unchanged.');
 for(const host of Object.keys(config.Web||{}))if(host.endsWith(':'+servePort)&&host!==endpoint)throw new SetupError('Tailscale port 8443 already serves another app. FOLKLET left it unchanged.');
 const web=config.Web?.[endpoint],tcp=config.TCP?.[servePort];
 if(web!==undefined){
  const handlers=web?.Handlers,handler=handlers?.['/'];
  if(!object(web)||Object.keys(web).some(key=>key!=='Handlers')||!object(handlers)||Object.keys(handlers).length!==1||!object(handler)||Object.keys(handler).length!==1||handler.Proxy!==target)throw new SetupError('Tailscale port 8443 already serves another app. FOLKLET left it unchanged.');
 }
 if(tcp!==undefined&&(!object(tcp)||tcp.HTTPS!==true||Object.keys(tcp).some(key=>key!=='HTTPS')))throw new SetupError('Tailscale port 8443 is already in use by a TCP service. FOLKLET left it unchanged.');
 return web!==undefined&&tcp?.HTTPS===true;
}
async function cli(command,args){return execFileAsync(command,args,{timeout:15000,maxBuffer:1024*1024,windowsHide:true,encoding:'utf8',signal:stop.signal});}
async function crewRequest(localPort,localToken,route,body){
 const response=await fetch('http://127.0.0.1:'+localPort+'/api/'+route,{method:body?'POST':'GET',redirect:'error',signal:AbortSignal.any([AbortSignal.timeout(5000),stop.signal]),headers:{'X-Crew-Token':localToken,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 if(!response.ok)throw new SetupError('FOLKLET could not save the phone connection. Keep FOLKLET open, refresh it, and run setup again.');
 return response.json();
}
export async function setupPhone({localPort,localToken,mobilePort=4320},{platform=process.platform,env=process.env,exists=executable,runCli=cli,requestCrew=crewRequest}={}){
 try{
  if(!Number.isInteger(localPort)||localPort<1||localPort>65535||!/^[a-f0-9]{64}$/.test(localToken||''))throw new SetupError('Open FOLKLET and start phone setup from its Connect iPhone dialog.');
  if(mobilePort!==4320)throw new SetupError('Phone setup requires FOLKLET’s standard companion port 4320. Restart FOLKLET without a custom companion port.');
  await requestCrew(localPort,localToken,'mobile-status');
  const command=findTailscale({platform,env,exists});
  const read=async(args,label)=>{let output;try{output=await runCli(command,args);}catch{throw new SetupError('Could not read Tailscale '+label+'. Open Tailscale, check its connection and your account’s permissions, then retry.');}try{return JSON.parse(output.stdout);}catch{throw new SetupError('Tailscale returned unreadable '+label+'. Update Tailscale and retry.');}};
  const status=await read(['status','--json'],'status');
  if(status?.BackendState!=='Running')throw new SetupError('Open Tailscale and sign in on this computer. Use the same Tailscale account on your iPhone, then retry.');
  const dns=String(status?.Self?.DNSName||'').replace(/\.$/,'').toLowerCase();
  if(!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.ts\.net$/.test(dns)||dns.includes('..'))throw new SetupError('Enable MagicDNS in the Tailscale admin console, then retry.','https://login.tailscale.com/admin/dns');
  const before=await read(['serve','status','--json'],'Serve status');
  if(!checkServeConfig(before,dns)){
   try{await runCli(command,['serve','--bg','--https=8443',target]);}
   catch(error){const actionUrl=tailscaleActionUrl((error.stdout||'')+'\n'+(error.stderr||''));if(actionUrl)throw new SetupError('Tailscale needs HTTPS permission. Open its setup page below, enable HTTPS, then choose Set up connection again.',actionUrl);throw new SetupError('Tailscale could not enable private HTTPS. Enable HTTPS in your Tailscale settings and check that your account can manage Serve, then retry.','https://login.tailscale.com/admin/dns');}
  }
  const after=await read(['serve','status','--json'],'Serve status');
  if(!checkServeConfig(after,dns))throw new SetupError('Tailscale did not confirm FOLKLET’s private connection. Update Tailscale and run setup again.');
  const origin='https://'+dns+':8443';
  await requestCrew(localPort,localToken,'mobile-configure',{origin});
  return {status:'completed',origin,message:'Your private connection is ready. Create a pairing code for your iPhone.'};
 }catch(error){return {status:'failed',error:error instanceof SetupError?error.message:'Phone setup could not finish. Keep FOLKLET and Tailscale open, then retry.',...(error instanceof SetupError&&error.actionUrl?{actionUrl:error.actionUrl}:{})};}
}

export class PhoneSetupRunner {
 constructor({spawnProcess=spawn,node=process.execPath,script=fileURLToPath(import.meta.url)}={}){Object.assign(this,{spawnProcess,node,script});this.state={status:'idle'};this.child=null;}
 start(input){
  if(this.child)return this.state;
  this.state={status:'running',message:'Checking your private Tailscale connection…'};
  let child,timer,chunks=[],size=0,finished=false;
  const finish=value=>{if(finished)return;finished=true;clearTimeout(timer);this.child=null;this.state=value;};
  try{
   child=this.spawnProcess(this.node,[this.script],{stdio:['pipe','pipe','ignore'],windowsHide:true});this.child=child;
   child.on('error',()=>finish({status:'failed',error:'The phone setup helper could not start. Restore the complete FOLKLET package and retry.'}));
   child.stdin.on('error',()=>{});
   child.stdout.on('data',chunk=>{size+=chunk.length;if(size>65536){finish({status:'failed',error:'The phone setup helper returned an unreadable result. Retry setup.'});child.kill();}else chunks.push(Buffer.from(chunk));});
   child.on('close',()=>{if(finished)return;try{const result=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!['completed','failed'].includes(result.status))throw Error('Invalid result');finish(result);}catch{finish({status:'failed',error:'Phone setup stopped before finishing. Keep Tailscale open and retry.'});}});
   timer=setTimeout(()=>{finish({status:'failed',error:'Phone setup timed out. Open Tailscale, check its connection, and retry.'});child.kill();},75000);timer.unref?.();
   child.stdin.end(JSON.stringify(input));
  }catch{finish({status:'failed',error:'The phone setup helper could not start. Restore the complete FOLKLET package and retry.'});}
  return this.state;
 }
 close(){if(this.child){this.child.kill();this.child=null;}}
}

// The local server supplies its short-lived token over stdin, never in process
// arguments, environment variables, log files, or the shared source package.
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 process.once('SIGTERM',()=>stop.abort());process.once('SIGINT',()=>stop.abort());
 let body='',result;
 try{for await(const chunk of process.stdin){body+=chunk;if(body.length>4096)throw Error('Too much input');}result=await setupPhone(JSON.parse(body));}
 catch{result={status:'failed',error:'Open FOLKLET and start phone setup from its Connect iPhone dialog.'};}
 process.stdout.write(JSON.stringify(result)+'\n');
}
