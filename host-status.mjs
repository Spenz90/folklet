import fs from 'node:fs/promises';
import os from 'node:os';
import {execFile} from 'node:child_process';

const run = (file, args) => new Promise(resolve => {
  execFile(file, args, {encoding:'utf8', timeout:2500, maxBuffer:16384, windowsHide:true}, (error, stdout) => {
    resolve({ok:!error, text:error ? '' : stdout});
  });
});
const fields = text => Object.fromEntries(String(text).split('\n').map(line => {
  const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1).trim()];
}));

// Read-only, fixed commands. Raw paths, process output and account details never
// become part of the phone-facing report. An unavailable check stays unknown.
export async function inspectHost({dataRoot, platform=process.platform, pid=process.pid,
  uid=process.getuid?.(), uptime=process.uptime(), now=Date.now(), execute=run,
  statfs=fs.statfs, memory=()=>({total:os.totalmem(),free:os.freemem()}),
  timeZone=Intl.DateTimeFormat().resolvedOptions().timeZone}={}) {
  let service={}, linger='', disk=null;
  const checks=[];
  const check=(id,title,status,detail)=>checks.push({id,title,status,detail});
  if (platform==='linux') {
    const [unit,user] = await Promise.all([
      execute('/usr/bin/systemctl',['--user','show','crew.service','--property=ActiveState,UnitFileState,MainPID,Restart,NRestarts']),
      Number.isInteger(uid) && uid>0 ? execute('/usr/bin/loginctl',['show-user',String(uid),'--property=Linger','--value']) : Promise.resolve({ok:false,text:''})
    ]);
    if(unit.ok)service=fields(unit.text);
    if(user.ok)linger=user.text.trim();
  }
  const managed=service.ActiveState==='active' && Number(service.MainPID)>0 && (pid===null || Number(service.MainPID)===pid);
  const enabled=service.UnitFileState==='enabled';
  const restarts=managed && ['on-failure','always'].includes(service.Restart);
  const startsAtBoot=managed && enabled && linger==='yes';
  if(uid===0)check('user','Host account','attention','Folklet is running as root. Move it to a regular user account before doing work.');
  if(platform==='linux') {
    check('service','Background service',managed?'ready':'attention',managed?'This workspace is running under its private user service.':'This workspace is not verified as the Folklet user service. Open the setup steps to keep it running after you disconnect.');
    check('startup','Starts after a reboot',startsAtBoot?'ready':!managed||linger==='no'||!enabled?'attention':'unknown',startsAtBoot?'The service is enabled and the user manager is configured to start at boot.':'The service must be enabled and user lingering must be on. See the setup steps; these settings are never changed by a status check.');
    check('restart','Recovers after a host crash',restarts?'ready':'attention',restarts?'The service manager can restart Folklet. Interrupted tasks still need review; they are not replayed automatically.':'Automatic host restart has not been verified for this workspace.');
  } else {
    check('service','Background service','attention','This workspace runs on your computer. Keep Folklet open and prevent the computer from sleeping, or use a private Linux server.');
  }
  if(dataRoot)try {const stat=await statfs(dataRoot);disk={freeBytes:Number(stat.bavail)*Number(stat.bsize),totalBytes:Number(stat.blocks)*Number(stat.bsize)};}catch{}
  if(disk && Number.isFinite(disk.freeBytes) && disk.totalBytes>0) {
    check('storage','Workspace storage',disk.freeBytes<1024**3?'attention':'ready',disk.freeBytes<1024**3?'Less than 1 GB is available. Free space or expand the host disk before large tasks.':'The workspace disk has at least 1 GB available. This is a snapshot, not a storage guarantee.');
  } else {disk=null;check('storage','Workspace storage','unknown','Available workspace disk space could not be checked.');}
  let ram=null;try{const value=memory();if(Number.isFinite(value.total)&&Number.isFinite(value.free)&&value.total>0)ram={totalBytes:value.total,freeBytes:Math.max(0,value.free)};}catch{}
  if(ram)check('memory','Host memory',ram.freeBytes<512*1024**2?'attention':'ready',ram.freeBytes<512*1024**2?'Less than 512 MB is free. Browsers or local models may need more memory.':'Memory is available now. Browser and local-model needs vary.');
  else check('memory','Host memory','unknown','Available host memory could not be checked.');
  return {checkedAt:now,platform,kind:managed?'service':'computer',uptimeSeconds:Math.max(0,Math.floor(uptime)),
    timeZone,startsAtBoot,recoversAfterCrash:restarts,disk,memory:ram,checks};
}

export function workspaceHostStatus(report,{bots=[],tasks=[],routines=[],providers=[],phone={},plugins=[],integrations=[],notifications={},vault={},backups={},push={}}={}) {
  const enabled=routines.filter(r=>r.enabled), used=new Set(bots.filter(b=>!b.archived).flatMap(b=>[b.providerId||'codex',...(b.fallback?.enabled?b.fallback.choices||[]:[]).map(c=>c.providerId)]));
  const temporary=providers.filter(p=>used.has(p.id)&&p.keyStorage==='session').length;
  const checks=[...report.checks,{id:'phone',title:'Private phone access',status:phone.enabled?'ready':'attention',detail:phone.enabled?'The paired-device gateway is running. Keep Tailscale connected on your phone and host.':'Connect your phone from the owner interface. Phone access uses private Tailscale HTTPS.'}];
  if(temporary)checks.push({id:'connections',title:'Connections after a restart',status:'attention',detail:`${temporary} connection${temporary===1?' uses':'s use'} a temporary API key. Reconnect after a restart, or explicitly remember the key on the host.`});
  const unavailable=[...used].filter(id=>id!=='codex'&&(!providers.some(p=>p.id===id)||providers.some(p=>p.id===id&&(p.keyStorage==='locked'||!p.hasKey&&!['custom','ollama'].includes(p.type))))).length;
  if(unavailable)checks.push({id:'unavailable-connections',title:'Primary and fallback credentials',status:'attention',detail:`${unavailable} selected connection${unavailable===1?' needs':'s need'} credentials or vault unlock. Review the bot's primary and fallback connections on the host.`});
  const disconnected=plugins.filter(p=>!p.connected).length,temporaryIntegrations=integrations.filter(p=>p.enabled&&p.tokenStorage==='session').length;
  if(plugins.length)checks.push({id:'plugins',title:'Plugin connections',status:disconnected||plugins.some(p=>['session','locked'].includes(p.secretStorage))?'attention':'ready',detail:`${plugins.length} configured; ${disconnected} disconnected. Plugins require manual reconnection after every host restart, including those with protected credentials. Session-only plugin secrets must be entered again.`});
  if(temporaryIntegrations)checks.push({id:'integrations',title:'Repository access after restart',status:'attention',detail:`${temporaryIntegrations} enabled integration${temporaryIntegrations===1?' uses':'s use'} a session-only token. Configure protected storage on the host to retain it.`});
  if(integrations.some(p=>p.enabled&&p.tokenStorage==='locked'))checks.push({id:'locked-integrations',title:'Protected repository access',status:'attention',detail:'Unlock the vault before using the enabled repository connections.'});
  if(notifications.tokenStorage==='session'||notifications.tokenStorage==='locked')checks.push({id:'notifications',title:'Telegram notification readiness',status:'attention',detail:notifications.tokenStorage==='session'?'The Telegram token will disappear after restarting.':'The Telegram token is protected but the vault is locked.'});
  if(vault.configured)checks.push({id:'vault',title:'Credential vault',status:vault.unlocked?'ready':'attention',detail:vault.unlocked?(vault.mode==='password'?'Unlocked now. A password vault needs unlocking after restart unless systemd supplies its credential.':'Unlocked through this computer account’s OS protection.'):'Unlock the vault on the host to use protected credentials.'});
  const legacy=providers.filter(p=>p.keyStorage==='disk').length+integrations.filter(p=>p.tokenStorage==='disk').length+plugins.filter(p=>p.secretStorage==='disk').length+(notifications.tokenStorage==='disk'?1:0);
  if(legacy)checks.push({id:'legacy-secrets',title:'Legacy remembered credentials',status:'attention',detail:`${legacy} connection${legacy===1?' still uses':'s still use'} plaintext storage. Open Credential protection to migrate saved keys.`});
  checks.push({id:'backups',title:'Workspace backups',status:backups.enabled&&vault.unlocked&&backups.lastRun&&!backups.lastError?'ready':'attention',detail:backups.enabled?(backups.lastError||(!backups.lastRun?'The first scheduled backup has not completed. Keep the vault unlocked and wait for idle work.':'Scheduled backups have run. Keep a downloaded copy on another device and test recovery.')):'Automatic backups are off. Configure and test recovery on the host.'});
  if(push.enabled)checks.push({id:'push',title:'Phone push notifications',status:push.unlocked&&push.deviceCount&&!push.error?'ready':'attention',detail:push.unlocked?(push.error||(!push.deviceCount?'No active paired phone has subscribed. Enable notifications from the installed phone app.':'Paired phones have subscribed. Confirm delivery on each device; this is not a live delivery test.')):'Unlock the credential vault before push can deliver.'});
  return {...report,checks,phone:{enabled:!!phone.enabled},work:{running:tasks.filter(t=>['running','waiting'].includes(t.status)).length,queued:tasks.filter(t=>t.status==='queued').length,routines:enabled.length,nextRun:enabled.map(r=>r.nextRun).filter(Number.isFinite).sort((a,b)=>a-b)[0]||null}};
}

export function createHostMonitor(options) {
  let cached=null,pending=null;
  return async()=>{
    if(cached && Date.now()-cached.checkedAt<15000)return cached;
    if(!pending)pending=inspectHost(options).then(report=>(cached=report)).finally(()=>{pending=null;});
    return pending;
  };
}
