import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=name=>fs.readFileSync(new URL(name,import.meta.url),'utf8').replace(/^import[^\n]+\n/gm,'').replace(/export /g,'');
const common=read('./review-ui-common.mjs'),modules={plugins:read('./plugins-ui.mjs')};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const decode=value=>value.replace(/&(amp|lt|gt|quot|#39);/g,(_,name)=>({amp:'&',lt:'<',gt:'>',quot:'"','#39':"'"}[name]));
function harness(kind){
 const elements={},handlers={},calls=[],modals=[],downloads=[],sources=[];let refreshes=0;
 function element(tag='div',attrs={}){
  let html='',text='';const node={tag,attrs,dataset:{},children:[],value:attrs.value||'',checked:'checked'in attrs,disabled:'disabled'in attrs,open:false,close(){this.open=false;},click(){downloads.push(this);},querySelectorAll(selector){const tags=selector.split(','),out=[];const walk=n=>{for(const child of n.children){if(tags.some(s=>s.startsWith('[')?Object.hasOwn(child.attrs,s.slice(1,-1)):s===child.tag))out.push(child);walk(child);}};walk(this);return out;}};
  for(const [name,value] of Object.entries(attrs))if(name.startsWith('data-'))node.dataset[name.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=value;
  Object.defineProperties(node,{innerHTML:{get:()=>html,set(value){html=String(value);node.children=[];const stack=[node];
   for(const match of html.matchAll(/<(\/?)([a-z][\w-]*)\b([^>]*)>/gi)){
    if(match[1]){if(stack.length>1&&stack.at(-1).tag===match[2])stack.pop();continue;}
    const attributes={};for(const a of match[3].matchAll(/([\w-]+)(?:="([^"]*)")?/g))attributes[a[1]]=decode(a[2]||'');
    const child=element(match[2],attributes);stack.at(-1).children.push(child);if(attributes.id)elements[attributes.id]=child;if(!['input','br','img','hr','meta','link'].includes(child.tag))stack.push(child);
   }
   for(const match of html.matchAll(/<textarea[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/textarea>/g))elements[match[1]].value=decode(match[2]);
   for(const select of node.querySelectorAll('select')){const options=select.children.filter(child=>child.tag==='option');select.value=(options.find(child=>'selected'in child.attrs)||options[0])?.value||'';}
  }},textContent:{get:()=>text,set(value){text=String(value);html='';node.children=[];}}});return node;
 }
 elements.modal=element('dialog');
 const context=vm.createContext({window:{CREW_MOBILE:false},URL,Blob,WeakSet,Date,setTimeout:()=>1,document:{getElementById:id=>elements[id]||null,addEventListener:(type,handler)=>{(handlers[type]??=[]).push(handler);},createElement:tag=>element(tag)},api:async(route,body)=>{calls.push({route,body:body?JSON.parse(JSON.stringify(body)):undefined});return context.respond(route,body);},refresh:async()=>{refreshes++;},getBots:()=>[{id:'bot',name:'<Owner>'}],onSource:source=>sources.push(source),onAppChange:item=>context.changeApp(item),modal(title,subtitle,body,type){modals.push({title,subtitle,type});for(const id of Object.keys(elements))if(id!=='modal')delete elements[id];elements.modal.open=true;elements.modal.dataset.kind=type;elements['modal-content']=element();elements['modal-content'].innerHTML=body;elements['modal-error']=element();}});
 context.respond=async route=>route==='plugins'||route==='plugin-packages'?[]:{};
 context.changeApp=async()=>{};
 vm.runInContext(common+'\nconst esc=escapeReview;\n'+modules[kind]+'\nui='+'createPluginsUI'+'({api,modal,refresh,getBots,onSource,onAppChange});',context);
 return {ui:context.ui,context,calls,modals,downloads,sources,get:id=>elements[id],refreshes:()=>refreshes,
  click:dataset=>Promise.all((handlers.click||[]).map(handler=>handler({target:{closest:()=>({dataset})}}))),
  change:target=>Promise.all((handlers.change||[]).map(handler=>handler({target}))),
  submit:id=>elements[id].onsubmit({preventDefault(){}}),
  replace(){context.modal('New screen','','<div>New content</div>','new');}
 };
}

test('phone plugin screen makes no management requests',async()=>{
 const h=harness('plugins');h.context.window.CREW_MOBILE=true;await h.ui.open();assert.equal(h.calls.length,0);assert.match(h.get('modal-content').innerHTML,/computer running Folklet/);
});
test('plugin list ignores replies after another view has opened',async()=>{
 const h=harness('plugins'),gate=deferred();h.context.respond=()=>gate.promise;const pending=h.ui.open();h.replace();gate.resolve([]);await pending;assert.equal(h.get('modal').dataset.kind,'new');
});
test('local server start requires trust and separately sends package-install consent',async()=>{
 const h=harness('plugins');await h.ui.edit(null,'local');h.get('plugin-name').value='Fixture';h.get('plugin-command').value='npx';
 await h.submit('plugin-form');assert.equal(h.calls.length,0);assert.match(h.get('modal-error').textContent,/trust box/);
 h.get('plugin-trust').checked=true;h.get('plugin-install-consent').checked=false;
 h.context.respond=async(route,body)=>{if(route==='plugin-save')return {id:'saved'};if(route==='plugins')return [{id:'saved',name:'Fixture',type:'mcp',transport:'stdio',command:'npx',args:[],tools:[],allowedTools:[],botIds:[]}];return {};};
 await h.submit('plugin-form');assert.equal(h.calls.find(c=>c.route==='plugin-save').body.allowPackageInstall,false);assert.equal(h.calls.find(c=>c.route==='plugin-connect').body.confirmed,true);
});
test('failed connection save preserves input and prevents connecting',async()=>{
 const h=harness('plugins'),gate=deferred();await h.ui.edit(null,'remote');h.get('plugin-name').value='Fixture';h.get('plugin-url').value='https://example.com/mcp';h.get('plugin-trust').checked=true;h.context.respond=()=>gate.promise;
 const pending=h.submit('plugin-form');await h.submit('plugin-form');assert.equal(h.calls.length,1);gate.reject(Error('Storage unavailable'));await pending;assert.match(h.get('modal-error').textContent,/Storage unavailable/);assert.equal(h.get('plugin-url').value,'https://example.com/mcp');assert.equal(h.calls.some(c=>c.route==='plugin-connect'),false);
});
test('package inspection renders escaped compatibility notes without executing or importing',()=>{
 const h=harness('plugins');h.ui.reviewPackage({id:'p',name:'<script>bad</script>',format:'portable',files:['plugin.json'],skills:[],connections:[],unsupported:['<img src=x onerror=alert(1)>'],reviewHash:'hash'});
 assert.equal(h.calls.length,0);assert.equal(h.get('plugin-install').disabled,true);assert.match(h.get('modal-content').innerHTML,/&lt;img/);assert.doesNotMatch(h.get('modal-content').innerHTML,/<img/);
});
test('package install submits the exact reviewed revision once',async()=>{
 const h=harness('plugins'),gate=deferred();h.ui.reviewPackage({id:'p',name:'Fixture',format:'portable',files:['plugin.json'],skills:[{name:'Read'}],connections:[],unsupported:[],reviewHash:'reviewed-hash'});h.context.respond=()=>gate.promise;
 const pending=h.get('plugin-install').onclick();await h.get('plugin-install').onclick();assert.equal(h.calls.length,1);assert.deepEqual(h.calls[0],{route:'plugin-install',body:{id:'p',reviewHash:'reviewed-hash',confirmed:true}});h.replace();gate.resolve({id:'p'});await pending;assert.equal(h.get('modal').dataset.kind,'new');
});

test('package file review binds the hash, escapes source and ignores a stale preview',async()=>{
 const h=harness('plugins'),review={id:'p',name:'Fixture',format:'portable',files:['SKILL.md'],skills:[{name:'Read'}],connections:[],unsupported:[],reviewHash:'hash'};
 h.ui.reviewPackage(review);h.context.respond=async()=>({path:'SKILL.md',text:'<script>execute()</script>',bytes:26,truncated:false,binary:false});
 await h.click({pluginFile:'SKILL.md'});assert.deepEqual(h.calls[0],{route:'plugin-file',body:{id:'p',path:'SKILL.md',reviewHash:'hash'}});assert.match(h.get('plugin-file-content').innerHTML,/&lt;script&gt;/);assert.doesNotMatch(h.get('plugin-file-content').innerHTML,/<script>/);
 await h.click({pluginReviewBack:''});assert.equal(h.get('modal').dataset.kind,'plugin-review');
 const gate=deferred();h.context.respond=()=>gate.promise;const pending=h.click({pluginFile:'SKILL.md'});h.replace();gate.resolve({bytes:5,text:'Late'});await pending;assert.equal(h.get('modal').dataset.kind,'new');
});

test('installed package review cannot reinstall and binary previews are identified',async()=>{
 const h=harness('plugins');h.ui.reviewPackage({id:'p',name:'Fixture',format:'portable',status:'installed',files:['data.bin'],skills:[{name:'Read'}],connections:[],unsupported:[],reviewHash:'hash'});
 assert.equal(h.get('plugin-install').disabled,true);await h.get('plugin-install').onclick();assert.equal(h.calls.length,0);
 h.context.respond=async()=>({path:'data.bin',text:'',bytes:10,truncated:false,binary:true});await h.click({pluginFile:'data.bin'});assert.match(h.get('plugin-file-content').innerHTML,/Binary file/);
});
