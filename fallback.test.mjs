import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeFallback,isRetryableFailure,failureSummary,createFallbackRun} from './fallback.mjs';
const choices=[{providerId:'first',model:'one',reasoningEffort:'low'},{providerId:'second',model:'two',reasoningEffort:''}];
const bot=()=>({providerId:'codex',model:'primary',fallback:{enabled:true,contentSharingApproved:true,choices:structuredClone(choices)}});
const temporary=()=>Object.assign(Error('Provider temporarily unavailable'),{status:503});
test('fallback starts off and requires explicit content-sharing consent and named unique choices',()=>{
 assert.deepEqual(normalizeFallback(),{enabled:false,contentSharingApproved:false,choices:[]});
 for(const input of [{enabled:true},{enabled:true,choices},{enabled:true,contentSharingApproved:true},{choices:[...choices,choices[0]]},{choices:[{providerId:'api',model:''}]},{choices:[{providerId:'api',model:'one',reasoningEffort:'UPPER'}]},{choices:Array(4).fill(choices[0])}])assert.throws(()=>normalizeFallback(input));
 assert.equal(normalizeFallback(bot().fallback).choices.length,2);
});
test('only conservative transport, timeout, rate-limit and temporary server failures retry',()=>{
 for(const error of [temporary(),{status:429},{status:408},Error('HTTP 502'),Error('request timed out'),Error('fetch failed'),{code:'ECONNRESET'},{cause:{code:'EAI_AGAIN'}}])assert.equal(isRetryableFailure(error),true,String(error.message));
 for(const error of [{status:401},{status:429,message:'insufficient_quota'},Error('unsupported model HTTP 503'),Error('permission approval timeout'),Error('Task cancelled'),Error('AbortError'),Error('Model not found'),Error('Something failed'),{status:403,message:'request timed out'}])assert.equal(isRetryableFailure(error),false,String(error.message));
});
test('approved fallback order is frozen for the task and never changes the bot preference',()=>{
 const b=bot(),run=createFallbackRun(b,{permissionContext:'same-context'});b.fallback.choices.reverse();
 const one=run.next({error:temporary(),permissionContext:'same-context'});assert.deepEqual(one.choice,choices[0]);
 one.choice.providerId='tampered';assert.equal(run.snapshot().current.providerId,'first');
 assert.deepEqual(run.next({error:temporary(),permissionContext:'same-context'}).choice,choices[1]);
 const exhausted=run.next({error:temporary(),permissionContext:'same-context'});assert.equal(exhausted.choice,null);assert.match(exhausted.reason,/All approved/);assert.equal(exhausted.history.length,3);
 for(let i=0;i<10;i++)run.next({error:temporary(),permissionContext:'same-context'});assert.equal(run.snapshot().history.length,3);
 assert.equal(b.providerId,'codex');assert.equal(b.model,'primary');
});
test('any answer or tool start blocks all subsequent fallback, including read-only tools',()=>{
 for(const method of ['markAssistantOutput','markToolStarted']){
  const run=createFallbackRun(bot(),{permissionContext:'same'});run[method]();const next=run.next({error:temporary(),permissionContext:'same'});assert.equal(next.choice,null);assert.match(next.reason,/Work already began/);
 }
});
test('changed or missing task permission context prevents cross-provider transmission',()=>{
 for(const [before,after] of [['initial','changed'],[undefined,undefined],['initial',undefined],['','']]){
  const run=createFallbackRun(bot(),{permissionContext:before});assert.equal(run.next({error:temporary(),permissionContext:after}).choice,null);
 }
});
test('disabled, malformed or nonretryable policies never start another provider',()=>{
 for(const fallback of [undefined,{enabled:false},{enabled:true,contentSharingApproved:false,choices}]){
  const run=createFallbackRun({...bot(),fallback},{permissionContext:'same'});assert.equal(run.next({error:temporary(),permissionContext:'same'}).choice,null);
 }
 const run=createFallbackRun(bot(),{permissionContext:'same'});assert.equal(run.next({error:Error('unsupported model'),retryable:true,permissionContext:'same'}).choice,null);
});
test('failure history excludes raw provider messages, keys and private URLs',()=>{
 const secret='private-fixture-value',error=Object.assign(Error('Request failed at https://private.example/'+secret),{status:503});
 const run=createFallbackRun(bot(),{permissionContext:'same'}),next=run.next({error,permissionContext:'same'});
 assert.equal(next.choice.providerId,'first');assert.equal(JSON.stringify(next).includes(secret),false);assert.equal(failureSummary(error).includes('private.example'),false);
});
test('a fallback identical to the primary preference is skipped instead of replaying it',()=>{
 const b=bot();b.fallback.choices.unshift({providerId:'codex',model:'primary',reasoningEffort:''});
 assert.deepEqual(createFallbackRun(b,{permissionContext:'same'}).next({error:temporary(),permissionContext:'same'}).choice,choices[0]);
});
test('API to Codex transitions cannot add terminal or plugin permissions, even later in a chain',()=>{
 const b=bot();b.providerId='api';b.fallback.choices=[{providerId:'codex',model:'named',reasoningEffort:''}];
 let run=createFallbackRun(b,{permissionContext:'same'}),next=run.next({error:temporary(),permissionContext:'same'});assert.equal(next.choice,null);assert.match(next.reason,/add tool permissions/);
 b.providerId='codex';b.fallback.choices=[choices[0],{providerId:'codex',model:'named',reasoningEffort:''}];run=createFallbackRun(b,{permissionContext:'same'});
 assert.equal(run.next({error:temporary(),permissionContext:'same'}).choice.providerId,'first');assert.equal(run.next({error:temporary(),permissionContext:'same'}).choice,null);
});
