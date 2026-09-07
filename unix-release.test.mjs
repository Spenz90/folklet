import test from 'node:test';
import assert from 'node:assert/strict';
import {archivePath,safeLink,brandPlist,expectedRuntimeFiles,validateRuntimeReceipt,validateMacHelperHeader,sourceWithoutRuntimeDuplicates,unixArchiveReadme} from './scripts/Build-Unix.mjs';
import {platformManifest} from './scripts/Install-Platform.mjs';
import {sourceFiles} from './scripts/release-files.mjs';

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
