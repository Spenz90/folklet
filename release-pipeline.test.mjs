import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {isolatedEnvironment,validateSmokeTarget,signatureEvidence,safeSmokeDiagnostic,readSmokeFailure} from './scripts/Smoke-Desktop.mjs';
import {validateSmokeEvidence,checkPinnedRuntimeNotices} from './scripts/Check-Release.mjs';
import {correspondingSource,validateSourcePin} from './scripts/Prepare-Corresponding-Source.mjs';

test('packaged smoke rejects foreign targets and strips inherited credentials/configuration',()=>{
 assert.equal(validateSmokeTarget('linux-x64','linux-x64'),'linux-x64');assert.throws(()=>validateSmokeTarget('darwin-arm64','win32-x64'));
 const root=path.resolve('temporary-smoke'),env=isolatedEnvironment(root,{PATH:'system-tools',SystemRoot:'system',OPENAI_API_KEY:'private',GITHUB_TOKEN:'private',NODE_OPTIONS:'--require injected',CREW_DATA:'used-data',CODEX_HOME:'used-account'});
 assert.equal(env.PATH,'system-tools');assert.equal(env.CODEX_HOME,path.join(root,'codex'));assert.equal(env.CREW_DATA,path.join(root,'data'));assert.equal(env.HOME,root);
 for(const key of ['OPENAI_API_KEY','GITHUB_TOKEN','NODE_OPTIONS'])assert.equal(env[key],undefined);
});
test('failed desktop diagnostics retain bounded startup errors without tokens or the private root',()=>{
 const root=path.resolve('isolated-smoke'),secret='sk-'+'a'.repeat(48),token='f'.repeat(64),message='Sandbox helper failed: '+root+' '+secret+' '+token;
 const result=safeSmokeDiagnostic(message,root);assert.match(result,/Sandbox helper failed/);assert.equal(result.includes(root),false);assert.equal(result.includes(secret),false);assert.equal(result.includes(token),false);assert.ok(safeSmokeDiagnostic('x'.repeat(20000)).length<=4000);
});
test('failed child smoke reports survive a nonzero exit with only bounded approved diagnostic fields',t=>{
 const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'crew-child-report-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const report=path.join(root,'desktop.json'),secret='a'.repeat(64);
 fs.writeFileSync(report,JSON.stringify({passed:false,phase:'capture-page',error:'Capture failure '+root+' '+secret,page:{titleExpected:true,rendered:true,tokenPresent:true,privateText:'private'},extra:'private'}));
 const value=readSmokeFailure(report,root);assert.equal(value.phase,'capture-page');assert.equal(value.page.rendered,true);for(const hidden of [root,secret,'private'])assert.equal(JSON.stringify(value).includes(hidden),false);
 fs.writeFileSync(report,'x'.repeat(65537));assert.equal(readSmokeFailure(report,root),null);assert.equal(readSmokeFailure(path.join(root,'missing.json'),root),null);
});
test('release readiness binds native startup evidence to the exact archive/platform/version',()=>{
 const expected={platform:'linux-x64',version:'0.6.1',sha256:'a'.repeat(64)},report={schemaVersion:1,passed:true,...expected,archive:'Folklet-Linux-x64.zip',archiveSha256:expected.sha256,hostStarted:true,workspaceRendered:true,isolatedData:true,ownedProcessesClosed:true};
 assert.equal(validateSmokeEvidence(report,expected),true);
 for(const change of [{archiveSha256:'b'.repeat(64)},{platform:'win32-x64'},{version:'0.6.0'},{workspaceRendered:false},{ownedProcessesClosed:false}])assert.throws(()=>validateSmokeEvidence({...report,...change},expected));
});
test('stable readiness refuses unsigned Windows and ad-hoc or unstapled Mac evidence',()=>{
 for(const platform of ['win32-x64','darwin-arm64','darwin-x64']){
  const archive={'win32-x64':'Folklet-Windows.zip','darwin-arm64':'Folklet-Mac-AppleSilicon.zip','darwin-x64':'Folklet-Mac-Intel.zip'}[platform],expected={platform,version:'0.6.1',sha256:'a'.repeat(64)},report={schemaVersion:1,passed:true,platform,version:expected.version,archive,archiveSha256:expected.sha256,hostStarted:true,workspaceRendered:true,isolatedData:true,ownedProcessesClosed:true};
  assert.equal(validateSmokeEvidence(report,expected),true);assert.throws(()=>validateSmokeEvidence(report,{...expected,channel:'stable'}),/signing/);
  const signing=platform==='win32-x64'?{authenticodeValid:true,timestamped:true}:{codesignValid:true,gatekeeperAccepted:true,notarizationStapled:true};assert.equal(validateSmokeEvidence({...report,signing},{...expected,channel:'stable'}),true);
 }
});
test('native signature inspection fails closed and does not sign or alter files',()=>{
 const calls=[],run=(file,args,options)=>{calls.push({file,args,options});return {status:1,stdout:''};};
 assert.deepEqual(signatureEvidence('win32-x64','example.exe',{},run),{authenticodeValid:false,timestamped:false});
 assert.deepEqual(signatureEvidence('darwin-arm64','/temporary/Folklet.app/Contents/MacOS/Electron',{},run),{codesignValid:false,gatekeeperAccepted:false,notarizationStapled:false});
 assert.equal(calls.some(call=>call.args.includes('--sign')),false);assert.equal(calls[0].options.env.CREW_SIGNATURE_TARGET,'example.exe');
});
test('corresponding-source pin is tied to the exact official bundled Codex commit',()=>{
 assert.equal(validateSourcePin().commit,correspondingSource.commit);
 for(const change of [{commit:'a'.repeat(40)},{url:'https://example.com/source.tar.gz'},{sha256:'bad'},{codexVersion:'0.0.0'}])assert.throws(()=>validateSourcePin({...correspondingSource,...change}));
});
test('Git checkout preserves exact upstream notice bytes and rejects newline conversion',()=>{
 const source=path.dirname(fileURLToPath(import.meta.url));
 assert.equal(checkPinnedRuntimeNotices(source),8);
 const fixture=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'crew-notice-test-'));
 try{
  fs.mkdirSync(path.join(fixture,'scripts'));fs.mkdirSync(path.join(fixture,'runtime/codex'),{recursive:true});
  for(const file of ['scripts/platform-dependencies.json','runtime/codex/runtime-source.json'])fs.copyFileSync(path.join(source,file),path.join(fixture,file));
  const manifest=JSON.parse(fs.readFileSync(path.join(source,'scripts/platform-dependencies.json')));
  for(const item of manifest.notices)fs.copyFileSync(path.join(source,'runtime/codex',item.file),path.join(fixture,'runtime/codex',item.file));
  const notice=path.join(fixture,'runtime/codex/RIPGREP-COPYING');fs.writeFileSync(notice,fs.readFileSync(notice,'utf8').replace(/\r\n/g,'\n'));
  assert.throws(()=>checkPinnedRuntimeNotices(fixture),/Pinned runtime notice differs: RIPGREP-COPYING/);
 }finally{fs.rmSync(fixture,{recursive:true,force:true});}
});
