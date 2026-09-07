import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const decode=value=>value.replace(/&(amp|lt|gt|quot|#39);/g,(_,key)=>({amp:'&',lt:'<',gt:'>',quot:'"','#39':"'"}[key]));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function harness(kind){
 const elements={},handlers={},calls=[];
 function element(tag='div',attrs={}){
  let html='',text='';const node={tag,attrs,children:[],dataset:{},value:attrs.value||'',checked:'checked' in attrs,disabled:'disabled' in attrs,open:false,close(){this.open=false;},querySelectorAll(selector){const names=selector.split(','),result=[];const visit=parent=>{for(const child of parent.children){if(names.includes(child.tag)||/^\[data-[\w-]+\]$/.test(selector)&&Object.hasOwn(child.attrs,selector.slice(1,-1)))result.push(child);visit(child);}};visit(this);return result;}};
  Object.defineProperties(node,{innerHTML:{get:()=>html,set(value){html=String(value);node.children=[];const stack=[node];for(const match of html.matchAll(/<(\/?)([a-z][\w-]*)\b([^>]*)>/gi)){if(match[1]){if(stack.at(-1).tag===match[2])stack.pop();continue;}const attributes={};for(const attr of match[3].matchAll(/([\w-]+)(?:="([^"]*)")?/g))attributes[attr[1]]=decode(attr[2]||'');const child=element(match[2],attributes);stack.at(-1).children.push(child);if(attributes.id)elements[attributes.id]=child;if(!['input','br','img','hr'].includes(child.tag))stack.push(child);}}},textContent:{get:()=>text,set(value){text=String(value);html='';node.children=[];}}});return node;
 }
 elements.modal=element('dialog');const context=vm.createContext({window:{CREW_MOBILE:false},URL,WeakSet,document:{getElementById:id=>elements[id]||null,addEventListener:(type,handler)=>{handlers[type]=handler;}},getBots:()=>[{id:'bot',name:'A <b> & B'}],api:async(route,body)=>{calls.push({route,body:body?JSON.parse(JSON.stringify(body)):undefined});return context.respond(route,body);},modal(title,subtitle,body,type){for(const id of Object.keys(elements))if(id!=='modal')delete elements[id];elements.modal.open=true;elements.modal.dataset.kind=type;elements['modal-content']=element();elements['modal-content'].innerHTML=body;elements['modal-error']=element();}});
 const state={enabled:false,hasToken:true,tokenStorage:'session',baseUrl:'',quietHours:{enabled:false,start:'22:00',end:'08:00',timeZone:'UTC'},recipient:null,pairing:null};context.respond=async route=>route==='integrations'?[]:route==='notification-status'?state:{};
 const factory=kind==='integrations'?'createIntegrationsUI':kind==='app-changes'?'createAppChangesUI':'createNotificationsUI',source=fs.readFileSync(new URL('./'+kind+'-ui.mjs',import.meta.url),'utf8').replace('export function ','function ');vm.runInContext(source+'\nui='+factory+'({api,modal,getBots});',context);
 return {ui:context.ui,context,calls,state,get:id=>elements[id],click:dataset=>handlers.click({target:{closest:()=>({dataset})}}),submit:id=>elements[id].onsubmit({preventDefault(){}})};
}
test('integration editor shows permissions and escapes bot names while preserving selected access on save',async()=>{
 const h=harness('integrations');await h.ui.edit();assert.match(h.get('integration-editor').innerHTML,/A &lt;b&gt; &amp; B/);h.get('integration-repo').value='example/project';h.get('integration-token').value='fixture-token';h.get('integration-form').querySelectorAll('[data-integration-bot]')[0].checked=true;
 await h.submit('integration-form');const saved=h.calls.find(call=>call.route==='integration-save').body;assert.deepEqual(saved.botIds,['bot']);assert.equal(saved.persistToken,false);assert.equal(saved.token,'fixture-token');assert.equal(h.get('modal').dataset.kind,'integrations');
});
test('integration save prevents duplicate writes and retains the draft on failure',async()=>{
 const h=harness('integrations'),gate=deferred();await h.ui.edit();h.get('integration-repo').value='example/project';h.get('integration-token').value='fixture-token';h.context.respond=()=>gate.promise;const pending=h.submit('integration-form');await h.submit('integration-form');assert.equal(h.calls.length,1);gate.reject(Error('Could not save'));await pending;assert.equal(h.get('integration-token').value,'fixture-token');assert.equal(h.get('integration-repo').value,'example/project');assert.ok(h.get('integration-form').querySelectorAll('button,input').every(control=>!control.disabled));
});
test('GitHub form defaults preserve optional credentials, no implicit bot access, and long repository names',async()=>{
 const h=harness('integrations');await h.ui.edit();h.get('integration-repo').value='owner/'+('repository'.repeat(10));await h.submit('integration-form');const body=h.calls.find(call=>call.route==='integration-save').body;assert.equal(body.name,undefined);assert.equal(body.token,undefined);assert.equal(body.persistToken,false);assert.equal(body.enabled,true);assert.deepEqual(body.botIds,[]);
});
test('external settings ignore late responses after their dialog is closed',async()=>{
 for(const kind of ['integrations','notifications']){const h=harness(kind),gate=deferred();h.context.respond=()=>gate.promise;const pending=h.ui.open();h.get('modal').close();gate.resolve(kind==='integrations'?[]:h.state);await pending;assert.equal(h.get('modal').open,false);}
});
test('phone settings expose no integration or notification administration controls',async()=>{
 for(const kind of ['integrations','notifications']){const h=harness(kind);h.context.window.CREW_MOBILE=true;await h.ui.open();assert.equal(h.calls.length,0);assert.match(h.get('modal-content').innerHTML,/host computer/);assert.doesNotMatch(h.get('modal-content').innerHTML,/<input/);}
});
test('Telegram pairing previews the recipient and requires a separate activation action',async()=>{
 const h=harness('notifications');await h.ui.open();h.context.respond=async route=>route==='notification-pair'?{pairingId:'pair',message:'/start crew_fixture',url:'https://t.me/CrewFixtureBot?start=crew_fixture'}:route==='notification-check'?{pairingId:'pair',preview:{id:'1234',name:'A <b> & B',username:'fixture'}}:h.state;
 await h.click({telegramPair:''});assert.equal(h.calls.some(call=>call.route==='notification-activate'),false);await h.click({telegramCheck:''});assert.match(h.get('modal-content').innerHTML,/A &lt;b&gt; &amp; B/);assert.match(h.get('modal-content').innerHTML,/Telegram user ID: 1234/);assert.equal(h.calls.some(call=>call.route==='notification-activate'),false);
 await h.click({telegramActivate:'pair',telegramRecipient:'1234'});assert.deepEqual(h.calls.find(call=>call.route==='notification-activate').body,{pairingId:'pair',recipientId:'1234'});
});
test('Telegram configuration preserves a failed draft and does not send messages',async()=>{
 const h=harness('notifications');await h.ui.open();h.get('telegram-token').value='fixture-token';h.context.respond=async()=>{throw Error('Temporary error');};await h.submit('telegram-form');assert.equal(h.get('telegram-token').value,'fixture-token');assert.match(h.get('modal-error').textContent,/Temporary/);assert.deepEqual(h.calls.map(call=>call.route),['notification-status','notification-configure']);
});
test('a late Telegram pairing reply cannot reopen a closed settings panel',async()=>{
 const h=harness('notifications'),gate=deferred();await h.ui.open();h.context.respond=()=>gate.promise;const pending=h.click({telegramPair:''});h.get('modal').close();gate.resolve({message:'fixture',url:'https://t.me/CrewFixtureBot'});await pending;assert.equal(h.get('modal').open,false);
});
const appDraft=()=>({id:'draft',title:'Improve buttons',status:'draft',reviewHash:'reviewed-hash',checks:{passed:true,reviewHash:'reviewed-hash',results:[]},tests:{passed:true,reviewHash:'reviewed-hash',testFiles:['app.test.mjs'],output:'Passed'},files:['app.mjs'],testFiles:['app.test.mjs'],changes:[{path:'app.mjs',before:'Original <b>source</b>',after:'Proposed <b>source</b>'}]});
test('app draft review escapes source text and keeps test choices compact',async()=>{
 const h=harness('app-changes');h.context.respond=()=>appDraft();await h.ui.edit('draft');const html=h.get('app-draft-review').innerHTML;assert.match(html,/Original &lt;b&gt;source&lt;\/b&gt;/);assert.doesNotMatch(html,/Original <b>/);assert.match(html,/<details><summary>Choose tests/);assert.match(html,/not a security sandbox/);assert.match(html,/Network and local services remain reachable/);
});
test('app draft tests and application each require their own explicit confirmation and bind the reviewed hash',async()=>{
 const h=harness('app-changes');h.context.respond=()=>appDraft();await h.ui.edit('draft');await h.click({appTests:''});assert.equal(h.calls.some(call=>call.route==='app-change-tests'),false);await h.click({appApply:''});assert.equal(h.calls.some(call=>call.route==='app-change-apply'),false);
 h.get('approve-draft-tests').checked=true;await h.click({appTests:''});assert.deepEqual(h.calls.find(call=>call.route==='app-change-tests').body,{id:'draft',reviewHash:'reviewed-hash',testFiles:['app.test.mjs'],confirmed:true});
 assert.equal(h.get('approve-draft-apply').checked,false);h.get('approve-draft-apply').checked=true;await h.click({appApply:''});assert.deepEqual(h.calls.find(call=>call.route==='app-change-apply').body,{id:'draft',reviewHash:'reviewed-hash',confirmed:true});
});
test('app-change administration stays on the host and late review results do not reopen closed dialogs',async()=>{
 const h=harness('app-changes');h.context.window.CREW_MOBILE=true;await h.ui.open();assert.equal(h.calls.length,0);assert.match(h.get('modal-content').innerHTML,/host computer/);h.context.window.CREW_MOBILE=false;const gate=deferred();h.context.respond=()=>gate.promise;const pending=h.ui.edit('draft');h.get('modal').close();gate.resolve(appDraft());await pending;assert.equal(h.get('modal').open,false);
});
test('retrying an applied draft review saves only its Learning record and removes the warning',async()=>{
 const h=harness('app-changes'),draft={...appDraft(),status:'applied',proposalId:'proposal',reviewWarning:'The app is applied; its review record needs attention.'};
 h.context.respond=route=>{if(route==='learning-accept'){draft.reviewWarning='';return {status:'reviewed'};}return draft;};await h.ui.edit('draft');assert.match(h.get('app-draft-review').innerHTML,/Retry saving review record/);await h.click({appReviewRetry:''});
 assert.deepEqual(h.calls.filter(call=>call.body),[{route:'learning-accept',body:{id:'proposal'}}]);assert.equal(h.calls.some(call=>call.route==='app-change-apply'),false);assert.doesNotMatch(h.get('app-draft-review').innerHTML,/Retry saving review record|review record needs attention/);
});
