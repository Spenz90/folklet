import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {spawn,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {pipeline} from 'node:stream/promises';
import yauzl from 'yauzl';
import {archivePath,safeLink,assertNoLinks,verifyUnixArchive} from './Build-Unix.mjs';
import {probeHost,shutdownHost} from '../electron/host.cjs';

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function deadline(promise,ms,message){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(message)),ms);})]);}finally{clearTimeout(timer);}}
export function isolatedEnvironment(root,source=process.env){
 const env={};for(const key of ['PATH','Path','SystemRoot','WINDIR','COMSPEC','PATHEXT','DISPLAY','XAUTHORITY','DBUS_SESSION_BUS_ADDRESS','LANG','LC_ALL'])if(source[key])env[key]=source[key];
 return {...env,HOME:root,USERPROFILE:root,APPDATA:path.join(root,'appdata'),LOCALAPPDATA:path.join(root,'localappdata'),XDG_CONFIG_HOME:path.join(root,'config'),XDG_CACHE_HOME:path.join(root,'cache'),CODEX_HOME:path.join(root,'codex'),CREW_DATA:path.join(root,'data'),CREW_PORT:'4318',CREW_MOBILE_PORT:'4320',TMPDIR:path.join(root,'tmp'),TEMP:path.join(root,'tmp'),TMP:path.join(root,'tmp')};
}
export function validateSmokeTarget(platform,host=`${process.platform}-${process.arch}`){
 if(!['win32-x64','darwin-arm64','darwin-x64','linux-x64'].includes(platform)||platform!==host)throw Error('Desktop smoke must run on its matching OS and architecture.');return platform;
}
export function signatureEvidence(platform,executable,env,run=spawnSync){
 const invoke=(file,args,extra={})=>run(file,args,{env,encoding:'utf8',windowsHide:true,timeout:30000,...extra});
 if(platform==='win32-x64'){
  const command="$s = Get-AuthenticodeSignature -LiteralPath $env:CREW_SIGNATURE_TARGET; @{authenticodeValid=($s.Status -eq 'Valid' -and $null -ne $s.SignerCertificate);timestamped=($null -ne $s.TimeStamperCertificate)} | ConvertTo-Json -Compress";
  const result=invoke('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{env:{...env,CREW_SIGNATURE_TARGET:executable}});
  try{const value=JSON.parse(result.stdout);return {authenticodeValid:result.status===0&&value.authenticodeValid===true,timestamped:result.status===0&&value.timestamped===true};}catch{return {authenticodeValid:false,timestamped:false};}
 }
 if(platform.startsWith('darwin')){
  const app=path.resolve(executable,'../../..');
  return {codesignValid:invoke('/usr/bin/codesign',['--verify','--deep','--strict',app]).status===0,gatekeeperAccepted:invoke('/usr/sbin/spctl',['--assess','--type','execute',app]).status===0,notarizationStapled:invoke('/usr/bin/xcrun',['stapler','validate',app]).status===0};
 }
 return {publisherSignatureRequired:false};
}
async function freePort(port){
 const listener=net.createServer();try{await new Promise((resolve,reject)=>{listener.once('error',reject);listener.listen(port,'127.0.0.1',resolve);});}catch{throw Error('Desktop smoke requires unused loopback ports 4318 and 4320. No existing host was stopped.');}finally{if(listener.listening)await new Promise(resolve=>listener.close(resolve));}
}
const sha=async file=>{const hash=createHash('sha256');for await(const b of fs.createReadStream(file))hash.update(b);return hash.digest('hex');};
async function extractArchive(file,destination){
 const zip=await new Promise((resolve,reject)=>yauzl.open(file,{lazyEntries:true,autoClose:false},(error,value)=>error?reject(error):resolve(value)));
 try{
  const entries=await new Promise((resolve,reject)=>{const all=[];zip.on('entry',entry=>{all.push(entry);zip.readEntry();});zip.once('error',reject);zip.once('end',()=>resolve(all));zip.readEntry();});
  const names=new Set(),links=[];let total=0;
  for(const entry of entries){archivePath(entry.fileName);if(names.has(entry.fileName))throw Error('Duplicate desktop entry.');names.add(entry.fileName);total+=entry.uncompressedSize;if(total>3_000_000_000||entries.length>10000)throw Error('Desktop archive exceeds smoke extraction limits.');}
  for(const entry of entries){
   const target=path.join(destination,entry.fileName),mode=entry.externalFileAttributes>>>16;
   if(entry.fileName.endsWith('/')){fs.mkdirSync(target,{recursive:true});continue;}
   fs.mkdirSync(path.dirname(target),{recursive:true});
   const stream=await new Promise((resolve,reject)=>zip.openReadStream(entry,(error,value)=>error?reject(error):resolve(value)));
   if((mode&0o170000)===0o120000){if(entry.uncompressedSize>4096)throw Error('Oversized desktop link.');const chunks=[];for await(const chunk of stream)chunks.push(chunk);const link=Buffer.concat(chunks).toString('utf8');safeLink(entry.fileName,link);links.push({target,link});}
   else{await pipeline(stream,fs.createWriteStream(target,{flags:'wx'}));if(process.platform!=='win32')fs.chmodSync(target,(mode&0o777)||0o644);}
  }
  for(const {target,link} of links)fs.symlinkSync(link,target);
 }finally{zip.close();}
}
function launch(file,args,options){
 const child=spawn(file,args,{windowsHide:true,stdio:'ignore',...options});
 child.done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));});child.done.catch(()=>{});return child;
}
async function stopOwned(child){if(!child||child.exitCode!==null||child.signalCode)return;child.kill();await deadline(child.done,3000,'Shutdown timeout').catch(()=>{});if(child.exitCode===null&&!child.signalCode){child.kill('SIGKILL');await deadline(child.done,3000,'Shutdown timeout').catch(()=>{});}}
export async function smokeDesktop({platform,archive,output}={}){
 validateSmokeTarget(platform);archive=path.resolve(archive||'');output=path.resolve(output||'test-results');assertNoLinks(archive);assertNoLinks(output);
 if(!archive.endsWith('.zip')||!fs.statSync(archive,{throwIfNoEntry:false})?.isFile())throw Error('Choose an existing desktop ZIP.');
 const digest=await sha(archive),checksum=fs.readFileSync(archive+'.sha256','utf8').trim().split(/\s+/)[0];if(digest!==checksum)throw Error('Desktop checksum does not match.');
 if(platform!=='win32-x64')await verifyUnixArchive(archive,platform);
 await freePort(4318);await freePort(4320);
 fs.mkdirSync(output,{recursive:true});const root=fs.mkdtempSync(path.join(os.tmpdir(),'crew-desktop-smoke-')),extracted=path.join(root,'extracted'),isolated=path.join(root,'isolated');fs.mkdirSync(extracted);fs.mkdirSync(isolated);
 const report=path.join(isolated,'desktop.json'),resultPath=path.join(output,platform+'-smoke.json'),screenshot=path.join(output,platform+'-smoke.png');assertNoLinks(resultPath);assertNoLinks(screenshot);
 let host,desktop,identity,passed=false;
 try{
  await extractArchive(archive,extracted);
  const appRoot=path.join(extracted,...(platform==='win32-x64'?['Crew']:platform.startsWith('darwin')?['Crew.app','Contents','Resources','app','crew']:['Crew','resources','app','crew']));
  const node=path.join(appRoot,'runtime',platform==='win32-x64'?'node.exe':'node'),env=isolatedEnvironment(isolated);for(const value of Object.values(env).filter(value=>typeof value==='string'&&value.startsWith(isolated)))fs.mkdirSync(value,{recursive:true});
  const version=JSON.parse(fs.readFileSync(path.join(appRoot,'package.json'),'utf8')).version;
  host=launch(node,[path.join(appRoot,'server.mjs')],{cwd:appRoot,env});
  const deadline=Date.now()+30000;
  while(Date.now()<deadline){const current=await probeHost();if(current.state==='ready'){if(current.pid!==host.pid)throw Error('Smoke host identity mismatch.');identity={...current,port:4318};break;}if(host.exitCode!==null||host.signalCode)throw Error('Packaged host stopped before startup.');await pause(200);}
  if(!identity)throw Error('Packaged host did not start.');
  const executable=path.join(extracted,...(platform==='win32-x64'?['Crew','desktop','Crew.exe']:platform.startsWith('darwin')?['Crew.app','Contents','MacOS','Electron']:['Crew','crew']));
  desktop=launch(executable,['--smoke-test',report],{cwd:path.dirname(executable),env:{...env,CREW_SMOKE_ROOT:isolated,CREW_SMOKE_HOST_PID:String(host.pid)}});
  const ended=await deadline(desktop.done,45000,'Packaged desktop smoke timed out.');
  if(ended.code!==0||!fs.existsSync(report))throw Error('Packaged desktop did not complete smoke.');
  const result=JSON.parse(fs.readFileSync(report,'utf8'));
  if(result.passed!==true||result.page?.rendered!==true||result.page?.tokenPresent!==true)throw Error('Packaged workspace did not render.');
  if(platform!=='win32-x64'&&(result.rendererSandboxed!==true||result.contextIsolation!==true||result.nodeIntegration!==false))throw Error('Packaged Electron isolation check failed.');
  fs.copyFileSync(report.replace(/\.json$/,'.png'),screenshot);
  await shutdownHost(identity);await deadline(host.done,5000,'Packaged host did not close.');
  if(host.exitCode===null)throw Error('Packaged host remained running.');
  const signing=signatureEvidence(platform,executable,env);
  passed=true;const evidence={schemaVersion:1,passed:true,platform,version,archive:path.basename(archive),archiveSha256:digest,checkedAt:new Date().toISOString(),hostStarted:true,workspaceRendered:true,isolatedData:true,ownedProcessesClosed:true,modelAccountUsed:false,nativeInputUsed:false,signing};fs.writeFileSync(resultPath,JSON.stringify(evidence,null,2)+'\n');return evidence;
 }finally{
  await stopOwned(desktop);if(identity&&host?.exitCode===null)await shutdownHost(identity).catch(()=>{});await stopOwned(host);
  if(!passed)fs.writeFileSync(resultPath,JSON.stringify({schemaVersion:1,passed:false,platform,archive:path.basename(archive),archiveSha256:digest,error:'Isolated packaged desktop smoke failed.'},null,2)+'\n');
  if(path.dirname(root)===path.resolve(os.tmpdir())&&path.basename(root).startsWith('crew-desktop-smoke-'))fs.rmSync(root,{recursive:true,force:true,maxRetries:3,retryDelay:300});
 }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const options={},args=process.argv.slice(2);for(let i=0;i<args.length;i++){const key={'--platform':'platform','--archive':'archive','--output':'output'}[args[i]];if(!key||!args[i+1])throw Error('Use --platform <target> --archive <ZIP> [--output <folder>].');options[key]=args[++i];}console.log(JSON.stringify(await smokeDesktop(options)));
}
