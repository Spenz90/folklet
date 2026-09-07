import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const appRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const unit=fs.readFileSync(new URL('./crew.service',import.meta.url),'utf8');
const launcher=fs.readFileSync(new URL('./start-host.sh',import.meta.url),'utf8');

function posixAbsolute(value){
 if(typeof value!=='string'||!value.startsWith('/')||/[\u0000-\u001f\u007f]/.test(value)||value.split('/').includes('..'))throw Error('Use an absolute Unix path without control characters or parent traversal.');
 return path.posix.normalize(value);
}
// systemd EnvironmentFile double quotes support these escapes. No shell ever
// sources this file, so shell expansion is not involved.
export function envQuote(value){return '"'+posixAbsolute(value).replace(/[\\"`$]/g,'\\$&')+'"';}
export function createServicePlan({home,root}){
 home=posixAbsolute(home);root=posixAbsolute(root);
 const data=path.posix.join(home,'.local/share/crew');
 return [
  {file:path.posix.join(home,'.config/crew/crew.env'),mode:0o600,text:'# Crew private host settings. No API keys belong in this file.\nCREW_APP='+envQuote(root)+'\nCREW_DATA='+envQuote(data)+'\nPLAYWRIGHT_BROWSERS_PATH='+envQuote(path.posix.join(data,'browsers'))+'\n'},
  {file:path.posix.join(home,'.local/lib/crew/start-host.sh'),mode:0o700,text:launcher},
  {file:path.posix.join(home,'.config/systemd/user/crew.service'),mode:0o600,text:unit}
 ];
}
function noLinks(file){
 let current=path.parse(file).root;
 for(const segment of path.resolve(file).slice(current.length).split(path.sep).filter(Boolean)){
  current=path.join(current,segment);
  try{if(fs.lstatSync(current).isSymbolicLink())throw Error('A setup path is a symbolic link. Use ordinary directories.');}catch(error){if(error.code!=='ENOENT')throw error;}
 }
}
export function assertInstallTargets(plan){
 for(const item of plan){
  noLinks(item.file);
  if(fs.existsSync(item.file)){
   const stat=fs.statSync(item.file);
   if(!stat.isFile()||stat.nlink!==1||fs.readFileSync(item.file,'utf8')!==item.text)throw Error('Existing Crew service files differ. Keep them, or review and move them before reinstalling.');
  }
 }
}
function systemctl(args){
 const result=spawnSync('systemctl',['--user',...args],{encoding:'utf8',timeout:15000,stdio:['ignore','pipe','pipe']});
 if(result.error||result.status!==0)throw Error('The systemd user manager is unavailable. Use an ordinary SSH login for this user; do not run the installer with sudo.');
 return result.stdout.trim();
}
export function installService({dryRun=false}={}){
 if(process.platform!=='linux'||process.arch!=='x64')throw Error('This service installer targets Ubuntu 24.04 on x64.');
 if(typeof process.getuid==='function'&&process.getuid()===0)throw Error('Sign in as a regular user. Crew must not run as root.');
 const osRelease=fs.readFileSync('/etc/os-release','utf8');
 if(!/^ID=ubuntu$/m.test(osRelease)||!/^VERSION_ID="?24\.04"?$/m.test(osRelease))throw Error('This service installer targets Ubuntu 24.04. Review HOSTING.md before adapting it for another distribution.');
 const home=os.homedir();
 for(const file of ['server.mjs','runtime/node','runtime/codex/bin/codex','node_modules/playwright/package.json']){
  const full=path.join(appRoot,file);noLinks(full);if(!fs.statSync(full).isFile())throw Error('Crew setup is incomplete. Run sh Setup.sh --skip-browser first.');
 }
 fs.accessSync(path.join(appRoot,'runtime/node'),fs.constants.X_OK);
 fs.accessSync(path.join(appRoot,'runtime/codex/bin/codex'),fs.constants.X_OK);
 const plan=createServicePlan({home,root:appRoot});assertInstallTargets(plan);
 noLinks(path.join(home,'.local/share/crew'));
 if(dryRun)return {files:plan.map(item=>item.file),started:false,dryRun:true};
 const fragment=systemctl(['show','crew.service','--property=FragmentPath','--value']);
 if(fragment&&fragment!==plan[2].file)throw Error('Another crew.service already exists. It has not been changed.');
 for(const item of plan){
  fs.mkdirSync(path.dirname(item.file),{recursive:true,mode:0o700});
  if(!fs.existsSync(item.file))fs.writeFileSync(item.file,item.text,{flag:'wx',mode:item.mode});
 }
 fs.mkdirSync(path.join(home,'.local/share/crew'),{recursive:true,mode:0o700});
 systemctl(['daemon-reload']);
 return {files:plan.map(item=>item.file),started:false,dryRun:false};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const args=process.argv.slice(2);
  if(args.length>1||args.some(arg=>arg!=='--dry-run'))throw Error('Usage: sh hosting/install-user-service.sh [--dry-run]');
  const result=installService({dryRun:args.includes('--dry-run')});
  console.log(result.dryRun?'Setup preview passed. No files or services changed.':'Service files installed. Crew has not been started.');
  console.log('When ready: systemctl --user enable --now crew.service');
 }catch(error){console.error(error.message);process.exitCode=1;}
}
