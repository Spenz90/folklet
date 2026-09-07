// Verified provider contracts, September 2026. Unknown models deliberately use Default.
// https://developers.openai.com/api/docs/models/gpt-6-astra
// https://developers.openai.com/api/docs/guides/latest-model
// https://platform.claude.com/docs/en/build-with-claude/effort
// https://ai.google.dev/gemini-api/docs/openai
// https://openrouter.ai/docs/guides/best-practices/reasoning-tokens
const labels={none:'None',minimal:'Minimal',low:'Low',medium:'Medium',high:'High',xhigh:'Extra high',max:'Maximum'};
const order=Object.keys(labels),standard=['low','medium','high'];
const openAI=new Map([
 ['gpt-6-astra',[...standard,'xhigh','max']],
 ...['gpt-5.6-sol','gpt-5.6-terra','gpt-5.6-luna'].map(id=>[id,['none',...standard,'xhigh','max']]),
 ...['gpt-5.5','gpt-5.4','gpt-5.2'].map(id=>[id,['none',...standard,'xhigh']]),
 ['gpt-5.1',['none',...standard]],
 ...['gpt-5','gpt-5-mini','gpt-5-nano'].map(id=>[id,['minimal',...standard]]),
 ['gpt-5-pro',['high']],
 ...['o1','o3','o3-mini','o4-mini'].map(id=>[id,standard])
]);
const claude=new Map([
 ['claude-opus-4-5',standard],
 ...['claude-opus-4-6','claude-sonnet-4-6','claude-mythos-preview'].map(id=>[id,[...standard,'max']]),
 ...['claude-opus-4-7','claude-opus-4-8','claude-opus-5','claude-sonnet-5','claude-fable-5','claude-mythos-5','claude-fable-5-1','claude-mythos-5-1'].map(id=>[id,[...standard,'xhigh','max']])
]);
const gemini=new Map([
 ...['gemini-2.5-flash','gemini-2.5-flash-lite'].map(id=>[id,['none','minimal',...standard]]),
 ...['gemini-2.5-pro','gemini-3.1-pro','gemini-3.1-flash-lite','gemini-3-flash'].map(id=>[id,['minimal',...standard]]),
 // Google's compatibility guide currently demonstrates only low for this newer model.
 ['gemini-3.8-flash',['low']]
]);
const modelId=(type,model)=>String(model||'').replace(type==='anthropic'?/-\d{8}$/:/-\d{4}-\d{2}-\d{2}$/,'').replace(type==='gemini'?/-preview(?:-\d{2}-\d{2})?$/:/$^/,'');

export function sanitizeReasoningMetadata(type,metadata){
 if(type!=='openrouter'||!metadata||typeof metadata.reasoning!=='object'||!metadata.reasoning)return {};
 const source=metadata.reasoning,reasoning={};
 if(source.supported_efforts===null)reasoning.supported_efforts=null;
 else if(Array.isArray(source.supported_efforts))reasoning.supported_efforts=order.filter(value=>source.supported_efforts.includes(value));
 if(typeof source.mandatory==='boolean')reasoning.mandatory=source.mandatory;
 if(typeof source.default_enabled==='boolean')reasoning.default_enabled=source.default_enabled;
 if(order.includes(source.default_effort))reasoning.default_effort=source.default_effort;
 return Object.keys(reasoning).length?{reasoning}:{};
}
export function reasoningOptions(type,model,metadata){
 const id=modelId(type,model);let efforts=[];
 if(type==='openai')efforts=openAI.get(id)||[];
 if(type==='anthropic')efforts=claude.get(id)||[];
 if(type==='gemini')efforts=gemini.get(id)||[];
 if(type==='openrouter'){
  const r=sanitizeReasoningMetadata(type,metadata).reasoning;
  efforts=r?.supported_efforts===null?order:r?.supported_efforts||[];
  if(r?.mandatory)efforts=efforts.filter(value=>value!=='none');
 }
 return [{value:'',label:'Default'},...efforts.map(value=>({value,label:labels[value]}))];
}
export function validateReasoningEffort(type,model,effort='',metadata){
 if(typeof effort!=='string'||!reasoningOptions(type,model,metadata).some(option=>option.value===effort))throw Error('This model does not support that reasoning level. Choose Default or one of its listed levels.');
 return effort;
}
export function usesOpenAIResponses(type,model){
 if(type!=='openai')return false;
 const id=modelId(type,model);
 return /^gpt-[56](?:[.-]|$)/.test(id)||['o1','o3','o3-mini','o3-pro','o4-mini'].includes(id);
}
export function reasoningRequest(type,model,effort='',metadata){
 validateReasoningEffort(type,model,effort,metadata);
 if(!effort)return {};
 if(type==='openrouter'||usesOpenAIResponses(type,model))return {reasoning:{effort}};
 if(type==='anthropic')return {output_config:{effort},...(modelId(type,model)!=='claude-opus-4-5'?{thinking:{type:'adaptive'}}:{})};
 return {reasoning_effort:effort};
}
