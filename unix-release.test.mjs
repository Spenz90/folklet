import test from 'node:test';
import assert from 'node:assert/strict';
import {archivePath,safeLink,brandPlist,expectedRuntimeFiles,validateRuntimeReceipt,validateMacHelperHeader,sourceWithoutRuntimeDuplicates,unixArchiveReadme} from './scripts/Build-Unix.mjs';
import {platformManifest} from './scripts/Install-Platform.mjs';
import {sourceFiles} from './scripts/release-files.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {macSigningPlan,signMacBundle} from './scripts/Sign-Mac.mjs';

function signingFixture(t){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'crew-mac-sign-test-'))),app=path.join(root,'Folklet.app');
 const files=['Contents/Frameworks/Electron Helper (Renderer).app/Contents/MacOS/Electron Helper (Renderer)','Contents/Frameworks/Electron Framework.framework/Versions/A/Libraries/libfixture.dylib','Contents/Frameworks/Electron Framework.framework/Versions/A/Helpers/chrome_crashpad_handler','Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework','Contents/Resources/app/crew/runtime/node','Contents/Resources/app/crew/runtime/codex/bin/codex'];
 for(const file of files){const target=path.join(app,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,Buffer.from('cffaedfe01020304','hex'));}
 t.after(()=>{assert.equal(path.dirname(root),fs.realpathSync(os.tmpdir()));assert.match(path.basename(root),/^crew-mac-sign-test-/);fs.rmSync(root,{recursive:true,force:true});});
 return {root,app,files};
}

test('Mac ad-hoc signing repairs unsigned nested code inside out while retaining valid signatures and runtime bytes',t=>{
 const {app}=signingFixture(t),plan=macSigningPlan(app),helper=path.join(app,'Contents/Frameworks/Electron Helper (Renderer).app'),helperBinary=path.join(helper,'Contents/MacOS/Electron Helper (Renderer)'),framework=path.join(app,'Contents/Frameworks/Electron Framework.framework');
 assert.equal(plan.includes(helperBinary),false);assert.equal(plan.includes(path.join(framework,'Versions/A/Electron Framework')),false);assert.ok(plan.indexOf(path.join(framework,'Versions/A/Helpers/chrome_crashpad_handler'))<plan.indexOf(framework));assert.ok(plan.indexOf(path.join(framework,'Versions/A/Libraries/libfixture.dylib'))<plan.indexOf(framework));assert.equal(plan.at(-1),app);assert.ok(plan.every(file=>!file.includes(path.join('Contents','Resources'))));
 const valid=new Set(plan.filter(file=>file.startsWith(framework))),calls=[],runtime=['runtime/node','runtime/codex/bin/codex'].map(file=>path.join(app,'Contents/Resources/app/crew',file)),before=runtime.map(file=>fs.readFileSync(file));
 const result=signMacBundle(app,{runProcess(command,args){assert.equal(command,'/usr/bin/codesign');calls.push(args);const target=args.at(-1);if(args.includes('--sign')){assert.ok(!args.includes('--deep'));valid.add(target);return {status:0};}if(args.includes('--display'))return valid.has(target)||target===app||(target===helper&&valid.has(helperBinary))?{status:0}:{status:1,stderr:'code object is not signed at all'};return {status:valid.has(target)||(target===helper&&valid.has(helperBinary))?0:1};}});
 const signed=calls.filter(args=>args.includes('--sign'));assert.deepEqual(signed.map(args=>args.at(-1)),[helper,app]);assert.ok(!signed[0].some(arg=>arg.startsWith('--preserve-metadata')));assert.ok(signed[1].includes('--preserve-metadata=entitlements,flags,runtime'));assert.equal(result.signed,2);assert.deepEqual(runtime.map(file=>fs.readFileSync(file)),before);assert.ok(calls.at(-1).includes('--deep'));
});

test('Mac signing refuses invalid existing signatures instead of treating every error as unsigned',t=>{
 const {app}=signingFixture(t);let signs=0;
 assert.throws(()=>signMacBundle(app,{runProcess(_command,args){if(args.includes('--sign'))signs++;return {status:args.includes('--display')?0:1};}}),/Unexpected invalid Mac component signature/);assert.equal(signs,0);
});
test('Mac signing can reseal ad-hoc Electron development signatures while preserving entitlements',t=>{
 const {app}=signingFixture(t),valid=new Set(),calls=[];
 const result=signMacBundle(app,{runProcess(_command,args){calls.push(args);const target=args.at(-1);if(args.includes('--sign')){valid.add(target);return {status:0};}if(args.includes('--display'))return {status:0,stderr:'Signature=adhoc\n'};return {status:valid.has(target)?0:1,stderr:'development resource seal needs preparation'};}});
 assert.ok(result.signed>1);assert.ok(calls.filter(args=>args.includes('--sign')).every(args=>args.includes('--preserve-metadata=entitlements,flags,runtime')&&!args.includes('--deep')));assert.ok(calls.at(-1).includes('--deep'));
});

test('Mac signing validates framework links without following them into external files',t=>{
 const {root,app}=signingFixture(t),framework=path.join(app,'Contents/Frameworks/Electron Framework.framework'),outside=path.join(root,'outside');fs.mkdirSync(outside);
 if(process.platform!=='win32'){fs.symlinkSync('A',path.join(framework,'Versions/Current'));assert.doesNotThrow(()=>macSigningPlan(app));}
 fs.symlinkSync(outside,path.join(framework,'unexpected-link'),'junction');assert.throws(()=>macSigningPlan(app),/Unsafe archive link|escapes the app/);
});

function receipt(platform){
 const target=platformManifest.platforms[platform];
 return {schemaVersion:1,platform,sources:Object.fromEntries(['node','codex'].map(name=>[name,{url:target[name].url,sha256:target[name].sha256}])),files:expectedRuntimeFiles(platform)};
}
test('Unix archives reject traversal and escaping framework symlinks',()=>{
 for(const name of ['/outside','../outside','Folklet/../outside','C:/outside','Folklet\\outside','Folklet/./outside','Folklet/\0'])assert.throws(()=>archivePath(name));
 assert.equal(safeLink('Folklet.app/Contents/Frameworks/Test.framework/Versions/Current','A'),'A');
 for(const value of ['../../../../../../outside','/outside','C:/outside','../\\outside'])assert.throws(()=>safeLink('Folklet.app/Contents/Frameworks/Current',value));
});
test('runtime receipts must exactly match publisher pins, file membership and executable modes',()=>{
 for(const platform of ['darwin-arm64','darwin-x64','linux-x64']){
  assert.deepEqual(validateRuntimeReceipt(receipt(platform),platform),expectedRuntimeFiles(platform));
  for(const mutate of [r=>r.files.pop(),r=>r.files.push({...r.files[0]}),r=>r.files[0].sha256='0'.repeat(64),r=>r.files[0].mode=0o777,r=>r.files[0].path='data/private.json',r=>r.sources.codex.url='https://example.com/codex',r=>r.platform='another']){
   const value=receipt(platform);mutate(value);assert.throws(()=>validateRuntimeReceipt(value,platform));
  }
 }
});
test('Unix runtime licenses replace matching source entries without duplicate ZIP paths',()=>{
 const source=['server.mjs','runtime/LICENSE.txt','runtime/codex/LICENSE','runtime/codex/runtime-source.json'];
 const runtime=expectedRuntimeFiles('darwin-arm64'),remaining=sourceWithoutRuntimeDuplicates(source,runtime);
 assert.deepEqual(remaining,['server.mjs','runtime/codex/runtime-source.json']);
 const paths=[...remaining,...runtime.map(f=>f.path)];assert.equal(new Set(paths).size,paths.length);
});
test('Mac helper packaging refuses a mismatched architecture or non-Mach-O executable',()=>{
 for(const [platform,cpu] of [['darwin-arm64',0x0100000c],['darwin-x64',0x01000007]]){
  const header=Buffer.alloc(8);header.writeUInt32LE(0xfeedfacf);header.writeUInt32LE(cpu,4);
  assert.doesNotThrow(()=>validateMacHelperHeader(header,platform));
  assert.throws(()=>validateMacHelperHeader(header,platform==='darwin-arm64'?'darwin-x64':'darwin-arm64'));
  assert.throws(()=>validateMacHelperHeader(header,'linux-x64'));
 }
 assert.throws(()=>validateMacHelperHeader(Buffer.from('MZ'), 'darwin-arm64'));
});
test('Mac outer application metadata carries Folklet identity and full runtime minimum',()=>{
 const result=brandPlist('<plist><dict><key>CFBundleName</key><string>Electron</string></dict></plist>','0.6.0');
 assert.match(result,/<key>CFBundleName<\/key>\s*<string>Folklet<\/string>/);
 assert.match(result,/<key>LSMinimumSystemVersion<\/key>\s*<string>15.0<\/string>/);
 assert.match(result,/<string>org.crew.desktop<\/string>/);
});
test('download start pages use the correct platform launcher and guide paths inside each archive',()=>{
 for(const platform of ['darwin-arm64','darwin-x64','linux-x64']){
  const readme=unixArchiveReadme(platform),prefix=platform.startsWith('darwin-')?'Folklet.app/Contents/Resources/app/crew/':'resources/app/crew/';
  const links=[...readme.matchAll(/\]\(([^)]+)\)/g)].map(match=>match[1]);assert.equal(links.length,5);
  for(const link of links){assert.ok(link.startsWith(prefix));assert.ok(sourceFiles.includes(link.slice(prefix.length)),link);}
  assert.match(readme,/My workspace → Quick start/);assert.match(readme,/preview/);
  if(platform==='linux-x64'){assert.match(readme,/Start Folklet\.sh/);assert.match(readme,/glibc 2\.38/);}
  else{assert.match(readme,/open Folklet\.app/);assert.match(readme,/macOS 15/);}
 }
});
