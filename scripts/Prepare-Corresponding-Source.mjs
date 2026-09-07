import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {pipeline} from 'node:stream/promises';
import {Readable} from 'node:stream';
import {spawnSync} from 'node:child_process';
import {assertNoLinks} from './Build-Unix.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const correspondingSource=JSON.parse(fs.readFileSync(new URL('./corresponding-source.json',import.meta.url)));
export function validateSourcePin(pin=correspondingSource){
 const platform=JSON.parse(fs.readFileSync(new URL('./platform-dependencies.json',import.meta.url)));
 if(pin.schemaVersion!==1||pin.commit!==platform.codexCommit||pin.codexVersion!==platform.codexVersion||pin.url!==`https://codeload.github.com/openai/codex/tar.gz/${pin.commit}`||!/^[a-f0-9]{64}$/.test(pin.sha256)||!Number.isSafeInteger(pin.bytes)||pin.bytes<1)throw Error('Corresponding source must match the bundled official Codex revision.');
 return pin;
}
const sha=async file=>{const hash=createHash('sha256');for await(const chunk of fs.createReadStream(file))hash.update(chunk);return hash.digest('hex');};
export async function verifyCorrespondingSource(file,pin=correspondingSource){
 validateSourcePin(pin);assertNoLinks(file);
 if(!fs.statSync(file,{throwIfNoEntry:false})?.isFile()||fs.statSync(file).size!==pin.bytes||await sha(file)!==pin.sha256)throw Error('Corresponding-source archive failed its size or SHA-256 check.');
 const result=spawnSync('tar',['-tzf',file],{encoding:'utf8',maxBuffer:8_000_000,windowsHide:true});if(result.error||result.status!==0)throw Error('Cannot inspect the corresponding-source archive; tar is required.');
 const names=new Set(result.stdout.trim().split(/\r?\n/)),prefix='codex-'+pin.commit+'/';
 for(const name of pin.requiredFiles)if(!names.has(prefix+name))throw Error('Corresponding source is missing a required source/build/license file.');
 return {schemaVersion:1,component:pin.component,codexVersion:pin.codexVersion,commit:pin.commit,url:pin.url,archive:pin.output,sha256:pin.sha256,bytes:pin.bytes,sourceContentsVerified:true};
}
export async function prepareCorrespondingSource({cache=path.join(root,'.cache','crew-source'),output=path.join(root,'dist'),offline=false}={}){
 const pin=validateSourcePin();cache=path.resolve(cache);output=path.resolve(output);assertNoLinks(cache);assertNoLinks(output);fs.mkdirSync(cache,{recursive:true});fs.mkdirSync(output,{recursive:true});
 const cached=path.join(cache,'codex-'+pin.commit+'.tar.gz');assertNoLinks(cached);
 if(!fs.existsSync(cached)){
  if(offline)throw Error('Corresponding source is absent from the offline cache.');
  const response=await fetch(pin.url,{redirect:'error'});if(!response.ok)throw Error('Official corresponding-source download failed.');
  const temp=cached+'.'+randomUUID()+'.part';try{await pipeline(Readable.fromWeb(response.body),fs.createWriteStream(temp,{flags:'wx'}));await verifyCorrespondingSource(temp,pin);fs.renameSync(temp,cached);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
 }
 const receipt=await verifyCorrespondingSource(cached,pin),destination=path.join(output,pin.output),receiptFile=path.join(output,'Folklet-Linux-Corresponding-Source.json');
 for(const file of [destination,destination+'.sha256',receiptFile])assertNoLinks(file);
 fs.copyFileSync(cached,destination);fs.writeFileSync(destination+'.sha256',pin.sha256+'  '+pin.output+'\n');fs.writeFileSync(receiptFile,JSON.stringify(receipt,null,2)+'\n');
 console.log('Prepared verified Linux corresponding source. Distribute it and its receipt alongside the Linux desktop download.');return receipt;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const options={},args=process.argv.slice(2);for(let i=0;i<args.length;i++){if(args[i]==='--offline'){options.offline=true;continue;}const key={'--cache':'cache','--output':'output'}[args[i]];if(!key||!args[i+1])throw Error('Use [--cache <folder>] [--output <folder>] [--offline].');options[key]=args[++i];}console.log(JSON.stringify(await prepareCorrespondingSource(options)));
}
