import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const parser='/usr/sbin/apparmor_parser';
const pin=JSON.parse(fs.readFileSync(new URL('./electron-releases.json',import.meta.url))).platforms['linux-x64'];
function assertNoLinks(file){let current=path.resolve(file);while(true){if(fs.lstatSync(current,{throwIfNoEntry:false})?.isSymbolicLink())throw Error('Sandbox setup paths cannot contain links.');const parent=path.dirname(current);if(parent===current)break;current=parent;}}
// Chromium documents an exact-path AppArmor userns exception for Ubuntu 23.10+:
// https://chromium.googlesource.com/chromium/src/+/main/docs/security/apparmor-userns-restrictions.md
export function linuxProfile(executable){
 if(typeof executable!=='string'||!executable.startsWith('/')||executable!==path.posix.normalize(executable)||!/^\/[A-Za-z0-9 /._-]+$/.test(executable)||executable.length>3000)throw Error('Use an absolute ordinary executable path without profile metacharacters.');
 const name='folklet-'+createHash('sha256').update(executable).digest('hex').slice(0,24);
 return {name,executable,content:`abi <abi/4.0>,\ninclude <tunables/global>\n\nprofile ${name} "${executable}" flags=(unconfined) {\n  userns,\n}\n`};
}
export async function verifiedLinuxProfile(executable){
 if(process.platform!=='linux')throw Error('Linux sandbox setup runs only on Linux.');
 executable=path.resolve(executable);assertNoLinks(executable);
 const stat=fs.lstatSync(executable);if(!stat.isFile()||stat.nlink!==1)throw Error('Choose the ordinary extracted Folklet executable.');
 executable=fs.realpathSync(executable);const profile=linuxProfile(executable),hash=createHash('sha256');
 for await(const chunk of fs.createReadStream(executable))hash.update(chunk);
 if(hash.digest('hex')!==pin.executableSha256)throw Error('The desktop executable does not match the pinned official Electron release.');
 return profile;
}
function runParser(profile,action,{sudo=false,runProcess=spawnSync,file}={}){
 // AppArmor reads stdin only when no profile filename is supplied. Unlike
 // many Unix tools, a literal "-" is interpreted as a filename here.
 const args=[action,...file?[file]:[]],command=sudo?'sudo':parser;
 const result=runProcess(command,sudo?['-n',parser,...args]:args,{input:file?undefined:profile.content,encoding:'utf8',timeout:30000,windowsHide:true,maxBuffer:2000000});
 if(result.error||result.status!==0)throw Error('AppArmor profile '+action+' failed. Install AppArmor with ABI 4 support and use administrator setup. '+String(result.stderr||'').slice(0,1200));
}
export function activateTemporaryLinuxProfile(profile,{runProcess=spawnSync}={}){
 const expected=linuxProfile(profile.executable);if(profile.name!==expected.name||profile.content!==expected.content)throw Error('Unexpected AppArmor profile content.');
 const listed=runProcess('sudo',['-n','/bin/cat','/sys/kernel/security/apparmor/profiles'],{encoding:'utf8',timeout:10000,maxBuffer:2000000});
 if(listed.error||listed.status!==0)throw Error('The isolated Linux check needs administrator access to AppArmor.');
 if(String(listed.stdout).split('\n').some(line=>line.startsWith(profile.name+' ')))throw Error('An existing AppArmor profile has this name; it was not replaced.');
 try{runParser(profile,'--replace',{sudo:true,runProcess});}catch(error){try{runParser(profile,'--remove',{sudo:true,runProcess});}catch{}throw error;}let active=true;
 return ()=>{if(active){runParser(profile,'--remove',{sudo:true,runProcess});active=false;}};
}
export function validateExistingLinuxProfile(stat,content,expected){
 if(!stat.isFile()||stat.nlink!==1||stat.uid!==0||(stat.mode&0o022)||content!==expected)throw Error('An existing profile differs or is linked; it was not changed.');
}
export function writeLinuxProfile(profile,{directory='/etc/apparmor.d',runProcess=spawnSync,uid=process.getuid?.()}={}){
 if(uid!==0)throw Error('Use the explicit administrator sandbox setup command. Ordinary source setup does not change system policy.');
 const expected=linuxProfile(profile.executable);if(profile.name!==expected.name||profile.content!==expected.content)throw Error('Unexpected AppArmor profile content.');
 assertNoLinks(directory);const parent=fs.statSync(directory);if(!parent.isDirectory()||parent.uid!==0||(parent.mode&0o022))throw Error('AppArmor profile directory must be root-owned and not writable by other users.');
 const file=path.join(directory,profile.name);assertNoLinks(file);let created=false;
 try{
  const existing=fs.lstatSync(file,{throwIfNoEntry:false});
  if(existing){validateExistingLinuxProfile(existing,profile.content,profile.content);validateExistingLinuxProfile(existing,fs.readFileSync(file,'utf8'),profile.content);}
  else{const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|(fs.constants.O_NOFOLLOW||0),0o644);created=true;try{fs.writeFileSync(fd,profile.content);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
  if(fs.readFileSync(file,'utf8')!==profile.content)throw Error('Installed profile verification failed.');
  runParser(profile,'--replace',{runProcess,file});return file;
 }catch(error){if(created)fs.unlinkSync(file);throw error;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);if(args.length!==2||!['--print','--install'].includes(args[0]))throw Error('Use --print <extracted executable> or --install <extracted executable>.');
 const profile=await verifiedLinuxProfile(args[1]);
 if(args[0]==='--print')process.stdout.write(profile.content);
 else{const installed=writeLinuxProfile(profile);console.log('Installed the exact-path Folklet sandbox profile: '+installed+'\nStart Folklet normally. Repeat this setup if you move the app; no system-wide policy was disabled.');}
}
