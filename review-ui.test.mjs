import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=name=>fs.readFileSync(new URL(name,import.meta.url),'utf8').replace(/^import[^\n]+\n/gm,'').replace(/export /g,'');
const common=read('./review-ui-common.mjs'),modules={skills:read('./skills-ui.mjs'),learning:read('./learning-review-ui.mjs')};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const decode=value=>value.replace(/&(amp|lt|gt|quot|#39);/g,(_,name)=>({amp:'&',lt:'<',gt:'>',quot:'"','#39':"'"}[name]));
const skill={id:'skill',activeRevisionId:'revision',enabledBotIds:[],revisions:[{id:'revision',number:1,status:'accepted',title:'Research <safely>',whenToUse:'For summaries',steps:['Read sources'],examples:['Use official docs'],checklist:['Check facts'],source:{botId:'bot',taskId:'task',href:'https://untrusted.example'}}]};
const lesson={id:'lesson',botId:'bot',title:'Brief answers',kind:'preference',status:'pending',text:'Be concise',revision:1,source:{botId:'bot',taskId:'task'}};
function harness(kind){
 const elements={},handlers={},calls=[],modals=[],downloads=[],sources=[];let refreshes=0;
 function element(tag='div',attrs={}){
  let html='',text='';const node={tag,attrs,dataset:{},children:[],value:attrs.value||'',checked:'checked'in attrs,disabled:'disabled'in attrs,open:false,close(){this.open=false;},click(){downloads.push(this);},querySelectorAll(selector){const tags=selector.split(','),out=[];const walk=n=>{for(const child of n.children){if(tags.includes(child.tag))out.push(child);walk(child);}};walk(this);return out;}};
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
 const context=vm.createContext({URL,Blob,WeakSet,Date,setTimeout:()=>1,document:{getElementById:id=>elements[id]||null,addEventListener:(type,handler)=>{(handlers[type]??=[]).push(handler);},createElement:tag=>element(tag)},api:async(route,body)=>{calls.push({route,body:body?JSON.parse(JSON.stringify(body)):undefined});return context.respond(route,body);},refresh:async()=>{refreshes++;},getBots:()=>[{id:'bot',name:'<Owner>'}],onSource:source=>sources.push(source),onAppChange:item=>context.changeApp(item),modal(title,subtitle,body,type){modals.push({title,subtitle,type});for(const id of Object.keys(elements))if(id!=='modal')delete elements[id];elements.modal.open=true;elements.modal.dataset.kind=type;elements['modal-content']=element();elements['modal-content'].innerHTML=body;elements['modal-error']=element();}});
 context.respond=async route=>route==='skills'?[structuredClone(skill)]:route.startsWith('skill-get?')?structuredClone(skill):route==='learning'||route.startsWith('learning-history?')?[structuredClone(lesson)]:route==='learning-policy'?{botNotes:'review',teamNotes:'automatic'}:route.startsWith('learning-memory?')?{text:'Saved notes'}:{};
 context.changeApp=async()=>{};
 vm.runInContext(common+'\nconst esc=escapeReview;\n'+modules[kind]+'\nui='+(kind==='skills'?'createSkillsUI':'createLearningReviewUI')+'({api,modal,refresh,getBots,onSource,onAppChange});',context);
 return {ui:context.ui,context,calls,modals,downloads,sources,get:id=>elements[id],refreshes:()=>refreshes,
  click:dataset=>Promise.all((handlers.click||[]).map(handler=>handler({target:{closest:()=>({dataset})}}))),
  change:target=>Promise.all((handlers.change||[]).map(handler=>handler({target}))),
  submit:id=>elements[id].onsubmit({preventDefault(){}}),
  replace(){context.modal('New screen','','<div>New content</div>','new');}
 };
}

test('skills render escaped instructions and only generated source links',async()=>{
 const h=harness('skills');await h.ui.detail('skill');const html=h.get('skill-detail').innerHTML;
 assert.match(html,/Research &lt;safely&gt;/);assert.match(html,/&lt;Owner&gt;/);assert.doesNotMatch(html,/untrusted\.example|<Owner>/);assert.match(html,/\/\?bot=bot&amp;task=task/);assert.match(html,/data-sk-enable/);
});
test('skill lists ignore stale success and failure after a newer dialog opens',async()=>{
 for(const failed of [false,true]){const h=harness('skills'),gate=deferred();h.context.respond=()=>gate.promise;const pending=h.ui.open();h.replace();h.get('modal-error').textContent='New status';failed?gate.reject(Error('Old error')):gate.resolve([skill]);await pending;assert.equal(h.get('modal').dataset.kind,'new');assert.equal(h.get('modal-error').textContent,'New status');}
});
test('skill draft save is frozen, single-flight and preserves edits after failure',async()=>{
 const h=harness('skills'),gate=deferred();await h.click({skNew:''});h.get('sk-title').value='My procedure';h.get('sk-when').value='For reports';h.get('sk-steps').value='Read\nVerify';h.context.respond=()=>gate.promise;
 const pending=h.submit('skill-edit-form');assert.ok(h.get('skill-edit-form').querySelectorAll('button,input,textarea').every(control=>control.disabled));await h.submit('skill-edit-form');assert.equal(h.calls.length,1);assert.deepEqual(h.calls[0].body.steps,['Read','Verify']);gate.reject(Error('Save unavailable'));await pending;assert.equal(h.get('sk-title').value,'My procedure');assert.match(h.get('modal-error').textContent,/unavailable/);assert.ok(h.get('skill-edit-form').querySelectorAll('button,input,textarea').every(control=>!control.disabled));
});
test('skill import waits for the chosen file and ignores its completion after navigation',async()=>{
 const h=harness('skills'),gate=deferred();await h.click({skImport:''});h.get('sk-document').value='old document';const loading=h.get('sk-file').onchange({target:{files:[{size:100,text:()=>gate.promise}]}});await h.submit('skill-import-form');assert.equal(h.calls.length,0);assert.equal(h.get('sk-document').disabled,true);h.replace();gate.resolve('new document');await loading;assert.equal(h.get('modal').dataset.kind,'new');assert.equal(h.calls.length,0);
});
test('skill acceptance blocks a conflicting decline and does not reopen a stale screen',async()=>{
 const h=harness('skills'),gate=deferred();await h.ui.detail('skill');h.context.respond=()=>gate.promise;const pending=h.click({skAccept:'skill',skRevision:'draft'});await h.click({skReject:'skill',skRevision:'draft'});assert.equal(h.calls.filter(call=>call.route==='skill-accept'||call.route==='skill-reject').length,1);h.replace();gate.resolve(skill);await pending;assert.equal(h.get('modal').dataset.kind,'new');
});
test('a failed skill enable restores the checkbox and shows a scoped error',async()=>{
 const h=harness('skills');await h.ui.detail('skill');const checkbox=h.get('skill-detail').querySelectorAll('input')[0];checkbox.checked=true;h.context.respond=async()=>{throw Error('Could not enable');};await h.change(checkbox);assert.equal(checkbox.checked,false);assert.match(h.get('modal-error').textContent,/Could not enable/);
});
test('use now queues one skill task without enabling it and opens its task',async()=>{
 const h=harness('skills');await h.ui.detail('skill');await h.click({skUse:'skill'});h.get('sk-task').value='Summarize this document';h.context.respond=()=>({task:{id:'task'}});await h.submit('skill-use-form');assert.equal(h.calls.at(-1).route,'skill-use');assert.equal(h.calls.some(call=>call.route==='skill-enable'),false);assert.deepEqual(h.sources,['/?bot=bot&task=task']);assert.equal(h.get('modal').open,false);
});
test('learning preserves newest-first order, escapes notes and explains paused routines',async()=>{
 const h=harness('learning');h.context.respond=()=>[{...lesson,id:'new',kind:'workflow',title:'Newest workflow',text:'<script>bad</script>'},{...lesson,id:'old',title:'Older preference'}];await h.ui.open();const html=h.get('learning-review').innerHTML;assert.ok(html.indexOf('Newest workflow')<html.indexOf('Older preference'));assert.match(html,/Save paused routine/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);
});
test('learning acceptance is single-flight and respects later navigation',async()=>{
 const h=harness('learning'),gate=deferred();await h.ui.open();h.context.respond=()=>gate.promise;const pending=h.click({lrAccept:'lesson'});await h.click({lrReject:'lesson'});assert.equal(h.calls.filter(call=>call.route.startsWith('learning-')).length,1);h.replace();gate.resolve(lesson);await pending;assert.equal(h.get('modal').dataset.kind,'new');
});
test('learning load and history replies never replace newer screens',async()=>{
 for(const screen of ['open','history'])for(const failed of [false,true]){const h=harness('learning'),gate=deferred();h.context.respond=()=>gate.promise;const pending=h.ui[screen]('lesson');h.replace();failed?gate.reject(Error('Old error')):gate.resolve([lesson]);await pending;assert.equal(h.get('modal').dataset.kind,'new');assert.equal(h.get('modal-error').textContent,'');}
});
test('memory settings preserve separate scopes and submit only explicit policy choices',async()=>{
 const h=harness('learning');await h.click({lrPolicy:''});assert.equal(h.get('lr-bot-policy').value,'review');assert.equal(h.get('lr-team-policy').value,'automatic');assert.match(h.get('learning-policy').innerHTML,/Crew’s memory tool/);h.get('lr-bot-policy').value='automatic';h.get('lr-team-policy').value='review';h.context.respond=route=>route==='learning'?[]:{};await h.submit('learning-policy-form');assert.deepEqual(h.calls.find(call=>call.body).body,{botNotes:'automatic',teamNotes:'review'});
});
test('manual memory edits preserve exact text and an empty revision on failed and successful saves',async()=>{
 const h=harness('learning');await h.ui.notes('bot','bot');assert.equal(h.modals.at(-1).title,'&lt;Owner&gt; notes');assert.equal(h.get('lr-notes-text').value,'Saved notes');h.get('lr-notes-text').value='  revised\n';h.context.respond=async()=>{throw Error('Disk unavailable');};await h.submit('learning-notes-form');assert.equal(h.get('lr-notes-text').value,'  revised\n');assert.equal(h.get('lr-notes-text').disabled,false);h.get('lr-notes-text').value='';h.context.respond=route=>route==='learning-memory-save'?{id:'saved'}:[];await h.submit('learning-notes-form');assert.deepEqual(h.calls.filter(call=>call.route==='learning-memory-save').at(-1).body,{botId:'bot',scope:'bot',text:''});assert.equal(h.get('modal').dataset.kind,'learning-history');
});
test('preference revisions remain review drafts and history exposes undo for accepted notes',async()=>{
 const h=harness('learning');await h.ui.open();await h.click({lrEdit:'lesson'});h.get('lr-text').value='Be concise and cite sources';h.context.respond=route=>route==='learning-revise'?{id:'next'}:[{...lesson,id:'next',text:'Be concise and cite sources',status:'accepted'}];await h.submit('learning-edit-form');assert.equal(h.calls.some(call=>call.route==='learning-accept'),false);assert.match(h.get('learning-review').innerHTML,/data-lr-undo="next"/);assert.equal(h.calls.find(call=>call.route==='learning-revise').body.text,'Be concise and cite sources');
});
test('app change review delegates to the separate review flow without accepting code',async()=>{
 const h=harness('learning');let reviewed;h.context.respond=()=>[{...lesson,kind:'app-change'}];h.context.changeApp=async item=>{reviewed=item;h.replace();};await h.ui.open();await h.click({lrApp:'lesson'});assert.equal(reviewed.id,'lesson');assert.equal(h.calls.some(call=>call.route==='learning-accept'),false);assert.equal(h.get('modal').dataset.kind,'new');
});
