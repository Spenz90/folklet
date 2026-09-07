import {escapeReview as esc,reviewSource,reviewUI} from './review-ui-common.mjs';
export function createLearningReviewUI({api,modal,refresh,getBots,onAppChange}){
 const {$,show,live,fail,action}=reviewUI({modal});let items=[];
 const label=item=>item.kind==='memory'?(item.scope==='team'?'Team notes':'Bot notes'):item.kind==='app-change'?'App change':item.kind==='workflow'?'Workflow':'Preference';
 const status=item=>item.status==='accepted'&&item.decisionMode==='automatic'?'Saved automatically':({pending:'Awaiting review',accepted:'Accepted',reviewed:'Reviewed',rejected:'Declined',superseded:'Earlier revision',undone:'Undone'}[item.status]||item.status);
 function card(item,history=false){
  const editable=['memory','preference'].includes(item.kind),bot=getBots().find(bot=>bot.id===item.botId);
  return '<article class="learning-card"><p class="note">'+esc(label(item))+' · '+esc(status(item))+(bot?' · '+esc(bot.name):'')+(item.revision?' · Revision '+Number(item.revision):'')+'</p><h3>'+esc(item.title)+'</h3><div class="learning-text" style="white-space:pre-wrap">'+esc(item.text)+'</div>'+(item.reason?'<p class="note">'+esc(item.reason)+'</p>':'')+reviewSource(item.source)+(item.kind==='memory'&&item.status==='pending'?'<details><summary>Current notes before this proposal</summary><div style="white-space:pre-wrap">'+esc(item.previousText||'(Empty)')+'</div></details>':'')+'<div class="row">'+(item.status==='pending'?'<button class="btn primary" '+(item.kind==='app-change'&&onAppChange?'data-lr-app':'data-lr-accept')+'="'+esc(item.id)+'">'+(item.kind==='workflow'?'Save paused routine':item.kind==='app-change'?(onAppChange?'Review code change':'Mark reviewed'):'Accept revision')+'</button><button class="btn" data-lr-reject="'+esc(item.id)+'">Decline</button>':'')+(item.kind==='app-change'&&onAppChange&&item.status==='reviewed'?'<button class="btn" data-lr-app="'+esc(item.id)+'">Review code change</button>':'')+(editable?'<button class="btn" data-lr-edit="'+esc(item.id)+'">Edit as new revision</button>'+(!history?'<button class="btn" data-lr-history="'+esc(item.id)+'">History</button>':'')+(item.status==='accepted'?'<button class="btn" data-lr-undo="'+esc(item.id)+'">Undo this revision</button>':''):'')+'</div></article>';
 }
 async function open(){
  const view=show('Learning & memory','Review what your bots remember and reuse.','<div id="learning-review">Loading learning…</div>','learning-review');
  try{const result=await api('learning');if(!live(view))return;items=result;
   $('learning-review').innerHTML='<div class="row"><button class="btn" data-lr-notes>Edit saved notes</button><button class="btn" data-lr-policy>Memory review settings</button></div><p class="note">Preferences and new note proposals wait for review by default. Accepted workflows create paused routines. App changes need a separate code review and apply step.</p>'+(items.length?items.map(item=>card(item)).join(''):'<p class="empty-box">No lessons yet. Ask a bot to remember a preference or propose a useful workflow.</p>');
  }catch(error){if(live(view)){$('learning-review').innerHTML='<button class="btn" data-lr-home>Try again</button>';fail(view,error);}}
 }
 async function history(id){
  const view=show('Revision history','Earlier notes stay available. Undo restores the previous accepted revision.','<div id="learning-review">Loading history…</div>','learning-history');
  try{const result=await api('learning-history?id='+encodeURIComponent(id));if(!live(view))return;items=result;$('learning-review').innerHTML='<button class="btn" data-lr-home>All learning</button>'+items.map(item=>card(item,true)).join('');}
  catch(error){if(live(view)){$('learning-review').innerHTML='<button class="btn" data-lr-history="'+esc(id)+'">Try again</button>';fail(view,error);}}
 }
 function edit(item){
  const view=show('Edit '+label(item).toLowerCase(),'Save a new draft for review. Earlier revisions remain in history.',`<form id="learning-edit-form"><label for="lr-title">Title</label><input id="lr-title" maxlength="120" value="${esc(item.title)}" required><label for="lr-text">${esc(label(item))}</label><textarea id="lr-text" rows="12" maxlength="${item.kind==='memory'?40000:12000}" ${item.kind==='memory'?'':'required'}>${esc(item.text)}</textarea><label for="lr-reason">Why this change? (optional)</label><textarea id="lr-reason" rows="2" maxlength="2000"></textarea><button class="btn primary">Save revision for review</button></form>`,'learning-edit');
  const form=$('learning-edit-form');form.onsubmit=async event=>{event.preventDefault();if(!live(view))return;const body={id:item.id,title:$('lr-title').value,text:$('lr-text').value,reason:$('lr-reason').value};await action(view,form,()=>api('learning-revise',body),result=>history(result.id));};
 }
 async function policy(){
  const view=show('Memory review settings','Choose separately for each notes scope.','<div id="learning-policy">Loading settings…</div>','learning-policy');
  try{const result=await api('learning-policy');if(!live(view))return;
   const options=value=>'<option value="review" '+(value==='review'?'selected':'')+'>Review every change</option><option value="automatic" '+(value==='automatic'?'selected':'')+'>Save automatically with history</option>';
   $('learning-policy').innerHTML='<form id="learning-policy-form"><label for="lr-bot-policy">Bot notes — private to that bot</label><select id="lr-bot-policy">'+options(result.botNotes)+'</select><label for="lr-team-policy">Team notes — shared with your bots</label><select id="lr-team-policy">'+options(result.teamNotes)+'</select><p class="note">These settings apply to note changes made with Crew’s memory tool. Preferences and skills still need review. Other workspace files follow the task’s normal file permissions.</p><p class="note">Automatic saves keep revision history and can be undone. Turning review back on affects future changes.</p><button class="btn primary">Save review settings</button></form>';
   const form=$('learning-policy-form');form.onsubmit=async event=>{event.preventDefault();if(!live(view))return;const body={botNotes:$('lr-bot-policy').value,teamNotes:$('lr-team-policy').value};await action(view,form,()=>api('learning-policy',body),()=>open());};
  }catch(error){if(live(view)){$('learning-policy').innerHTML='<button class="btn" data-lr-policy>Try again</button>';fail(view,error);}}
 }
 function chooseNotes(){
  const bots=getBots(),view=show('Edit saved notes','Your edits are saved directly with revision history.','<form id="learning-notes-choice"><label for="lr-scope">Notes scope</label><select id="lr-scope"><option value="bot">One bot’s notes</option><option value="team" '+(bots.length?'':'selected')+'>Shared team notes</option></select><label for="lr-bot">Bot</label><select id="lr-bot" '+(bots.length?'':'disabled')+'>'+bots.map(bot=>'<option value="'+esc(bot.id)+'">'+esc(bot.name)+'</option>').join('')+'</select><p class="note">Team notes are shared with every bot. Bot notes apply only to the chosen bot.</p><button class="btn primary">Open notes</button></form>','learning-notes-choice');
  $('lr-scope').onchange=()=>{$('lr-bot').disabled=$('lr-scope').value==='team';};const form=$('learning-notes-choice');form.onsubmit=async event=>{event.preventDefault();if(!live(view))return;const scope=$('lr-scope').value,botId=scope==='bot'?$('lr-bot').value:undefined;if(scope==='bot'&&!botId){fail(view,Error('Create a bot first, or choose shared team notes.'));return;}await notes(botId,scope);};
 }
 async function notes(botId,scope){
  const title=scope==='team'?'Shared team notes':(getBots().find(bot=>bot.id===botId)?.name||'Bot')+' notes',view=show(title,'Save your own edits with history, or leave the current notes unchanged.','<div id="learning-notes">Loading notes…</div>','learning-notes');
  try{const result=await api('learning-memory?scope='+encodeURIComponent(scope)+(botId?'&botId='+encodeURIComponent(botId):''));if(!live(view))return;
   $('learning-notes').innerHTML='<form id="learning-notes-form"><label for="lr-notes-text">'+esc(scope==='team'?'Notes shared with every bot':'Notes for this bot')+'</label><textarea id="lr-notes-text" rows="14" maxlength="40000">'+esc(result.text)+'</textarea><p class="note">Saving an empty field clears these notes. You can restore them from revision history.</p><button class="btn primary">Save notes</button></form>';
   const form=$('learning-notes-form');form.onsubmit=async event=>{event.preventDefault();if(!live(view))return;const body={botId,scope,text:$('lr-notes-text').value};await action(view,form,()=>api('learning-memory-save',body),async result=>{await refresh();if(live(view))await history(result.id);});};
  }catch(error){if(live(view)){$('learning-notes').innerHTML='<button class="btn" data-lr-notes>Choose notes again</button>';fail(view,error);}}
 }
 document.addEventListener('click',async event=>{const d=event.target.closest('button')?.dataset;if(!d)return;const view=$('modal-error');try{
  if(d.lrHome!==undefined)await open();else if(d.lrPolicy!==undefined)await policy();else if(d.lrNotes!==undefined)chooseNotes();else if(d.lrHistory)await history(d.lrHistory);
  else if(d.lrEdit){const item=items.find(item=>item.id===d.lrEdit);if(item)edit(item);}
  else if(d.lrApp&&onAppChange){const item=items.find(item=>item.id===d.lrApp);if(item)await action(view,$('learning-review'),()=>onAppChange(item));}
  else if(d.lrAccept||d.lrReject||d.lrUndo){const id=d.lrAccept||d.lrReject||d.lrUndo,route=d.lrAccept?'learning-accept':d.lrReject?'learning-reject':'learning-undo';await action(view,$('learning-review'),()=>api(route,{id}),async()=>{await refresh();if(live(view))await (d.lrUndo?history(id):open());});}
 }catch(error){fail(view,error);}});
 return {open,history,notes};
}
