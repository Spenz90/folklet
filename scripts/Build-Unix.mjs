import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {pipeline} from 'node:stream/promises';
import {Readable} from 'node:stream';
import yauzl from 'yauzl';
import yazl from 'yazl';
import {collectReleaseFiles,validateRelativeFile} from './release-files.mjs';
import {platformManifest} from './Install-Platform.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sha=async file=>{const hash=createHash('sha256');for await(const b of fs.createReadStream(file))hash.update(b);return hash.digest('hex');};
export function assertNoLinks(file){let p=path.resolve(file);while(true){if(fs.lstatSync(p,{throwIfNoEntry:false})?.isSymbolicLink())throw Error('Build paths cannot contain links');const parent=path.dirname(p);if(p===parent)break;p=parent;}}
export function archivePath(name){if(typeof name!=='string'||!name||name.includes('\\')||name.startsWith('/')||name.includes(':')||name.split('/').some(p=>p==='..'||p==='.')||name.includes('\0'))throw Error('Unsafe archive path');return name;}
export function safeLink(name,target){archivePath(name);if(!target||target.includes('\\')||target.startsWith('/')||target.includes(':')||target.includes('\0'))throw Error('Unsafe archive link');const resolved=path.posix.resolve('/',path.posix.dirname(name),target);if(!resolved.startsWith('/Folklet.app/'))throw Error('Archive link escapes the app');return target;}
export function brandPlist(text,version){
 const values={CFBundleName:'Folklet',CFBundleDisplayName:'Folklet',CFBundleIdentifier:'org.crew.desktop',CFBundleShortVersionString:version,CFBundleVersion:version,CFBundleIconFile:'crew.icns',LSMinimumSystemVersion:'15.0'};
 for(const [key,value] of Object.entries(values)){
  const escaped=value.replaceAll('&','&amp;').replaceAll('<','&lt;');
  const re=new RegExp(`(<key>${key}</key>\\s*)<string>[^<]*</string>`);
  text=re.test(text)?text.replace(re,`$1<string>${escaped}</string>`):text.replace('<dict>',`<dict>\n<key>${key}</key><string>${escaped}</string>`);
 }
 return text;
}
const openZip=file=>new Promise((resolve,reject)=>yauzl.open(file,{lazyEntries:true,autoClose:false},(e,z)=>e?reject(e):resolve(z)));
const entries=zip=>new Promise((resolve,reject)=>{const all=[];zip.on('entry',e=>{all.push(e);zip.readEntry();});zip.once('end',()=>resolve(all));zip.once('error',reject);zip.readEntry();});
const streamEntry=(zip,entry)=>new Promise((resolve,reject)=>zip.openReadStream(entry,(e,s)=>e?reject(e):resolve(s)));
const entryBuffer=async(zip,entry)=>{if(entry.uncompressedSize>2_000_000)throw Error('Unexpected metadata size');const parts=[];for await(const p of await streamEntry(zip,entry))parts.push(p);return Buffer.concat(parts);};
async function getElectron(pin,cache,offline){
 if(new URL(pin.url).origin!=='https://github.com'||!new URL(pin.url).pathname.startsWith('/electron/electron/releases/download/'))throw Error('Unexpected Electron source');
 assertNoLinks(cache);fs.mkdirSync(cache,{recursive:true});
 const file=path.join(cache,path.basename(new URL(pin.url).pathname));assertNoLinks(file);
 if(fs.existsSync(file)){if(await sha(file)!==pin.sha256)throw Error('Cached Electron hash mismatch');return file;}
 if(offline)throw Error('Electron archive is missing from the offline cache');
 console.log('Downloading pinned Electron '+path.basename(file));
 const response=await fetch(pin.url);if(!response.ok)throw Error('Electron download failed: '+response.status);
 const temp=file+'.'+randomUUID()+'.part';await pipeline(Readable.fromWeb(response.body),fs.createWriteStream(temp,{flags:'wx'}));
 if(await sha(temp)!==pin.sha256){fs.unlinkSync(temp);throw Error('Electron download checksum mismatch');}fs.renameSync(temp,file);return file;
}
function addTree(zip,directory,prefix){
 assertNoLinks(directory);
 for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
  const full=path.join(directory,entry.name),name=archivePath(prefix+'/'+entry.name);
  if(entry.isSymbolicLink())throw Error('Unexpected local dependency link');
  if(entry.isDirectory())addTree(zip,full,name);else if(entry.isFile()){validateRelativeFile(name);zip.addFile(full,name,{mode:0o100644});}else throw Error('Unexpected dependency file');
 }
}
export function expectedRuntimeFiles(platform){
 const target=platformManifest.platforms[platform];if(!target)throw Error('Unknown runtime platform');
 return [
  {path:'runtime/node',sha256:target.node.executableSha256,mode:0o755},
  {path:'runtime/LICENSE.txt',sha256:target.node.licenseSha256,mode:0o644},
  ...target.codex.files.map(f=>({path:'runtime/codex/'+f.file,sha256:f.sha256,mode:f.executable?0o755:0o644})),
  ...platformManifest.notices.filter(f=>f.platforms.includes(platform)).map(f=>({path:'runtime/codex/'+f.file,sha256:f.sha256,mode:0o644}))
 ].sort((a,b)=>a.path.localeCompare(b.path));
}
export function validateRuntimeReceipt(receipt,platform){
 const target=platformManifest.platforms[platform];
 if(!target||receipt.schemaVersion!==1||receipt.platform!==platform||!Array.isArray(receipt.files))throw Error('Runtime platform receipt mismatch');
 for(const component of ['node','codex'])if(receipt.sources?.[component]?.url!==target[component].url||receipt.sources?.[component]?.sha256!==target[component].sha256)throw Error('Runtime source differs from pinned publisher');
 const expected=expectedRuntimeFiles(platform),actual=[...receipt.files].sort((a,b)=>String(a.path).localeCompare(String(b.path)));
 if(expected.length!==actual.length)throw Error('Unexpected runtime receipt file count');
 for(let i=0;i<expected.length;i++){
  const a=actual[i],e=expected[i];validateRelativeFile(a.path);
  if(a.path!==e.path||a.sha256!==e.sha256||a.mode!==e.mode)throw Error('Runtime receipt differs from pinned files');
 }
 return expected;
}
export function validateMacHelperHeader(header,platform){
 const cpu={'darwin-arm64':0x0100000c,'darwin-x64':0x01000007}[platform];
 if(!cpu||header.length<8||header.readUInt32LE(0)!==0xfeedfacf||header.readUInt32LE(4)!==cpu)throw Error('Native Mac helper does not match the requested architecture');
}
export function sourceWithoutRuntimeDuplicates(source,runtimeFiles){
 const runtimePaths=new Set(runtimeFiles.map(f=>f.path));return source.filter(relative=>!runtimePaths.has(relative));
}
export function unixArchiveReadme(platform){
 if(!platformManifest.platforms[platform])throw Error('Unknown desktop platform');
 const mac=platform.startsWith('darwin-'),guides=mac?'Folklet.app/Contents/Resources/app/crew/':'resources/app/crew/';
 const title=mac?'Folklet for Mac — '+(platform==='darwin-arm64'?'Apple Silicon':'Intel'):'Folklet for Linux x64';
 const start=mac?
  'Requires macOS 15 or later and the matching Mac architecture. Extract the whole ZIP, keep Folklet.app intact, and open Folklet.app. You can move it to Applications.':
  'Requires a Linux x64 desktop with glibc 2.38 or later, libtinfo.so.6 and Electron desktop libraries; Ubuntu 24.04 and Debian 13 are reference targets. Extract the whole ZIP, open a terminal in the Folklet folder, and run `sh "./Start Folklet.sh"`. Keep the entire folder together. This is not an Alpine package.';
 const preview=mac?
  'This is a preview. A local ad-hoc signature is not Apple Developer ID signing or notarization. See the published release checks for native launch results and native-control helper availability, and read the Mac build/signing instructions before relying on this download. Do not disable macOS protections to launch it.':
  'This is a preview. See the published release checks for tested systems and native desktop launch results before relying on this download. Do not disable sandboxing to bypass a startup error.';
 return `# ${title}\n\n${start}\n\n${preview}\n\nOnce Folklet opens, choose **My workspace → Quick start**, **Connections** or **Cloud hosting** for the in-app guides. Connect your ChatGPT account or an API provider, create a bot and send a small first task. The Codex desktop app is not required.\n\nBrowser tasks need an installed supported browser; **Folklet → Install browser** downloads Folklet's browser when needed. Keep this host awake for routines and phone access.\n\nOffline guides included in this archive:\n\n- [Quick start](${guides}QUICKSTART.md)\n- [Connections and models](${guides}PROVIDERS.md)\n- [Private cloud hosting](${guides}HOSTING.md)\n- [Preview checks and limitations](${guides}RELEASE-CHECKS.md)\n- [Build and signing instructions](${guides}RELEASING.md)\n\nThese links work relative to this README after extraction. The same guides are available inside Folklet.\n`;
}
export async function buildUnix({platform,runtimeRoot,nativeHelper,cache=path.join(root,'.cache/electron'),output=path.join(root,'dist'),offline=false}={}){
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'scripts/electron-releases.json'))),pin=manifest.platforms[platform];if(!pin)throw Error('Choose darwin-arm64, darwin-x64, or linux-x64');
 const source=collectReleaseFiles(root,'Source'),isMac=platform.startsWith('darwin-');
 runtimeRoot=path.resolve(runtimeRoot||path.join(root,'.build',platform));assertNoLinks(runtimeRoot);
 if(!fs.existsSync(path.join(runtimeRoot,'runtime/platform-source.json'))){
  const args=[path.join(root,'scripts/Install-Platform.mjs'),'--platform',platform,'--root',runtimeRoot,'--cache',path.resolve(cache),...(offline?['--offline']:[])];
  const r=spawnSync(process.execPath,args,{stdio:'inherit',windowsHide:true});if(r.error||r.status!==0)throw Error('Platform runtime setup failed');
 }
 const receipt=JSON.parse(fs.readFileSync(path.join(runtimeRoot,'runtime/platform-source.json')));
 const runtimeFiles=validateRuntimeReceipt(receipt,platform);
 for(const item of runtimeFiles){const file=path.join(runtimeRoot,item.path);assertNoLinks(file);if(!fs.statSync(file).isFile()||await sha(file)!==item.sha256)throw Error('Platform runtime hash mismatch: '+item.path);}
 if(nativeHelper&&!isMac)throw Error('A Mac native helper can only be added to a Mac archive');
 const defaultHelper=isMac?path.join(root,'native','macos-control-'+platform.slice(7)):null;
 nativeHelper=nativeHelper?path.resolve(nativeHelper):(defaultHelper&&fs.existsSync(defaultHelper)?defaultHelper:null);
 if(nativeHelper){assertNoLinks(nativeHelper);if(!fs.statSync(nativeHelper).isFile())throw Error('Native Mac helper must be a regular file');const fd=fs.openSync(nativeHelper,'r'),header=Buffer.alloc(8);try{fs.readSync(fd,header,0,8,0);}finally{fs.closeSync(fd);}validateMacHelperHeader(header,platform);}
 const electron=await getElectron(pin,path.resolve(cache),offline),input=await openZip(electron),list=await entries(input);
 const version=JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version;
 const base=isMac?'Folklet.app/Contents/Resources/app':'Folklet/resources/app',appBase=base+'/crew';
 const expectedMain=isMac?'Electron.app/Contents/MacOS/Electron':'electron';if(!list.some(e=>e.fileName===expectedMain))throw Error('Unexpected Electron archive layout');
 assertNoLinks(output);fs.mkdirSync(output,{recursive:true});const destination=path.join(path.resolve(output),pin.output);assertNoLinks(destination);assertNoLinks(destination+'.sha256');
 const temp=destination+'.'+randomUUID()+'.tmp',zip=new yazl.ZipFile();
 const done=pipeline(zip.outputStream,fs.createWriteStream(temp,{flags:'wx'}));zip.on('error',error=>zip.outputStream.destroy(error));
 try{
  for(const entry of list){
   const old=archivePath(entry.fileName);
   if(old.endsWith('/'))continue;
   // Adding our own app invalidates only the outer application seal. Framework
   // binaries and their signatures stay byte-for-byte unchanged.
   if(isMac&&old.startsWith('Electron.app/Contents/_CodeSignature/'))continue;
   if(/(?:^|\/)resources\/default_app\.asar$/i.test(old))continue;
   const name=archivePath(isMac?(old.startsWith('Electron.app/')?old.replace(/^Electron\.app\//,'Folklet.app/'):'Electron-Licenses/'+old):'Folklet/'+(old==='electron'?'crew':old));
   const mode=(entry.externalFileAttributes>>>16)||0o100644;
   if(isMac&&old==='Electron.app/Contents/Info.plist'){zip.addBuffer(Buffer.from(brandPlist((await entryBuffer(input,entry)).toString('utf8'),version)),name,{mode:0o100644});continue;}
   if((mode&0o170000)===0o120000){const link=(await entryBuffer(input,entry)).toString();safeLink(name,link);zip.addBuffer(Buffer.from(link),name,{mode:0o120777});continue;}
   zip.addReadStreamLazy(name,{mode,mtime:entry.getLastModDate(),size:entry.uncompressedSize},cb=>input.openReadStream(entry,cb));
  }
  for(const relative of sourceWithoutRuntimeDuplicates(source,runtimeFiles))zip.addFile(path.join(root,relative),appBase+'/'+relative,{mode:relative.endsWith('.sh')?0o100755:0o100644});
  for(const name of ['package.json','main.cjs','policy.cjs','host.cjs','smoke.cjs'])zip.addFile(path.join(root,'electron',name),base+'/'+name,{mode:0o100644});
  for(const library of ['playwright','playwright-core']){
   const pkg=JSON.parse(fs.readFileSync(path.join(root,'node_modules',library,'package.json')));if(pkg.version!=='1.62.1')throw Error('Unexpected browser library');addTree(zip,path.join(root,'node_modules',library),appBase+'/node_modules/'+library);
  }
  for(const item of runtimeFiles)zip.addFile(path.join(runtimeRoot,item.path),appBase+'/'+item.path,{mode:0o100000|item.mode});
  if(nativeHelper)zip.addFile(nativeHelper,appBase+'/native/macos-control',{mode:0o100755});
  zip.addFile(path.join(runtimeRoot,'runtime/platform-source.json'),appBase+'/runtime/platform-source.json',{mode:0o100644});
  zip.addBuffer(Buffer.from(unixArchiveReadme(platform)),isMac?'README.md':'Folklet/README.md',{mode:0o100644});
  zip.addFile(path.join(root,'LICENSE'),isMac?'LICENSE':'Folklet/CREW-LICENSE',{mode:0o100644});
  if(isMac){const png=fs.readFileSync(path.join(root,'icons/crew-512.png'));const chunk=Buffer.alloc(8);chunk.write('ic09');chunk.writeUInt32BE(png.length+8,4);const header=Buffer.alloc(8);header.write('icns');header.writeUInt32BE(png.length+16,4);zip.addBuffer(Buffer.concat([header,chunk,png]),'Folklet.app/Contents/Resources/crew.icns',{mode:0o100644});}
  else zip.addBuffer(Buffer.from('#!/bin/sh\nset -eu\ncd -- "$(dirname -- "$0")"\nexec ./crew "$@"\n'),'Folklet/Start Folklet.sh',{mode:0o100755});
  zip.end();await done;
 }catch(error){zip.outputStream.destroy(error);await done.catch(()=>{});throw error;}finally{input.close();}
 await verifyUnixArchive(temp,platform);fs.renameSync(temp,destination);
 fs.writeFileSync(destination+'.sha256',(await sha(destination))+'  '+path.basename(destination)+'\n');
 console.log(JSON.stringify({archive:path.basename(destination),bytes:fs.statSync(destination).size,platform,structureVerified:true,runtimeHashesVerified:true,nativeMacHelperIncluded:!!nativeHelper,executedOnTarget:false}));return destination;
}
export async function verifyUnixArchive(file,platform){
 const zip=await openZip(file);try{
  const list=await entries(zip),map=new Map(list.map(e=>[e.fileName,e]));if(map.size!==list.length)throw Error('Duplicate release archive path');
  const mac=platform.startsWith('darwin-'),base=mac?'Folklet.app/Contents/Resources/app':'Folklet/resources/app';
  for(const entry of list){archivePath(entry.fileName);if(/(^|\/)(data|profile|browser-profiles|\.env|auth\.json)(\/|$)/i.test(entry.fileName))throw Error('Private data in desktop archive');if(((entry.externalFileAttributes>>>16)&0o170000)===0o120000)safeLink(entry.fileName,(await entryBuffer(zip,entry)).toString());}
  for(const name of [base+'/main.cjs',base+'/host.cjs',base+'/policy.cjs',base+'/smoke.cjs',base+'/package.json',base+'/crew/server.mjs',base+'/crew/http.mjs',base+'/crew/runtime/platform-source.json',base+'/crew/node_modules/playwright/package.json'])if(!map.has(name))throw Error('Missing release file: '+name);
  const readmeName=mac?'README.md':'Folklet/README.md',readmeEntry=map.get(readmeName);if(!readmeEntry)throw Error('Missing desktop start instructions');
  const readme=(await entryBuffer(zip,readmeEntry)).toString('utf8');
  for(const [,link] of readme.matchAll(/\]\(([^)]+)\)/g)){archivePath(link);const target=path.posix.join(path.posix.dirname(readmeName),link);if(!map.has(target))throw Error('Broken desktop guide link: '+link);}
  for(const name of [mac?'Folklet.app/Contents/MacOS/Electron':'Folklet/crew',base+'/crew/runtime/node',base+'/crew/runtime/codex/bin/codex']){const entry=map.get(name);if(!entry||!((entry.externalFileAttributes>>>16)&0o111))throw Error('Missing Unix executable mode: '+name);}
  const receipt=JSON.parse((await entryBuffer(zip,map.get(base+'/crew/runtime/platform-source.json'))).toString('utf8'));
  for(const item of validateRuntimeReceipt(receipt,platform)){
   const entry=map.get(base+'/crew/'+item.path);if(!entry||((entry.externalFileAttributes>>>16)&0o777)!==item.mode)throw Error('Runtime mode mismatch: '+item.path);
   const hash=createHash('sha256');for await(const chunk of await streamEntry(zip,entry))hash.update(chunk);
   if(hash.digest('hex')!==item.sha256)throw Error('Archived runtime hash mismatch: '+item.path);
  }
  const helper=map.get(base+'/crew/native/macos-control');if(helper){if(!mac||((helper.externalFileAttributes>>>16)&0o777)!==0o755)throw Error('Unexpected native helper');const stream=await streamEntry(zip,helper);let header=Buffer.alloc(0);for await(const chunk of stream){header=Buffer.concat([header,chunk.subarray(0,8-header.length)]);if(header.length===8)break;}validateMacHelperHeader(header,platform);}
  return {files:list.length};
 }finally{zip.close();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),options={};for(let i=0;i<args.length;i++){const key=args[i];if(key==='--offline'){options.offline=true;continue;}const field={'--platform':'platform','--runtime-root':'runtimeRoot','--native-helper':'nativeHelper','--cache':'cache','--output':'output'}[key];if(!field||!args[i+1])throw Error('Unknown or incomplete build option');options[field]=args[++i];}await buildUnix(options);
}
