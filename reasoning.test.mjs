import test from 'node:test';
import assert from 'node:assert/strict';
import {reasoningOptions,validateReasoningEffort,reasoningRequest,usesOpenAIResponses,sanitizeReasoningMetadata} from './reasoning.mjs';
const values=(type,model,metadata)=>reasoningOptions(type,model,metadata).map(option=>option.value);
test('OpenAI effort choices distinguish model generations and API from Codex levels',()=>{
 assert.deepEqual(values('openai','gpt-6-astra'),['','low','medium','high','xhigh','max']);
 assert.deepEqual(values('openai','gpt-5.6-luna'),['','none','low','medium','high','xhigh','max']);
 assert.deepEqual(values('openai','gpt-5.5-2026-04-23'),['','none','low','medium','high','xhigh']);
 assert.deepEqual(values('openai','gpt-5.1'),['','none','low','medium','high']);
 assert.deepEqual(values('openai','gpt-5-mini'),['','minimal','low','medium','high']);
 assert.deepEqual(values('openai','gpt-5-pro'),['','high']);
 assert.throws(()=>validateReasoningEffort('openai','gpt-6-astra','ultra'),/does not support/);
 assert.throws(()=>validateReasoningEffort('openai','gpt-6-astra','none'),/does not support/);
 assert.equal(usesOpenAIResponses('openai','gpt-6-astra'),true);
 assert.equal(usesOpenAIResponses('custom','gpt-6-astra'),false);
});
test('Anthropic effort and adaptive thinking reflect documented model support',()=>{
 assert.deepEqual(values('anthropic','claude-opus-4-5-20251101'),['','low','medium','high']);
 assert.deepEqual(values('anthropic','claude-sonnet-4-6'),['','low','medium','high','max']);
 assert.deepEqual(values('anthropic','claude-fable-5-1'),['','low','medium','high','xhigh','max']);
 assert.deepEqual(reasoningRequest('anthropic','claude-opus-4-5','low'),{output_config:{effort:'low'}});
 assert.deepEqual(reasoningRequest('anthropic','claude-opus-4-7','xhigh'),{output_config:{effort:'xhigh'},thinking:{type:'adaptive'}});
 assert.deepEqual(values('anthropic','claude-haiku-4-5'),['']);
});
test('Gemini compatibility avoids disabling mandatory reasoning or invented levels',()=>{
 assert.deepEqual(values('gemini','gemini-2.5-flash'),['','none','minimal','low','medium','high']);
 assert.deepEqual(values('gemini','gemini-2.5-pro'),['','minimal','low','medium','high']);
 assert.deepEqual(values('gemini','gemini-3.1-pro-preview'),['','minimal','low','medium','high']);
 assert.deepEqual(values('gemini','gemini-2.5-flash-image'),['']);
 assert.deepEqual(reasoningRequest('gemini','gemini-2.5-flash','none'),{reasoning_effort:'none'});
 assert.throws(()=>reasoningRequest('gemini','gemini-3.1-pro-preview','none'),/does not support/);
});
test('OpenRouter effort choices use reported enums and mandatory reasoning',()=>{
 const limited={reasoning:{supported_efforts:['high','low','high','invented'],mandatory:true,default_effort:'low',private:'omit'}};
 assert.deepEqual(values('openrouter','vendor/model',limited),['','low','high']);
 assert.deepEqual(reasoningRequest('openrouter','vendor/model','high',limited),{reasoning:{effort:'high'}});
 assert.throws(()=>reasoningRequest('openrouter','vendor/model','medium',limited),/does not support/);
 assert.deepEqual(values('openrouter','vendor/model',{reasoning:{supported_efforts:null,mandatory:true}}),['','minimal','low','medium','high','xhigh','max']);
 assert.deepEqual(values('openrouter','vendor/model',{reasoning:{supported_efforts:null}}),['','none','minimal','low','medium','high','xhigh','max']);
 assert.deepEqual(values('openrouter','openrouter/auto',{supported_parameters:['reasoning']}),['']);
 assert.deepEqual(sanitizeReasoningMetadata('openrouter',limited),{reasoning:{supported_efforts:['low','high'],mandatory:true,default_effort:'low'}});
});
test('Default omits all reasoning fields and unknown/custom metadata cannot grant support',()=>{
 for(const type of ['openai','anthropic','gemini','openrouter','ollama','custom'])assert.deepEqual(reasoningRequest(type,'unknown',''),{});
 for(const type of ['custom','ollama','openai'])assert.deepEqual(values(type,'future-model',{reasoning:{supported_efforts:null},supportedReasoningEfforts:[{reasoningEffort:'max'}]}),['']);
 for(const bad of [null,{},4,'HIGH','high '])assert.throws(()=>validateReasoningEffort('openai','gpt-5.5',bad),/does not support/);
 assert.deepEqual(reasoningRequest('openai','gpt-5.5','none'),{reasoning:{effort:'none'}});
});
