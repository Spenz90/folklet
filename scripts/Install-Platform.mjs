#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {execFileSync, spawnSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';

const sourceRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const platformManifest=JSON.parse(fs.readFileSync(new URL('./platform-dependencies.json',import.meta.url),'utf8'));
const hashFile=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');

export function safeRelative(relative){
 if(typeof relative!=='string'||!relative||relative.startsWith('-')||relative.includes('\0')||relative.includes('\\')||relative.includes(':')||path.posix.isAbsolute(relative)||relative.split('/').some(part=>!part||part==='.'||part==='..'))throw Error('Unsafe runtime archive path.');
 return relative;
}
export function officialAssetUrl(text){
 const url=new URL(text);
 if(url.protocol!=='https:'||url.username||url.password||url.port||url.search||url.hash)throw Error('Runtime downloads require an official HTTPS URL.');
 const node=url.hostname==='nodejs.org'&&/^\/dist\/v24\.19\.0\/node-v24\.19\.0-(darwin-(arm64|x64)|linux-x64)\.tar\.gz$/.test(url.pathname);
 const codex=url.hostname==='github.com'&&/^\/openai\/codex\/releases\/download\/rust-v0\.153\.4\/codex-package-(aarch64-apple-darwin|x86_64-apple-darwin|x86_64-unknown-linux-musl)\.tar\.gz$/.test(url.pathname);
 if(!node&&!codex)throw Error('Runtime asset is not from a pinned official publisher.');
 return url;
}
export function verifyHash(file,expected){
 if(!/^[a-f0-9]{64}$/i.test(expected)||!fs.statSync(file,{throwIfNoEntry:false})?.isFile()||hashFile(file)!==expected.toLowerCase())throw Error(`Runtime checksum mismatch: ${path.basename(file)}`);
}
export async function downloadAsset(asset,cache,{offline=false}={}){
 const url=officialAssetUrl(asset.url);fs.mkdirSync(cache,{recursive:true});
 const destination=path.join(cache,path.posix.basename(url.pathname));
 if(fs.existsSync(destination)){verifyHash(destination,asset.sha256);return destination;}
 if(offline)throw Error(`Offline runtime download is missing: ${path.basename(destination)}`);
 const temporary=destination+'.'+randomUUID()+'.part';
 try{
  console.log(`Downloading ${path.basename(destination)}...`);
  const response=await fetch(url,{signal:AbortSignal.timeout(300000)});
  if(!response.ok||!response.body)throw Error(`Official download failed (${response.status}).`);
  // GitHub redirects release assets to its storage host. The fixed SHA-256 is
  // verified before extraction; redirects never change the trusted artifact.
  if(new URL(response.url).protocol!=='https:')throw Error('Runtime download left HTTPS.');
  await pipeline(Readable.fromWeb(response.body),fs.createWriteStream(temporary,{flags:'wx'}));
  verifyHash(temporary,asset.sha256);fs.renameSync(temporary,destination);return destination;
 }finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
}
function run(command,args,options={}){
 const result=spawnSync(command,args,{stdio:'inherit',windowsHide:true,...options});
 if(result.error)throw result.error;
 if(result.status!==0)throw Error(`${path.basename(command)} failed with exit code ${result.status}.`);
}
function extractSelected(archive,destination,members){
 for(const member of members)safeRelative(member);
 fs.mkdirSync(destination,{recursive:true});
 run('tar',['-xzf',archive,'-C',destination,'--',...members]);
}
function checkedCopy(source,destination,sha256,mode){
 if(fs.lstatSync(source).isSymbolicLink())throw Error('Runtime symlinks are not accepted.');
 verifyHash(source,sha256);fs.mkdirSync(path.dirname(destination),{recursive:true});
 if(!fs.existsSync(destination)||hashFile(destination)!==sha256)fs.copyFileSync(source,destination);
 fs.chmodSync(destination,mode);
}
function verifyNativeHost(target){
 if(target.os!==process.platform||target.arch!==process.arch)throw Error('Foreign runtimes may be staged, but cannot be executed on this host.');
 if(process.platform==='darwin'){
  const version=execFileSync('/usr/bin/sw_vers',['-productVersion'],{encoding:'utf8'}).trim();
  if(Number(version.split('.')[0])<15)throw Error('This Folklet runtime requires macOS 15 or later.');
 }else if(process.platform==='linux'){
  const glibc=process.report?.getReport().header.glibcVersionRuntime;
  const [major,minor]=(glibc||'0.0').split('.').map(Number);
  if(major<2||(major===2&&minor<38))throw Error('This Folklet runtime needs a desktop Linux distribution with glibc 2.38 or later (for example Ubuntu 24.04 or Debian 13).');
 }
}

export async function installPlatform({platform,root,cache,offline=false,installDependencies=false,installBrowser=false,browserIfNeeded=false}={}){
 const target=platformManifest.platforms[platform];if(!target)throw Error('Choose darwin-arm64, darwin-x64 or linux-x64.');
 root=path.resolve(root||sourceRoot);cache=path.resolve(cache||path.join(root,'.cache','crew-setup'));
 if((installDependencies||installBrowser||browserIfNeeded))verifyNativeHost(target);
 if((target.os!==process.platform||target.arch!==process.arch)&&root===sourceRoot)throw Error('Use --root with a separate staging folder when assembling a foreign platform.');
 const temporary=path.join(cache,'extract-'+randomUUID());fs.mkdirSync(temporary,{recursive:true});
 const files=[];
 function stage(source,relative,sha256,mode){safeRelative(relative);checkedCopy(source,path.join(root,relative),sha256,mode);files.push({path:relative,sha256,mode});}
 try{
  const nodeArchive=await downloadAsset(target.node,cache,{offline});
  const nodeMembers=[target.node.archiveRoot+'/bin/node',target.node.archiveRoot+'/LICENSE'];
  if(installDependencies)nodeMembers.push(target.node.archiveRoot+'/lib/node_modules/npm');
  const nodeExtract=path.join(temporary,'node');extractSelected(nodeArchive,nodeExtract,nodeMembers);
  const nodeSource=path.join(nodeExtract,target.node.archiveRoot);
  stage(path.join(nodeSource,'bin/node'),'runtime/node',target.node.executableSha256,0o755);
  stage(path.join(nodeSource,'LICENSE'),'runtime/LICENSE.txt',target.node.licenseSha256,0o644);
  const codexArchive=await downloadAsset(target.codex,cache,{offline});
  const codexExtract=path.join(temporary,'codex');extractSelected(codexArchive,codexExtract,target.codex.files.map(file=>file.file));
  for(const file of target.codex.files)stage(path.join(codexExtract,file.file),'runtime/codex/'+file.file,file.sha256,file.executable?0o755:0o644);
  for(const notice of platformManifest.notices.filter(item=>item.platforms.includes(platform))){
   stage(path.join(sourceRoot,'runtime/codex',notice.file),'runtime/codex/'+notice.file,notice.sha256,0o644);
  }
  const receipt={schemaVersion:1,platform,minimum:target.minimum,sources:{node:{url:target.node.url,sha256:target.node.sha256},codex:{url:target.codex.url,sha256:target.codex.sha256}},files:files.sort((a,b)=>a.path.localeCompare(b.path))};
  fs.writeFileSync(path.join(root,'runtime/platform-source.json'),JSON.stringify(receipt,null,2)+'\n');
  const node=path.join(root,'runtime/node');
  const childEnv={...process.env,PATH:path.dirname(node)+path.delimiter+(process.env.PATH||'')};
  if(installDependencies){
   const lock=path.join(root,'package-lock.json');if(!fs.existsSync(lock))throw Error('Restore package-lock.json from the source checkout.');
   const args=[path.join(nodeSource,'lib/node_modules/npm/bin/npm-cli.js'),'ci','--ignore-scripts','--omit=optional','--no-audit','--fund=false','--registry=https://registry.npmjs.org/','--cache',path.join(cache,'npm'),'--prefix',root];
   if(offline)args.push('--offline');run(node,args,{cwd:root,env:childEnv});
  }
  if(installBrowser||browserIfNeeded){
   let needed=installBrowser;
   fs.mkdirSync(path.join(root,'runtime/browsers'),{recursive:true});
   process.env.PLAYWRIGHT_BROWSERS_PATH=path.join(root,'runtime/browsers');
   if(!needed){
    const require=createRequire(path.join(root,'package.json'));
    const {chromium}=require('playwright');
    const {resolveCrewBrowser}=await import(pathToFileURL(path.join(root,'computer.mjs')));
    try{resolveCrewBrowser(chromium);}catch{needed=true;}
   }
   if(needed){
    if(offline)throw Error('No installed browser is available for offline setup. Run setup online, or install Edge/Chrome first.');
    run(node,[path.join(root,'node_modules/playwright/cli.js'),'install','--no-shell','chromium'],{cwd:root,env:{...childEnv,PLAYWRIGHT_BROWSERS_PATH:path.join(root,'runtime/browsers')}});
   }
  }
  console.log(`Verified ${platform} runtime assembled (${files.length} files).`);return receipt;
 }finally{
  // This directory was created by this invocation below the selected cache;
  // never remove the cache or an existing installation during cleanup.
  const relative=path.relative(cache,temporary);
  if(!relative.startsWith('..')&&!path.isAbsolute(relative)&&/^extract-[a-f0-9-]+$/.test(relative))fs.rmSync(temporary,{recursive:true,force:true});
 }
}
function parseArguments(args){
 const options={platform:process.platform+'-'+process.arch};
 for(let i=0;i<args.length;i++){
  const value=args[i];
  if(['--platform','--root','--cache'].includes(value)){if(!args[i+1]||args[i+1].startsWith('--'))throw Error(`Missing value for ${value}.`);options[value.slice(2)]=args[++i];}
  else if(value==='--offline')options.offline=true;
  else if(value==='--install-dependencies')options.installDependencies=true;
  else if(value==='--install-browser')options.installBrowser=true;
  else if(value==='--browser-if-needed')options.browserIfNeeded=true;
  else throw Error(`Unknown setup option: ${value}`);
 }
 return options;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 installPlatform(parseArguments(process.argv.slice(2))).catch(error=>{console.error(error.message);process.exitCode=1;});
}
