export function createModelSettingsUI({api,modal,refresh,getBots}){
 const $=id=>document.getElementById(id),esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const preference=bot=>bot.modelPreference??bot.model??'';
 const effortLabel=value=>({none:'None',minimal:'Minimal',low:'Low',medium:'Medium',high:'High',xhigh:'Extra high',max:'Max',ultra:'Ultra'}[value]||'Default')+' reasoning';
 let editor=null,timer;
 const error=e=>{if($('modal-error'))$('modal-error').textContent=e.message||String(e);};
 async function listBots(){
  editor=null;clearTimeout(timer);const bots=getBots();
  modal('Models & reasoning','Choose how each teammate thinks.',bots.length?'<div class="settings-options">'+bots.map(b=>'<button class="settings-option" data-model-bot="'+esc(b.id)+'"><span><b>'+esc(b.name)+'</b><small>'+esc(preference(b)||'Default model')+' · '+esc(effortLabel(b.reasoningEffort))+'</small></span><span>›</span></button>').join('')+'</div>':'<p class="note">Create a bot first, then choose its model and reasoning here.</p><button class="btn primary" data-create>Create a bot</button>','models');
 }
 function live(state){return editor===state&&$('model-editor')===state.element&&$('modal').open;}
 function modelRows(state){
  const target=$('available-models');if(!target||!live(state))return;
  const input=$('chosen-model').value.toLowerCase().trim(),query=(state.models||[]).some(m=>m.id.toLowerCase()===input)?'':input,items=(state.models||[]).filter(m=>!query||(m.id+' '+m.name).toLowerCase().includes(query)).slice(0,80);
  target.innerHTML=(state.providerId==='codex'?'<button type="button" class="model-option" data-model-default aria-pressed="'+!input+'"><b>Default model</b><small>Use your Codex configuration</small></button>':'')+items.map(m=>'<button type="button" class="model-option" data-model-pick="'+esc(m.id)+'" aria-pressed="'+(m.id.toLowerCase()===input)+'"><b>'+esc(m.name||m.id)+'</b><small>'+esc(m.id)+'</small></button>').join('')+(!items.length?'<p class="model-empty">'+(query?'No matching models. You can enter an exact model ID above.':'No models were listed. Enter the model ID from your provider.')+'</p>':'');
 }
 async function loadOptions(state,keepEffort=false){
  if(!live(state))return;const serial=++state.serial,model=$('chosen-model').value.trim();
  state.model=model;if(!keepEffort)state.effort='';$('save-model-settings').disabled=true;$('reasoning-choices').textContent='Loading reasoning options…';
  try{
   const data=await api('model-settings?providerId='+encodeURIComponent(state.providerId)+'&model='+encodeURIComponent(model));
   if(!live(state)||serial!==state.serial)return;state.models=data.models||[];state.options=data.options||[{value:'',label:'Default'}];
   if(!state.options.some(o=>o.value===state.effort))state.effort='';
   $('reasoning-choices').innerHTML=state.options.map(option=>'<button type="button" class="reasoning-choice" data-reasoning-level="'+esc(option.value)+'" aria-pressed="'+(option.value===state.effort)+'"'+(option.description?' title="'+esc(option.description)+'"':'')+'>'+esc(option.label)+'</button>').join('');
   $('reasoning-help').textContent=state.options.length>1?'Higher effort can take longer and use more tokens. Default follows your connection’s configuration.':state.providerId==='codex'&&!model?'Choose a named model to customize reasoning. Default model follows your Codex configuration.':'This model or connection does not advertise adjustable reasoning. FOLKLET will use its default.';
   $('model-catalog-note').textContent=data.notice||'';$('modal-error').textContent='';modelRows(state);$('save-model-settings').disabled=false;
  }catch(e){if(live(state)&&serial===state.serial){$('reasoning-choices').innerHTML='<button type="button" class="btn" data-retry-model-options>Try loading again</button>';error(e);}}
 }
 async function edit(botId,providerId){
  clearTimeout(timer);const bot=getBots().find(b=>b.id===botId);if(!bot)throw Error('Bot not found.');
  modal('Model & reasoning',esc(bot.name),'<div id="model-editor">Loading connections…</div>','model-settings');const target=$('model-editor');
  let providers;try{providers=await api('providers');}catch(e){if($('model-editor')===target&&$('modal').open)error(e);return;}if($('model-editor')!==target||!$('modal').open)return;
  const chosen=providerId||bot.providerId||'codex',provider=providers.find(p=>p.id===chosen);if(!provider)throw Error('Connection unavailable.');
  const changed=chosen!==(bot.providerId||'codex');
  const state=editor={botId,providerId:chosen,model:changed?provider.defaultModel||'':preference(bot),effort:changed?'':bot.reasoningEffort||'',element:target,serial:0,models:[],options:[]};
  target.innerHTML='<form id="model-settings-form"><label>Connection</label><details class="model-connection"><summary>'+esc(provider.name)+' <span>Change ⌄</span></summary><div class="settings-options">'+providers.map(p=>'<button type="button" class="settings-option" data-model-provider="'+esc(p.id)+'"><span><b>'+esc(p.name)+'</b><small>'+esc(p.id==='codex'?'Your ChatGPT account':p.type)+'</small></span><span>›</span></button>').join('')+'</div></details><label for="chosen-model">Model</label><input id="chosen-model" value="'+esc(state.model)+'" maxlength="200" autocomplete="off" placeholder="'+(chosen==='codex'?'Default model · type to find another':'Search or enter a model ID')+'"><p class="note" id="model-catalog-note"></p><details class="model-catalog"><summary>Browse available models</summary><div id="available-models" class="models-list"></div></details><label id="reasoning-label">Reasoning level</label><div id="reasoning-choices" class="reasoning-choices" role="group" aria-labelledby="reasoning-label"></div><p id="reasoning-help" class="note"></p><button class="btn primary" id="save-model-settings" disabled>Save model & reasoning</button></form><button class="btn" data-fallback-bot="'+esc(botId)+'">Fallback models</button><p class="note">Changes apply to the next task. Finish or stop an active task before changing these settings. Your visible chat history stays saved.</p>';
  $('chosen-model').oninput=()=>{state.effort='';state.serial++;$('save-model-settings').disabled=true;target.querySelector('.model-catalog').open=true;modelRows(state);clearTimeout(timer);timer=setTimeout(()=>loadOptions(state),300);};
  $('model-settings-form').onsubmit=async event=>{event.preventDefault();if(!live(state)||state.saving||$('save-model-settings').disabled)return;const request={id:state.botId,providerId:state.providerId,model:$('chosen-model').value.trim(),reasoningEffort:state.effort};state.saving=true;$('save-model-settings').textContent='Saving…';for(const control of target.querySelectorAll('button,input'))control.disabled=true;try{await api('update',request);if(live(state)){$('modal').close();editor=null;}await refresh();}catch(e){if(live(state)){error(e);$('save-model-settings').textContent='Save model & reasoning';for(const control of target.querySelectorAll('button,input'))control.disabled=false;}}finally{state.saving=false;}};
  await loadOptions(state,true);
 }
 document.addEventListener('click',async event=>{const d=event.target.closest('button')?.dataset;if(!d)return;try{
  if(d.modelBot)await edit(d.modelBot);
  else if(d.retryModelOptions!==undefined&&editor&&live(editor)&&!editor.saving)await loadOptions(editor,true);
  else if(d.modelProvider&&editor&&!editor.saving)await edit(editor.botId,d.modelProvider);
  else if((d.modelPick!==undefined||d.modelDefault!==undefined)&&editor&&live(editor)&&!editor.saving){$('chosen-model').value=d.modelDefault!==undefined?'':d.modelPick;editor.element.querySelector('.model-catalog').open=false;clearTimeout(timer);await loadOptions(editor);}
  else if(d.reasoningLevel!==undefined&&editor&&live(editor)&&!editor.saving&&editor.options.some(o=>o.value===d.reasoningLevel)){editor.effort=d.reasoningLevel;for(const button of $('reasoning-choices').querySelectorAll('button'))button.setAttribute('aria-pressed',String(button.dataset.reasoningLevel===editor.effort));}
 }catch(e){error(e);}});
 return {listBots,edit};
}
