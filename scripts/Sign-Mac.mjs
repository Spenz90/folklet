import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {assertNoLinks,safeLink,verifyUnixArchive} from './Build-Unix.mjs';

const machOMagic=new Set(['feedface','cefaedfe','feedfacf','cffaedfe','cafebabe','bebafeca','cafebabf','bfbafeca']);
export function macSigningPlan(app){
 app=path.resolve(app);assertNoLinks(app);if(!fs.statSync(app).isDirectory())throw Error('Choose an extracted Mac application.');
 const frameworkRoot=path.join(app,'Contents','Frameworks'),targets=[];
 const visit=(file,owner)=>{
  const stat=fs.lstatSync(file),relative=path.relative(app,file).replaceAll('\\','/');
  if(stat.isSymbolicLink()){
   safeLink('Folklet.app/'+relative,fs.readlinkSync(file));
   const real=fs.realpathSync(file);if(!real.startsWith(fs.realpathSync(app)+path.sep))throw Error('Framework link escapes the app');
   return; // Framework aliases are retained, but never traversed or signed.
  }
  if(stat.isDirectory()){
   const bundle=/\.(app|framework|xpc|bundle)$/.test(file);
   for(const name of fs.readdirSync(file).sort())visit(path.join(file,name),bundle?file:owner);
   if(bundle)targets.push(file);
  }else if(stat.isFile()){
   if(stat.nlink>1)throw Error('Mac signing cannot modify linked executable files');
   const header=Buffer.alloc(4),fd=fs.openSync(file,'r');let count;try{count=fs.readSync(fd,header,0,4,0);}finally{fs.closeSync(fd);}
   if(count===4&&machOMagic.has(header.toString('hex'))){
    // Signing a bundle's main binary seals its containing bundle too. Leave it
    // to the final bundle step, after Helpers/Libraries regardless of alphabetic
    // order (Electron Framework sorts before its unsigned crashpad helper).
    const relativeToOwner=owner?path.relative(owner,file).replaceAll('\\','/'):'',entryName=owner?path.basename(owner).replace(/\.(app|framework|xpc|bundle)$/,''):'';
    const main=owner&&(owner.endsWith('.framework')?(relativeToOwner===entryName||new RegExp('^Versions/[^/]+/'+entryName.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$').test(relativeToOwner)):relativeToOwner==='Contents/MacOS/'+entryName);
    if(!main)targets.push(file);
   }
  }else throw Error('Unexpected framework entry');
 };
 visit(frameworkRoot);
 // Post-order traversal signs nested code before its containing bundle. Only
 // Electron's Frameworks tree is considered: Resources/app/crew/runtime is
 // intentionally excluded so pinned Node/Codex executables are never changed.
 return [...targets,app];
}

export function signMacBundle(app,{runProcess=spawnSync}={}){
 const plan=macSigningPlan(app),modified=[];
 const invoke=(args,quiet=false)=>{
  const result=runProcess('/usr/bin/codesign',args,{stdio:quiet?'pipe':'inherit',encoding:'utf8',timeout:120000,maxBuffer:2000000});
  if(result.error)throw Error('Mac signing step could not run: codesign');return result;
 };
 const requireSuccess=args=>{if(invoke(args).status!==0)throw Error('Mac signing step failed: codesign');};
 for(const target of plan){
  const outer=target===plan.at(-1),containsRepair=modified.some(file=>file.startsWith(target+path.sep));
  // A newly signed main executable can make a bundle verify successfully before
  // its resource envelope is sealed. Always reseal a repaired code container.
  const verification=invoke(['--verify','--strict',target],true);
  if(!outer&&!containsRepair&&verification.status===0)continue;
  const signature=invoke(['--display','--verbose=4',target],true),signed=signature.status===0,adHoc=/^Signature=adhoc\s*$/m.test(String(signature.stderr||''));
  if(!signed&&!/code object is not signed at all/.test(String(signature.stderr||'')))throw Error('Mac component signature could not be inspected: '+path.basename(target));
  // Valid upstream signatures remain intact. A signed container is resealed
  // only if this pass repaired nested code, it is the changed outer app, or it
  // has only an ad-hoc development seal. Ad-hoc seals identify bytes, not a
  // publisher, and must be regenerated when preparing the Electron bundle.
  // Invalid publisher signatures still fail closed. Runtime tools are excluded.
  if(signed&&!outer&&!containsRepair&&!adHoc)throw Error('Unexpected invalid Mac component signature: '+path.basename(target)+'; '+String(verification.stderr||'No verification detail.').slice(0,2000));
  requireSuccess(['--force','--sign','-',...(signed?['--preserve-metadata=entitlements,flags,runtime']:[]),target]);
  requireSuccess(['--verify','--strict',target]);modified.push(target);
 }
 // --deep is for verification only, never recursive signing of pinned tools.
 // Apple TN2206 requires inside-out signing of each nested code object.
 requireSuccess(['--verify','--deep','--strict','--verbose=2',plan.at(-1)]);
 return {signed:modified.length};
}

// This creates a local ad-hoc signature, not a Developer ID identity or notarization.
export async function signMacArchive({archive,platform}={}){
 if(process.platform!=='darwin')throw Error('Apple codesign must run on a Mac.');
 if(!['darwin-arm64','darwin-x64'].includes(platform))throw Error('Choose a Mac platform.');
 archive=path.resolve(archive||'');assertNoLinks(archive);
 if(!archive.endsWith('.zip')||!fs.statSync(archive,{throwIfNoEntry:false})?.isFile())throw Error('Choose an existing Folklet Mac ZIP archive.');
 await verifyUnixArchive(archive,platform);
 const parent=path.dirname(archive),stage=path.join(parent,'.crew-sign-'+randomUUID()),signed=stage+'.zip';
 assertNoLinks(stage);assertNoLinks(signed);assertNoLinks(archive+'.sha256');
 fs.mkdirSync(stage);
 const run=(command,args,options={})=>{const result=spawnSync(command,args,{stdio:'inherit',...options});if(result.error||result.status!==0)throw Error('Mac signing step failed: '+path.basename(command));};
 try{
  run('/usr/bin/ditto',['-x','-k',archive,stage]);
  const app=path.join(stage,'Folklet.app');
  // Intel Electron distributions can contain unsigned nested helpers. Repair
  // those first; preserve valid signatures/entitlements and sign the app last.
  signMacBundle(app);
  run('/usr/bin/zip',['-q','-r','-y',signed,'.'],{cwd:stage});
  await verifyUnixArchive(signed,platform);
  fs.renameSync(signed,archive);
  const hash=createHash('sha256');for await(const chunk of fs.createReadStream(archive))hash.update(chunk);
  fs.writeFileSync(archive+'.sha256',hash.digest('hex')+'  '+path.basename(archive)+'\n');
  console.log('Verified local ad-hoc Mac signature. Developer ID signing and notarization remain separate release steps.');
 }finally{
  if(path.dirname(stage)===parent&&/^\.crew-sign-[a-f0-9-]+$/.test(path.basename(stage)))fs.rmSync(stage,{recursive:true,force:true});
  if(fs.existsSync(signed))fs.unlinkSync(signed);
 }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),options={};
 for(let i=0;i<args.length;i++){const name={'--archive':'archive','--platform':'platform'}[args[i]];if(!name||!args[i+1])throw Error('Use --archive <Folklet-Mac.zip> --platform darwin-arm64|darwin-x64');options[name]=args[++i];}
 await signMacArchive(options);
}
