'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {smokeOptions,validSmokePage,captureSmoke}=require('./smoke.cjs');
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
test('desktop smoke reports booleans only, saves an isolated screenshot and exits',async t=>{
 const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'crew-smoke-render-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));let code;
 const report=path.join(root,'result.json'),page={title:'FOLKLET',app:true,main:true,rendered:true,tokenPresent:true,nodeAbsent:true};
 await captureSmoke({executeJavaScript:async()=>page,capturePage:async()=>({toPNG:()=>Buffer.from('fixture')}),getLastWebPreferences:()=>({sandbox:true,contextIsolation:true,nodeIntegration:false})},{root,report},{exit:value=>{code=value;},timeout:100});
 assert.equal(code,0);assert.equal(JSON.parse(fs.readFileSync(report)).passed,true);assert.equal(fs.existsSync(path.join(root,'result.png')),true);assert.equal(fs.readFileSync(report,'utf8').includes('CREW_TOKEN'),false);
});
