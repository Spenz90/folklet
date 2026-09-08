// Reconnect only reads workspace state. Mutations are never queued or replayed.
export class ConnectionState {
  constructor({now=Date.now,onChange=()=>{}}={}) {this.now=now;this.onChange=onChange;this.status='connecting';this.lastSync=0;this.failures=0;}
  snapshot(){return {status:this.status,lastSync:this.lastSync,failures:this.failures};}
  emit(){this.onChange(this.snapshot());}
  success(){if(this.status==='expired')return;this.status='online';this.lastSync=this.now();this.failures=0;this.emit();}
  failure(error){if(this.status==='expired')return;this.failures++;this.status=error?.code==='CONNECTION_EXPIRED'||error?.code==='PAIRING_REQUIRED'?'expired':'offline';this.emit();}
  reconnect(){if(this.status==='expired')return;this.status=this.lastSync?'reconnecting':'connecting';this.emit();}
  delay(){return this.status==='expired'?60000:this.failures?Math.min(30000,1800*2**Math.min(this.failures,5)):1800;}
  canSend(){return this.status==='online';}
}

export function createRefreshLoop({refresh,connection,visible=()=>true,setTimer=setTimeout,clearTimer=clearTimeout}) {
  let timer=null,running=null,stopped=true;
  const clear=()=>{if(timer!==null)clearTimer(timer);timer=null;};
  const schedule=()=>{clear();if(!stopped&&visible()&&connection.status!=='expired')timer=setTimer(tick,connection.delay());};
  async function tick(){clear();if(stopped||!visible()||connection.status==='expired')return;
    if(running)return running;
    running=Promise.resolve().then(refresh).catch(()=>{}).finally(()=>{running=null;schedule();});return running;
  }
  return {start(){stopped=false;return tick();},wake(){clear();if(visible()){connection.reconnect();return tick();}},stop(){stopped=true;clear();}};
}

export function connectionCopy({status,lastSync},now=Date.now()) {
  const ago=lastSync?Math.max(0,Math.floor((now-lastSync)/60000)):null;
  const last=ago===null?'No workspace snapshot yet.':ago<1?'Last synced just now.':`Last synced ${ago} min ago.`;
  if(status==='online')return {title:'Host connected',detail:'Your workspace is up to date.',action:'Host status'};
  if(status==='expired')return {title:'Reconnect this device',detail:'Save any draft before reloading. Your host restarted or this device needs pairing again.',action:'Reload to reconnect'};
  if(status==='connecting')return {title:'Connecting to your host',detail:'Checking your private workspace…',action:'Try now'};
  if(status==='reconnecting')return {title:'Refreshing your workspace',detail:last+' Your draft stays in this open page.',action:'Try now'};
  return {title:'Host connection lost',detail:last+' Keep Tailscale and your host online. Drafts stay in this open page; nothing is resent.',action:'Try now'};
}
