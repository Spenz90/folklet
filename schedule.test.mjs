import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {Store,nextOccurrence} from './store.mjs';

const local=(year,month,day,hour=0,minute=0)=>new Date(year,month-1,day,hour,minute).getTime();
function make(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'crew-schedule-test-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const store=new Store(dir),bot=store.create({name:'Calendar helper'});
 return {store,bot};
}

test('daily runs later today, and moves to tomorrow at the exact scheduled time',()=>{
 const routine={scheduleKind:'daily',time:'09:30'};
 assert.equal(nextOccurrence(routine,local(2026,9,4,9,29)),local(2026,9,4,9,30));
 assert.equal(nextOccurrence(routine,local(2026,9,4,9,30)),local(2026,9,5,9,30));
 assert.equal(nextOccurrence(routine,local(2026,12,31,10)),local(2027,1,1,9,30));
});

test('weekdays skip the weekend, including a weekend reference time',()=>{
 const routine={scheduleKind:'weekdays',time:'08:00'};
 assert.equal(nextOccurrence(routine,local(2026,9,4,7)),local(2026,9,4,8));
 assert.equal(nextOccurrence(routine,local(2026,9,4,8)),local(2026,9,7,8));
 assert.equal(nextOccurrence(routine,local(2026,9,5,7)),local(2026,9,7,8));
 assert.equal(nextOccurrence(routine,local(2026,9,6,23)),local(2026,9,7,8));
});

test('weekly schedules honor Sunday zero, today, and next-week boundaries',()=>{
 const sunday={scheduleKind:'weekly',time:'10:15',weekday:0};
 assert.equal(nextOccurrence(sunday,local(2026,9,5,12)),local(2026,9,6,10,15));
 assert.equal(nextOccurrence(sunday,local(2026,9,6,9)),local(2026,9,6,10,15));
 assert.equal(nextOccurrence(sunday,local(2026,9,6,10,15)),local(2026,9,13,10,15));
 assert.equal(nextOccurrence({...sunday,weekday:5},local(2026,12,31,12)),local(2027,1,1,10,15));
});

test('legacy interval routines keep their elapsed-time schedule',()=>{
 const now=local(2026,9,5,15,23);
 assert.equal(nextOccurrence({minutes:90},now),now+90*60000);
 assert.equal(nextOccurrence({scheduleKind:'interval',minutes:5},now),now+5*60000);
 assert.throws(()=>nextOccurrence({minutes:0},now),/interval/);
});

test('calendar validation rejects malformed schedules and does not change saved routines',t=>{
 const {store,bot}=make(t),base={botId:bot.id,prompt:'Review my tasks',scheduleKind:'daily',time:'09:30'};
 for(const change of [{time:'24:00'},{time:'9:30'},{time:'09:60'},{scheduleKind:'monthly'},{scheduleKind:'weekly'},{scheduleKind:'weekly',weekday:7},{scheduleKind:'weekly',weekday:1.5}]){
  assert.throws(()=>store.routine({...base,...change}));
 }
 assert.equal(store.db.routines.length,0);
 const routine=store.routine({...base,enabled:false});
 assert.equal(routine.scheduleKind,'daily');
 assert.equal(routine.time,'09:30');
 assert.equal(routine.minutes,null);
 assert.ok(routine.nextRun>Date.now());
 assert.deepEqual(store.due(routine.nextRun+14*86400000),[]);
 assert.equal(routine.enabled,false);
 const updated=store.routine({...base,id:routine.id,scheduleKind:'weekly',weekday:2,enabled:true});
 assert.equal(updated.id,routine.id);
 assert.equal(store.db.routines.length,1);
 assert.equal(new Date(updated.nextRun).getDay(),2);
});

test('missed calendar runs combine into one and active tasks prevent duplicate work',t=>{
 const {store,bot}=make(t),routine=store.routine({botId:bot.id,prompt:'Morning review',scheduleKind:'daily',time:'09:00',enabled:true});
 routine.nextRun=local(2026,9,1,9);
 const resumed=local(2026,9,10,14),tasks=store.due(resumed);
 assert.equal(tasks.length,1);
 assert.equal(tasks[0].source,'routine:'+routine.id);
 assert.equal(routine.lastRun,resumed);
 assert.equal(routine.nextRun,local(2026,9,11,9));
 assert.equal(store.due(resumed).length,0);
 for(const status of ['queued','running','waiting']){
  tasks[0].status=status;
  const dueAt=routine.nextRun;
  assert.equal(store.due(dueAt).length,0);
  assert.ok(routine.nextRun>dueAt);
 }
 tasks[0].status='completed';
 assert.equal(store.due(routine.nextRun).length,1);
});

test('saved calendar schedules and paused proposals survive a restart',t=>{
 const {store,bot}=make(t);
 const daily=store.routine({botId:bot.id,prompt:'Review',scheduleKind:'daily',time:'11:45',enabled:true});
 const proposed=store.routine({botId:bot.id,prompt:'Proposed job',minutes:60,enabled:false});
 const reloaded=new Store(store.root);
 assert.deepEqual(reloaded.db.routines.find(r=>r.id===daily.id),daily);
 assert.equal(reloaded.db.routines.find(r=>r.id===proposed.id).enabled,false);
 assert.equal(reloaded.due(daily.nextRun).length,1);
});

test('calendar schedules stay on local wall time through both daylight-saving changes',()=>{
 // A separate process fixes its OS-local timezone before V8 initializes Date.
 // This keeps the test independent of the user's configured timezone, including Windows.
 const script=`
  import assert from 'node:assert/strict';
  import {nextOccurrence} from ${JSON.stringify(new URL('./store.mjs',import.meta.url).href)};
  const at=(m,d,h,min=0)=>new Date(2026,m-1,d,h,min).getTime();
  assert.equal(new Date(2026,0,1).getTimezoneOffset(),480);
  const daily={scheduleKind:'daily',time:'09:00'};
  const spring=nextOccurrence(daily,at(3,7,9));
  assert.equal(spring,at(3,8,9));
  assert.equal(spring-at(3,7,9),23*3600000);
  const fall=nextOccurrence(daily,at(10,31,9));
  assert.equal(fall,at(11,1,9));
  assert.equal(fall-at(10,31,9),25*3600000);
  const weekdays={scheduleKind:'weekdays',time:'09:00'};
  assert.equal(nextOccurrence(weekdays,at(3,6,9)),at(3,9,9));
  assert.equal(nextOccurrence({scheduleKind:'weekly',time:'09:00',weekday:0},at(3,1,9)),at(3,8,9));
  const gap={scheduleKind:'daily',time:'02:30'};
  assert.equal(nextOccurrence(gap,at(3,7,3)),at(3,8,3,30));
  assert.equal(nextOccurrence(gap,at(3,8,3,30)),at(3,9,2,30));
  const repeated={scheduleKind:'daily',time:'01:30'};
  const first=Date.parse('2026-11-01T01:30:00-07:00');
  assert.equal(nextOccurrence(repeated,at(10,31,2)),first);
  assert.equal(nextOccurrence(repeated,first),at(11,2,1,30));
  assert.equal(nextOccurrence(repeated,Date.parse('2026-11-01T01:15:00-08:00')),at(11,2,1,30));
 `;
 const result=spawnSync(process.execPath,['--input-type=module','--eval',script],{env:{...process.env,TZ:'America/Los_Angeles'},encoding:'utf8'});
 assert.equal(result.status,0,result.stderr||result.error?.message);
});
