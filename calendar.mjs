import {nextOccurrence} from './store.mjs';

// Project the next week without changing the scheduler. Intervals are grouped
// within each day so a five-minute routine does not create thousands of rows.
export function calendarDays(routines,now=Date.now()){
 const today=new Date(now);
 return Array.from({length:7},(_,offset)=>{
  const start=new Date(today.getFullYear(),today.getMonth(),today.getDate()+offset).getTime();
  const end=new Date(today.getFullYear(),today.getMonth(),today.getDate()+offset+1).getTime();
  const items=[];
  for(const r of routines){
   if(!r.enabled||!Number.isFinite(r.nextRun))continue;
   try{
    const from=Math.max(start,now),interval=(r.scheduleKind||'interval')==='interval';
    let first=r.nextRun,count=1;
    if(interval){
     const step=r.minutes*60000;if(!(step>=300000))continue;
     if(first<from)first+=Math.ceil((from-first)/step)*step;
     count=Math.floor((end-1-first)/step)+1;
    }else first=Math.max(first,nextOccurrence(r,from-1));
    if(first<start||first>=end||count<1)continue;
    items.push({routineId:r.id,firstRun:first,count});
   }catch{/* Invalid schedules are paused by the scheduler. */}
  }
  return {start,items:items.sort((a,b)=>a.firstRun-b.firstRun)};
 });
}
