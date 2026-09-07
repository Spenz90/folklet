import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {resolveCrewEngine,crewEngineEnvironment} from './runtime.mjs';

test('FOLKLET uses its packaged engine and never discovers a Codex desktop installation',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'crew-runtime-test-'));
 t.after(()=>{assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('crew-runtime-test-'));fs.rmSync(dir,{recursive:true,force:true});});
 const external=path.join(dir,'external-codex.exe');fs.writeFileSync(external,'not executable');
 const env={CREW_CODEX:external,PATH:dir,LOCALAPPDATA:dir};
 const resolve=options=>resolveCrewEngine({platform:'win32',...options});
 assert.throws(()=>resolve({root:dir,env}),/bundled engine is missing/);
 const bundled=path.join(dir,'runtime','codex','codex.exe');fs.mkdirSync(path.dirname(bundled),{recursive:true});fs.writeFileSync(bundled,'not executable');
 assert.equal(resolve({root:dir,env:{...env,CREW_CODEX_OVERRIDE:external}}),bundled);
 fs.unlinkSync(bundled);assert.equal(resolve({root:dir,env:{CREW_CODEX_OVERRIDE:external}}),external);
 assert.throws(()=>resolve({root:dir,env:{CREW_CODEX_OVERRIDE:'relative.exe'}}),/bundled engine is missing/);
});

test('each supported platform selects its own bundled engine filename',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'crew-runtime-platform-test-'));
 t.after(()=>{assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert.match(path.basename(dir),/^crew-runtime-platform-test-/);fs.rmSync(dir,{recursive:true,force:true});});
 const bin=path.join(dir,'runtime','codex');fs.mkdirSync(bin,{recursive:true});
 const unix=path.join(bin,'codex'),officialUnix=path.join(bin,'bin','codex'),windows=path.join(bin,'codex.exe');
 fs.mkdirSync(path.dirname(officialUnix));fs.writeFileSync(officialUnix,'test binary');fs.writeFileSync(unix,'test binary');fs.writeFileSync(windows,'test binary');
 for(const platform of ['win32','darwin','linux'])assert.equal(resolveCrewEngine({root:dir,env:{},platform}),platform==='win32'?windows:officialUnix);
 fs.unlinkSync(officialUnix);
 for(const platform of ['darwin','linux'])assert.equal(resolveCrewEngine({root:dir,env:{},platform}),unix,'Flat developer fixtures remain compatible');
 fs.unlinkSync(unix);
 for(const platform of ['darwin','linux']){
  assert.throws(()=>resolveCrewEngine({root:dir,env:{},platform}),/bundled engine is missing/,'A Windows binary cannot silently satisfy a Unix package');
  assert.equal(resolveCrewEngine({root:dir,env:{CREW_CODEX_OVERRIDE:windows},platform}),windows,'An explicit developer override is preserved');
 }
 fs.mkdirSync(unix);
 assert.throws(()=>resolveCrewEngine({root:dir,env:{},platform:'linux'}),/bundled engine is missing/,'A directory is not an executable');
 assert.throws(()=>resolveCrewEngine({root:dir,env:{},platform:'freebsd'}),/Windows, macOS, and Linux/);
});

test('Unix engine PATH retains official package tools without dropping the caller environment',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'crew-runtime-path-test-'));
 t.after(()=>{assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert.match(path.basename(dir),/^crew-runtime-path-test-/);fs.rmSync(dir,{recursive:true,force:true});});
 const bin=path.join(dir,'bin'),tools=path.join(dir,'codex-path');fs.mkdirSync(bin);fs.mkdirSync(tools);
 const env=crewEngineEnvironment(path.join(bin,'codex'),{platform:'linux',env:{PATH:'/usr/bin:/bin',PRESERVE:'yes'}});
 assert.equal(env.PATH,[bin,tools,'/usr/bin:/bin'].join(':'));assert.equal(env.PRESERVE,'yes');
 const windows=crewEngineEnvironment(path.join(dir,'codex.exe'),{platform:'win32',env:{PATH:'C:\\Windows\\System32'}});
 assert.equal(windows.PATH,dir+';C:\\Windows\\System32');
});
