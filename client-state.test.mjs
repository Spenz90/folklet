import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Exercise the app's async state handlers with a small DOM adapter. No account,
// production server, user data, browser profile, or model request is involved.
const source=fs.readFileSync(new URL('./app.js',import.meta.url),'utf8').replace(/^import[^\n]+\n/gm,'');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function harness(){
 const elements={};
 const element=()=>({value:'',dataset:{},style:{},classList:{add(){},remove(){},toggle(){}},open:false,innerHTML:'',textContent:'',disabled:false,dispatchEvent(){},click(){},close(){this.open=false;},showModal(){this.open=true;}});
 const get=id=>elements[id]??=(element());
 get('modal');
 const calls=[],context=vm.createContext({elements,element,calls,md:x=>x,createAppChangesUI:()=>({open(){}}),createSettingsUI:()=>({welcome(){},botConnection(id){calls.push({modelBot:id});}}),console,Event,URL,URLSearchParams,location:{href:'http://127.0.0.1:4318/',origin:'http://127.0.0.1:4318'},requestAnimationFrame:()=>{},
  document:{getElementById:get,addEventListener(){},documentElement:{dataset:{}},visibilityState:'hidden'},
  window:{matchMedia:()=>({matches:false,addEventListener(){}}),addEventListener(){},innerWidth:800},
  history:{state:{},replaceState(){},pushState(){},back(){}},localStorage:{getItem:()=>null,setItem(){}},
  fetch:()=>new Promise(()=>{}),setInterval:()=>1,clearInterval(){},setTimeout:()=>1,clearTimeout(){},
  FileReader:class{readAsDataURL(){this.result='data:application/octet-stream;base64,dGVzdA==';queueMicrotask(()=>this.onload());}}
 });
 vm.runInContext(source,context);
 vm.runInContext('const realRefresh=refresh;',context);
 const run=code=>vm.runInContext(code,context);
 run("data={bots:[{id:'a',name:'A',cwd:'C:/crew/a'},{id:'b',name:'B',cwd:'C:/crew/b'}],channels:[{id:'group',members:['a','b']}]};selected='a';channel='group';refresh=async()=>{};screen=async()=>{};toast=s=>calls.push({toast:s});");
 return {context,run,elements,get,calls,element};
}

test('conversation source links validate origin, ownership and channel membership before navigating',()=>{
 const h=harness();h.run("data={bots:[{id:'a',name:'A',messages:[{id:'dm',taskId:'own',role:'assistant',text:'Saved answer'},{id:'shared',taskId:'team-task',channelId:'team',role:'assistant',text:'Shared answer'}]},{id:'b',name:'B',messages:[]}],tasks:[{id:'other-task',botId:'b'}],channels:[{id:'team',members:['a']}]};navigate=(view,id)=>calls.push({view,id});");
 for(const source of ['https://example.com/?bot=a','/?bot=missing','/?bot=a&message=missing','/?bot=a&task=other-task'])h.run('openSource('+JSON.stringify(source)+')');
 assert.equal(h.calls.filter(c=>c.view).length,0);assert.equal(h.calls.filter(c=>c.toast).length,4);
 h.run("openSource('/?bot=a&message=shared')");assert.deepEqual(JSON.parse(JSON.stringify(h.calls.at(-1))),{view:'channel',id:'team'});
 h.run("data.channels[0].members=[];openSource('/?bot=a&message=shared')");assert.match(h.calls.at(-1).toast,/channel is no longer available/);
 h.run("openSource('/?bot=a&message=dm')");assert.deepEqual(JSON.parse(JSON.stringify(h.calls.at(-1))),{view:'bot',id:'a'});
});

test('refresh after an action waits for a new snapshot when an earlier poll is still in flight',async()=>{
 const h=harness(),first=deferred(),next=deferred();let reads=0;
 h.context.refreshRead=()=>++reads===1?first.promise:next.promise;
 h.run('refresh=realRefresh;refreshPromise=null;refreshFollowup=null;refreshOnce=refreshRead;');
 const polling=h.run('refresh()'),afterAction=h.run('refresh()'),alsoWaiting=h.run('refresh()');assert.equal(afterAction,alsoWaiting);assert.equal(reads,1);
 first.resolve();await polling;await Promise.resolve();assert.equal(reads,2,'A poll begun before enqueue cannot satisfy the action refresh');
 let resolved=false;afterAction.then(()=>{resolved=true;});await Promise.resolve();assert.equal(resolved,false);next.resolve();await afterAction;assert.equal(resolved,true);assert.equal(reads,2);
});

test('send follows attachment owners when a group chooses a different recipient',async()=>{
 const {run,get,calls}=harness();get('prompt').value='Read this';
 run("selected='b';attachments=[{owner:'a',path:'attachments/report.txt'}];api=async(route,body)=>{calls.push({route,body});return {};};");
 await run('send({preventDefault(){}})');
 assert.equal(calls[0].body.id,'b');assert.equal(calls[0].body.attachments[0].owner,'a');assert.equal(calls[0].body.attachments[0].path,'attachments/report.txt');assert.equal(calls[0].body.text,'Read this');
});

test('removing an attachment changes only that draft and sends the remaining files',async()=>{
 const {run,get,calls}=harness();get('prompt').value='Read the remaining file';
 run("attachments=[{owner:'a',path:'attachments/1750000000000-first.txt'},{owner:'a',path:'attachments/1750000000001-second.txt'}];draftAttachments.b=[{owner:'b',path:'attachments/other.txt'}];api=async(route,body)=>{calls.push({route,body});return {};};removeAttachment(0);");
 assert.equal(run('attachments.length'),1);assert.equal(run('draftAttachments.group.length'),1);assert.equal(run('draftAttachments.b.length'),1);assert.equal(calls.length,0);
 assert.equal(run('attachmentLabel(attachments[0])'),'second.txt');
 await run('send({preventDefault(){}})');assert.equal(calls[0].route,'send');assert.equal(calls[0].body.attachments.length,1);assert.match(calls[0].body.attachments[0].path,/second\.txt$/);
});

test('an attachment already being submitted cannot be removed while its request is pending',async()=>{
 const {run,get,context}=harness(),gate=deferred();context.gate=gate;get('prompt').value='Read my file';
 run("attachments=[{owner:'a',path:'attachments/first.txt'}];api=async()=>gate.promise;");const pending=run('send({preventDefault(){}})');
 run('removeAttachment(0)');assert.equal(run('attachments.length'),1);gate.reject(Error('Disconnected'));await pending;
 run('removeAttachment(0)');assert.equal(run('attachments.length'),0);
});

test('navigating away and back during a send cannot submit the draft twice',async()=>{
 const {context,run,get,calls,elements,element}=harness(),gate=deferred();context.gate=gate;get('prompt').value='Only once';
 run("api=async(route,body)=>{calls.push({route,body});return gate.promise;};saveDraft();");
 const pending=run('send({preventDefault(){}})');
 elements.prompt=element();elements.prompt.value='Only once';
 await run('send({preventDefault(){}})');assert.equal(calls.length,1);
 gate.resolve({});await pending;assert.equal(get('prompt').value,'');assert.equal(get('send').disabled,false);
});

test('send completion retains text and attachments added while the request was pending',async()=>{
 const {context,run,get}=harness(),gate=deferred();context.gate=gate;get('prompt').value='First message';
 run("attachments=[{owner:'a',path:'attachments/first.txt'}];api=async()=>gate.promise;");
 const pending=run('send({preventDefault(){}})');get('prompt').value='Next message';
 run("attachments.push({owner:'a',path:'attachments/next.txt'});");gate.resolve({});await pending;
 assert.equal(get('prompt').value,'Next message');assert.equal(run('attachments.length'),1);assert.equal(run('attachments[0].path'),'attachments/next.txt');
});

test('a failed send leaves its draft available and clears the pending-send guard',async()=>{
 const {run,get,calls}=harness();get('prompt').value='Keep this message';run("api=async()=>{throw Error('Disconnected');};");
 await run('send({preventDefault(){}})');assert.equal(get('prompt').value,'Keep this message');assert.equal(get('send').disabled,false);assert.equal(run('sendingDrafts.size'),0);assert.equal(calls.at(-1).toast,'Disconnected');
});

test('an upload finishing after navigation belongs to the original draft',async()=>{
 const {context,run,get}=harness(),gate=deferred();context.gate=gate;run("api=async()=>gate.promise;chooseFile();");
 const pending=get('file-input').onchange({target:{files:[{name:'note.txt',size:4}],value:'selected'}});
 run("channel=null;selected='b';attachments=[];");gate.resolve({path:'attachments/note.txt'});await pending;
 assert.equal(run('attachments.length'),0);assert.equal(run("draftAttachments.group[0].owner"),'a');assert.equal(run("draftAttachments.group[0].path"),'attachments/note.txt');
});

test('delayed browser typing remains addressed to the bot that received the keystrokes',async()=>{
 const {run,calls}=harness();run("inspect='a';act=async(route,body)=>{calls.push({route,body});return {};};queueTyping('private input');inspect='b';");
 await run('flushTyping()');assert.equal(calls[0].body.id,'a');assert.equal(calls[0].body.text,'private input');
});

test('sending waits for an attachment upload so the selected file is not silently omitted',async()=>{
 const {context,run,get,calls}=harness(),gate=deferred();context.gate=gate;get('prompt').value='Read my file';
 run("api=async(route,body)=>{calls.push({route,body});return gate.promise;};chooseFile();");
 const uploading=get('file-input').onchange({target:{files:[{name:'note.txt',size:4}],value:'selected'}});
 await run('send({preventDefault(){}})');assert.equal(calls.some(x=>x.route==='send'),false);assert.equal(get('prompt').value,'Read my file');
 gate.resolve({path:'attachments/note.txt'});await uploading;assert.equal(get('send').disabled,false);
 await run('send({preventDefault(){}})');assert.equal(calls.find(x=>x.route==='send').body.attachments[0].path,'attachments/note.txt');
});

test('the chat model menu opens the unified model and reasoning settings for that bot',async()=>{
 const {run,calls}=harness();run("api=async()=>{throw Error('The old model menu must not request its own catalog.');};");
 await run("modelMenu('b')");assert.deepEqual(calls,[{modelBot:'b'}]);
});

test('a superseded file preview ignores a late response',async()=>{
 const {context,run,elements,element}=harness(),gate=deferred();context.gate=gate;
 run("modal=(title,subtitle,body,type)=>{modalType=type;elements.modal.open=true;elements['file-preview']=element();};api=async()=>gate.promise;");
 const pending=run("previewFile('a','first.txt')");elements['file-preview']=element();elements['file-preview'].innerHTML='Second file';gate.resolve({text:'First file contents'});await pending;
 assert.equal(elements['file-preview'].innerHTML,'Second file');
});

test('an unreachable host and a gateway HTML error have readable messages',async()=>{
 const {context,run}=harness();context.fetch=async()=>{throw Error('NetworkError');};
 await assert.rejects(run("api('state')"),/FOLKLET cannot reach your host/);
 context.fetch=async()=>({status:502,ok:false,json:async()=>{throw Error('Unexpected token <');}});
 await assert.rejects(run("api('state')"),/Check your connection and try again/);
});

test('phone setup explains the host platform and displays only official HTTPS setup links',async()=>{
 for(const platform of ['win32','darwin','linux']){
  const {context,run,get}=harness();context.phoneState={platform,enabled:false,devices:[],setup:{status:'failed',error:'Enable HTTPS',actionUrl:'https://login.tailscale.com/admin/dns'}};
  run('api=async()=>phoneState;');await run('phonePanel()');const html=get('modal-content').innerHTML;
  if(platform==='win32')assert.match(html,/Windows may ask to allow the setup/);
  else{assert.match(html,/Set up connection/);assert.ok(html.includes('https://tailscale.com/download/'+(platform==='darwin'?'mac':'linux')));assert.doesNotMatch(html,/Windows may ask/);}
  assert.match(html,/https:\/\/login\.tailscale\.com\/admin\/dns/);
  context.phoneState.setup.actionUrl='https://login.tailscale.com.evil.invalid/';await run('phonePanel()');assert.doesNotMatch(get('modal-content').innerHTML,/evil\.invalid/);
 }
});

test('closing phone setup while its status loads does not reopen the dialog',async()=>{
 const {context,run,get}=harness(),gate=deferred();context.gate=gate;run('api=async()=>gate.promise;');
 const pending=run('phonePanel()');get('modal').close();gate.resolve({platform:'linux',enabled:false,devices:[],setup:{status:'idle'}});await pending;
 assert.equal(get('modal').open,false);
});

test('a failed account refresh cannot claim readiness from a previous successful sign-in',async()=>{
 const {run,get}=harness();run("drawAccount({connected:true,type:'chatgpt',error:'Temporary failure'});");
 assert.match(get('modal-content').innerHTML,/last successful check/);assert.doesNotMatch(get('modal-content').innerHTML,/FOLKLET is ready|Sign in with ChatGPT/);
 run("drawAccount({connected:true,type:'chatgpt'});");assert.match(get('modal-content').innerHTML,/FOLKLET is ready/);
 run("api=async()=>{throw Error('Network unavailable');};");await run('updateAccountPanel()');
 assert.match(get('modal-content').innerHTML,/Could not refresh account status/);assert.doesNotMatch(get('modal-content').innerHTML,/FOLKLET is ready/);
 run("api=async()=>({connected:true,type:'chatgpt'});");await run('updateAccountPanel()');assert.match(get('modal-content').innerHTML,/FOLKLET is ready/);
});
