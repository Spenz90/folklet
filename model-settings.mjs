import {reasoningOptions} from './reasoning.mjs';

const labels={none:'None',minimal:'Minimal',low:'Low',medium:'Medium',high:'High',xhigh:'Extra high',max:'Max',ultra:'Ultra'};
export class ModelSettings {
 constructor({account,providers,now=Date.now}){this.account=account;this.providers=providers;this.now=now;this.codexCache=null;}
 async catalog(providerId){
  if(providerId!=='codex')return this.providers.modelList(providerId);
  if(this.codexCache&&this.now()-this.codexCache.at<300000)return this.codexCache.models;
  const connection=await this.account.connect(),models=[];let cursor;
  for(let page=0;page<10;page++){
   const response=await this.account.rpc(connection,'model/list',{includeHidden:false,limit:100,...(cursor?{cursor}:{})});
   for(const m of response.data||[])if(typeof (m.model||m.id)==='string')models.push({id:m.model||m.id,name:m.displayName||m.model||m.id,isDefault:m.isDefault===true,defaultReasoningEffort:m.defaultReasoningEffort,supportedReasoningEfforts:m.supportedReasoningEfforts});
   if(!response.nextCursor||response.nextCursor===cursor)break;cursor=response.nextCursor;
  }
  this.codexCache={at:this.now(),models};return models;
 }
 async get(providerId='codex',model=''){
  if(typeof model!=='string'||model.length>200)throw Error('Choose a valid model ID.');
  const provider=this.providers.list().find(p=>p.id===providerId);if(!provider)throw Error('Choose an available connection.');
  let models=[],notice='';try{models=await this.catalog(providerId);}catch{notice=providerId==='codex'?'Connect ChatGPT to load available models and reasoning levels.':'The model list could not load. You can enter a model ID manually.';}
  const defaultModelId=providerId==='codex'?models.find(m=>m.isDefault)?.id||'':provider.defaultModel||'';
  // A configured Codex default can differ from the catalog's advertised default.
  // Require a named model before offering an effort override.
  const selected=models.find(m=>m.id===(providerId==='codex'?model:model||defaultModelId));
  let options;
  if(providerId==='codex'){
   const seen=new Set(['']);options=[{value:'',label:'Default'}];
   for(const item of selected?.supportedReasoningEfforts||[]){const value=item?.reasoningEffort;if(typeof value!=='string'||!Object.hasOwn(labels,value)||seen.has(value))continue;seen.add(value);options.push({value,label:labels[value],description:typeof item.description==='string'?item.description.slice(0,300):''});}
  }else options=reasoningOptions(provider.type,model||defaultModelId,selected);
  return {models,options,defaultModelId,defaultEffort:selected?.defaultReasoningEffort||'',notice};
 }
 async validate(providerId,model,effort){
  if(typeof effort!=='string'||effort.length>20)throw Error('Choose a valid reasoning level.');
  if(!effort)return '';
  const settings=await this.get(providerId,model);
  if(!settings.options.some(option=>option.value===effort))throw Error('This model does not support that reasoning level. Choose Default or one of its supported levels.');
  return effort;
 }
}
