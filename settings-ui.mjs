import {createModelSettingsUI} from './model-settings-ui.mjs';
import {createSkillsUI} from './skills-ui.mjs';
import {createLearningReviewUI} from './learning-review-ui.mjs';
import {createRecallUI} from './recall-ui.mjs';
import {createIntegrationsUI} from './integrations-ui.mjs';
import {createPluginsUI} from './plugins-ui.mjs';
import {createNotificationsUI} from './notifications-ui.mjs';
import {createFallbackUI} from './fallback-ui.mjs';
import {createRoutinePolicyUI} from './routine-policy-ui.mjs';
import {createHostingUI} from './hosting-ui.mjs';
export function createSettingsUI({api,modal,refresh,getBots,accountPanel,md,onSource,onAppChange}){
 const $=id=>document.getElementById(id),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const types={openai:['OpenAI','OpenAI API key'],anthropic:['Anthropic','Claude API key'],gemini:['Google Gemini','Gemini API key'],openrouter:['OpenRouter','Many model families through one connection'],ollama:['Ollama','Models running on your own machine'],custom:['Custom endpoint','An OpenAI-compatible Chat Completions API']};
 const modelUI=createModelSettingsUI({api,modal,refresh,getBots});
 const pluginsUI=createPluginsUI({api,modal,getBots});
 const hostingUI=createHostingUI({api,modal});
 const skillsUI=createSkillsUI({api,modal,refresh,getBots,onSource}),learningUI=createLearningReviewUI({api,modal,refresh,getBots,onSource,onAppChange}),recallUI=createRecallUI({api,modal,getBots,onSource}),integrationsUI=createIntegrationsUI({api,modal,getBots}),notificationsUI=createNotificationsUI({api,modal}),fallbackUI=createFallbackUI({api,modal,refresh,getBots}),routineUI=createRoutinePolicyUI({api,modal,refresh});
 let oauthTimer;const busy=new WeakSet();
 const row=(title,detail,action)=>`<button class="settings-option" ${action}><span><b>${esc(title)}</b><small>${esc(detail)}</small></span><span>›</span></button>`;
 function guideText(text){
  const known=new Set(['QUICKSTART.md','HOSTING.md','PROVIDERS.md','FEATURES.md','SECURITY.md','RELEASE-CHECKS.md','FEATURE-ROADMAP.md','PLUGINS.md']),links=[];
  const marked=String(text).replace(/\[([^\]\n]+)\]\(([A-Z-]+\.md)(?:#[^)\s]+)?\)/g,(original,label,name)=>{if(!known.has(name))return original;const index=links.push({label,name})-1;return '\uE123'+index+'\uE124';});
  return md(marked).replace(/\uE123(\d+)\uE124/g,(original,index)=>{const link=links[Number(index)];return link?'<button type="button" class="guide-link" data-settings-guide="'+esc(link.name)+'">'+esc(link.label)+'</button>':original;});
 }
 const error=e=>{if($('modal-error'))$('modal-error').textContent=e.message||String(e);};
 const current=view=>view&&$('modal-error')===view&&$('modal').open;
 function loadError(view,target,e,retry){if(current(view)){target.innerHTML='<button class="btn" '+retry+'>Try again</button>';error(e);}}
 async function change(view,scope,work,after){
  if(!scope||!current(view)||busy.has(view))return;busy.add(view);view.textContent='';
  const controls=[...scope.querySelectorAll('button,input')].map(control=>[control,control.disabled]);for(const [control] of controls)control.disabled=true;
  try{const result=await work();if(current(view))await after(result);}catch(e){if(current(view))error(e);}finally{busy.delete(view);for(const [control,disabled] of controls)control.disabled=disabled;}
 }
 async function providers(){
  clearTimeout(oauthTimer);if(window.CREW_MOBILE){modal('Connections','Manage accounts on your host computer.','<p class="note">You can choose an existing connection for each bot here. Add accounts or API keys from the computer or private server running FOLKLET.</p>','connections');return;}modal('Connections','Choose the account or API that powers your bots.','<div id="provider-list">Loading connections…</div>','connections');const target=$('provider-list'),view=$('modal-error');
  try{const list=await api('providers');if(!current(view))return;
   target.innerHTML='<div class="settings-options">'+row('ChatGPT','Sign in using the bundled Codex engine.','data-settings-chatgpt')+list.filter(p=>p.id!=='codex').map(p=>row(p.name,(p.defaultModel||types[p.type]?.[0]||p.type)+' · '+(p.hasKey?p.keyStorage==='disk'?'Saved on this computer':'Connected for this session':p.type==='ollama'?'Local connection':p.type==='custom'?'Endpoint configured':'Key needed'),`data-provider-edit="${esc(p.id)}"`)).join('')+'</div><h3 class="settings-label">Add a connection</h3><div class="settings-options">'+Object.entries(types).map(([key,[name,description]])=>row(name,description,`data-add-provider="${key}"`)).join('')+'</div><p class="note">Open Models & reasoning to choose a connection for each bot. API providers bill your account separately from ChatGPT subscriptions.</p>';
  }catch(e){loadError(view,target,e,'data-crew-settings="connections"');}
 }
 async function editProvider(type,id){
  let list=[];
  if(id){modal('Edit connection','Choose how this connection works.','<div id="provider-loading">Loading connection…</div>','provider-editor');const target=$('provider-loading'),view=$('modal-error');try{list=await api('providers');if(!current(view))return;if(!list.some(p=>p.id===id))throw Error('This connection no longer exists. Return to Connections to add it again.');}catch(e){loadError(view,target,e,'data-crew-settings="connections"');return;}}
  const p=list.find(x=>x.id===id)||{},kind=type||p.type;
  if(!types[kind])throw Error('Choose a provider');
  modal(p.id?'Edit connection':'Connect '+types[kind][0],types[kind][1],`<form id="provider-form"><input type="hidden" id="provider-type" value="${esc(kind)}"><input type="hidden" id="provider-id" value="${esc(p.id||'')}"><label for="provider-name">Connection name</label><input id="provider-name" value="${esc(p.name||types[kind][0])}" maxlength="80" required>${['custom','ollama'].includes(kind)?'<label for="provider-url">API base URL</label><input id="provider-url" type="url" placeholder="'+(kind==='ollama'?'http://127.0.0.1:11434/v1':'https://your-provider.example/v1')+'" value="'+esc(p.baseUrl||(kind==='ollama'?'http://127.0.0.1:11434/v1':''))+'" required><p class="note">Only use an endpoint you trust. Requests and any key you enter are sent there.</p>':''}<label for="provider-model">Default model ID</label><input id="provider-model" value="${esc(p.defaultModel||'')}" placeholder="Choose a model for each bot, or enter a default here" maxlength="200"><label for="provider-key">${['ollama','custom'].includes(kind)?'API key (optional)':'API key'}</label><input id="provider-key" type="password" autocomplete="off" placeholder="${p.hasKey?'Leave blank to keep the existing key':'Paste your API key'}"><label class="check"><input type="checkbox" id="provider-persist" ${p.keyStorage==='disk'?'checked':''}>Remember this key on this computer</label><p class="note">Unchecked: the key is kept only until FOLKLET quits. Remembered keys are saved as plaintext in FOLKLET’s data folder, not an OS password vault. On Windows, access follows that folder’s existing permissions.</p><div class="row"><button class="btn primary" type="submit">Save connection</button>${kind==='openrouter'?'<button class="btn" type="button" data-openrouter-login>Sign in with OpenRouter ↗</button>':''}${p.id?'<button class="btn danger" type="button" data-provider-remove="'+esc(p.id)+'">Remove</button>':''}</div></form><p class="note">${kind==='anthropic'?'Use an Anthropic API key. Claude subscription login is not offered through FOLKLET.':kind==='custom'?'Tool calling and vision depend on the endpoint and model.':'You keep your own provider account and billing.'}</p>`,'provider-editor');
  const form=$('provider-form'),view=$('modal-error'),key=$('provider-key');
  $('provider-form').onsubmit=async event=>{event.preventDefault();if(!current(view)||busy.has(view))return;const body={id:$('provider-id').value||undefined,type:$('provider-type').value,name:$('provider-name').value,baseUrl:$('provider-url')?.value,defaultModel:$('provider-model').value,apiKey:key.value||undefined,persistKey:$('provider-persist').checked};await change(view,form,async()=>{await api('provider-save',body);key.value='';},providers);};
 }
 async function oauth(){
  const form=$('provider-form'),view=$('modal-error');if(!form)return;
  const persistKey=$('provider-persist')?.checked===true,name=$('provider-name')?.value||'OpenRouter';
  await change(view,form,async()=>{
   const before=await api('providers');if(!current(view))return;
   const login=await api('provider-login',{name,persistKey}),url=new URL(login.authUrl);if(url.origin!=='https://openrouter.ai'||url.pathname!=='/auth')throw Error('Unexpected sign-in address');return {before,login,url};
  },async({before,login,url})=>{
   clearTimeout(oauthTimer);modal('Connect OpenRouter','Use a supported sign-in flow.','<p class="note">Continue in your browser and authorize FOLKLET. Then return here. OpenRouter will give this connection its own API key.</p><a class="btn primary" href="'+esc(url.href)+'" target="_blank" rel="noopener noreferrer">Continue to OpenRouter ↗</a><p class="note" id="oauth-wait">Waiting for your connection…</p>','provider-oauth');
   const target=$('oauth-wait'),pollView=$('modal-error'),deadline=login.expiresAt||Date.now()+600000;
   const poll=async()=>{
    if(!current(pollView))return;if(Date.now()>deadline){target.textContent='This sign-in expired. Close this panel and start again.';return;}
    try{const now=await api('providers');if(!current(pollView))return;if(now.some(p=>p.id!=='codex'&&p.type==='openrouter'&&p.hasKey&&!before.some(old=>old.id===p.id&&old.hasKey))){await providers();return;}target.textContent='Waiting for your connection…';}catch(e){if(!current(pollView))return;target.textContent=e.message;}
    if(current(pollView))oauthTimer=setTimeout(poll,2000);
   };oauthTimer=setTimeout(poll,1500);
  });
 }
 const botConnection=id=>modelUI.edit(id);
 async function learning(){
  modal('Learning','Keep useful lessons. Review every proposed change.','<div id="learning-list">Loading…</div>','learning');const target=$('learning-list'),view=$('modal-error');
  try{const items=await api('learning');if(!current(view))return;
   target.innerHTML='<p class="note">Ask a bot to remember a preference or propose a reusable workflow. Lessons become active after you accept them. Accepted workflows become paused routines; app changes stay as proposals for review.</p>'+(items.length?items.map(item=>'<article class="learning-card"><div class="row between"><b>'+esc(item.title)+'</b><small>'+esc(item.status)+'</small></div><small>'+esc(item.kind)+' · '+esc(getBots().find(b=>b.id===item.botId)?.name||'Your team')+'</small><div class="message-text">'+md(item.text)+'</div>'+(item.reason?'<p class="note">'+esc(item.reason)+'</p>':'')+(item.status==='pending'?'<div class="row"><button class="btn primary" data-learning-accept="'+esc(item.id)+'">'+(item.kind==='app-change'?'Mark reviewed':item.kind==='workflow'?'Save paused routine':'Accept lesson')+'</button><button class="btn" data-learning-reject="'+esc(item.id)+'">Decline</button></div>':'')+'</article>').join(''):'<div class="empty-box">No lessons yet. Try: “Remember that I prefer short answers,” or “Turn this into a workflow I can reuse.”</div>');
  }catch(e){loadError(view,target,e,'data-crew-settings="learning"');}
 }
 async function computer(){
  modal('Computer access','Optional control of the desktop running FOLKLET.','<div id="computer-settings">Loading computer access…</div>','computer-access');const target=$('computer-settings'),view=$('modal-error');
  try{const state=await api('native-status');if(!current(view))return;target.innerHTML='<p class="note">'+esc(state.enabled?'Enabled for this FOLKLET session.':'Desktop control is off.')+'</p><p class="note">When enabled, a bot must ask before every screenshot, click, keystroke or scroll. Screenshots can contain other apps and are sent to the model you selected. Browser use continues to work separately.</p>'+(state.reason?'<p class="note">'+esc(state.reason)+'</p>':'')+(state.requirements?'<p class="note">'+esc(Array.isArray(state.requirements)?state.requirements.join(' '):state.requirements)+'</p>':'')+(window.CREW_MOBILE?'<p class="note">Enable or disable desktop access from the host computer.</p>':!state.available&&!state.enabled?'<p class="note">Complete the requirements above to enable desktop control.</p>':'<button class="btn '+(state.enabled?'danger':'primary')+'" data-native-enable="'+(!state.enabled)+'">'+(state.enabled?'Turn off desktop control':'Enable for this session')+'</button>')+'<p class="note">Restarting FOLKLET turns desktop control off. A VPS uses its own isolated desktop; it does not control your home computer.</p>';
  }catch(e){loadError(view,target,e,'data-crew-settings="computer"');}
 }
 async function guide(name){modal('FOLKLET guides','Read setup and connection help.','<div id="settings-guide">Loading guide…</div>','guide');const target=$('settings-guide'),view=$('modal-error');try{const doc=await api('guide?name='+encodeURIComponent(name));if(current(view))modal(esc(doc.title),'FOLKLET guides','<div class="message-text settings-guide">'+guideText(doc.text)+'</div>','guide');}catch(e){loadError(view,target,e,'data-settings-guide="'+esc(name)+'"');}}
 function cloud(){hostingUI.setup();}
 function welcome(){modal('Make FOLKLET yours','A few steps, then your first teammate.','<div class="settings-options">'+row('1. Connect an account','Use ChatGPT, an API key, OpenRouter sign-in or a local model.','data-crew-settings="connections"')+row('2. Create your first bot','Give it a name and a job.','data-create')+row('3. Read the quick start','Simple setup, phone access and common fixes.','data-settings-guide="QUICKSTART.md"')+'</div><p class="note">Your local workspace is yours. Cloud hosting is optional.</p>','welcome');}
 const screens={host:hostingUI.open,models:modelUI.listBots,connections:providers,learning:learningUI.open,skills:skillsUI.open,plugins:pluginsUI.open,recall:recallUI.open,integrations:integrationsUI.open,notifications:notificationsUI.open,computer,cloud,welcome};
 document.addEventListener('click',async event=>{const el=event.target.closest('button'),d=el?.dataset;if(!d)return;const view=$('modal-error');try{
  if(d.fallbackBot){await fallbackUI.edit(d.fallbackBot);return;}if(d.routinePolicy){await routineUI.edit(d.routinePolicy);return;}
  if(d.crewSettings&&screens[d.crewSettings])await screens[d.crewSettings]();
  else if(d.settingsChatgpt!==undefined)await accountPanel();
  else if(d.addProvider)await editProvider(d.addProvider);
  else if(d.providerEdit)await editProvider(null,d.providerEdit);
  else if(d.providerRemove)await change(view,$('provider-form'),()=>api('provider-remove',{id:d.providerRemove}),providers);
  else if(d.openrouterLogin!==undefined)await oauth();
  else if(d.connectionBot)await botConnection(d.connectionBot);
  else if(d.learningAccept)await change(view,$('learning-list'),async()=>{await api('learning-accept',{id:d.learningAccept});await refresh();},learning);
  else if(d.learningReject)await change(view,$('learning-list'),()=>api('learning-reject',{id:d.learningReject}),learning);
  else if(d.nativeEnable!==undefined)await change(view,$('computer-settings'),()=>api('native-enable',{enabled:d.nativeEnable==='true'}),computer);
  else if(d.settingsGuide)await guide(d.settingsGuide);
  else if(d.cloudLink){const links={hetzner:'https://www.hetzner.com/cloud/',digitalocean:'https://www.digitalocean.com/pricing/droplets'};if(links[d.cloudLink]){const a=document.createElement('a');a.href=links[d.cloudLink];a.target='_blank';a.rel='noopener noreferrer';a.click();}}
 }catch(e){if(current(view))error(e);}});
 async function setupBot(id){const view=$('modal-error');try{const list=await api('providers');if(list.some(p=>p.id!=='codex')&&!$('modal').open&&$('modal-error')===view)await botConnection(id);}catch(e){if(current(view))error(e);}}
 return {providers,botConnection,setupBot,learning:learningUI.open,computer,cloud,welcome};
}
