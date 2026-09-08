import test from 'node:test';
import assert from 'node:assert/strict';
import {ConnectionState,createRefreshLoop,connectionCopy} from './connection-state.mjs';

test('connection failures preserve last sync and back off with a fixed maximum',()=>{
 let now=1000;const state=new ConnectionState({now:()=>now});state.success();assert.equal(state.canSend(),true);
 for(let n=0;n<100;n++){state.failure();assert.ok(state.delay()<=30000);}
 assert.equal(state.canSend(),false);assert.equal(state.lastSync,1000);now=5000;state.reconnect();assert.equal(state.canSend(),false);state.success();assert.equal(state.delay(),1800);assert.equal(state.lastSync,5000);
});
test('expired pairing is not automatically retried and never claims to be online',()=>{
 const state=new ConnectionState();state.failure({code:'PAIRING_REQUIRED'});state.reconnect();assert.equal(state.status,'expired');assert.equal(state.canSend(),false);
 assert.match(connectionCopy(state.snapshot()).detail,/Save any draft before reloading/);
 state.failure(Error('Late network failure'));state.success();assert.equal(state.status,'expired');
});
test('foreground and network events share one bounded state read and pause while hidden',async()=>{
 const timers=new Map();let n=0,reads=0,visible=true,resolve;
 const state=new ConnectionState(),loop=createRefreshLoop({connection:state,visible:()=>visible,setTimer:(fn,ms)=>{timers.set(++n,{fn,ms});return n;},clearTimer:id=>timers.delete(id),refresh:()=>{reads++;return new Promise(r=>{resolve=()=>{state.success();r();};});}});
 const first=loop.start();await Promise.resolve();loop.wake();loop.wake();assert.equal(reads,1);resolve();await first;assert.equal(timers.size,1);
 visible=false;await loop.wake();assert.equal(timers.size,0);assert.equal(reads,1);
 visible=true;const resumed=loop.wake();await Promise.resolve();assert.equal(reads,2);resolve();await resumed;assert.equal(timers.size,1);loop.stop();assert.equal(timers.size,0);
});
test('failed checks schedule later reads but never replay a mutation',async()=>{
 let next,reads=0;const state=new ConnectionState();const loop=createRefreshLoop({connection:state,setTimer:(fn,ms)=>{next={fn,ms};return 1;},clearTimer(){},refresh:async()=>{reads++;state.failure();}});
 await loop.start();assert.equal(reads,1);assert.ok(next.ms>1800);await next.fn();assert.equal(reads,2);state.failure({code:'CONNECTION_EXPIRED'});await loop.wake();assert.equal(reads,2);loop.stop();
});
