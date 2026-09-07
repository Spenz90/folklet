import test from 'node:test';
import assert from 'node:assert/strict';
import {ModelSettings} from './model-settings.mjs';

// Entirely synthetic catalogs: no account process, credentials or network access.
function fixture(){
 let now=1000;const calls=[],connection={fixture:true};
 const pages=new Map([
  ['',{data:[{id:'record-one',model:'model-one',displayName:'Model One',isDefault:true,defaultReasoningEffort:'high',internalField:'not-public',supportedReasoningEfforts:[{reasoningEffort:'low',description:'Faster'},{reasoningEffort:'high',description:'d'.repeat(400)},{reasoningEffort:'high'},{reasoningEffort:'ultra'},{reasoningEffort:'unknown'}]}],nextCursor:'second'}],
  ['second',{data:[{id:'model-two',supportedReasoningEfforts:[{reasoningEffort:'medium'}]},{id:42}],nextCursor:null}]
 ]);
 const definitions=[{id:'codex',type:'codex'},{id:'api',type:'openai',defaultModel:'o3'},{id:'custom',type:'custom',defaultModel:'o3'},{id:'router',type:'openrouter',defaultModel:'fixture/router'}];
 const account={async connect(){calls.push({connect:true});return connection;},async rpc(client,method,params){assert.equal(client,connection);assert.equal(method,'model/list');calls.push({method,params});return structuredClone(pages.get(params.cursor||''));}};
 const apiModels={api:[{id:'o3',name:'O3'}],custom:[{id:'o3',supportedReasoningEfforts:[{reasoningEffort:'high'}]}],router:[{id:'fixture/router',reasoning:{supported_efforts:['low','high'],default_effort:'low',mandatory:true}}]};
 const providers={list(){return definitions;},async modelList(id){calls.push({providerId:id});return structuredClone(apiModels[id]);}};
 const settings=new ModelSettings({account,providers,now:()=>now});
 return {settings,account,providers,calls,pages,apiModels,advance(ms){now+=ms;}};
}

test('Codex catalog normalizes IDs and names, paginates, and exposes supported effort labels',async()=>{
 const f=fixture(),result=await f.settings.get('codex','model-one');
 assert.deepEqual(result.models.map(({id,name})=>({id,name})),[{id:'model-one',name:'Model One'},{id:'model-two',name:'model-two'}]);
 assert.equal(Object.hasOwn(result.models[0],'internalField'),false);
 assert.equal(result.defaultModelId,'model-one');assert.equal(result.defaultEffort,'high');assert.equal(result.notice,'');
 assert.deepEqual(result.options.map(({value,label})=>({value,label})),[{value:'',label:'Default'},{value:'low',label:'Low'},{value:'high',label:'High'},{value:'ultra',label:'Ultra'}]);
 assert.equal(result.options.find(option=>option.value==='high').description.length,300);
 assert.deepEqual(f.calls.filter(call=>call.method).map(call=>call.params.cursor),[undefined,'second']);
 assert.equal(await f.settings.validate('codex','model-one','ultra'),'ultra');
});

test('Codex catalog cache expires and repeated cursors cannot loop indefinitely',async()=>{
 const f=fixture();await f.settings.get('codex','model-one');f.advance(299999);await f.settings.get('codex','model-two');
 assert.equal(f.calls.filter(call=>call.connect).length,1);
 f.advance(1);await f.settings.get('codex','model-two');assert.equal(f.calls.filter(call=>call.connect).length,2);
 const repeated=fixture();repeated.pages.get('second').nextCursor='second';await repeated.settings.catalog('codex');
 assert.equal(repeated.calls.filter(call=>call.method).length,2);
});

test('blank Codex configuration and unknown models never inherit a catalog default effort',async()=>{
 const f=fixture();
 for(const model of ['', 'not-in-the-catalog']){
  const result=await f.settings.get('codex',model);assert.deepEqual(result.options,[{value:'',label:'Default'}]);assert.equal(result.defaultEffort,'');
  await assert.rejects(f.settings.validate('codex',model,'high'),/does not support/);
 }
 assert.equal(await f.settings.validate('codex','',''),'');
});

test('catalog failure yields safe default guidance and can recover without restarting',async()=>{
 const f=fixture(),connect=f.account.connect;f.account.connect=async()=>{throw Error('fixture-internal-credential-detail');};
 const result=await f.settings.get('codex','model-one');assert.deepEqual(result.models,[]);assert.deepEqual(result.options,[{value:'',label:'Default'}]);
 assert.match(result.notice,/Connect ChatGPT/);assert.equal(JSON.stringify(result).includes('fixture-internal-credential-detail'),false);
 await assert.rejects(f.settings.validate('codex','model-one','high'),/does not support/);
 f.account.connect=connect;assert.equal((await f.settings.get('codex','model-one')).options.some(option=>option.value==='high'),true);
});

test('unknown providers, invalid model IDs and malformed effort values fail before discovery',async()=>{
 const f=fixture();await assert.rejects(f.settings.get('missing','model-one'),/available connection/);
 for(const model of [null,42,{},'x'.repeat(201)])await assert.rejects(f.settings.get('codex',model),/valid model ID/);
 for(const effort of [null,42,{},'x'.repeat(21)])await assert.rejects(f.settings.validate('codex','model-one',effort),/valid reasoning level/);
 assert.equal(f.calls.length,0);
 await assert.rejects(f.settings.validate('codex','model-one','unknown'),/does not support/);
});

test('API settings use their own model protocol and supported discovery metadata',async()=>{
 const f=fixture();assert.deepEqual((await f.settings.get('api','')).options.map(option=>option.value),['','low','medium','high']);
 assert.equal(await f.settings.validate('api','o3','high'),'high');
 assert.deepEqual((await f.settings.get('custom','o3')).options,[{value:'',label:'Default'}]);
 await assert.rejects(f.settings.validate('custom','o3','high'),/does not support/);
 const router=await f.settings.get('router','');assert.deepEqual(router.options.map(option=>option.value),['','low','high']);
 await assert.rejects(f.settings.validate('router','fixture/router','none'),/does not support/);
 f.providers.modelList=async()=>{throw Error('fixture-private-provider-error');};
 const fallback=await f.settings.get('api','o3');assert.match(fallback.notice,/enter a model ID manually/);assert.equal(JSON.stringify(fallback).includes('fixture-private-provider-error'),false);
 assert.deepEqual(fallback.options.map(option=>option.value),['','low','medium','high']);
 assert.equal(f.calls.some(call=>call.connect),false,'API settings must never start a Codex account process');
});
