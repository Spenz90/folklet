import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {isolatedEnvironment,validateSmokeTarget,signatureEvidence} from './scripts/Smoke-Desktop.mjs';
import {validateSmokeEvidence} from './scripts/Check-Release.mjs';
import {correspondingSource,validateSourcePin} from './scripts/Prepare-Corresponding-Source.mjs';

test('packaged smoke rejects foreign targets and strips inherited credentials/configuration',()=>{
 assert.equal(validateSmokeTarget('linux-x64','linux-x64'),'linux-x64');assert.throws(()=>validateSmokeTarget('darwin-arm64','win32-x64'));
 const root=path.resolve('temporary-smoke'),env=isolatedEnvironment(root,{PATH:'system-tools',SystemRoot:'system',OPENAI_API_KEY:'private',GITHUB_TOKEN:'private',NODE_OPTIONS:'--require injected',CREW_DATA:'used-data',CODEX_HOME:'used-account'});
 assert.equal(env.PATH,'system-tools');assert.equal(env.CODEX_HOME,path.join(root,'codex'));assert.equal(env.CREW_DATA,path.join(root,'data'));assert.equal(env.HOME,root);
 for(const key of ['OPENAI_API_KEY','GITHUB_TOKEN','NODE_OPTIONS'])assert.equal(env[key],undefined);
});
test('release readiness binds native startup evidence to the exact archive/platform/version',()=>{
 const expected={platform:'linux-x64',version:'0.6.1',sha256:'a'.repeat(64)},report={schemaVersion:1,passed:true,...expected,archive:'Crew-Linux-x64.zip',archiveSha256:expected.sha256,hostStarted:true,workspaceRendered:true,isolatedData:true,ownedProcessesClosed:true};
 assert.equal(validateSmokeEvidence(report,expected),true);
 for(const change of [{archiveSha256:'b'.repeat(64)},{platform:'win32-x64'},{version:'0.6.0'},{workspaceRendered:false},{ownedProcessesClosed:false}])assert.throws(()=>validateSmokeEvidence({...report,...change},expected));
});
test('stable readiness refuses unsigned Windows and ad-hoc or unstapled Mac evidence',()=>{
 for(const platform of ['win32-x64','darwin-arm64','darwin-x64']){
  const archive={'win32-x64':'Crew-Windows.zip','darwin-arm64':'Crew-Mac-AppleSilicon.zip','darwin-x64':'Crew-Mac-Intel.zip'}[platform],expected={platform,version:'0.6.1',sha256:'a'.repeat(64)},report={schemaVersion:1,passed:true,platform,version:expected.version,archive,archiveSha256:expected.sha256,hostStarted:true,workspaceRendered:true,isolatedData:true,ownedProcessesClosed:true};
  assert.equal(validateSmokeEvidence(report,expected),true);assert.throws(()=>validateSmokeEvidence(report,{...expected,channel:'stable'}),/signing/);
  const signing=platform==='win32-x64'?{authenticodeValid:true,timestamped:true}:{codesignValid:true,gatekeeperAccepted:true,notarizationStapled:true};assert.equal(validateSmokeEvidence({...report,signing},{...expected,channel:'stable'}),true);
 }
});
test('native signature inspection fails closed and does not sign or alter files',()=>{
 const calls=[],run=(file,args,options)=>{calls.push({file,args,options});return {status:1,stdout:''};};
 assert.deepEqual(signatureEvidence('win32-x64','example.exe',{},run),{authenticodeValid:false,timestamped:false});
 assert.deepEqual(signatureEvidence('darwin-arm64','/temporary/Crew.app/Contents/MacOS/Electron',{},run),{codesignValid:false,gatekeeperAccepted:false,notarizationStapled:false});
 assert.equal(calls.some(call=>call.args.includes('--sign')),false);assert.equal(calls[0].options.env.CREW_SIGNATURE_TARGET,'example.exe');
});
test('corresponding-source pin is tied to the exact official bundled Codex commit',()=>{
 assert.equal(validateSourcePin().commit,correspondingSource.commit);
 for(const change of [{commit:'a'.repeat(40)},{url:'https://example.com/source.tar.gz'},{sha256:'bad'},{codexVersion:'0.0.0'}])assert.throws(()=>validateSourcePin({...correspondingSource,...change}));
});
