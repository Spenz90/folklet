import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Small DOM adapter for the real module's asynchronous event handlers. These
// tests make no network calls and do not require a browser or live workspace.
const source=fs.readFileSync(new URL('./model-settings-ui.mjs',import.meta.url),'utf8').replace('export function ','function ');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const decode=value=>value.replace(/&(amp|lt|gt|quot|#39);/g,(_,name)=>({amp:'&',lt:'<',gt:'>',quot:'"','#39':"'"}[name]));
const providers=[{id:'codex',name:'ChatGPT'},{id:'api',name:'API',type:'custom',defaultModel:'api-model'}];
const options=(...levels)=>({models:[{id:'alpha',name:'Alpha'},{id:'beta',name:'Beta'}],options:[{value:'',label:'Default'},...levels.map(value=>({value,label:value}))]});
function harness({bots=[{id:'a',name:'A',model:'alpha',reasoningEffort:'high'}],respond=()=>options('low','high')}={}){
 const elements={},handlers={},timers=new Map(),calls=[],dialogs=[];let nextTimer=0,refreshes=0;
 function element(tag='div',attrs={}){
  let html='',text='';const node={tag,dataset:{},attrs:{...attrs},value:attrs.value||'',disabled:'disabled' in attrs,open:false,children:[],
   close(){this.open=false;},setAttribute(name,value){this.attrs[name]=value;},getAttribute(name){return this.attrs[name];},closest(selector){return selector==='button'&&this.tag==='button'?this:null;},
   querySelectorAll(selector){const tags=selector.split(','),out=[];const walk=n=>{for(const child of n.children){if(tags.includes(child.tag))out.push(child);walk(child);}};walk(this);return out;},
   querySelector(selector){const all=[];const walk=n=>{for(const child of n.children){all.push(child);walk(child);}};walk(this);return all.find(child=>selector[0]==='.'?(child.attrs.class||'').split(' ').includes(selector.slice(1)):child.tag===selector)||null;}
  };
  for(const [name,value] of Object.entries(attrs))if(name.startsWith('data-'))node.dataset[name.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=value;
  Object.defineProperties(node,{innerHTML:{get:()=>html,set(value){html=String(value);text='';node.children=[];
   for(const match of html.matchAll(/<([a-z]+)\b([^>]*)>/g)){
    const attributes={};for(const a of match[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g))attributes[a[1]]=decode(a[2]||'');
    const child=element(match[1],attributes);node.children.push(child);if(attributes.id)elements[attributes.id]=child;
   }
  }},textContent:{get:()=>text,set(value){text=String(value);html='';node.children=[];}}});return node;
 }
 elements.modal=element('dialog');elements['modal-error']=element();
 const api=async(route,body)=>{calls.push({route,body:body?JSON.parse(JSON.stringify(body)):undefined});return route==='providers'?providers:route==='update'?{}:respond(route,body);};
 const context=vm.createContext({document:{getElementById:id=>elements[id]||null,addEventListener:(event,handler)=>{handlers[event]=handler;}},
  setTimeout:fn=>{const id=++nextTimer;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),
  api:(...args)=>context.handleApi(...args),getBots:()=>bots,refresh:async()=>{refreshes++;},
  modal(title,subtitle,body){dialogs.push({title,subtitle,body});for(const id of Object.keys(elements))if(!['modal','modal-error'].includes(id))delete elements[id];elements.modal.open=true;elements['modal-error'].textContent='';elements.content=element();elements.content.innerHTML=body;}
 });context.handleApi=api;
 vm.runInContext(source+'\nui=createModelSettingsUI({api,modal,refresh,getBots});',context);
 return {elements,calls,dialogs,context,ui:context.ui,get:id=>elements[id],refreshes:()=>refreshes,
  click:dataset=>handlers.click({target:{closest:()=>({dataset})}}),
  input(value){const input=elements['chosen-model'];if(!input.disabled){input.value=value;input.oninput();}},
  flush(){const pending=[...timers.values()];timers.clear();return Promise.all(pending.map(fn=>fn()));},
  submit:()=>elements['model-settings-form'].onsubmit({preventDefault(){}}),
  request(handler){context.handleApi=async(route,body)=>{calls.push({route,body:body?JSON.parse(JSON.stringify(body)):undefined});return handler(route,body);};}
 };
}
const selected=h=>h.get('reasoning-choices').querySelectorAll('button').find(button=>button.getAttribute('aria-pressed')==='true')?.dataset.reasoningLevel;

test('a resolved runtime model does not overwrite the saved Default preference',async()=>{
 const h=harness({bots:[{id:'a',name:'A',model:'runtime-selected-model',modelPreference:'',reasoningEffort:''}],respond:()=>options()});
 await h.ui.listBots();assert.match(h.get('content').innerHTML,/Default model/);assert.doesNotMatch(h.get('content').innerHTML,/runtime-selected-model/);
 await h.ui.edit('a');assert.equal(h.get('chosen-model').value,'');assert.equal(selected(h),'');
 assert.match(h.calls.at(-1).route,/model=$/);await h.submit();assert.deepEqual(h.calls.at(-1).body,{id:'a',providerId:'codex',model:'',reasoningEffort:''});assert.equal(h.get('modal').open,false);
});

test('a bot name cannot inject markup into a model dialog heading or subtitle',async()=>{
 const h=harness({bots:[{id:'a',name:'<img src=x onerror="alert(1)"> & team',model:'alpha'}]});
 await h.ui.edit('a');const dialog=h.dialogs.at(-1);
 assert.doesNotMatch(dialog.subtitle,/<img/);assert.match(dialog.subtitle,/&lt;img/);assert.match(dialog.subtitle,/&amp; team/);
 await h.ui.listBots();assert.doesNotMatch(h.dialogs.at(-1).body,/<img/);
});

test('retrying model discovery retains a supported saved choice without changing the bot',async()=>{
 const h=harness();h.request(route=>route==='providers'?providers:Promise.reject(Error('Temporary failure')));await h.ui.edit('a');
 assert.match(h.get('reasoning-choices').innerHTML,/Try loading again/);assert.equal(h.get('save-model-settings').disabled,true);
 h.request(route=>route==='providers'?providers:options('low','high'));await h.click({retryModelOptions:''});
 assert.equal(selected(h),'high');assert.equal(h.get('save-model-settings').disabled,false);assert.equal(h.get('modal-error').textContent,'');assert.equal(h.calls.some(call=>call.route==='update'),false);
});
test('model changes reset effort and ignore out-of-order capability responses',async()=>{
 const h=harness(),older=deferred(),newer=deferred();await h.ui.edit('a');assert.equal(selected(h),'high');
 h.request(route=>route==='providers'?providers:route==='update'?{}:route.endsWith('model=beta')?older.promise:newer.promise);
 h.input('beta');await h.submit();assert.equal(h.calls.some(call=>call.route==='update'),false);const first=h.flush();
 h.input('gamma');const second=h.flush();newer.resolve(options('low'));await second;
 assert.equal(selected(h),'');assert.equal(h.get('save-model-settings').disabled,false);
 older.resolve(options('max'));await first;assert.equal(h.get('chosen-model').value,'gamma');assert.doesNotMatch(h.get('reasoning-choices').innerHTML,/max/);
 await h.submit();assert.deepEqual(h.calls.at(-1).body,{id:'a',providerId:'codex',model:'gamma',reasoningEffort:''});
});
test('changing provider starts with its default model and default reasoning',async()=>{
 const h=harness();await h.ui.edit('a');await h.click({modelProvider:'api'});
 assert.equal(h.get('chosen-model').value,'api-model');assert.equal(selected(h),'');await h.submit();assert.deepEqual(h.calls.at(-1).body,{id:'a',providerId:'api',model:'api-model',reasoningEffort:''});
});
test('superseded connection discovery cannot replace or stain a newer dialog',async()=>{
 for(const failure of [false,true]){
  const h=harness({bots:[{id:'a',name:'A',model:'alpha'},{id:'b',name:'B',model:'beta'}]}),old=deferred();let loads=0;
  h.request(route=>route==='providers'?(++loads===1?old.promise:providers):options('low'));
  const first=h.ui.edit('a');await h.ui.edit('b');h.get('modal-error').textContent='New dialog status';
  failure?old.reject(Error('Old account failure')):old.resolve(providers);await first;
  assert.equal(h.get('chosen-model').value,'beta');assert.equal(h.get('modal-error').textContent,'New dialog status');
 }
});
test('late capability errors are ignored and a successful retry clears a current error',async()=>{
 const h=harness(),old=deferred(),started=deferred();let loads=0;h.request(route=>{if(route==='providers')return providers;if(++loads===1){started.resolve();return old.promise;}return options('low');});
 const first=h.ui.edit('a');await started.promise;await h.ui.edit('a');old.reject(Error('Stale failure'));await first;assert.equal(h.get('modal-error').textContent,'');
 h.request(route=>route==='providers'?providers:Promise.reject(Error('Temporary failure')));await h.click({modelPick:'beta'});assert.equal(h.get('save-model-settings').disabled,true);assert.equal(h.get('modal-error').textContent,'Temporary failure');
 h.request(route=>route==='providers'?providers:options('low'));await h.click({modelPick:'alpha'});assert.equal(h.get('modal-error').textContent,'');assert.equal(h.get('save-model-settings').disabled,false);
});
test('saving freezes controls and ignores duplicate saves or picker changes',async()=>{
 const h=harness(),save=deferred();await h.ui.edit('a');h.request(route=>route==='update'?save.promise:route==='providers'?providers:options('low'));
 const pending=h.submit();assert.ok(h.get('model-editor').querySelectorAll('button,input').every(control=>control.disabled));
 h.input('beta');await h.click({reasoningLevel:'low'});await h.click({modelPick:'beta'});await h.click({modelProvider:'api'});await h.submit();
 assert.equal(h.calls.filter(call=>call.route==='update').length,1);assert.equal(h.get('chosen-model').value,'alpha');assert.equal(selected(h),'high');
 save.resolve({});await pending;assert.equal(h.get('modal').open,false);assert.equal(h.refreshes(),1);assert.deepEqual(h.calls.at(-1).body,{id:'a',providerId:'codex',model:'alpha',reasoningEffort:'high'});
});
test('a failed save keeps its selected draft editable for a retry',async()=>{
 const h=harness();await h.ui.edit('a');h.request(route=>route==='update'?Promise.reject(Error('Task is still running')):options('low','high'));
 await h.submit();assert.equal(h.get('modal').open,true);assert.equal(h.get('chosen-model').disabled,false);assert.equal(h.get('chosen-model').value,'alpha');assert.equal(selected(h),'high');assert.equal(h.get('modal-error').textContent,'Task is still running');
 await h.click({reasoningLevel:'low'});h.request(()=>({}));await h.submit();assert.equal(h.calls.at(-1).body.reasoningEffort,'low');assert.equal(h.get('modal').open,false);
});
