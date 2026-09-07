'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {EventEmitter}=require('node:events');
const {smokeOptions,validSmokePage,captureSmoke,prepareSmokeWindow}=require('./smoke.cjs');
test('desktop diagnostics are opt-in and require a report inside the isolated root plus owned host PID',t=>{
 const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'crew-smoke-options-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 assert.equal(smokeOptions([],{}),null);
 const env={CREW_SMOKE_ROOT:root,CREW_SMOKE_HOST_PID:'123'},report=path.join(root,'result.json');
 assert.equal(smokeOptions(['--smoke-test',report],env).hostPid,123);
 for(const [file,settings] of [[path.join(root,'..','outside.json'),env],[report,{...env,CREW_SMOKE_HOST_PID:'invalid'}],[report,{}]])assert.throws(()=>smokeOptions(['--smoke-test',file],settings));
 const linked=path.join(root,'linked'),ordinary=path.join(root,'ordinary');fs.mkdirSync(ordinary);fs.symlinkSync(ordinary,linked,'junction');
 assert.throws(()=>smokeOptions(['--smoke-test',path.join(linked,'result.json')],{...env,CREW_SMOKE_ROOT:linked}),/cannot contain links/);
});
test('desktop smoke requires rendered application content and no renderer Node bridge',()=>{
 const page={title:'FOLKLET',app:true,main:true,rendered:true,tokenPresent:true,nodeAbsent:true};assert.equal(validSmokePage(page),true);
 for(const key of ['rendered','tokenPresent','nodeAbsent'])assert.equal(validSmokePage({...page,[key]:false}),false);
});
test('desktop smoke shows the window and waits for both document load and its first paint',()=>{
 for(const order of [['load','paint'],['paint','load']]){
  const window=new EventEmitter();window.webContents=new EventEmitter();const calls=[];
  prepareSmokeWindow(window,{},{show:()=>calls.push('show'),capture:()=>calls.push('capture')});
  const emit=name=>name==='paint'?window.emit('ready-to-show'):window.webContents.emit('did-finish-load');
  emit(order[0]);assert.equal(calls.includes('capture'),false);emit(order[1]);assert.deepEqual(calls,['show','capture']);emit('load');emit('paint');assert.deepEqual(calls,['show','capture']);
 }
});
test('desktop smoke reports booleans only, saves an isolated screenshot and exits',async t=>{
 const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'crew-smoke-render-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));let code;
 const report=path.join(root,'result.json'),page={title:'FOLKLET',app:true,main:true,rendered:true,tokenPresent:true,nodeAbsent:true};
 await captureSmoke({executeJavaScript:async()=>page,capturePage:async()=>({toPNG:()=>Buffer.from('fixture')}),getLastWebPreferences:()=>({sandbox:true,contextIsolation:true,nodeIntegration:false})},{root,report},{exit:value=>{code=value;},timeout:100});
 assert.equal(code,0);assert.equal(JSON.parse(fs.readFileSync(report)).passed,true);assert.equal(fs.existsSync(path.join(root,'result.png')),true);assert.equal(fs.readFileSync(report,'utf8').includes('CREW_TOKEN'),false);
});
test('desktop smoke retains the exact failed rendering phase without page content or tokens',async t=>{
 const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'crew-smoke-failure-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const page={title:'FOLKLET',app:true,main:true,rendered:true,tokenPresent:true,nodeAbsent:true,privateText:'must not persist'},secret='f'.repeat(64);let code;
 const report=path.join(root,'result.json');await captureSmoke({executeJavaScript:async()=>page,capturePage:async()=>{throw Error('Capture failed '+root+' '+secret);}}, {root,report},{exit:value=>{code=value;},timeout:100});
 const raw=fs.readFileSync(report,'utf8'),result=JSON.parse(raw);assert.equal(code,1);assert.equal(result.phase,'capture-page');assert.match(result.error,/Capture failed/);assert.equal(result.page.rendered,true);assert.equal(result.page.titleExpected,true);for(const hidden of [root,secret,'must not persist'])assert.equal(raw.includes(hidden),false);
});
