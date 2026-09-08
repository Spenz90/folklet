import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectHost,workspaceHostStatus} from './host-status.mjs';

const base={platform:'linux',pid:4242,uid:1000,uptime:90,now:1750000000000,timeZone:'UTC',dataRoot:'/srv/folklet',memory:()=>({total:8*1024**3,free:3*1024**3}),statfs:async()=>({bavail:500000,bsize:4096,blocks:1000000})};
function fixture(overrides={}) {const commands=[];return {commands,options:{...base,execute:async(file,args)=>{commands.push({file,args});return {ok:true,text:file.endsWith('systemctl')?'ActiveState=active\nUnitFileState=enabled\nMainPID=4242\nRestart=on-failure\nNRestarts=1\n':'yes\n'};},...overrides}};}
test('always-on status requires this process, enabled service and persistent user manager',async()=>{
 const {options,commands}=fixture(),report=await inspectHost(options);
 assert.equal(report.kind,'service');assert.equal(report.startsAtBoot,true);assert.equal(report.recoversAfterCrash,true);
 assert.equal(commands.length,2);assert.equal(commands[0].file,'/usr/bin/systemctl');assert.deepEqual(commands[1].args,['show-user','1000','--property=Linger','--value']);
 assert.doesNotMatch(JSON.stringify(report),/4242|\/srv|MainPID|1000|on-failure/);
 const other=await inspectHost({...options,pid:5555});assert.equal(other.kind,'computer');assert.equal(other.startsAtBoot,false);
 const cli=await inspectHost({...options,pid:null});assert.equal(cli.kind,'service');
});
test('unknown or disabled lingering cannot look ready',async()=>{
 for(const linger of ['', 'no']){
  const {options}=fixture();const original=options.execute;options.execute=(file,args)=>file.endsWith('loginctl')?Promise.resolve({ok:!!linger,text:linger}):original(file,args);
  const report=await inspectHost(options);assert.equal(report.startsAtBoot,false);assert.notEqual(report.checks.find(c=>c.id==='startup').status,'ready');
 }
});
test('desktop reports never claim a background service or execute host commands',async()=>{
 const {options,commands}=fixture({platform:'darwin',uid:501});const report=await inspectHost(options);
 assert.equal(commands.length,0);assert.equal(report.startsAtBoot,false);assert.equal(report.kind,'computer');
});
test('unavailable probes, root and low storage are visible without exposing raw errors',async()=>{
 const {options}=fixture({uid:0,execute:async()=>({ok:false,text:'secret-path'}),statfs:async()=>{throw Error('/private/secret');},memory:()=>({total:1024**3,free:100*1024**2})});
 const report=await inspectHost(options);assert.equal(report.disk,null);assert.equal(report.startsAtBoot,false);
 assert.equal(report.checks.find(c=>c.id==='user').status,'attention');assert.equal(report.checks.find(c=>c.id==='memory').status,'attention');
 assert.doesNotMatch(JSON.stringify(report),/secret/);
 const low=await inspectHost({...options,statfs:async()=>({bavail:1,bsize:4096,blocks:100})});assert.equal(low.checks.find(c=>c.id==='storage').status,'attention');
});
test('phone report includes counts and restart warnings without keys or device details',async()=>{
 const {options}=fixture(),report=workspaceHostStatus(await inspectHost(options),{bots:[{providerId:'a'},{providerId:'unused',archived:true}],providers:[{id:'a',keyStorage:'session',apiKey:'do-not-share'},{id:'unused',keyStorage:'session'}],tasks:[{status:'running',prompt:'private'},{status:'queued'}],routines:[{enabled:true,nextRun:123},{enabled:false,nextRun:1}],phone:{enabled:true,origin:'https://private.ts.net',devices:[{name:'Private name',hash:'secret'}]}});
 assert.deepEqual(report.work,{running:1,queued:1,routines:1,nextRun:123});assert.equal(report.checks.find(c=>c.id==='connections').status,'attention');
 assert.match(report.checks.find(c=>c.id==='connections').detail,/1 connection uses/);
 assert.doesNotMatch(JSON.stringify(report),/do-not-share|private\.ts|Private name|"prompt"|"hash"/);
});
