const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function createFallbackUI({api,modal,refresh,getBots}){
 let editor;
 const $=id=>document.getElementById(id),live=state=>editor===state&&$('fallback-editor')===state.element&&$('modal').open;
 const availableProviders=(state,index)=>state.providers.filter(provider=>provider.id!=='codex'||(state.primaryProvider==='codex'&&!state.choices.slice(0,index).some(choice=>choice.providerId!=='codex')));
 function render(state){
  if(!live(state))return;
  state.element.innerHTML='<form id="fallback-form"><label class="check"><input type="checkbox" id="fallback-enabled" '+(state.enabled?'checked':'')+'>Use approved fallback models for this bot</label><p class="note">Crew tries this order only after a temporary failure before any answer or tool use. It keeps the task’s permissions. Once work begins, you review and retry it yourself.</p><div id="fallback-choices">'+state.choices.map((choice,index)=>'<fieldset data-fallback-row="'+index+'"><legend>Fallback '+(index+1)+'</legend><label>Connection</label><details><summary>'+esc(state.providers.find(p=>p.id===choice.providerId)?.name||'Choose a connection')+'</summary><div class="settings-options">'+availableProviders(state,index).map(p=>'<button class="settings-option" type="button" data-fallback-provider="'+esc(p.id)+'" data-fallback-index="'+index+'"><span>'+esc(p.name)+'</span></button>').join('')+'</div></details><label for="fallback-model-'+index+'">Named model ID</label><input id="fallback-model-'+index+'" data-fallback-model="'+index+'" maxlength="200" value="'+esc(choice.model)+'" placeholder="Choose a named model" autocomplete="off"><details><summary>Browse available models</summary><div class="settings-options" id="fallback-catalog-'+index+'"></div></details><label>Reasoning level</label><div id="fallback-efforts-'+index+'" class="reasoning-choices">Loading choices…</div><div class="row"><button class="btn" type="button" data-fallback-up="'+index+'" '+(index===0?'disabled':'')+'>Move up</button><button class="btn" type="button" data-fallback-remove="'+index+'">Remove</button></div></fieldset>').join('')+'</div><button class="btn" type="button" data-fallback-add '+(state.choices.length>=3?'disabled':'')+'>Add fallback</button><p class="note">Up to three choices. Add connections on the host before selecting them here.</p><label class="check"><input type="checkbox" id="fallback-sharing" '+(state.contentSharingApproved?'checked':'')+'>I allow this bot’s task, relevant chat context, files and tool results to be sent to the connections listed above when fallback is needed.</label><p class="note">Changing the order or a model clears this confirmation. Nothing is sent while editing these settings.</p><button class="btn primary" type="submit" id="fallback-save">Save fallback settings</button></form>';
  state.element.insertAdjacentHTML('beforeend','<p class="note">For ChatGPT, fallback stops once a turn is submitted, because the engine may already have begun work. Automatic fallback cannot switch from an API connection to ChatGPT, which would add tool permissions.</p>'+(state.originalEnabled?'<button class="btn danger" type="button" data-fallback-disable>Turn off and clear fallback</button>':''));
  $('fallback-enabled').onchange=()=>{state.enabled=$('fallback-enabled').checked;};
  $('fallback-sharing').onchange=()=>{state.contentSharingApproved=$('fallback-sharing').checked;};
  for(const input of state.element.querySelectorAll('[data-fallback-model]'))input.oninput=()=>{
   const index=Number(input.dataset.fallbackModel);state.choices[index].model=input.value;state.choices[index].reasoningEffort='';state.contentSharingApproved=false;$('fallback-sharing').checked=false;
   clearTimeout(state.timers[index]);state.loading[index]=true;$('fallback-save').disabled=true;state.serials[index]=(state.serials[index]||0)+1;
   state.timers[index]=setTimeout(()=>loadChoice(state,index),250);
  };
  state.element.onclick=event=>{
   const button=event.target.closest('button');if(!button||!live(state)||state.saving)return;const d=button.dataset;
   if(d.fallbackDisable!==undefined){void disable(state);}
   else if(d.fallbackAdd!==undefined){const provider=availableProviders(state,state.choices.length)[0];if(!provider){$('modal-error').textContent='Add an eligible API connection on the host first.';return;}state.choices.push({providerId:provider.id,model:'',reasoningEffort:''});changed(state);}
   else if(d.fallbackRemove!==undefined){state.choices.splice(Number(d.fallbackRemove),1);changed(state);}
   else if(d.fallbackUp!==undefined){const i=Number(d.fallbackUp);if(i>0){[state.choices[i-1],state.choices[i]]=[state.choices[i],state.choices[i-1]];changed(state);}}
   else if(d.fallbackProvider!==undefined){state.choices[Number(d.fallbackIndex)]={providerId:d.fallbackProvider,model:'',reasoningEffort:''};changed(state);}
   else if(d.fallbackModelPick!==undefined){state.choices[Number(d.fallbackIndex)].model=d.fallbackModelPick;state.choices[Number(d.fallbackIndex)].reasoningEffort='';changed(state);}
   else if(d.fallbackEffort!==undefined){state.choices[Number(d.fallbackIndex)].reasoningEffort=d.fallbackEffort;changed(state);}
  };
  $('fallback-form').onsubmit=async event=>{
   event.preventDefault();if(!live(state)||state.saving||state.loading.some(Boolean))return;
   const fallback={enabled:state.enabled,contentSharingApproved:state.contentSharingApproved,choices:state.choices.map(choice=>({...choice,model:choice.model.trim()}))};
   state.saving=true;for(const control of state.element.querySelectorAll('input,button'))control.disabled=true;
   try{await api('fallback-save',{id:state.botId,fallback});if(live(state)){$('modal').close();editor=null;}await refresh();}
   catch(error){if(live(state)){$('modal-error').textContent=error.message;state.saving=false;render(state);}}
   finally{state.saving=false;}
  };
  state.choices.forEach((_,index)=>loadChoice(state,index));
 }
 async function disable(state){
  if(!live(state)||state.saving)return;state.saving=true;
  for(const control of state.element.querySelectorAll('input,button'))control.disabled=true;
  try{await api('fallback-save',{id:state.botId,fallback:{enabled:false,contentSharingApproved:false,choices:[]}});if(live(state)){$('modal').close();editor=null;}await refresh();}
  catch(error){if(live(state)){$('modal-error').textContent=error.message;for(const control of state.element.querySelectorAll('input,button'))control.disabled=false;}}
  finally{state.saving=false;}
 }
 function changed(state){state.contentSharingApproved=false;for(const timer of state.timers)clearTimeout(timer);state.timers=[];state.serials=[];state.loading=[];state.generation++;render(state);}
 async function loadChoice(state,index){
  if(!live(state)||!state.choices[index])return;
  const generation=state.generation,serial=state.serials[index]=(state.serials[index]||0)+1,choice={...state.choices[index]};state.loading[index]=true;$('fallback-save').disabled=true;
  try{
   const data=await api('model-settings?providerId='+encodeURIComponent(choice.providerId)+'&model='+encodeURIComponent(choice.model.trim()));
   if(!live(state)||generation!==state.generation||serial!==state.serials[index])return;
   const options=data.options||[{value:'',label:'Default'}];
   if(!options.some(option=>option.value===state.choices[index].reasoningEffort)){state.choices[index].reasoningEffort='';state.contentSharingApproved=false;$('fallback-sharing').checked=false;}
   $('fallback-efforts-'+index).innerHTML=options.map(option=>'<button class="reasoning-choice" type="button" data-fallback-effort="'+esc(option.value)+'" data-fallback-index="'+index+'" aria-pressed="'+(option.value===state.choices[index].reasoningEffort)+'">'+esc(option.label)+'</button>').join('');
   $('fallback-catalog-'+index).innerHTML=(data.models||[]).slice(0,80).map(model=>'<button class="settings-option" type="button" data-fallback-model-pick="'+esc(model.id)+'" data-fallback-index="'+index+'"><span><b>'+esc(model.name||model.id)+'</b><small>'+esc(model.id)+'</small></span></button>').join('')||'<p class="note">Enter the exact model ID from this connection.</p>';
   state.loading[index]=false;$('fallback-save').disabled=state.saving||state.loading.some(Boolean);
  }catch(error){if(live(state)&&generation===state.generation&&serial===state.serials[index]){$('fallback-efforts-'+index).textContent='Reasoning choices could not load. Reopen this editor to try again.';$('modal-error').textContent=error.message;}}
 }
 async function edit(botId){
  const bot=getBots().find(item=>item.id===botId);if(!bot)return;
  const state=editor={botId,primaryProvider:bot.providerId||'codex',enabled:bot.fallback?.enabled===true,originalEnabled:bot.fallback?.enabled===true,contentSharingApproved:bot.fallback?.contentSharingApproved===true,choices:(bot.fallback?.choices||[]).map(choice=>({...choice})),timers:[],serials:[],loading:[],generation:0};
  modal('Fallback models','Choose which connections may take over before work begins.','<div id="fallback-editor"><p>Loading connections…</p>'+(state.originalEnabled?'<button class="btn danger" type="button" data-fallback-disable>Turn off and clear fallback</button>':'')+'</div>','fallback');state.element=$('fallback-editor');
  state.element.onclick=event=>{if(event.target.closest('button')?.dataset.fallbackDisable!==undefined)void disable(state);};
  try{state.providers=await api('providers');if(live(state)&&!state.saving)render(state);}
  catch(error){if(live(state))state.element.innerHTML='<p class="note">'+esc(error.message)+'</p>'+(state.originalEnabled?'<button class="btn danger" type="button" data-fallback-disable>Turn off and clear fallback</button>':'');}
 }
 return {edit};
}
