import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Execute the real settings handlers with a small DOM and deferred API replies.
// No accounts, OAuth endpoints, native controls or live workspaces are used.
const source=fs.readFileSync(new URL('./settings-ui.mjs',import.meta.url),'utf8').replace(/^import[^\n]+\n/gm,'').replace('export function ','function ');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const decode=value=>value.replace(/&(amp|lt|gt|quot|#39);/g,(_,name)=>({amp:'&',lt:'<',gt:'>',quot:'"','#39':"'"}[name]));
const catalog=[{id:'codex',name:'ChatGPT'},{id:'custom-one',type:'custom',name:'Local helper',baseUrl:'http://127.0.0.1:8080/v1',hasKey:false}];
function harness(){
 const elements={},handlers={},timers=new Map(),calls=[],modelCalls=[],featureCalls=[],modals=[];let nextTimer=0,refreshes=0;
 function element(tag='div',attrs={}){
  let html='',text='';const node={tag,attrs,dataset:{},children:[],value:attrs.value||'',checked:'checked' in attrs,disabled:'disabled' in attrs,open:false,
   close(){this.open=false;},querySelectorAll(selector){const tags=selector.split(','),out=[];const walk=n=>{for(const child of n.children){if(tags.includes(child.tag))out.push(child);walk(child);}};walk(this);return out;}
  };
  for(const [name,value] of Object.entries(attrs))if(name.startsWith('data-'))node.dataset[name.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=value;
  Object.defineProperties(node,{innerHTML:{get:()=>html,set(value){html=String(value);text='';node.children=[];const stack=[node];
   for(const match of html.matchAll(/<(\/?)([a-z][\w-]*)\b([^>]*)>/gi)){
    if(match[1]){if(stack.length>1&&stack.at(-1).tag===match[2])stack.pop();continue;}
    const attributes={};for(const a of match[3].matchAll(/([\w-]+)(?:="([^"]*)")?/g))attributes[a[1]]=decode(a[2]||'');
    const child=element(match[2],attributes);stack.at(-1).children.push(child);if(attributes.id)elements[attributes.id]=child;
    if(!['input','br','img','hr','meta','link'].includes(child.tag))stack.push(child);
   }
  }},textContent:{get:()=>text,set(value){text=String(value);html='';node.children=[];}}});return node;
 }
 elements.modal=element('dialog');
 const context=vm.createContext({window:{CREW_MOBILE:false},URL,WeakSet,Date,
  document:{getElementById:id=>elements[id]||null,addEventListener:(type,handler)=>{handlers[type]=handler;},createElement:tag=>({...element(tag),click(){}})},
  setTimeout:fn=>{const id=++nextTimer;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),
  api:async(route,body)=>{calls.push({route,body:body?JSON.parse(JSON.stringify(body)):undefined});return context.respond(route,body);},
  refresh:async()=>{refreshes++;},getBots:()=>[{id:'bot',name:'Test bot'}],accountPanel:async()=>{},md:text=>String(text),
  createHostingUI:()=>({open:async()=>{featureCalls.push('host');},setup(){featureCalls.push('cloud');}}),
  createModelSettingsUI:()=>({edit:async id=>{modelCalls.push(id);},listBots:async()=>{}}),
  createPluginsUI:()=>({open:async()=>{featureCalls.push('plugins');}}),createSkillsUI:()=>({open:async()=>{featureCalls.push('skills');}}),createLearningReviewUI:()=>({open:async()=>{featureCalls.push('learning');}}),createRecallUI:()=>({open:async()=>{featureCalls.push('recall');}}),createIntegrationsUI:()=>({open:async()=>{featureCalls.push('integrations');}}),createNotificationsUI:()=>({open:async()=>{featureCalls.push('notifications');}}),createFallbackUI:()=>({open:async()=>{featureCalls.push('fallback');}}),createRoutinePolicyUI:()=>({open:async()=>{featureCalls.push('routine');}}),
  modal(title,subtitle,body,type){modals.push({title,subtitle,type});for(const id of Object.keys(elements))if(id!=='modal')delete elements[id];elements.modal.open=true;elements.modal.dataset.kind=type;elements['modal-content']=element();elements['modal-content'].innerHTML=body;elements['modal-error']=element();}
 });
 context.respond=async route=>route==='providers'?catalog:route==='learning'?[]:route==='native-status'?{enabled:false,available:true}:route.startsWith('guide?')?{title:'Guide',text:'Help'}:{};
 vm.runInContext(source+'\nui=createSettingsUI({api,modal,refresh,getBots,accountPanel,md});',context);
 return {ui:context.ui,context,calls,modelCalls,featureCalls,modals,get:id=>elements[id],refreshes:()=>refreshes,timers,
  click:dataset=>handlers.click({target:{closest:()=>({dataset})}}),
  submit:()=>elements['provider-form'].onsubmit({preventDefault(){}}),
  flush(){const pending=[...timers.values()];timers.clear();return Promise.all(pending.map(fn=>fn()));}
 };
}

test('keyless custom endpoints have accurate connection and optional-key labels',async()=>{
 const h=harness();await h.ui.providers();assert.match(h.get('provider-list').innerHTML,/Endpoint configured/);assert.doesNotMatch(h.get('provider-list').innerHTML,/Key needed/);
 await h.click({providerEdit:'custom-one'});assert.match(h.get('modal-content').innerHTML,/API key \(optional\)/);assert.equal(h.get('provider-url').value,'http://127.0.0.1:8080/v1');
});
test('provider saves support keyboard submission, freeze the draft and ignore double submits',async()=>{
 const h=harness(),gate=deferred();await h.click({addProvider:'openai'});h.get('provider-key').value='fixture-key';h.get('provider-name').value='My connection';
 h.context.respond=route=>route==='provider-save'?gate.promise:catalog;
 const pending=h.submit(),controls=h.get('provider-form').querySelectorAll('button,input');assert.ok(controls.length>5);assert.ok(controls.every(control=>control.disabled));
 await h.submit();assert.equal(h.calls.filter(call=>call.route==='provider-save').length,1);gate.resolve({});await pending;
 assert.equal(h.get('modal').dataset.kind,'connections');assert.equal(h.calls.find(call=>call.route==='provider-save').body.name,'My connection');
});
test('a failed provider save preserves fields and restores controls for retry',async()=>{
 const h=harness();await h.click({addProvider:'custom'});h.get('provider-key').value='fixture-key';h.get('provider-url').value='http://127.0.0.1:8080/v1';h.get('provider-persist').checked=true;
 h.context.respond=async()=>{throw Error('Connection could not be saved');};await h.submit();
 assert.equal(h.get('provider-key').value,'fixture-key');assert.equal(h.get('provider-url').value,'http://127.0.0.1:8080/v1');assert.equal(h.get('provider-persist').checked,true);assert.ok(h.get('provider-form').querySelectorAll('button,input').every(control=>!control.disabled));
 h.context.respond=route=>route==='providers'?catalog:{};await h.submit();assert.equal(h.get('modal').dataset.kind,'connections');assert.equal(h.get('modal-error').textContent,'');
});
test('saving or removing a provider cannot reopen a dialog after navigation',async()=>{
 for(const action of ['save','remove']){
  const h=harness(),gate=deferred();await h.click({providerEdit:'custom-one'});h.context.respond=()=>gate.promise;
  const pending=action==='save'?h.submit():h.click({providerRemove:'custom-one'});h.ui.welcome();gate.resolve({});await pending;
  assert.equal(h.get('modal').dataset.kind,'welcome');assert.equal(h.calls.at(-1).route,action==='save'?'provider-save':'provider-remove');
 }
});
test('a superseded provider editor ignores late discovery success and failure',async()=>{
 for(const failure of [false,true]){
  const h=harness(),gate=deferred();h.context.respond=()=>gate.promise;const pending=h.click({providerEdit:'custom-one'});h.ui.welcome();h.get('modal-error').textContent='Current status';
  failure?gate.reject(Error('Old failure')):gate.resolve(catalog);await pending;assert.equal(h.get('modal').dataset.kind,'welcome');assert.equal(h.get('modal-error').textContent,'Current status');
 }
});
test('settings loading replies and errors cannot reopen closed or replaced screens',async()=>{
 for(const screen of ['providers','computer','guide'])for(const failure of [false,true]){
  const h=harness(),gate=deferred();h.context.respond=()=>gate.promise;
  const pending=screen==='guide'?h.click({settingsGuide:'QUICKSTART.md'}):h.ui[screen]();h.ui.welcome();h.get('modal').close();h.get('modal-error').textContent='Keep this';
  failure?gate.reject(Error('Stale failure')):gate.resolve(screen==='providers'?catalog:screen==='learning'?[]:screen==='computer'?{enabled:false,available:true}:{title:'Old guide',text:'Old'});
  await pending;assert.equal(h.get('modal').open,false);assert.equal(h.get('modal').dataset.kind,'welcome');assert.equal(h.get('modal-error').textContent,'Keep this');
 }
});
test('failed list loading offers an immediate retry and clears the recovered error',async()=>{
 const h=harness();h.context.respond=async()=>{throw Error('Host temporarily unavailable');};await h.ui.providers();assert.match(h.get('provider-list').innerHTML,/Try again/);assert.match(h.get('modal-error').textContent,/temporarily/);
 h.context.respond=()=>catalog;await h.click({crewSettings:'connections'});assert.match(h.get('provider-list').innerHTML,/Endpoint configured/);assert.equal(h.get('modal-error').textContent,'');
});
test('settings opens the integrated skills, memory, recall and integration screens',async()=>{
 const h=harness();for(const screen of ['skills','learning','recall','integrations','notifications'])await h.click({crewSettings:screen});assert.deepEqual(h.featureCalls,['skills','learning','recall','integrations','notifications']);await h.ui.learning();assert.equal(h.featureCalls.at(-1),'learning');
});
test('an already enabled desktop can be turned off when its helper becomes unavailable',async()=>{
 const h=harness();h.context.respond=()=>({enabled:true,available:false,reason:'Helper unavailable'});await h.ui.computer();assert.match(h.get('computer-settings').innerHTML,/data-native-enable="false"/);assert.match(h.get('computer-settings').innerHTML,/Turn off desktop control/);
});
test('OpenRouter sign-in starts once and stops preparation if its form was left',async()=>{
 const h=harness(),gate=deferred();await h.click({addProvider:'openrouter'});h.context.respond=()=>gate.promise;
 const pending=h.click({openrouterLogin:''});await h.click({openrouterLogin:''});assert.equal(h.calls.filter(call=>call.route==='providers').length,1);
 h.ui.welcome();gate.resolve(catalog);await pending;assert.equal(h.calls.some(call=>call.route==='provider-login'),false);assert.equal(h.get('modal').dataset.kind,'welcome');
});
test('late OpenRouter login and poll replies cannot replace a newer dialog',async()=>{
 for(const stage of ['login','poll']){
  const h=harness(),gate=deferred(),started=deferred();await h.click({addProvider:'openrouter'});let lists=0;
  h.context.respond=route=>{
   if(route==='provider-login'){if(stage==='login'){started.resolve();return gate.promise;}return {authUrl:'https://openrouter.ai/auth?test=1',expiresAt:Date.now()+100000};}
   if(++lists===2){started.resolve();return gate.promise;}return catalog;
  };
  const connecting=h.click({openrouterLogin:''});if(stage==='poll')await connecting;const pending=stage==='poll'?h.flush():connecting;await started.promise;h.ui.welcome();
  gate.resolve(stage==='login'?{authUrl:'https://openrouter.ai/auth?test=1',expiresAt:Date.now()+100000}:[...catalog,{id:'new-router',type:'openrouter',hasKey:true}]);await pending;
  assert.equal(h.get('modal').dataset.kind,'welcome');assert.equal(h.timers.size,0);
 }
});
test('a rejected OpenRouter sign-in URL keeps the form usable without opening a link',async()=>{
 const h=harness();await h.click({addProvider:'openrouter'});h.context.respond=route=>route==='providers'?catalog:{authUrl:'https://other.example/auth'};await h.click({openrouterLogin:''});
 assert.equal(h.get('modal').dataset.kind,'provider-editor');assert.match(h.get('modal-error').textContent,/Unexpected sign-in address/);assert.ok(h.get('provider-form').querySelectorAll('button,input').every(control=>!control.disabled));assert.equal(h.timers.size,0);
});
test('guide titles are escaped before reaching the shared modal HTML contract',async()=>{
 const h=harness();h.context.respond=()=>({title:'<img src=x>',text:'Help'});await h.click({settingsGuide:'QUICKSTART.md'});assert.equal(h.modals.at(-1).title,'&lt;img src=x&gt;');
});
test('recognized local guide links are usable inside FOLKLET without allowing arbitrary file navigation',async()=>{
 const h=harness();h.context.respond=async()=>({title:'Features',text:'Read [Quick start](QUICKSTART.md), [Security](SECURITY.md) and [Fallback](PROVIDERS.md#approved-fallback). Keep [private](../data/crew.json) and [unknown](UNKNOWN.md) as text.'});
 await h.click({settingsGuide:'FEATURES.md'});const html=h.get('modal-content').innerHTML;
 assert.match(html,/data-settings-guide="QUICKSTART.md">Quick start<\/button>/);assert.match(html,/data-settings-guide="SECURITY.md"/);assert.match(html,/data-settings-guide="PROVIDERS.md"/);assert.doesNotMatch(html,/data-settings-guide="(?:\.\.\/data\/crew.json|UNKNOWN.md)"/);assert.ok(html.includes('[unknown](UNKNOWN.md)'));
 await h.click({settingsGuide:'SECURITY.md'});assert.equal(h.calls.at(-1).route,'guide?name=SECURITY.md');
});
test('delayed first-bot setup does not reopen settings after another dialog was used',async()=>{
 const h=harness(),gate=deferred();h.context.respond=()=>gate.promise;const pending=h.ui.setupBot('bot');h.ui.welcome();h.get('modal').close();gate.resolve(catalog);await pending;assert.deepEqual(h.modelCalls,[]);assert.equal(h.get('modal').open,false);
});
