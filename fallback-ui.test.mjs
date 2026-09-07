import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const decode=value=>value.replace(/&(amp|lt|gt|quot|#39);/g,(_,key)=>({amp:'&',lt:'<',gt:'>',quot:'"','#39':"'"}[key]));
const providers=[{id:'codex',name:'ChatGPT'},{id:'api',name:'API'}],catalog={models:[{id:'one',name:'One'},{id:'two',name:'Two'}],options:[{value:'',label:'Default'},{value:'low',label:'Low'}]};
function harness(kind='fallback',fallback={enabled:true,contentSharingApproved:true,choices:[{providerId:'api',model:'one',reasoningEffort:''}]},providerId='codex'){
 const elements={},calls=[],timers=new Map();let timer=0,refreshes=0;
 function element(tag='div',attrs={}){
  let html='',text='';const node={tag,attrs,dataset:{},children:[],value:attrs.value||'',checked:'checked'in attrs,disabled:'disabled'in attrs,open:false,close(){this.open=false;},closest(){return this;},insertAdjacentHTML(_where,content){this.innerHTML=this.innerHTML+content;},
   querySelectorAll(selector){const out=[],walk=n=>{for(const child of n.children){if(selector.split(',').some(part=>part.startsWith('[')?Object.hasOwn(child.attrs,part.slice(1,-1)):child.tag===part))out.push(child);walk(child);}};walk(this);return out;},
   querySelector(selector){const name=selector.match(/name="([^"]+)"/)?.[1];return this.querySelectorAll('input').find(child=>child.attrs.name===name&&child.checked)||null;}
  };
  for(const [key,value]of Object.entries(attrs))if(key.startsWith('data-'))node.dataset[key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=value;
  Object.defineProperties(node,{innerHTML:{get:()=>html,set(value){html=String(value);text='';node.children=[];const stack=[node];for(const m of html.matchAll(/<(\/?)([a-z][\w-]*)\b([^>]*)>/gi)){if(m[1]){if(stack.at(-1).tag===m[2]&&stack.length>1)stack.pop();continue;}const properties={};for(const a of m[3].matchAll(/([\w-]+)(?:="([^"]*)")?/g))properties[a[1]]=decode(a[2]||'');const child=element(m[2],properties);stack.at(-1).children.push(child);if(properties.id)elements[properties.id]=child;if(!['input','br','hr','img'].includes(m[2]))stack.push(child);}}},textContent:{get:()=>text,set(value){text=String(value);html='';node.children=[];}}});return node;
 }
 elements.modal=element('dialog');
 const context=vm.createContext({setTimeout:fn=>{timers.set(++timer,fn);return timer;},clearTimeout:id=>timers.delete(id),document:{getElementById:id=>elements[id]||null},
  api:async(route,body)=>{calls.push({route,body:body?structuredClone(body):undefined});return context.respond(route,body);},
  getBots:()=>[{id:'bot',name:'Test',providerId,fallback}],refresh:async()=>{refreshes++;},
  modal(_title,_subtitle,body){for(const id of Object.keys(elements))if(id!=='modal')delete elements[id];elements.modal.open=true;elements.content=element();elements.content.innerHTML=body;elements['modal-error']=element();}
 });
 context.respond=async route=>route==='providers'?providers:route.startsWith('model-settings')?catalog:route.startsWith('routine-policy?')?{name:'Example',missedRunPolicy:'skip',retryLimit:0,retryDelayMinutes:1,notificationPolicy:'changes',nextExplanation:'Paused until you enable it.'}:{};
 const file=kind==='fallback'?'fallback-ui.mjs':'routine-policy-ui.mjs',factory=kind==='fallback'?'createFallbackUI':'createRoutinePolicyUI';
 vm.runInContext(fs.readFileSync(new URL(file,import.meta.url),'utf8').replace('export function ','function ')+`\nui=${factory}({api,modal,refresh,getBots});`,context);
 return {ui:context.ui,context,calls,get:id=>elements[id],refreshes:()=>refreshes,
  click:dataset=>elements['fallback-editor'].onclick({target:{closest:()=>({dataset})}}),
  async flush(){const pending=[...timers.values()];timers.clear();await Promise.all(pending.map(fn=>fn()));await new Promise(resolve=>setTimeout(resolve,0));},
  submit:()=>elements[kind==='fallback'?'fallback-form':'routine-policy-form'].onsubmit({preventDefault(){}})
 };
}
test('editing fallback only loads metadata and changing its order clears sharing approval',async()=>{
 const policy={enabled:true,contentSharingApproved:true,choices:[{providerId:'api',model:'one',reasoningEffort:''},{providerId:'codex',model:'two',reasoningEffort:''}]},h=harness('fallback',policy);
 await h.ui.edit('bot');await h.flush();assert.equal(h.get('fallback-sharing').checked,true);h.click({fallbackUp:'1'});await h.flush();
 assert.equal(h.get('fallback-sharing').checked,false);assert.equal(h.get('fallback-model-0').value,'two');assert.equal(policy.choices[0].model,'one');assert.equal(h.calls.some(c=>c.route==='fallback-save'),false);
});
test('fallback save freezes the selected plan and suppresses repeated submissions',async()=>{
 const h=harness(),gate=deferred();await h.ui.edit('bot');await h.flush();h.context.respond=route=>route==='fallback-save'?gate.promise:catalog;
 const saving=h.submit();await h.submit();assert.equal(h.calls.filter(c=>c.route==='fallback-save').length,1);assert.ok(h.get('fallback-editor').querySelectorAll('input,button').every(control=>control.disabled));
 gate.resolve({});await saving;assert.equal(h.get('modal').open,false);assert.equal(h.calls.at(-1).body.fallback.choices[0].model,'one');
});
test('fallback can be revoked even when model and provider discovery are unavailable',async()=>{
 const h=harness();h.context.respond=async route=>{if(route==='fallback-save')return {};throw Error('Connection unavailable');};await h.ui.edit('bot');assert.match(h.get('fallback-editor').innerHTML,/Turn off and clear/);
 h.click({fallbackDisable:''});await h.flush();const save=h.calls.find(c=>c.route==='fallback-save');assert.deepEqual(save.body.fallback,{enabled:false,contentSharingApproved:false,choices:[]});assert.equal(h.get('modal').open,false);
});
test('API bots are only offered API fallback connections',async()=>{
 const h=harness('fallback',undefined,'api');await h.ui.edit('bot');await h.flush();assert.doesNotMatch(h.get('fallback-editor').innerHTML,/data-fallback-provider="codex"/);
 h.click({fallbackAdd:''});await h.flush();assert.doesNotMatch(h.get('fallback-editor').innerHTML,/data-fallback-provider="codex"/);assert.match(h.calls.at(-1).route,/providerId=api/);
});
test('superseded fallback metadata cannot update a newer screen',async()=>{
 const h=harness(),gate=deferred();h.context.respond=()=>gate.promise;const opening=h.ui.edit('bot');h.context.modal('Other','','<div id="other">Keep this</div>');gate.resolve(providers);await opening;assert.equal(h.get('other').innerHTML,'');assert.equal(h.get('fallback-form'),undefined);
});
test('routine reliability save changes only policy and never enables a paused routine',async()=>{
 const h=harness('routine');await h.ui.edit('routine');assert.match(h.get('routine-policy-loading').innerHTML,/Paused/);await h.submit();const save=h.calls.find(c=>c.route==='routine-policy-save');assert.deepEqual(save.body,{routineId:'routine',missedRunPolicy:'skip',retryLimit:0,retryDelayMinutes:1,notificationPolicy:'changes'});assert.equal(Object.hasOwn(save.body,'enabled'),false);
});
test('routine reliability saves cannot double-submit or close a newer modal',async()=>{
 const h=harness('routine'),gate=deferred();await h.ui.edit('routine');h.context.respond=()=>gate.promise;const pending=h.submit();await h.submit();assert.equal(h.calls.filter(c=>c.route==='routine-policy-save').length,1);
 h.context.modal('Other','','<div id="other">Keep this</div>');gate.resolve({});await pending;assert.equal(h.get('modal').open,true);assert.ok(h.get('other'));
});
