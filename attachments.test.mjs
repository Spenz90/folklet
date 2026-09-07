import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from './store.mjs';
import {attachToMessage} from './attachments.mjs';
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'crew-attachments-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const store=new Store(root),a=store.create({name:'A'}),b=store.create({name:'B'});fs.mkdirSync(path.join(a.cwd,'attachments'));fs.writeFileSync(path.join(a.cwd,'attachments/report.txt'),'hello 🌿');return {store,a,b};}
test('cross-recipient attachments become readable local files without private absolute paths',t=>{const {store,a,b}=fixture(t),prompt=attachToMessage(store,b,'Read this',[{owner:a.id,path:'attachments/report.txt'}]),relative=prompt.split('\n').at(-1);assert.match(relative,/^attachments\//);assert.equal(fs.readFileSync(store.safeFile(b,relative),'utf8'),'hello 🌿');assert.ok(!prompt.includes(a.cwd));assert.ok(!prompt.includes(b.cwd));assert.equal(fs.readFileSync(path.join(a.cwd,'attachments/report.txt'),'utf8'),'hello 🌿');});
test('same-recipient files remain relative and missing or escaped files prevent partial copies',t=>{const {store,a,b}=fixture(t);assert.match(attachToMessage(store,a,'Read',[{owner:a.id,path:'attachments/report.txt'}]),/\nattachments\/report.txt$/);for(const file of ['../crew.json','attachments/../../crew.json','attachments/missing.txt']){assert.throws(()=>attachToMessage(store,b,'Read',[{owner:a.id,path:'attachments/report.txt'},{owner:a.id,path:file}]));assert.equal(fs.existsSync(path.join(b.cwd,'attachments')),false);}});
test('invalid message and excessive attachment counts are rejected before copying',t=>{const {store,a,b}=fixture(t);assert.throws(()=>attachToMessage(store,b,'',[{owner:a.id,path:'attachments/report.txt'}]));assert.throws(()=>attachToMessage(store,b,'Read',Array(21).fill({owner:a.id,path:'attachments/report.txt'})));});
