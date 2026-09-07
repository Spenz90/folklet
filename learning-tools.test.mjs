import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {Store} from './store.mjs';
import {Learning} from './learning.mjs';
import {Engine,crewTools} from './engine.mjs';

const decode=result=>JSON.parse(result[0].text);
function fixture(t){
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'crew-learning-tools-test-')),store=new Store(path.join(base,'data'));
 const engine=new Engine(store,{async close(){}},{executable:'test-only'});clearInterval(engine.timer);engine.drain=()=>{};
 const bot=store.create({name:'Test bot'}),task=store.enqueue(bot.id,'Do local test work');task.status='running';
 const live={task,status:'Working',activity:'',approval:null,requests:new Map(),pending:new Map(),proc:{kill(){},stdin:{write(){}}}};engine.live.set(bot.id,live);
 const learning=new Learning({dataRoot:store.root,store});engine.learning=learning;
 t.after(async()=>{await engine.close();assert.equal(path.dirname(path.resolve(base)),path.resolve(os.tmpdir()));assert.match(path.basename(base),/^crew-learning-tools-test-/);fs.rmSync(base,{recursive:true,force:true});});
 const call=(name,args)=>engine.dynamic(bot,live,name,args);
 return {base,store,engine,learning,bot,live,call};
}

test('file tools list, read, and atomically update only the bot workspace',async t=>{
 const {bot,call}=fixture(t);
 assert.equal(decode(await call('crew_files',{action:'write',path:'outputs/check.txt',text:'First version'})).written,true);
 assert.equal(decode(await call('crew_files',{action:'read',path:'outputs/check.txt'})).text,'First version');
 assert.ok(decode(await call('crew_files',{action:'list'})).some(file=>file.path==='outputs/check.txt'));
 await call('crew_files',{action:'write',path:'outputs/check.txt',text:'Updated café'});
 assert.equal(fs.readFileSync(path.join(bot.cwd,'outputs','check.txt'),'utf8'),'Updated café');
 assert.equal(fs.readdirSync(path.join(bot.cwd,'outputs')).some(name=>name.startsWith('.crew-write-')),false);
});

test('file tools reject traversal, external links, oversized UTF-8, binary data, and shell actions',async t=>{
 const {base,bot,call}=fixture(t),external=path.join(base,'application');fs.mkdirSync(external);fs.writeFileSync(path.join(external,'main.mjs'),'Original app');
 fs.symlinkSync(external,path.join(bot.cwd,'linked-app'),'junction');
 for(const file of ['../app.mjs',path.join(external,'main.mjs'),'linked-app/main.mjs'])await assert.rejects(call('crew_files',{action:'write',path:file,text:'Changed'}));
 await assert.rejects(call('crew_files',{action:'write',path:'large.txt',text:'é'.repeat(128001)}),/256 KB/);
 await assert.rejects(call('crew_files',{action:'write',path:'binary.txt',text:'a\0b'}),/UTF-8/);
 fs.writeFileSync(path.join(bot.cwd,'binary.bin'),Buffer.from([0xff,0xfe]));await assert.rejects(call('crew_files',{action:'read',path:'binary.bin'}),/not a UTF-8/);
 fs.writeFileSync(path.join(bot.cwd,'large.txt'),'x'.repeat(256001));await assert.rejects(call('crew_files',{action:'read',path:'large.txt'}),/256 KB/);
 await assert.rejects(call('crew_files',{action:'exec',text:'do not run'}),/list, read, or write/);
 assert.equal(fs.readFileSync(path.join(external,'main.mjs'),'utf8'),'Original app');
});

test('updating a workspace hard link replaces only that link, preserving external application code',async t=>{
 const {base,bot,call}=fixture(t),source=path.join(base,'application.mjs');fs.writeFileSync(source,'Original app');fs.linkSync(source,path.join(bot.cwd,'linked-source.mjs'));
 await call('crew_files',{action:'write',path:'linked-source.mjs',text:'Workspace draft'});
 assert.equal(fs.readFileSync(source,'utf8'),'Original app');assert.equal(fs.readFileSync(path.join(bot.cwd,'linked-source.mjs'),'utf8'),'Workspace draft');
});

test('learning tools cannot approve themselves or change another bot’s learning scope',async t=>{
 const {call,store,bot,learning}=fixture(t),other=store.create({name:'Other'});
 const proposal=decode(await call('crew_learning',{action:'propose',botId:other.id,kind:'preference',title:'Concise',text:'Be concise.',status:'accepted'}));
 assert.equal(proposal.botId,bot.id);assert.equal(proposal.status,'pending');assert.deepEqual(decode(await call('crew_learning',{action:'list'})),[]);
 await assert.rejects(call('crew_learning',{action:'accept',id:proposal.id}),/Only the user/);
 learning.accept(proposal.id);assert.equal(decode(await call('crew_learning',{action:'list'}))[0].status,'accepted');
 for(const name of ['crew_files','crew_learning','crew_computer'])assert.ok(crewTools.some(tool=>tool.name===name));
 assert.equal(crewTools.find(tool=>tool.name==='crew_learning').inputSchema.properties.action.enum.includes('accept'),false);
});

test('native computer tool obtains explicit approval and returns frame metadata with the screenshot',async t=>{
 const {engine,live,bot,call}=fixture(t);let performed=false;
 engine.nativeComputer={execute:async(owner,args,approve)=>{assert.equal(owner.id,bot.id);assert.equal(await approve({title:'Allow screenshot?',action:{action:'look'},note:'Shared desktop'}),true);performed=true;return {frameId:'frame-1',width:100,height:80,capturedAt:123,image:'aW1hZ2U=',mimeType:'image/png'};}};
 const pending=call('crew_computer',{action:'look',actor:'user'});
 assert.equal(performed,false);assert.equal(live.approval.kind,'approval');engine.answer(bot,live.approval.id,'accept');const result=await pending;
 assert.equal(performed,true);assert.deepEqual(decode(result),{frameId:'frame-1',width:100,height:80,capturedAt:123});assert.equal(result[1].imageUrl,'data:image/png;base64,aW1hZ2U=');
});

test('declining or stopping a native request prevents the approved-action callback from succeeding',async t=>{
 for(const stop of [false,true]){
  const {engine,live,bot,call}=fixture(t);let performed=false;
  engine.nativeComputer={execute:async(owner,args,approve)=>{if(await approve({title:'Allow native click?',action:args,note:'Shared desktop'})!==true)throw Error('Not approved');performed=true;return {};}};
  const pending=call('crew_computer',{action:'click',frameId:'frame-1',x:1,y:1});
  if(stop){engine.answer(bot,live.approval.id,'accept');await engine.interrupt(bot);}else engine.answer(bot,live.approval.id,'decline');
  await assert.rejects(pending,/Not approved/);assert.equal(performed,false);
 }
});
