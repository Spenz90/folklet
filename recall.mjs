// Conversation recall stays local. Every read rechecks the requesting bot's scope.
const snippet=(text,query,limit=700)=>{const index=text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase()),start=Math.max(0,index-140);return (start?'…':'')+text.slice(start,start+limit)+(text.length>start+limit?'…':'');};
export class Recall {
 constructor({store}){this.s=store;}
 settings(botId){const b=this.s.bot(botId);return {botId:b.id,includeShared:b.recallShared===true};}
 configure({botId,includeShared}){if(typeof includeShared!=='boolean')throw Error('Choose whether this bot may recall shared chats.');const b=this.s.bot(botId);b.recallShared=includeShared;this.s.save();return this.settings(botId);}
 visible(botId,{excludeTaskId}={}){
  const bot=this.s.bot(botId),shared=new Set(bot.recallShared===true?this.s.db.channels.filter(c=>c.members.includes(botId)).map(c=>c.id):[]);
  return this.s.db.bots.filter(b=>!b.archived).flatMap(owner=>owner.messages.filter(m=>['user','assistant'].includes(m.role)&&m.text&&(!excludeTaskId||m.taskId!==excludeTaskId)&&(m.channelId?shared.has(m.channelId):owner.id===botId)).map(message=>({owner,message})));
 }
 source(owner,m){return {messageId:m.id,botId:owner.id,botName:owner.name,role:m.role,at:m.at,taskId:m.taskId||null,channelId:m.channelId||null,url:'/?'+new URLSearchParams({bot:owner.id,message:m.id,...(m.taskId?{task:m.taskId}:{})})};}
 search(botId,{query,limit=8,excludeTaskId}={}){
  if(typeof query!=='string'||!query.trim()||query.length>300)throw Error('Enter a search of 1–300 characters.');
  if(!Number.isInteger(limit)||limit<1||limit>30)throw Error('Request between 1 and 30 results.');
  query=query.trim();const terms=[...new Set(query.toLocaleLowerCase().split(/\s+/).filter(Boolean))];
  return this.visible(botId,{excludeTaskId}).filter(({message:m})=>terms.every(term=>m.text.toLocaleLowerCase().includes(term))).sort((a,b)=>(b.message.at||0)-(a.message.at||0)).slice(0,limit).map(({owner,message:m})=>({...this.source(owner,m),snippet:snippet(m.text,query)}));
 }
 read(botId,{ownerId,messageId,offset=0}={}){
  if(!Number.isInteger(offset)||offset<0)throw Error('Choose a valid text offset.');
  const hit=this.visible(botId).find(({owner,message})=>owner.id===ownerId&&message.id===messageId);if(!hit)throw Error('This source is unavailable to this bot.');
  const {owner,message:m}=hit;if(offset>m.text.length)throw Error('This text offset is past the message.');
  const end=Math.min(m.text.length,offset+20000);return {...this.source(owner,m),text:m.text.slice(offset,end),offset,nextOffset:end<m.text.length?end:null,truncated:end<m.text.length};
 }
}
