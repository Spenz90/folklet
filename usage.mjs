import path from 'node:path';
import {atomicPrivateJSON,privateJSON} from './credential-vault.mjs';

const count=value=>Number.isSafeInteger(value)&&value>=0?value:null;
const day=now=>new Date(now).toISOString().slice(0,10);
const emptyDay=()=>({requests:0,inputTokens:0,outputTokens:0,estimatedUSD:0,unpricedRequests:0,unknownUsage:0});

export function normalizeUsage(value){
 if(!value||typeof value!=='object')return {input:null,output:null,cached:null};
 return {input:count(value.input_tokens??value.prompt_tokens??value.inputTokens),output:count(value.output_tokens??value.completion_tokens??value.outputTokens),cached:count(value.input_tokens_details?.cached_tokens??value.prompt_tokens_details?.cached_tokens??value.cache_read_input_tokens??value.cachedInputTokens)};
}

function contribute(total,item,sign=1){
 total.requests+=sign;
 total.inputTokens+=sign*(item.input??0);
 total.outputTokens+=sign*(item.output??0);
 total.estimatedUSD+=sign*(item.estimatedUSD??0);
 total.unpricedRequests+=sign*(item.estimatedUSD===null?1:0);
 total.unknownUsage+=sign*(item.input===null||item.output===null?1:0);
}

export class Usage{
 constructor({dataRoot,now=Date.now}={}){
  this.file=path.join(dataRoot,'usage.json');this.now=now;
  this.state=privateJSON(this.file,{version:1,settings:{dailyRequests:0,dailyBudgetUSD:0,rates:[]},entries:[],days:{}});
  if(this.state.version!==1||!Array.isArray(this.state.entries))throw Error('Usage storage is invalid.');
  // Totals outlive the bounded request detail list, so pruning cannot reset a limit.
  if(!this.state.days){this.state.days={};for(const item of this.state.entries)contribute(this.bucket(item.at),item);}
 }
 bucket(at){return this.state.days[day(at)]??=emptyDay();}
 save(){
  this.state.entries=this.state.entries.filter(e=>this.now()-e.at<90*86400000).slice(-10000);
  const cutoff=day(this.now()-90*86400000);
  for(const key of Object.keys(this.state.days))if(key<cutoff)delete this.state.days[key];
  atomicPrivateJSON(this.file,this.state);
 }
 configure(input){
  const dailyRequests=Number(input.dailyRequests),dailyBudgetUSD=Number(input.dailyBudgetUSD),rates=input.rates||[];
  if(!Number.isSafeInteger(dailyRequests)||dailyRequests<0||dailyRequests>100000||!Number.isFinite(dailyBudgetUSD)||dailyBudgetUSD<0||dailyBudgetUSD>100000||!Array.isArray(rates)||rates.length>100)throw Error('Choose valid daily request and budget limits. Zero means off.');
  const seen=new Set();
  for(const rate of rates){
   if(typeof rate.providerId!=='string'||!rate.providerId||rate.providerId.length>100||typeof rate.model!=='string'||!rate.model||rate.model.length>200||!['inputPerMillion','outputPerMillion'].every(k=>Number.isFinite(rate[k])&&rate[k]>=0&&rate[k]<=100000)||seen.has(rate.providerId+'\0'+rate.model))throw Error('Choose one valid price entry per connection and model.');
   seen.add(rate.providerId+'\0'+rate.model);
  }
  this.state.settings={dailyRequests,dailyBudgetUSD,rates:rates.map(r=>({providerId:r.providerId,model:r.model,inputPerMillion:r.inputPerMillion,outputPerMillion:r.outputPerMillion}))};
  this.save();return this.status();
 }
 beforeRequest({providerId,model,taskId,botId}){
  const status=this.status();
  if(status.settings.dailyRequests&&status.today.requests>=status.settings.dailyRequests)throw Object.assign(Error('Daily API request limit reached. Review Usage & limits on the host.'),{code:'USAGE_LIMIT'});
  if(status.settings.dailyBudgetUSD&&status.today.estimatedUSD>=status.settings.dailyBudgetUSD)throw Object.assign(Error('Estimated daily API budget reached. Review Usage & limits on the host.'),{code:'USAGE_LIMIT'});
  const item={id:globalThis.crypto.randomUUID(),at:this.now(),providerId,model,taskId,botId,input:null,output:null,cached:null,estimatedUSD:null};
  this.state.entries.push(item);contribute(this.bucket(item.at),item);this.save();return item.id;
 }
 record(id,value){
  const item=this.state.entries.find(e=>e.id===id);if(!item)return;
  const total=this.bucket(item.at);contribute(total,item,-1);
  Object.assign(item,normalizeUsage(value),{estimatedUSD:null});
  const rate=this.state.settings.rates.find(r=>r.providerId===item.providerId&&r.model===item.model);
  if(rate&&item.input!==null&&item.output!==null)item.estimatedUSD=(item.input*rate.inputPerMillion+item.output*rate.outputPerMillion)/1e6;
  contribute(total,item);this.save();
 }
 status(){
  const today={...(this.state.days[day(this.now())]||emptyDay())},budget=this.state.settings.dailyBudgetUSD;
  return {settings:this.state.settings,day:day(this.now()),timeZone:'UTC',today,alert:budget&&today.estimatedUSD>=budget?'budget-reached':budget&&today.estimatedUSD>=budget*.8?'near-budget':null,entries:this.state.entries.slice(-100).map(({taskId,...e})=>e),note:'API usage only. Prices are your estimates in USD, not provider bills. Cached and special token pricing can differ. Limits block new requests after recorded usage; requests already sent can exceed a cost budget. ChatGPT subscription usage is not measured here.'};
 }
}
