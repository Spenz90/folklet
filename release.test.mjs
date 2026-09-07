import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import yauzl from 'yauzl';
import {sourceFiles, collectReleaseFiles, validateRelativeFile, checkSourceText} from './scripts/release-files.mjs';

test('release paths refuse private data and traversal', () => {
  for (const name of ['data/crew.json','desktop/profile/Cookies','browser-profiles/Default','auth.json','secrets/.env','key.pem','../server.mjs','/server.mjs','desktop\\profile\\Cookies','C:/secret']) {
    assert.throws(() => validateRelativeFile(name));
  }
  assert.equal(validateRelativeFile('desktop/Crew.exe.config'), 'desktop/Crew.exe.config');
});

test('packaging uses an allowlist even in an installation containing private files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-release-'));
  try {
    for (const name of sourceFiles) { fs.mkdirSync(path.dirname(path.join(root, name)), {recursive:true}); fs.writeFileSync(path.join(root, name), 'public'); }
    fs.mkdirSync(path.join(root, 'data'), {recursive:true});
    fs.writeFileSync(path.join(root, 'data/crew.json'), 'private');
    fs.writeFileSync(path.join(root, '.env'), 'private');
    fs.writeFileSync(path.join(root, 'unknown-file.txt'), 'private');
    assert.deepEqual(collectReleaseFiles(root), [...sourceFiles].sort());
    fs.unlinkSync(path.join(root, 'server.mjs'));
    assert.throws(() => collectReleaseFiles(root), /ENOENT/);
  } finally { fs.rmSync(root, {recursive:true, force:true}); }
});

test('public source check rejects real-looking credentials and personal absolute paths without echoing contents', () => {
  for (const text of ['C:' + '\\Users\\' + 'ExamplePerson\\private', '/Users/' + 'ExamplePerson/private', '"/home/' + 'example/private"', 'sk-' + 'a'.repeat(45), 'ghp_' + 'a'.repeat(40)]) {
    assert.throws(() => checkSourceText('fixture.txt', text), error => error.message.includes('fixture.txt') && !error.message.includes(text));
  }
  assert.doesNotThrow(() => checkSourceText('fixture.txt', 'Use $env:USERPROFILE; private@example.com is test data.'));
});

test('packaging refuses linked source directories', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-release-'));
  try {
    for (const name of sourceFiles) { fs.mkdirSync(path.dirname(path.join(root, name)), {recursive:true}); fs.writeFileSync(path.join(root, name), 'public'); }
    const original=path.join(root,'icons'),relocated=path.join(root,'local-icons');
    fs.renameSync(original,relocated);fs.symlinkSync(relocated,original,'junction');
    assert.throws(() => collectReleaseFiles(root), /symlink refused/);
  } finally { const resolved=path.resolve(root);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert.match(path.basename(resolved),/^crew-release-/);fs.rmSync(resolved,{recursive:true,force:true}); }
});

test('Windows packaging rejects linked output ancestors and checksum paths before writing', {skip:process.platform!=='win32'}, () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'crew-release-'));
  const packageScript=fileURLToPath(new URL('./scripts/Package.ps1',import.meta.url));
  try {
    const target=path.join(root,'target'),link=path.join(root,'linked-output');fs.mkdirSync(target);fs.symlinkSync(target,link,'junction');
    const check=output=>{const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',packageScript,'-OutputDirectory',output],{encoding:'utf8',windowsHide:true,timeout:15000});assert.equal(result.error,undefined);assert.notEqual(result.status,0);assert.match(result.stderr,/Release output cannot contain a link/);};
    check(path.join(link,'new-folder'));assert.equal(fs.existsSync(path.join(target,'new-folder')),false);
    const output=path.join(root,'output');fs.mkdirSync(output);fs.symlinkSync(target,path.join(output,'Folklet-Source.zip.sha256'),'junction');
    check(output);assert.equal(fs.existsSync(path.join(output,'Folklet-Source.zip')),false);assert.deepEqual(fs.readdirSync(target),[]);
  } finally { const resolved=path.resolve(root);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert.match(path.basename(resolved),/^crew-release-/);fs.rmSync(resolved,{recursive:true,force:true}); }
});

test('Windows PowerShell 5.1 source packaging writes one entry per approved file', {skip:process.platform!=='win32'}, async()=>{
  const output=fs.mkdtempSync(path.join(os.tmpdir(),'crew-release-'));
  try{
    const script=fileURLToPath(new URL('./scripts/Package.ps1',import.meta.url));
    const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,'-Kind','Source','-OutputDirectory',output],{encoding:'utf8',windowsHide:true,timeout:30000});
    assert.equal(result.error,undefined);assert.equal(result.status,0,result.stderr);
    const archive=path.join(output,'Folklet-Source.zip');
    const names=await new Promise((resolve,reject)=>yauzl.open(archive,{lazyEntries:true},(error,zip)=>{
      if(error){reject(error);return;}const files=[];
      zip.on('entry',entry=>{files.push(entry.fileName);zip.readEntry();});zip.once('end',()=>resolve(files));zip.once('error',reject);zip.readEntry();
    }));
    assert.deepEqual(names.sort(),sourceFiles.map(file=>'Folklet/'+file).sort());
    assert.equal(new Set(names).size,names.length);assert.ok(fs.statSync(archive+'.sha256').size>64);
  }finally{const resolved=path.resolve(output);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert.match(path.basename(resolved),/^crew-release-/);fs.rmSync(resolved,{recursive:true,force:true});}
});
