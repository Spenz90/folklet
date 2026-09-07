import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {sourceFiles,checkSourceText,validateRelativeFile} from './scripts/release-files.mjs';
import {readPrivateJson,writePrivateJson} from './integrations.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),clone=value=>structuredClone(value);
const editable=file=>/\.(mjs|js|css|html|md)$/.test(file),testFile=file=>/\.test\.(mjs|cjs)$/.test(file),limit=256000;
function unlinkedTree(root){
 let entries=0;const visit=target=>{if(++entries>20000)throw Error('The app draft has too many files. Create a fresh draft.');const stat=fs.lstatSync(target);if(stat.isSymbolicLink()||stat.isFile()&&stat.nlink>1)throw Error('App draft source, temporary files, and backups cannot contain symbolic links, junctions, or hard links.');if(stat.isDirectory()){for(const name of fs.readdirSync(target))visit(path.join(target,name));}else if(!stat.isFile())throw Error('App drafts may contain only regular files and directories.');};visit(root);
}
function regular(root,relative){validateRelativeFile(relative);if(fs.lstatSync(root).isSymbolicLink())throw Error('App drafts cannot follow symbolic links.');let target=root;for(const part of relative.split('/')){target=path.join(target,part);const stat=fs.lstatSync(target);if(stat.isSymbolicLink())throw Error('App drafts cannot follow symbolic links.');}if(!fs.statSync(target).isFile())throw Error('Choose a regular source file.');return target;}
function atomic(file,bytes){const temporary=file+'.'+randomUUID()+'.tmp';try{fs.writeFileSync(temporary,bytes,{flag:'wx',mode:0o600});fs.renameSync(temporary,file);}finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}}
function safeEnvironment(directory){
 const env={};for(const key of ['SystemRoot','SYSTEMROOT','WINDIR','COMSPEC','LANG','LC_ALL'])if(process.env[key])env[key]=process.env[key];
 for(const key of ['HOME','USERPROFILE','TMPDIR','TEMP','TMP','CODEX_HOME','CREW_DATA'])env[key]=directory;
 env.CREW_CODEX_OVERRIDE=process.execPath;return env;
}
export class AppChanges{
 constructor({appRoot,dataRoot,store,learning,nodeExecutable=process.execPath,allowlist=sourceFiles,spawnProcess=spawn,isIdle}={}){
  this.appRoot=fs.realpathSync(appRoot);this.root=path.resolve(dataRoot,'app-change-drafts');this.store=store;this.learning=learning;this.node=nodeExecutable;this.allowlist=[...new Set(allowlist)].sort();this.spawnProcess=spawnProcess;this.isIdle=isIdle||(()=>!store.db.tasks.some(task=>['queued','running','waiting'].includes(task.status)));this.busy=new Set();this.processes=new Set();this.closed=false;
  if(fs.lstatSync(this.root,{throwIfNoEntry:false})?.isSymbolicLink())throw Error('App draft storage cannot be a symbolic link.');fs.mkdirSync(this.root,{recursive:true});
 }
 directory(id){if(typeof id!=='string'||! /^[a-f0-9-]{36}$/.test(id))throw Error('Choose a valid app draft.');const directory=path.join(this.root,id);if(fs.lstatSync(directory,{throwIfNoEntry:false})?.isSymbolicLink())throw Error('App draft storage cannot be a symbolic link.');return directory;}
 metadata(id){const directory=this.directory(id),meta=readPrivateJson(path.join(directory,'draft.json'),null);if(!meta||meta.id!==id||!Array.isArray(meta.files)||!meta.baseHashes||meta.files.some(file=>!this.allowlist.includes(file)))throw Error('App draft metadata is invalid.');return meta;}
 save(meta){writePrivateJson(path.join(this.directory(meta.id),'draft.json'),meta);}
 source(meta){const dir=path.join(this.directory(meta.id),'source');if(fs.lstatSync(dir).isSymbolicLink())throw Error('App draft source cannot be a symbolic link.');return dir;}
 assertAvailable(id){if(this.closed)throw Error('App drafts are closed.');if(this.busy.has(id))throw Error('Wait for this draft’s check or test run to finish.');}
 public(meta){let reviewWarning='';if(meta.status==='applied'){try{if(this.learning.get(meta.proposalId).status!=='reviewed')reviewWarning='The app changes were applied, but their Learning proposal is not marked reviewed. Mark it reviewed in Learning; do not apply these files again.';}catch{reviewWarning='The app changes were applied, but their Learning review record could not be read. Check Learning; do not apply these files again.';}}return {id:meta.id,proposalId:meta.proposalId,botId:meta.botId,title:meta.title,createdAt:meta.createdAt,status:meta.status,checks:clone(meta.checks||null),tests:clone(meta.tests||null),appliedAt:meta.appliedAt||null,reviewWarning,files:meta.files.filter(editable),testFiles:meta.files.filter(testFile)};}
 list(){return fs.readdirSync(this.root,{withFileTypes:true}).filter(entry=>entry.isDirectory()&&/^[a-f0-9-]{36}$/.test(entry.name)).map(entry=>this.public(this.metadata(entry.name))).sort((a,b)=>b.createdAt-a.createdAt);}
 get(id){const meta=this.metadata(id);return {...this.public(meta),...this.diff(id)};}
 create({proposalId,botId}={}){
  this.assertAvailable('');this.store.bot(botId);const proposal=this.learning.get(proposalId);if(proposal.kind!=='app-change'||proposal.botId!==botId||proposal.status==='rejected')throw Error('Choose this bot’s app-change proposal.');
  if(this.list().length>=10)throw Error('The app draft limit is 10. Keep a backup and remove old draft folders locally before creating more.');
  const id=randomUUID(),directory=this.directory(id),source=path.join(directory,'source'),base=path.join(directory,'base');fs.mkdirSync(source,{recursive:true});fs.mkdirSync(base);
  const meta={id,proposalId,botId,title:proposal.title,createdAt:Date.now(),status:'draft',files:this.allowlist,baseHashes:{}};
  try{for(const relative of this.allowlist){const file=regular(this.appRoot,relative),bytes=fs.readFileSync(file);if(bytes.length>10*1024*1024)throw Error('A source file is too large for an app draft.');meta.baseHashes[relative]=hash(bytes);for(const dest of [source,base]){fs.mkdirSync(path.dirname(path.join(dest,relative)),{recursive:true});fs.writeFileSync(path.join(dest,relative),bytes,{flag:'wx',mode:0o600});}}
   this.save(meta);return this.public(meta);
  }catch(error){if(path.dirname(directory)===this.root&&path.basename(directory)===id)fs.rmSync(directory,{recursive:true,force:true});throw error;}
 }
 read({id,path:relative,botId}={}){const meta=this.metadata(id);if(botId!==undefined&&meta.botId!==botId)throw Error('This draft belongs to another bot.');if(!meta.files.includes(relative)||!editable(relative))throw Error('Choose an existing editable source file.');const file=regular(this.source(meta),relative),bytes=fs.readFileSync(file);if(bytes.length>limit)throw Error('This source file exceeds the 256 KB editor limit.');return {path:relative,text:bytes.toString('utf8')};}
 write({id,path:relative,text,botId}={}){
  this.assertAvailable(id);const meta=this.metadata(id);if(botId!==undefined&&meta.botId!==botId)throw Error('This draft belongs to another bot.');if(meta.status!=='draft')throw Error('Create a new draft to change an already applied or restored proposal.');if(!meta.files.includes(relative)||!editable(relative))throw Error('Choose an existing editable source file.');if(typeof text!=='string'||Buffer.byteLength(text)>limit||text.includes('\0'))throw Error('Draft text must be UTF-8 text under 256 KB.');checkSourceText(relative,text);
  const file=regular(this.source(meta),relative),before=fs.readFileSync(file);atomic(file,Buffer.from(text));try{this.diff(id);}catch(error){atomic(file,before);throw error;}delete meta.checks;delete meta.tests;this.save(meta);return this.diff(id);
 }
 diff(id){
  const meta=this.metadata(id),source=this.source(meta),changes=[],hashes=[];let size=0;
  for(const relative of meta.files){const current=fs.readFileSync(regular(source,relative)),digest=hash(current);hashes.push([relative,digest]);if(digest===meta.baseHashes[relative])continue;if(!editable(relative)||current.length>limit)throw Error('Only existing text source files under 256 KB may change.');const before=fs.readFileSync(regular(path.join(this.directory(id),'base'),relative));if(hash(before)!==meta.baseHashes[relative])throw Error('The draft’s original source snapshot changed.');size+=current.length+before.length;if(size>2*1024*1024||changes.length>=20)throw Error('Keep a draft under 20 changed files and 2 MB of review text.');changes.push({path:relative,before:before.toString('utf8'),after:current.toString('utf8')});}
  return {reviewHash:hash(JSON.stringify(hashes)),changes};
 }
 async run(args,directory,timeoutMs){
  if(this.closed)throw Error('App drafts are closed.');unlinkedTree(directory);const temporary=path.join(directory,'.crew-test-data');fs.mkdirSync(temporary,{recursive:true});
  return new Promise(resolve=>{
   let output='',done=false,timedOut=false,proc;const finish=code=>{if(done)return;done=true;clearTimeout(timer);this.processes.delete(proc);output=output.split(directory).join('<draft>').split(this.appRoot).join('<app>');resolve({passed:code===0&&!timedOut,exitCode:code??null,timedOut,output});};
   const timer=setTimeout(()=>{timedOut=true;proc?.kill();finish(null);},timeoutMs);timer.unref?.();
   try{proc=this.spawnProcess(this.node,args,{cwd:directory,env:safeEnvironment(temporary),windowsHide:true,stdio:['ignore','pipe','pipe']});this.processes.add(proc);for(const stream of [proc.stdout,proc.stderr])stream?.on('data',chunk=>{if(output.length<64000)output+=(String(chunk)).slice(0,64000-output.length);});proc.once('error',()=>{output='The bundled Node runtime could not start this check.';finish(null);});proc.once('close',finish);}catch{output='The bundled Node runtime could not start this check.';finish(null);}
  });
 }
 async check(id,{botId}={}){
  this.assertAvailable(id);const meta=this.metadata(id);if(botId!==undefined&&meta.botId!==botId)throw Error('This draft belongs to another bot.');const snapshot=this.diff(id);if(!snapshot.changes.length)throw Error('Make a source change before checking the draft.');this.busy.add(id);
  try{const results=[];for(const change of snapshot.changes){checkSourceText(change.path,change.after);if(/\.(mjs|js)$/.test(change.path)){const result=await this.run(['--check',regular(this.source(meta),change.path)],this.source(meta),15000);results.push({path:change.path,...result});}else results.push({path:change.path,passed:true,output:'Text file checked; no syntax parser is available for this file type.'});}
   const stable=this.diff(id).reviewHash===snapshot.reviewHash;meta.checks={reviewHash:snapshot.reviewHash,passed:stable&&results.every(result=>result.passed),at:Date.now(),results};delete meta.tests;this.save(meta);return clone(meta.checks);
  }finally{this.busy.delete(id);}
 }
 async runTests({id,reviewHash,testFiles,confirmed}={}){
  this.assertAvailable(id);if(confirmed!==true)throw Error('Review the draft and explicitly approve running its proposed test code.');const meta=this.metadata(id),snapshot=this.diff(id);if(snapshot.reviewHash!==reviewHash||!meta.checks?.passed||meta.checks.reviewHash!==reviewHash)throw Error('Run syntax checks and review this exact draft before testing.');
  if(!Array.isArray(testFiles)||!testFiles.length||testFiles.length>20||new Set(testFiles).size!==testFiles.length||testFiles.some(file=>!meta.files.includes(file)||!testFile(file)))throw Error('Choose 1–20 existing test files to run.');const source=this.source(meta);testFiles.forEach(file=>regular(source,file));this.busy.add(id);
  try{const result=await this.run(['--permission','--allow-fs-read='+source,'--allow-fs-write='+source,'--test-isolation=none','--test',...testFiles],source,120000),stable=this.diff(id).reviewHash===reviewHash;meta.tests={...result,passed:result.passed&&stable,reviewHash,testFiles,at:Date.now(),...(stable?{}:{output:result.output+'\nThe draft changed during its test run. Review it and check again.'})};this.save(meta);return clone(meta.tests);}finally{this.busy.delete(id);}
 }
 assertIdle(){if(!this.isIdle())throw Error('Finish or stop all active and queued tasks before applying or undoing app changes.');}
 apply({id,reviewHash,confirmed}={}){
  this.assertAvailable(id);if(confirmed!==true)throw Error('Explicitly approve applying this reviewed draft.');this.assertIdle();const meta=this.metadata(id),snapshot=this.diff(id);
  if(meta.status!=='draft'||!snapshot.changes.length||snapshot.reviewHash!==reviewHash||!meta.checks?.passed||meta.checks.reviewHash!==reviewHash||!meta.tests?.passed||meta.tests.reviewHash!==reviewHash)throw Error('This exact draft needs passing syntax checks and selected tests before applying.');
  const proposal=this.learning.get(meta.proposalId);if(proposal.kind!=='app-change'||proposal.botId!==meta.botId||proposal.status==='rejected')throw Error('The linked app-change proposal is unavailable or rejected. Create a new proposal before applying.');
  for(const file of meta.files)if(hash(fs.readFileSync(regular(this.appRoot,file)))!==meta.baseHashes[file])throw Error('Crew’s source changed since this draft was created. Create a fresh draft.');
  const backup=path.join(this.directory(id),'backup');fs.mkdirSync(backup,{recursive:true});unlinkedTree(backup);
  meta.appliedHashes={};for(const change of snapshot.changes){const destination=path.join(backup,change.path);fs.mkdirSync(path.dirname(destination),{recursive:true});if(fs.existsSync(destination))throw Error('This draft already has an application backup.');fs.copyFileSync(regular(this.appRoot,change.path),destination,fs.constants.COPYFILE_EXCL);meta.appliedHashes[change.path]=hash(Buffer.from(change.after));}
  meta.status='applying';meta.reviewHash=reviewHash;this.save(meta);const written=[];
  try{for(const change of snapshot.changes){const target=regular(this.appRoot,change.path);atomic(target,Buffer.from(change.after));written.push(change.path);}meta.status='applied';meta.appliedAt=Date.now();this.save(meta);}
  catch(error){let restored=true;for(const relative of written.reverse())try{atomic(regular(this.appRoot,relative),fs.readFileSync(regular(backup,relative)));}catch{restored=false;}meta.status=restored?'rolled-back':'applying';this.save(meta);throw Error(restored?'Applying failed; the original files were restored.':'Applying was interrupted. Review the draft and restore its backup before restarting Crew.');}
  // File application is already committed. A separate Learning write failure
  // must never roll it back or make an already-applied revision eligible again.
  try{this.learning.accept(meta.proposalId);}catch{/* public() reports the persisted review state accurately. */}
  return {...this.public(meta),restartRequired:true};
 }
 undo({id,confirmed}={}){
  this.assertAvailable(id);if(confirmed!==true)throw Error('Explicitly approve restoring this app backup.');this.assertIdle();const meta=this.metadata(id);if(!['applied','applying'].includes(meta.status)||!meta.appliedHashes)throw Error('This draft has no applied changes to restore.');
  const backup=path.join(this.directory(id),'backup');for(const [relative,digest]of Object.entries(meta.appliedHashes)){if(!meta.files.includes(relative))throw Error('The backup manifest is invalid.');const current=hash(fs.readFileSync(regular(this.appRoot,relative)));if(current!==digest&&current!==meta.baseHashes[relative])throw Error('An applied file changed again. Review it before restoring this backup.');if(hash(fs.readFileSync(regular(backup,relative)))!==meta.baseHashes[relative])throw Error('The original app backup changed.');}
  for(const relative of Object.keys(meta.appliedHashes))atomic(regular(this.appRoot,relative),fs.readFileSync(regular(backup,relative)));meta.status='restored';this.save(meta);return {...this.public(meta),restartRequired:true};
 }
 close(){this.closed=true;for(const proc of this.processes)proc.kill();}
}
