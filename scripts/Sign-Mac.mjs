import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {assertNoLinks,verifyUnixArchive} from './Build-Unix.mjs';

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
  // Only the outer application changed. Preserve its JIT entitlements and leave
  // upstream framework/runtime signatures and pinned runtime bytes untouched.
  run('/usr/bin/codesign',['--force','--sign','-','--preserve-metadata=entitlements,flags,runtime',app]);
  run('/usr/bin/codesign',['--verify','--strict','--verbose=2',app]);
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
