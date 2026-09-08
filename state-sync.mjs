import {createHash,randomBytes} from 'node:crypto';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('base64url');
// Each bounded snapshot belongs to this host process. No history is retained in
// the browser service worker. Unknown/evicted cursors receive a fresh snapshot.
export class StateSync{
 constructor({limit=16}={}){this.limit=limit;this.snapshots=new Map();this.session=randomBytes(12).toString('hex');this.counter=0;}
 update(state,cursor){const bots=state.bots.map(b=>({...b,messages:b.messages.slice(-60),messageCount:b.messages.length,events:b.events.slice(-100)}));const next={...state,bots},signature=hash(next);let entry=[...this.snapshots.values()].find(e=>e.signature===signature);if(!entry){entry={cursor:this.session+':'+(++this.counter),signature,botIds:bots.map(b=>b.id),botHashes:new Map(bots.map(b=>[b.id,hash(b)])),fieldHashes:new Map(Object.entries(next).filter(([key])=>key!=='bots').map(([key,value])=>[key,hash(value)]))};this.snapshots.set(entry.cursor,entry);while(this.snapshots.size>this.limit)this.snapshots.delete(this.snapshots.keys().next().value);}
 const previous=this.snapshots.get(cursor);if(!previous)return {cursor:entry.cursor,full:true,state:next};if(previous.cursor===entry.cursor)return {cursor,unchanged:true};
 const changes={};for(const key of Object.keys(next))if(key!=='bots'&&entry.fieldHashes.get(key)!==previous.fieldHashes.get(key))changes[key]=next[key];
 return {cursor:entry.cursor,full:false,changes,bots:bots.filter(b=>entry.botHashes.get(b.id)!==previous.botHashes.get(b.id)),removed:previous.botIds.filter(id=>!entry.botHashes.has(id))};
 }
}
export function historyPage(bot,before,messageId,taskId){let end=bot.messages.length;if(messageId||taskId){const index=bot.messages.findIndex(m=>messageId?m.id===messageId:m.taskId===taskId);if(index<0)throw Error('This source is no longer available.');end=Math.min(bot.messages.length,index+31);}else if(before){end=bot.messages.findIndex(m=>m.id===before);if(end<0)throw Error('This history cursor is no longer available. Refresh the conversation.');}const start=Math.max(0,end-60);return {id:bot.id,messages:bot.messages.slice(start,end),hasMore:start>0,sourcePage:!!(messageId||taskId)};}
