export const escapeReview=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const reviewLines=value=>String(value||'').split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
export function reviewSource(source){if(!source||typeof source.botId!=='string')return '';const href='/?bot='+encodeURIComponent(source.botId)+(source.taskId?'&task='+encodeURIComponent(source.taskId):source.messageId?'&message='+encodeURIComponent(source.messageId):'');return '<a class="note" href="'+escapeReview(href)+'">Open source '+(source.taskId?'task':source.messageId?'message':'bot')+'</a>';}
export function reviewUI({modal}){
 const $=id=>document.getElementById(id),busy=new WeakSet(),live=view=>view&&$('modal-error')===view&&$('modal')?.open;
 const show=(title,subtitle,body,type)=>{modal(escapeReview(title),escapeReview(subtitle),body,type);return $('modal-error');};
 const fail=(view,error)=>{if(live(view))view.textContent=error.message||String(error);};
 async function action(view,scope,work,after){
  if(!scope||!live(view)||busy.has(view))return false;busy.add(view);view.textContent='';const controls=[...scope.querySelectorAll('button,input,textarea,select')].map(control=>[control,control.disabled]);for(const [control] of controls)control.disabled=true;
  try{const result=await work();if(live(view))await after?.(result);return true;}catch(error){fail(view,error);return false;}finally{busy.delete(view);for(const [control,disabled] of controls)control.disabled=disabled;}
 }
 return {$,show,live,fail,action};
}
