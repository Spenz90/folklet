import {createHash} from 'node:crypto';
export const MISSED_RUN_GRACE_MS=60000;
export function normalizeRoutinePolicy(input={}){
 const missedRunPolicy=input.missedRunPolicy??'run_once',notificationPolicy=input.notificationPolicy??'changes';
 if(!['run_once','skip'].includes(missedRunPolicy))throw Error('Choose Run once or Skip for missed runs.');
 if(!['changes','all'].includes(notificationPolicy))throw Error('Choose notifications for changes or every completed run.');
 const retryLimit=input.retryLimit??0,retryDelayMinutes=input.retryDelayMinutes??1;
 if(!Number.isInteger(retryLimit)||retryLimit<0||retryLimit>3)throw Error('Choose zero to three retries.');
 if(!Number.isInteger(retryDelayMinutes)||retryDelayMinutes<1||retryDelayMinutes>60)throw Error('Choose a retry delay of one to sixty minutes.');
 return {missedRunPolicy,notificationPolicy,retryLimit,retryDelayMinutes};
}
export function missedRunDecision(r,now=Date.now()){
 if(!r.enabled||!Number.isFinite(r.nextRun)||r.nextRun>now)return {due:false,missed:false,run:false};
 const missed=now-r.nextRun>MISSED_RUN_GRACE_MS;
 return {due:true,missed,run:!missed||normalizeRoutinePolicy(r).missedRunPolicy==='run_once'};
}
const normalizedResult=value=>String(value??'').replace(/\s+/g,' ').trim();
export function compareRoutineResult(previous,result){
 const normalized=normalizedResult(result),hash=createHash('sha256').update(normalized).digest('hex');
 return {hash,summary:normalized.slice(0,1600),changed:!previous||previous.hash!==hash,first:!previous};
}
export function recordRoutineOutcome(r,t,flags={},now=Date.now()){
 if(t.routineCompletionHandled)return {handled:true,notification:null,retryScheduled:false,changed:null,retryAt:null};
 if(!['completed','failed','interrupted','cancelled'].includes(t.status))return {handled:false};
 const policy=normalizeRoutinePolicy(r),last=r.lastOutcome,completed=t.status==='completed';
 t.routineCompletionHandled=true;
 const previous=r.lastSuccessfulResult,comparison=completed?compareRoutineResult(previous,t.result):null;
 const changed=comparison?.changed??null,recovered=completed&&last&&last.status!=='completed';
 const retryAttempt=Number.isInteger(t.retryAttempt)?t.retryAttempt:0;
 const retryScheduled=t.status==='failed'&&r.enabled&&flags.retryable===true&&flags.assistantOutput===false&&flags.toolStarted===false&&retryAttempt<policy.retryLimit;
 const retryAt=retryScheduled?now+Math.min(3600000,policy.retryDelayMinutes*60000*2**retryAttempt):null;
 r.lastOutcome={taskId:t.id,status:t.status,at:now,retryAttempt,changed,recovered:!!recovered,retryScheduled};
 r.resultComparison={kind:completed?(recovered?'recovered':comparison.first?'first':changed?'changed':'unchanged'):'failed',at:now,previousTaskId:previous?.taskId??null,previousSummary:previous?.summary??'',currentSummary:comparison?.summary??''};
 if(comparison)r.lastSuccessfulResult={taskId:t.id,at:now,hash:comparison.hash,summary:comparison.summary};
 r.runHistory=[...(r.runHistory||[]),{...r.lastOutcome}].slice(-20);
 r.retry=retryScheduled?{at:retryAt,attempt:retryAttempt+1,afterTaskId:t.id,runId:t.routineRunId||t.id}:null;
 if(completed)delete r.lastError;else r.lastError=t.status==='failed'?'The last run failed. Open its task to review the error.':'The last run was stopped. It will not be retried automatically.';
 const notify=!retryScheduled&&(completed?(policy.notificationPolicy==='all'||changed||recovered):true);
 const title=completed?(recovered?'Routine recovered':comparison.first?'Routine completed':changed?'Routine result changed':'Routine completed'):t.status==='failed'?'Routine needs attention':'Routine stopped';
 const text=completed?comparison.summary||r.name:r.lastError;
 return {handled:true,notification:notify?{title,text}:null,retryScheduled,changed,retryAt};
}
export function routineSummary(r,now=Date.now()){
 const policy=normalizeRoutinePolicy(r),time=at=>new Date(at).toLocaleString(),timezone=Intl.DateTimeFormat().resolvedOptions().timeZone;
 const next=r.enabled?(r.retry?.at??r.nextRun):null;
 const nextExplanation=!r.enabled?'Paused until you enable it.':r.retry?`Retry ${r.retry.at<=now?'is ready':`at ${time(r.retry.at)}`} after a temporary failure before work began.`:Number.isFinite(next)?`Next run ${next<=now?'is ready':`at ${time(next)}`} (${timezone}).`:'Choose a valid schedule.';
 return {...policy,nextRunAt:next,timezone,nextExplanation,missedRunExplanation:policy.missedRunPolicy==='skip'?'Skip runs missed by more than one minute.':'Run once after missed runs; do not replay the backlog.',retryExplanation:policy.retryLimit?`Up to ${policy.retryLimit} retries, starting after ${policy.retryDelayMinutes} minute${policy.retryDelayMinutes===1?'':'s'}, with increasing delay. Only before any answer or tool use.`:'Automatic retries are off.',lastOutcome:r.lastOutcome??null,resultComparison:r.resultComparison??null,retry:r.retry??null};
}
