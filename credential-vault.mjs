import fs from 'node:fs';
import path from 'node:path';
import {randomBytes,randomUUID,createCipheriv,createDecipheriv,scryptSync,createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
export const isSealed=value=>!!value&&typeof value==='object'&&value.format==='folklet-secret-v1';
export function privateJSON(file,fallback){const st=fs.lstatSync(file,{throwIfNoEntry:false});if(!st)return structuredClone(fallback);if(st.isSymbolicLink()||!st.isFile()||st.nlink!==1||st.size>8*1024*1024)throw Error('Private storage must be a regular file under 8 MB.');return JSON.parse(fs.readFileSync(file,'utf8'));}
export function atomicPrivateJSON(file,value){const st=fs.lstatSync(file,{throwIfNoEntry:false});if(st&&(st.isSymbolicLink()||!st.isFile()||st.nlink!==1))throw Error('Private storage cannot be a linked file.');fs.mkdirSync(path.dirname(file),{recursive:true});const temp=file+'.'+randomUUID()+'.tmp';try{fs.writeFileSync(temp,JSON.stringify(value)+'\n',{flag:'wx',mode:0o600});fs.renameSync(temp,file);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}}
export function sealBytes(bytes,key,aad){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(aad));const data=Buffer.concat([cipher.update(bytes),cipher.final()]);return {iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')};}
export function openBytes(value,key,aad){try{if(!value||typeof value.data!=='string'||value.data.length>256*1024*1024)throw Error();const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(value.iv,'base64'));decipher.setAAD(Buffer.from(aad));decipher.setAuthTag(Buffer.from(value.tag,'base64'));return Buffer.concat([decipher.update(Buffer.from(value.data,'base64')),decipher.final()]);}catch{throw Error('The password is incorrect or encrypted data is damaged.');}}
function passwordKey(password,salt){if(typeof password!=='string'||password.length<12||password.length>1024)throw Error('Use a vault password between 12 and 1024 characters.');const decoded=Buffer.from(salt,'base64');if(decoded.length!==16)throw Error('Invalid encrypted vault.');return scryptSync(password,decoded,32,{N:32768,r:8,p:1,maxmem:64*1024*1024});}
export function passwordWrap(bytes,password,aad){const salt=randomBytes(16).toString('base64');return {salt,...sealBytes(bytes,passwordKey(password,salt),aad)};}
export function passwordOpen(value,password,aad){return openBytes(value,passwordKey(password,value.salt),aad);}

// Secrets go through stdin, never process arguments. Native stores are optional;
// unavailable or locked stores fail explicitly instead of writing a plaintext key.
export function osKeyStore(action,id,value,{platform=process.platform,run=spawnSync}={}){
 let command,args,input;
 if(platform==='win32'){command='powershell.exe';args=['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(here,'native','Vault-Windows.ps1')];input=JSON.stringify({action,value});}
 else if(platform==='darwin'){command='/usr/bin/security';if(action==='get'){args=['find-generic-password','-s','Folklet','-a',id,'-w'];}else{if(!/^[a-f0-9]{64}$/.test(value))throw Error('Invalid vault key.');args=['-i'];input=`add-generic-password -U -s Folklet -a ${id} -w ${value}\n`;}}
 else if(platform==='linux'){command='secret-tool';args=action==='get'?['lookup','service','folklet','workspace',id]:['store','--label=Folklet credential vault','service','folklet','workspace',id];input=value;}
 else throw Error('Use a password vault on this platform.');
 const result=run(command,args,{input,encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:16384});
 if(result.error||result.status!==0)throw Error('The OS credential store is unavailable or locked. Use a password vault, or unlock your OS keychain.');
 const output=String(result.stdout||'').trim();return platform==='win32'?JSON.parse(output).value:action==='get'?output:'';
}

export class CredentialVault{
 constructor(dataRoot,{native=osKeyStore}={}){this.file=path.join(dataRoot,'credential-vault.json');this.native=native;this.key=null;this.config=privateJSON(this.file,{version:1,mode:'none'});this.id=this.config.id||randomBytes(16).toString('hex');this.lastError='';if(!/^[a-f0-9]{32}$/.test(this.id))throw Error('Invalid vault identity.');if(this.config.version!==1||!['none','password','os'].includes(this.config.mode))throw Error('Invalid credential vault.');if(this.config.mode==='os')try{const value=this.native('get',this.id,this.config.wrapped);this.key=Buffer.from(value,'hex');if(this.key.length!==32)throw Error();}catch{this.key=null;this.lastError='Unlock the OS credential store, then try Unlock again.';}}
 status(){return {configured:this.config.mode!=='none',mode:this.config.mode,unlocked:!!this.key,platform:process.platform,error:this.lastError};}
 configure({mode='password',password}={}){if(this.config.mode!=='none')throw Error('The vault is already configured. Unlock it to use remembered credentials.');if(!['password','os'].includes(mode))throw Error('Choose password or OS credential storage.');const key=randomBytes(32);let wrapped;if(mode==='password')wrapped=passwordWrap(key,password,'folklet-vault-key-v1');else{wrapped=this.native('put',this.id,key.toString('hex'));if(this.native('get',this.id,wrapped)!==key.toString('hex'))throw Error('The OS credential store did not retain the key.');}const config={version:1,id:this.id,mode,wrapped};atomicPrivateJSON(this.file,config);this.config=config;this.key=key;this.lastError='';return this.status();}
 unlock(password){let key;if(this.config.mode==='password')key=passwordOpen(this.config.wrapped,password,'folklet-vault-key-v1');else if(this.config.mode==='os')key=Buffer.from(this.native('get',this.id,this.config.wrapped),'hex');else throw Error('Set up credential protection first.');if(key.length!==32)throw Error('Invalid vault key.');this.key=key;this.lastError='';return this.status();}
 protect(value,aad){if(isSealed(value))return value;if(!this.key)throw Error('Set up or unlock Credential protection before remembering a key. Session-only keys still work.');return {format:'folklet-secret-v1',...sealBytes(Buffer.from(JSON.stringify(value)),this.key,aad)};}
 reveal(value,aad,{required=false}={}){if(!isSealed(value))return value;if(!this.key){if(required)throw Error('Unlock Credential protection on the host to use this connection.');return null;}return JSON.parse(openBytes(value,this.key,aad).toString('utf8'));}
 portable(password){if(this.config.mode==='none')return this.config;if(!this.key)throw Error('Unlock the credential vault before making a portable backup.');return {version:1,id:this.id,mode:'password',wrapped:passwordWrap(this.key,password,'folklet-vault-key-v1')};}
 unlockFromService(directory=process.env.CREDENTIALS_DIRECTORY){if(process.platform!=='linux'||this.config.mode!=='password'||!directory)return;try{const file=path.join(directory,'folklet-vault'),st=fs.lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||st.size>4096)throw Error();this.unlock(fs.readFileSync(file,'utf8').replace(/\r?\n$/,''));}catch{this.lastError='The service vault credential was unavailable or invalid. Unlock on the host.';}}
 close(){this.key?.fill(0);this.key=null;}
}
export const protectSecret=(vault,value,aad)=>vault?vault.protect(value,aad):value;
export const revealSecret=(vault,value,aad,options)=>vault?vault.reveal(value,aad,options):value;
export const secretStorage=(vault,value)=>isSealed(value)?vault?.key?'vault':'locked':value?'disk':'none';
