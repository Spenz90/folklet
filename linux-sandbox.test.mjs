import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {linuxProfile,activateTemporaryLinuxProfile,writeLinuxProfile,validateExistingLinuxProfile} from './scripts/Linux-Sandbox.mjs';

test('Linux profile grants only user namespaces to one exact ordinary executable path',()=>{
 const profile=linuxProfile('/opt/Folklet app/crew');assert.match(profile.content,/"\/opt\/Folklet app\/crew" flags=\(unconfined\)/);assert.equal((profile.content.match(/userns,/g)||[]).length,1);assert.equal(profile.name,linuxProfile(profile.executable).name);assert.notEqual(profile.name,linuxProfile('/opt/another/crew').name);
 for(const bad of ['relative/crew','/opt/../crew','/opt/*/crew','/opt/{one,two}/crew','/opt/crew\nuserns,','/opt/"crew','/opt/[crew]','/opt/crew\\x'])assert.throws(()=>linuxProfile(bad));
 assert.equal(profile.content.includes('sysctl'),false);
});
test('temporary CI profiles refuse existing policies and remove only their own named policy',()=>{
 const profile=linuxProfile('/tmp/isolated-folklet/crew'),calls=[],runProcess=(file,args,options)=>{calls.push({file,args,options});return {status:0,stdout:''};};
 const remove=activateTemporaryLinuxProfile(profile,{runProcess});remove();remove();assert.equal(calls.length,3);assert.deepEqual(calls[1].args,['-n','/usr/sbin/apparmor_parser','--replace']);assert.deepEqual(calls[2].args,['-n','/usr/sbin/apparmor_parser','--remove']);assert.equal(calls[1].options.input,profile.content);assert.equal(calls[2].options.input,profile.content);
 assert.throws(()=>activateTemporaryLinuxProfile(profile,{runProcess:()=>({status:0,stdout:profile.name+' (unconfined)\n'})}),/existing AppArmor profile/);
 assert.throws(()=>activateTemporaryLinuxProfile(profile,{runProcess:()=>({status:1})}),/administrator access/);
});
test('installed Linux parser accepts the temporary profile via stdin without loading kernel policy',{skip:process.platform!=='linux'||!fs.existsSync('/usr/sbin/apparmor_parser')},()=>{
 const profile=linuxProfile('/tmp/isolated-folklet/crew'),calls=[];
 const remove=activateTemporaryLinuxProfile(profile,{runProcess:(file,args,options)=>{
  if(args[1]==='/bin/cat')return {status:0,stdout:''};
  // Exercise the generated parser invocation without sudo or changing policy.
  const result=spawnSync(args[1],['--skip-kernel-load','--skip-cache',...args.slice(2)],options);calls.push(result);return result;
 }});
 remove();assert.equal(calls.length,2);for(const result of calls)assert.equal(result.status,0,String(result.stderr||result.error||''));
});
test('persistent sandbox setup requires explicit root authorization and preserves edited or linked profiles',()=>{
 const profile=linuxProfile('/opt/Folklet/crew');assert.throws(()=>writeLinuxProfile(profile,{uid:1000}),/explicit administrator/);
 const valid={isFile:()=>true,nlink:1,uid:0,mode:0o644};assert.doesNotThrow(()=>validateExistingLinuxProfile(valid,profile.content,profile.content));
 for(const changed of [{nlink:2},{uid:1000},{mode:0o666},{isFile:()=>false}])assert.throws(()=>validateExistingLinuxProfile({...valid,...changed},profile.content,profile.content),/existing profile differs/);
 assert.throws(()=>validateExistingLinuxProfile(valid,'administrator-edited',profile.content),/existing profile differs/);
});
