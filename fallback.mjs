const safeString=(value,max,label)=>{
 if(typeof value!=='string'||value.length>max||/[\u0000-\u001f\u007f]/.test(value))throw Error('Choose a valid '+label+'.');
 return value.trim();
};
export function normalizeFallback(input={}){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Choose valid fallback settings.');
 if(input.enabled!==undefined&&typeof input.enabled!=='boolean')throw Error('Choose whether fallback is enabled.');
 if(input.contentSharingApproved!==undefined&&typeof input.contentSharingApproved!=='boolean')throw Error('Confirm which connections may receive task content.');
 const enabled=input.enabled===true,contentSharingApproved=input.contentSharingApproved===true;
 const choices=input.choices??[];
 if(!Array.isArray(choices)||choices.length>3)throw Error('Choose up to three fallback models.');
 const seen=new Set(),normalized=choices.map(choice=>{
  if(!choice||typeof choice!=='object'||Array.isArray(choice))throw Error('Choose a valid fallback model.');
  const providerId=safeString(choice.providerId,100,'connection');
  if(!/^[a-z\d_-]+$/i.test(providerId))throw Error('Choose a valid connection.');
  const model=safeString(choice.model,200,'model ID');if(!model)throw Error('Each fallback needs a named model.');
  const reasoningEffort=safeString(choice.reasoningEffort??'',20,'reasoning level');
  if(reasoningEffort&&!/^[a-z]+$/.test(reasoningEffort))throw Error('Choose a valid reasoning level.');
  const key=JSON.stringify([providerId,model,reasoningEffort]);if(seen.has(key))throw Error('Each fallback choice must be different.');seen.add(key);
  return {providerId,model,reasoningEffort};
 });
 if(enabled&&(!contentSharingApproved||!normalized.length))throw Error('Choose fallback models and explicitly allow them to receive this bot’s task content.');
 return {enabled,contentSharingApproved,choices:normalized};
}

function failureText(error){return [error?.code,error?.cause?.code,error?.message,typeof error==='string'?error:''].filter(Boolean).join(' ');}
export function isRetryableFailure(error){
 const text=failureText(error);
 if(/cancel|abort|insufficient[_ ]quota|billing|quota.{0,30}exceed|authentication|unauthori[sz]|forbidden|invalid.{0,20}key|unsupported|not supported|model.{0,30}not found|permission|approval|context.{0,20}(length|limit)/i.test(text))return false;
 const status=Number(error?.status??error?.statusCode??error?.response?.status);
 if([400,401,402,403,404,405,409,422].includes(status))return false;
 if(status===408||status===429||(status>=500&&status<=599))return true;
 return /\b(?:ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT)\b|\b(?:request|connection|network|connect|socket|read) (?:timed out|timeout|reset|failed)\b|\bfetch failed\b|\brate limit(?:ed|ing)?\b|\btemporarily unavailable\b|\b(?:HTTP|status|error|response)[:\s]+(?:408|429|5\d\d)\b/i.test(text);
}
export function failureSummary(error){
 const text=failureText(error),status=Number(error?.status??error?.statusCode??error?.response?.status);
 if(/cancel|abort/i.test(text))return 'The task was stopped.';
 if([401,402,403].includes(status)||/authentication|unauthori[sz]|forbidden|invalid.{0,20}key|insufficient[_ ]quota|billing/i.test(text))return 'This connection needs account, key or billing attention.';
 if(status===429||/rate limit/i.test(text))return 'This connection temporarily reached its request limit.';
 if(status===408||/timeout|timed out/i.test(text))return 'This connection did not respond in time.';
 if(status>=500&&status<=599||/temporarily unavailable/i.test(text))return 'This provider is temporarily unavailable.';
 if(/ECONN|ENET|EHOST|EAI_AGAIN|network|fetch failed/i.test(text))return 'FOLKLET could not reach this connection.';
 return 'This connection could not complete the request.';
}

export function createFallbackRun(bot,{permissionContext}={}){
 let policy;try{policy=normalizeFallback(bot.fallback);}catch{policy=normalizeFallback();}
 const primary={providerId:bot.providerId||'codex',model:bot.model||'',reasoningEffort:bot.reasoningEffort||''};
 const candidates=policy.choices.filter(choice=>JSON.stringify(choice)!==JSON.stringify(primary));
 let current=primary,index=0,assistantOutput=false,toolStarted=false,blocked=false;
 const history=[];
 return {
  markAssistantOutput(){assistantOutput=true;},
  markToolStarted(){toolStarted=true;},
  next({error,retryable=isRetryableFailure(error),permissionContext:nowContext}={}){
   if(blocked)return {choice:null,reason:'Fallback has already stopped for this task.',history:history.map(item=>({...item}))};
   const reason=failureSummary(error);
   history.push({...current,reason});
   let stopReason='';
   if(!policy.enabled||!policy.contentSharingApproved)stopReason='Automatic fallback is off.';
   else if(assistantOutput||toolStarted)stopReason='Work already began. Retry manually after reviewing what happened.';
   else if(typeof permissionContext!=='string'||!permissionContext||nowContext!==permissionContext)stopReason='Task permissions or context changed. Review the task before retrying.';
   else if(!retryable||!isRetryableFailure(error))stopReason='This failure needs attention before another connection is tried.';
   else if(index>=candidates.length)stopReason='All approved fallback choices were tried.';
   else if(current.providerId!=='codex'&&candidates[index].providerId==='codex')stopReason='Switching from an API connection to ChatGPT would add tool permissions. Choose another API fallback or start a separate task.';
   if(stopReason){blocked=true;return {choice:null,reason:stopReason,history:history.map(item=>({...item}))};}
   current={...candidates[index++]};return {choice:{...current},reason,history:history.map(item=>({...item}))};
  },
  snapshot(){return {enabled:policy.enabled,assistantOutput,toolStarted,blocked,current:{...current},remaining:candidates.length-index,history:history.map(item=>({...item}))};}
 };
}
