const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function createRoutinePolicyUI({api,modal,refresh}){
 let editor;
 const $=id=>document.getElementById(id),current=state=>editor===state&&$('routine-policy-form')===state.form&&$('modal').open;
 async function edit(routineId){
  const state=editor={routineId};
  modal('Routine reliability','Choose what happens when a scheduled run is missed or cannot start.','<div id="routine-policy-loading">Loading routine settings…</div>','routine-policy');const target=$('routine-policy-loading');
  try{
   const data=await api('routine-policy?routineId='+encodeURIComponent(routineId));
   if(editor!==state||$('routine-policy-loading')!==target||!$('modal').open)return;
   target.innerHTML='<form id="routine-policy-form"><p class="note">'+esc(data.name)+'</p><p>'+esc(data.nextExplanation)+'</p><fieldset><legend>If FOLKLET misses a run</legend><label class="check"><input type="radio" name="missed-policy" value="run_once" '+(data.missedRunPolicy==='run_once'?'checked':'')+'>Run once when FOLKLET returns</label><label class="check"><input type="radio" name="missed-policy" value="skip" '+(data.missedRunPolicy==='skip'?'checked':'')+'>Skip it and wait for the next scheduled time</label><p class="note">A one-minute allowance handles normal scheduling delays. Missed runs never create a backlog.</p></fieldset><label for="routine-retries">Retries before work begins</label><input type="number" id="routine-retries" min="0" max="3" step="1" value="'+esc(data.retryLimit??0)+'"><label for="routine-retry-delay">First retry delay (minutes)</label><input type="number" id="routine-retry-delay" min="1" max="60" step="1" value="'+esc(data.retryDelayMinutes??1)+'"><p class="note">Retries apply only to temporary connection failures before any answer or tool use. The delay doubles between attempts, up to one hour. Zero turns retries off.</p><fieldset><legend>Completion notifications</legend><label class="check"><input type="radio" name="routine-notifications" value="changes" '+(data.notificationPolicy!=='all'?'checked':'')+'>First result, changes, recovery or failures</label><label class="check"><input type="radio" name="routine-notifications" value="all" '+(data.notificationPolicy==='all'?'checked':'')+'>Every completed run and failures</label><p class="note">Changes compare the answer text with the last successful run. Formatting spaces are ignored.</p></fieldset>'+(data.resultComparison?'<details><summary>Compare the last result</summary><p><b>'+esc(data.resultComparison.kind)+'</b></p><h4>Previous result</h4><p class="note">'+esc(data.resultComparison.previousSummary||'No earlier successful result.')+'</p><h4>Latest result</h4><p class="note">'+esc(data.resultComparison.currentSummary||'No completed answer.')+'</p></details>':'')+'<button class="btn primary" type="submit">Save reliability settings</button><p class="note">Saving these settings does not enable a paused routine.</p></form>';
   state.form=$('routine-policy-form');
   state.form.onsubmit=async event=>{
    event.preventDefault();if(!current(state)||state.saving)return;
    const form=state.form,payload={routineId,missedRunPolicy:form.querySelector('[name="missed-policy"]:checked')?.value,retryLimit:Number($('routine-retries').value),retryDelayMinutes:Number($('routine-retry-delay').value),notificationPolicy:form.querySelector('[name="routine-notifications"]:checked')?.value};
    state.saving=true;for(const control of form.querySelectorAll('input,button'))control.disabled=true;
    try{await api('routine-policy-save',payload);if(current(state)){$('modal').close();editor=null;}await refresh();}
    catch(error){if(current(state)){$('modal-error').textContent=error.message;for(const control of form.querySelectorAll('input,button'))control.disabled=false;}}
    finally{state.saving=false;}
   };
  }catch(error){if(editor===state&&$('routine-policy-loading')===target&&$('modal').open)target.textContent=error.message;}
 }
 return {edit};
}
