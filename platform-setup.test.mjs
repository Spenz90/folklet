import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {downloadAsset,installPlatform,officialAssetUrl,platformManifest,safeRelative} from './scripts/Install-Platform.mjs';

test('runtime setup refuses traversal and unofficial download origins',()=>{
 for(const name of ['../outside','bin/../outside','/absolute','C:/absolute','bin\\codex','bin//codex','--file=outside','bad\0name'])assert.throws(()=>safeRelative(name));
 assert.equal(safeRelative('codex-resources/zsh/bin/zsh'),'codex-resources/zsh/bin/zsh');
 for(const url of ['http://nodejs.org/dist/v24.19.0/node-v24.19.0-linux-x64.tar.gz','https://nodejs.org.evil.test/dist/v24.19.0/node-v24.19.0-linux-x64.tar.gz','https://github.com/other/codex/releases/download/rust-v0.153.4/codex-package-x86_64-unknown-linux-musl.tar.gz','https://user@nodejs.org/dist/v24.19.0/node-v24.19.0-linux-x64.tar.gz'])assert.throws(()=>officialAssetUrl(url));
 for(const target of Object.values(platformManifest.platforms)){assert.doesNotThrow(()=>officialAssetUrl(target.node.url));assert.doesNotThrow(()=>officialAssetUrl(target.codex.url));}
});
test('offline runtime cache rejects corruption and missing artifacts',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'crew-platform-check-'));
 try{
  const bytes=Buffer.from('test-only archive');
  const sha256=createHash('sha256').update(bytes).digest('hex');
  const asset={url:platformManifest.platforms['linux-x64'].node.url,sha256};
  const file=path.join(directory,path.posix.basename(new URL(asset.url).pathname));
  await assert.rejects(downloadAsset(asset,directory,{offline:true}),/missing/);
  fs.writeFileSync(file,bytes);assert.equal(await downloadAsset(asset,directory,{offline:true}),file);
  fs.writeFileSync(file,'changed');await assert.rejects(downloadAsset(asset,directory,{offline:true}),/checksum mismatch/);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
test('foreign setup cannot execute downloaded runtimes on the current host',async()=>{
 const foreign=Object.keys(platformManifest.platforms).find(key=>key!==process.platform+'-'+process.arch);
 await assert.rejects(installPlatform({platform:foreign,installDependencies:true}),/cannot be executed/);
});
test('shell bootstrap and manifest agree on every executable pin',()=>{
 const shell=fs.readFileSync(new URL('./Setup.sh',import.meta.url),'utf8');
 for(const target of Object.values(platformManifest.platforms)){
  assert.ok(shell.includes(target.node.sha256),`Archive checksum for ${target.os}-${target.arch}`);
  assert.ok(shell.includes(target.node.executableSha256),`Executable checksum for ${target.os}-${target.arch}`);
  assert.ok(target.codex.files.some(file=>file.file==='codex-resources/zsh/bin/zsh'));
  assert.ok(target.codex.files.some(file=>file.file==='bin/codex'));
 }
 assert.ok(platformManifest.platforms['linux-x64'].codex.files.some(file=>file.file==='codex-resources/bwrap'));
});
