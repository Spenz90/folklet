import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import yazl from 'yazl';
import {Store} from './store.mjs';
import {Skills} from './skills.mjs';
import {PluginPackages,packagePath} from './plugin-packages.mjs';
import {PluginConnections} from './plugin-connections.mjs';

const pluginSchema='https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',mcpSchema='https://agent-plugins.org/schemas/1.0.0/mcp.schema.json';
const skill='---\nname: review\ndescription: Review a document\nmetadata:\n  openclaw:\n    requires:\n      bins: [gh]\n---\n# Review\n\nRead the document, then check the sources.\n';
const file=(path,content)=>({path,content:typeof content==='string'?content:JSON.stringify(content)});
function portable(extra=[]){return [file('plugin.json',{$schema:pluginSchema,name:'review-tools',version:'1.0.0'}),file('skills/review/SKILL.md',skill),...extra];}
function fixture(t,{failConnection=false}={}){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'crew-packages-test-'))),store=new Store(root),skills=new Skills({dataRoot:root,store}),saved=[];
 const connections={validate(value){assert.equal(value.botIds.length,0);assert.equal(value.allowedTools.length,0);return value;},save(value){if(failConnection)throw Error('Connection storage failed');const item={...structuredClone(value),id:randomUUID(),enabled:false};saved.push(item);return item;},list(){return structuredClone(saved);},async remove(id){const i=saved.findIndex(value=>value.id===id);if(i>=0)saved.splice(i,1);}};
 const packages=new PluginPackages({dataRoot:root,skills,connections});t.after(()=>{assert.equal(path.dirname(root),fs.realpathSync(os.tmpdir()));assert.match(path.basename(root),/^crew-packages-test-/);fs.rmSync(root,{recursive:true,force:true});});return {root,store,skills,connections,packages,saved};
}
async function zip(entries){const archive=new yazl.ZipFile();for(const entry of entries)archive.addBuffer(Buffer.from(entry.content),entry.path,{mode:entry.mode??0o100644,compress:entry.compress!==false});archive.end();const chunks=[];for await(const part of archive.outputStream)chunks.push(part);return Buffer.concat(chunks);}

test('portable Agent Plugins inspection is inert and installation requires exact reviewed bytes',async t=>{
 const {packages,skills,saved,root}=fixture(t),review=await packages.inspect({files:portable([file('scripts/server.mjs','throw new Error("MUST NOT EXECUTE");'),file('mcp.json',{$schema:mcpSchema,mcpServers:{local:{type:'stdio',command:'node',args:['${PLUGIN_ROOT}/scripts/server.mjs'],cwd:'${PLUGIN_DATA}/cache',env:{API_KEY:'private-source-token'}},docs:{type:'streamable-http',url:'https://example.invalid/mcp',headers:{Authorization:'Bearer private-source-token'}}}})])});
 assert.equal(review.format,'agent-plugins-v1');assert.equal(skills.list().length,0);assert.equal(saved.length,0);assert.equal(review.skills.length,1);assert.equal(review.connections.length,2);assert.equal(JSON.stringify(review).includes('private-source-token'),false);assert.match(review.unsupported.join(' '),/Enter environment value API_KEY/);assert.match(review.reviewHash,/^[a-f0-9]{64}$/);
 await assert.rejects(packages.install({id:review.id,reviewHash:review.reviewHash}),/confirm/);await assert.rejects(packages.install({id:review.id,reviewHash:'0'.repeat(64),confirmed:true}),/hash/);
 const installed=await packages.install({id:review.id,reviewHash:review.reviewHash,confirmed:true});assert.equal(installed.status,'installed');assert.equal(installed.skillIds.length,1);assert.equal(installed.connectionIds.length,2);assert.equal(skills.get(installed.skillIds[0]).revisions[0].status,'pending');assert.deepEqual(skills.get(installed.skillIds[0]).enabledBotIds,[]);
 const local=saved.find(value=>value.name==='local');assert.equal(local.enabled,false);assert.deepEqual(local.botIds,[]);assert.deepEqual(local.allowedTools,[]);assert.equal(local.allowPackageInstall,false);assert.deepEqual(local.env,{});assert.ok(local.args[0].startsWith(local.packageRoot));assert.ok(fs.existsSync(path.join(local.packageRoot,'scripts/server.mjs')));assert.equal(local.cwd,path.join(local.packageData,'cache'));assert.ok(fs.statSync(local.cwd).isDirectory());assert.equal(local.sourcePackageId,review.id);
 assert.equal((await packages.install({id:review.id,reviewHash:review.reviewHash,confirmed:true})).id,installed.id);assert.equal(skills.list().length,1);assert.equal(new PluginPackages({dataRoot:root,skills,connections:{list:()=>[]}}).list()[0].reviewHash,review.reviewHash);
});

test('native OpenClaw and Hermes entrypoints are detected without executing them',async t=>{
 const {packages,saved,skills}=fixture(t);
 const openclaw=await packages.inspect({files:[file('openclaw.plugin.json',{id:'native',configSchema:{type:'object'},contracts:{tools:['danger']},skills:['instructions']}),file('package.json',{name:'native',openclaw:{extensions:['./index.mjs']},scripts:{install:'DO NOT RUN'}}),file('index.mjs','throw Error("MUST NOT LOAD")'),file('instructions/review/SKILL.md',skill)]});assert.equal(openclaw.format,'openclaw-native');assert.equal(openclaw.skills.length,1);assert.match(openclaw.unsupported.join(' '),/entrypoints.*not executed/);assert.match(openclaw.unsupported.join(' '),/install scripts/);
 const hermes=await packages.inspect({files:[file('plugin.yaml','name: native\nentrypoint: run.py'),file('run.py','raise Exception("MUST NOT LOAD")'),file('skills/review/SKILL.md',skill)]});assert.equal(hermes.format,'hermes-native');assert.match(hermes.unsupported.join(' '),/register\(ctx\)/);assert.equal(saved.length,0);assert.equal(skills.list().length,0);
});

test('OpenClaw-compatible Codex bundles map declared skills and MCP while reporting unsupported hooks',async t=>{
 const {packages,saved}=fixture(t),review=await packages.inspect({files:[file('.codex-plugin/plugin.json',{name:'bundle',skills:'./extra-skills',mcpServers:'./connections.json'}),file('extra-skills/review/SKILL.md',skill),file('hooks/HOOK.md','Not executed'),file('connections.json',{mcpServers:{docs:{transport:'streamable-http',url:'https://example.invalid/mcp'},legacy:{transport:'sse',url:'https://example.invalid/sse'}}})]});
 assert.equal(review.format,'codex-bundle');assert.equal(review.skills.length,1);assert.equal(review.connections.length,1);assert.match(review.unsupported.join(' '),/legacy SSE/);assert.match(review.unsupported.join(' '),/Hooks/);assert.equal(saved.length,0);
});

test('valid ZIP wrapper imports retain supporting files and reject modified file contents before installation',async t=>{
 const {packages,root,skills}=fixture(t),entries=portable([file('scripts/helper.py','print("not executed")')]).map(value=>({...value,path:'download/'+value.path})),archive=await zip(entries),review=await packages.inspect({archive:archive.toString('base64')});assert.ok(review.files.includes('scripts/helper.py'));
 const source=path.join(root,'plugin-packages','staged',review.id,'files','skills','review','SKILL.md');fs.appendFileSync(source,'\nChanged after review');await assert.rejects(packages.install({id:review.id,reviewHash:review.reviewHash,confirmed:true}),/changed after review/);assert.equal(skills.list().length,0);assert.equal(packages.list().length,0);
});

test('portable manifest versions, credential URLs, reserved environment and unsafe placeholders fail closed',async t=>{
 const {packages}=fixture(t);await assert.rejects(packages.inspect({files:[file('plugin.json',{$schema:'https://example.invalid/schema',name:'test'})]}),/1.0.0 schema/);
 const review=await packages.inspect({files:portable([file('mcp.json',{$schema:mcpSchema,mcpServers:{url:{type:'streamable-http',url:'https://example.invalid/mcp?token=private'},env:{type:'stdio',command:'node',env:{PLUGIN_ROOT:'/outside'}},escape:{type:'stdio',command:'node',args:['${PLUGIN_ROOT}/../outside']},shell:{type:'stdio',command:'sh',args:['-c','run']},download:{type:'stdio',command:'npx',args:['-y','example-mcp']}}})])});
 assert.deepEqual(review.connections.map(value=>value.name),['download']);assert.equal(review.connections[0].allowPackageInstall,false);assert.match(review.unsupported.join(' '),/download and run packages/);assert.equal(JSON.stringify(review).includes('?token=private'),false);assert.equal(review.unsupported.length>=4,true);
});

test('text folder and ZIP paths reject traversal, case aliases, reserved Windows names and file-directory collisions',async t=>{
 const {packages}=fixture(t);
 for(const value of ['../outside','/absolute','C:/file','folder\\file','con.txt','COM¹.txt','trailing.','trailing ','x:stream','a//b','a/./b','a/../b','a\0b'])assert.throws(()=>packagePath(value),/Unsafe/);
 for(const additions of [[file('a.txt','a'),file('A.txt','b')],[file('Folder/a','a'),file('folder/b','b')],[file('a','a'),file('a/b','b')]])await assert.rejects(packages.inspect({files:portable(additions)}),/collid|directory|Duplicate/i);
 const bad=await zip([file('safe.txt','content')]);for(let i=0;(i=bad.indexOf(Buffer.from('safe.txt'),i))>=0;i+=8)Buffer.from('../x.txt').copy(bad,i);await assert.rejects(packages.inspect({archive:bad.toString('base64')}),/Unsafe/);
 const duplicate=await zip([file('a.txt','1'),file('A.txt','2')]);await assert.rejects(packages.inspect({archive:duplicate.toString('base64')}),/colliding/);
});

test('ZIP symbolic links, CRC mismatches and excessive expanded bytes are rejected before staging',async t=>{
 const {packages,root}=fixture(t),linked=await zip([{...file('linked','outside'),mode:0o120777}]);await assert.rejects(packages.inspect({archive:linked.toString('base64')}),/links/);
 const broken=await zip([{...file('safe.txt','known fixture payload'),compress:false}]),offset=broken.indexOf(Buffer.from('known fixture payload'));assert.ok(offset>0);broken[offset]=120;await assert.rejects(packages.inspect({archive:broken.toString('base64')}),/integrity/);
 const large=await zip([file('large.txt','x'.repeat(1024*1024+1))]);await assert.rejects(packages.inspect({archive:large.toString('base64')}),/limit/);assert.deepEqual(fs.readdirSync(path.join(root,'plugin-packages/staged')),[]);
});

test('pre-existing staged junctions and hard links cannot be installed or recursively followed',async t=>{
 const {packages,root,skills}=fixture(t),review=await packages.inspect({files:portable()}),source=path.join(root,'plugin-packages/staged',review.id,'files'),outside=path.join(root,'outside');fs.mkdirSync(outside);fs.writeFileSync(path.join(outside,'keep.txt'),'Keep');fs.symlinkSync(outside,path.join(source,'linked'),'junction');
 await assert.rejects(packages.install({id:review.id,reviewHash:review.reviewHash,confirmed:true}),/links/);await assert.rejects(packages.remove(review.id),/links/);assert.equal(fs.readFileSync(path.join(outside,'keep.txt'),'utf8'),'Keep');fs.unlinkSync(path.join(source,'linked'));
 fs.linkSync(path.join(outside,'keep.txt'),path.join(source,'hard.txt'));await assert.rejects(packages.install({id:review.id,reviewHash:review.reviewHash,confirmed:true}),/hard links/);fs.unlinkSync(path.join(source,'hard.txt'));await packages.remove(review.id);assert.equal(skills.list().length,0);assert.equal(fs.readFileSync(path.join(outside,'keep.txt'),'utf8'),'Keep');
});

test('failed package installation rolls back only its pending skills and connections',async t=>{
 const {packages,skills,root}=fixture(t,{failConnection:true}),unrelated=skills.importSkill(skill),review=await packages.inspect({files:portable([file('mcp.json',{$schema:mcpSchema,mcpServers:{docs:{type:'streamable-http',url:'https://example.invalid/mcp'}}})])});
 await assert.rejects(packages.install({id:review.id,reviewHash:review.reviewHash,confirmed:true}),/Connection storage failed/);assert.deepEqual(skills.list().map(value=>value.id),[unrelated.skillId]);assert.deepEqual(packages.list(),[]);assert.deepEqual(fs.readdirSync(path.join(root,'plugin-packages/installed')),[]);
});

test('package removal revokes attached definitions and preserves unrelated user records',async t=>{
 const {packages,skills,saved,connections,root}=fixture(t),review=await packages.inspect({files:portable([file('mcp.json',{$schema:mcpSchema,mcpServers:{docs:{type:'streamable-http',url:'https://example.invalid/mcp'}}})])}),installed=await packages.install({id:review.id,reviewHash:review.reviewHash,confirmed:true}),ownSkill=skills.importSkill(skill),ownConnection=connections.save({name:'User',type:'mcp',transport:'streamable-http',url:'https://example.invalid/own',botIds:[],allowedTools:[]});
 await packages.remove(installed.id);assert.deepEqual(skills.list().map(value=>value.id),[ownSkill.skillId]);assert.deepEqual(saved.map(value=>value.id),[ownConnection.id]);assert.deepEqual(packages.list(),[]);assert.equal(fs.existsSync(path.join(root,'plugin-packages/installed',installed.id)),false);await packages.remove(installed.id);await assert.rejects(packages.remove('../outside'),/identity/);
});

test('real connection storage keeps imported package paths after restart without secrets, activation or process launches',async t=>{
 const {root,store,skills}=fixture(t);let effects=0;const connections=new PluginConnections({dataRoot:root,store,fetchImpl(){effects++;throw Error('Must not fetch');},spawnProcess(){effects++;throw Error('Must not spawn');}}),packages=new PluginPackages({dataRoot:root,skills,connections});
 connections.protectControlOrigin('http://127.0.0.1:4318');
 const review=await packages.inspect({files:portable([file('server.mjs','throw Error("not executed")'),file('mcp.json',{$schema:mcpSchema,mcpServers:{local:{type:'stdio',command:'node',args:['${PLUGIN_ROOT}/server.mjs'],env:{EXAMPLE_API_KEY:'private-original-value'}},download:{type:'stdio',command:'npx',args:['example-mcp']},blocked:{type:'streamable-http',url:'http://127.0.0.1:4318/mcp'}}})])});
 assert.equal(review.connections.length,2);assert.match(review.unsupported.join(' '),/owner or phone control endpoints/);const imported=await packages.install({id:review.id,reviewHash:review.reviewHash,confirmed:true});assert.equal(effects,0);
 const restarted=new PluginConnections({dataRoot:root,store,fetchImpl(){effects++;throw Error('Must not fetch');},spawnProcess(){effects++;throw Error('Must not spawn');}}),items=restarted.list(),local=items.find(item=>item.name==='local'),download=items.find(item=>item.name==='download');assert.equal(items.length,2);assert.equal(local.enabled,false);assert.equal(local.hasSecrets,false);assert.ok(path.isAbsolute(local.packageRoot));assert.ok(local.command==='node');assert.ok(local.args[0].includes(local.packageRoot));assert.equal(local.sourcePackageId,imported.id);assert.deepEqual(local.botIds,[]);assert.deepEqual(local.allowedTools,[]);assert.equal(download.allowPackageInstall,false);assert.equal(fs.readFileSync(restarted.file,'utf8').includes('private-original-value'),false);
 await assert.rejects(restarted.connect({id:download.id,confirmed:true}),/separate permission/);assert.equal(effects,0);
});

test('package file previews are bounded, hash-bound and safe for staged and installed source',async t=>{
 const {packages,root}=fixture(t),long='a'.repeat(63999)+'😀'+'tail'.repeat(20000),entries=portable([file('scripts/review.mjs','throw Error("never execute this preview")'),file('reference.txt',long),file('binary.dat','\0binary')]),review=await packages.inspect({archive:(await zip(entries)).toString('base64')});
 const script=packages.readFile({id:review.id,path:'scripts/review.mjs',reviewHash:review.reviewHash});assert.equal(script.text,'throw Error("never execute this preview")');assert.equal(script.binary,false);assert.equal(script.truncated,false);
 const reference=packages.readFile({id:review.id,path:'reference.txt'});assert.equal(reference.truncated,true);assert.equal(reference.text.length,63999);assert.equal(reference.bytes,Buffer.byteLength(long));assert.equal(packages.readFile({id:review.id,path:'binary.dat'}).binary,true);
 assert.throws(()=>packages.readFile({id:review.id,path:'scripts/review.mjs',reviewHash:'0'.repeat(64)}),/hash/);assert.throws(()=>packages.readFile({id:review.id,path:'../index.json'}),/Unsafe/);assert.throws(()=>packages.readFile({id:review.id,path:'missing'}),/listed/);
 await packages.install({id:review.id,reviewHash:review.reviewHash,confirmed:true});assert.deepEqual(packages.readFile({id:review.id,path:'scripts/review.mjs',reviewHash:review.reviewHash}),script);
 const installed=path.join(root,'plugin-packages/installed',review.id,'files','scripts/review.mjs'),outside=path.join(root,'outside-preview');fs.mkdirSync(outside);fs.unlinkSync(installed);fs.symlinkSync(outside,installed,'junction');assert.throws(()=>packages.readFile({id:review.id,path:'scripts/review.mjs'}),/links/);fs.unlinkSync(installed);
});
