import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {Store} from './store.mjs';
const make=()=>new Store(fs.mkdtempSync(path.join(os.tmpdir(),'crew-test-')));

test('a failed commit restores existing object references and removes ghost tasks and permission changes',t=>{
 const s=make(),b=s.create({name:'Test'}),task=s.enqueue(b.id,'Existing task'),original=fs.readFileSync(s.file,'utf8'),rename=fs.renameSync;
 t.after(()=>{assert.equal(path.dirname(s.root),path.resolve(os.tmpdir()));assert.match(path.basename(s.root),/^crew-test-/);fs.rmSync(s.root,{recursive:true,force:true});});
 fs.renameSync=(from,to)=>{if(to===s.file)throw Error('Fixture disk full');return rename(from,to);};
 try{b.recallShared=true;task.status='running';assert.throws(()=>s.enqueue(b.id,'Ghost task'),/could not save/);}finally{fs.renameSync=rename;}
 assert.equal(s.bot(b.id),b);assert.equal(s.db.tasks[0],task);assert.equal(b.recallShared,undefined);assert.equal(task.status,'queued');assert.equal(s.db.tasks.length,1);assert.equal(fs.readFileSync(s.file,'utf8'),original);assert.equal(fs.readdirSync(s.root).some(file=>file.endsWith('.tmp')),false);
 s.save();assert.equal(new Store(s.root).db.tasks.length,1,'A later commit cannot accidentally persist the rejected task');
});

test('state writes never follow a predictable temporary-file link and database links fail before loading bots',t=>{
 const s=make(),target=path.join(s.root,'untouched.json');fs.writeFileSync(target,'{"fixture":true}');fs.linkSync(target,s.file+'.tmp');
 t.after(()=>{assert.equal(path.dirname(s.root),path.resolve(os.tmpdir()));assert.match(path.basename(s.root),/^crew-test-/);fs.rmSync(s.root,{recursive:true,force:true});});s.create({name:'Test'});assert.equal(fs.readFileSync(target,'utf8'),'{"fixture":true}');
 const copy=path.join(s.root,'linked-data');fs.mkdirSync(copy);fs.linkSync(s.file,path.join(copy,'crew.json'));assert.throws(()=>new Store(copy),/not a link/);assert.equal(fs.readdirSync(copy).length,1);
});
test('routines deduplicate active runs and combine missed intervals',()=>{const s=make(),b=s.create({name:'Test'}),r=s.routine({botId:b.id,name:'Daily',prompt:'Review',minutes:1440,enabled:true});const now=r.nextRun+5*1440*60000;assert.equal(s.due(now).length,1);assert.equal(r.nextRun,now+1440*60000);assert.equal(s.due(r.nextRun+1).length,0);s.db.tasks[0].status='completed';assert.equal(s.due(r.nextRun+1).length,1);});
test('restart marks unfinished tasks interrupted and retains queued tasks',()=>{const s=make(),b=s.create({name:'Test'});s.enqueue(b.id,'one').status='running';s.enqueue(b.id,'two');s.save();const reloaded=new Store(s.root);assert.equal(reloaded.db.tasks[0].status,'interrupted');assert.equal(reloaded.db.tasks[1].status,'queued');});
test('file access rejects traversal and symlinks outside bot workspace',()=>{const s=make(),b=s.create({name:'Test'});assert.throws(()=>s.safeFile(b,'../crew.json'));assert.throws(()=>s.safeFile(b,path.resolve(s.root,'crew.json')));assert.equal(s.safeFile(b,'outputs/report.txt',false),path.join(b.cwd,'outputs','report.txt'));const other=fs.mkdtempSync(path.join(os.tmpdir(),'crew-outside-'));fs.symlinkSync(other,path.join(b.cwd,'external'),'junction');assert.throws(()=>s.safeFile(b,'external/private.txt',false));});
test('proposed routines stay paused and reject invalid intervals',()=>{const s=make(),b=s.create({name:'Test'});assert.equal(s.routine({botId:b.id,prompt:'Review',minutes:60,enabled:false}).enabled,false);assert.throws(()=>s.routine({botId:b.id,prompt:'Review',minutes:0}));assert.equal(s.due(Date.now()+999999999).length,0);});

test('new file paths reject dangling directory links and keep ordinary nested paths working',t=>{
 const s=make(),b=s.create({name:'Test'}),target=path.join(s.root,'temporary-link-target');
 t.after(()=>{const dir=path.resolve(s.root);assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));assert.match(path.basename(dir),/^crew-test-/);fs.rmSync(dir,{recursive:true,force:true});});
 fs.mkdirSync(target);fs.symlinkSync(target,path.join(b.cwd,'linked-directory'),'junction');fs.rmdirSync(target);
 assert.throws(()=>s.safeFile(b,'linked-directory/report.txt',false),/Broken file links/);
 assert.throws(()=>s.safeFile(b,'linked-directory',false),/Broken file links/);
 assert.equal(s.safeFile(b,'outputs/new/report.txt',false),path.join(b.cwd,'outputs','new','report.txt'));
 assert.equal(fs.existsSync(target),false);
});

test('links whose existing targets stay inside the workspace remain usable',t=>{
 const s=make(),b=s.create({name:'Test'}),target=path.join(b.cwd,'outputs');
 t.after(()=>{const dir=path.resolve(s.root);assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));assert.match(path.basename(dir),/^crew-test-/);fs.rmSync(dir,{recursive:true,force:true});});
 fs.mkdirSync(target);fs.writeFileSync(path.join(target,'report.txt'),'Example report');
 fs.symlinkSync(target,path.join(b.cwd,'linked-output'),'junction');
 const file=s.safeFile(b,'linked-output/report.txt');assert.equal(fs.readFileSync(file,'utf8'),'Example report');
 assert.equal(s.safeFile(b,'linked-output/new.txt',false),path.join(b.cwd,'linked-output','new.txt'));
});

test('a copied data folder uses its copied workspaces and preserves saved conversations',t=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'crew-test-'));
 t.after(()=>{const dir=path.resolve(base);assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));assert.match(path.basename(dir),/^crew-test-/);fs.rmSync(dir,{recursive:true,force:true});});
 const original=new Store(path.join(base,'original')),b=original.create({name:'Test'});
 original.message(b,'user','Example conversation');b.threadId='saved-thread';original.save();
 fs.writeFileSync(path.join(b.cwd,'report.txt'),'Original report');
 const destination=path.join(base,'copied');fs.cpSync(original.root,destination,{recursive:true});
 const copied=new Store(destination),moved=copied.bot(b.id);
 assert.equal(moved.cwd,path.join(destination,'workspaces',b.id));assert.equal(moved.messages[0].text,'Example conversation');assert.equal(moved.threadId,'saved-thread');
 assert.equal(fs.readFileSync(copied.safeFile(moved,'report.txt'),'utf8'),'Original report');
 fs.writeFileSync(copied.safeFile(moved,'report.txt'),'Copied report');assert.equal(fs.readFileSync(path.join(b.cwd,'report.txt'),'utf8'),'Original report');
 assert.equal(new Store(destination).bot(b.id).cwd,moved.cwd);
});

test('a database copied without its workspaces fails without recreating or changing the old location',t=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'crew-test-'));
 t.after(()=>{const dir=path.resolve(base);assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));assert.match(path.basename(dir),/^crew-test-/);fs.rmSync(dir,{recursive:true,force:true});});
 const original=new Store(path.join(base,'original')),b=original.create({name:'Test'}),destination=path.join(base,'incomplete');
 fs.writeFileSync(path.join(b.cwd,'report.txt'),'Keep this report');fs.mkdirSync(destination);fs.copyFileSync(original.file,path.join(destination,'crew.json'));
 const before=fs.readFileSync(original.file,'utf8'),copied=fs.readFileSync(path.join(destination,'crew.json'),'utf8');
 assert.throws(()=>new Store(destination),/Restore the entire data folder/);
 assert.equal(fs.readFileSync(original.file,'utf8'),before);assert.equal(fs.readFileSync(path.join(destination,'crew.json'),'utf8'),copied);assert.equal(fs.readFileSync(path.join(b.cwd,'report.txt'),'utf8'),'Keep this report');
});

test('new installations start empty and explicit custom workspace paths are preserved',t=>{
 const s=make();
 t.after(()=>{const dir=path.resolve(s.root);assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));assert.match(path.basename(dir),/^crew-test-/);fs.rmSync(dir,{recursive:true,force:true});});
 const {workspaceId,...content}=s.db;assert.match(workspaceId,/^[a-f\d-]{36}$/);assert.equal(new Store(s.root).db.workspaceId,workspaceId);
 assert.deepEqual(content,{bots:[],tasks:[],routines:[],channels:[],notifications:[]});
 const b=s.create({name:'Test'});b.cwd=path.join(s.root,'custom-project');fs.mkdirSync(b.cwd);s.save();
 assert.equal(new Store(s.root).bot(b.id).cwd,b.cwd);
});
