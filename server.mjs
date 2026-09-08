import {CredentialVault} from './credential-vault.mjs';
import {Backups,inspectBackup} from './backups.mjs';
import {StateSync,historyPage} from './state-sync.mjs';
import {Usage} from './usage.mjs';
import {PushNotifications} from './push-notifications.mjs';
import {pluginCatalog,catalogRecipe,catalogSkill} from './plugin-catalog.mjs';
import {checkUpdates} from './updates.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {Store,uid,nextOccurrence} from './store.mjs';
import {calendarDays} from './calendar.mjs';
import {Computers} from './computer.mjs';
import {Engine} from './engine.mjs';
import {MobileAccess} from './mobile.mjs';
import {spawn} from 'node:child_process';
import {AccountConnection} from './account.mjs';
import {resolveCrewEngine} from './runtime.mjs';
import {readJSON,sendDownload,isManagedBrowserRequest} from './http.mjs';
import {PhoneSetupRunner} from './mobile/Setup-iPhone.mjs';
import {ProviderStore} from './providers.mjs';
import {Learning} from './learning.mjs';
import {NativeComputer} from './native-computer.mjs';
import {attachToMessage} from './attachments.mjs';
import {ModelSettings} from './model-settings.mjs';
import {Skills} from './skills.mjs';
import {Recall} from './recall.mjs';
import {IntegrationStore} from './integrations.mjs';
import {TelegramNotifications} from './notifications.mjs';
import {normalizeFallback} from './fallback.mjs';
import {routineSummary} from './routine-policy.mjs';
import {AppChanges} from './app-changes.mjs';
import {PluginConnections} from './plugin-connections.mjs';
import {PluginPackages} from './plugin-packages.mjs';
import {createHostMonitor,workspaceHostStatus} from './host-status.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const store=new Store(process.env.CREW_DATA||path.join(root,'data'));
const computers=new Computers(store.root,(b,e)=>store.event(b,e));
const vault=new CredentialVault(store.root);vault.unlockFromService();
const providers=new ProviderStore(store.root,{vault}),learning=new Learning({dataRoot:store.root,store}),nativeComputer=new NativeComputer();
const skills=new Skills({dataRoot:store.root,store}),recall=new Recall({store}),integrations=new IntegrationStore({dataRoot:store.root,store,vault}),notifications=new TelegramNotifications({dataRoot:store.root,vault});
const plugins=new PluginConnections({dataRoot:store.root,store,vault}),pluginPackages=new PluginPackages({dataRoot:store.root,skills,connections:plugins});
const engine=new Engine(store,computers,{providers}),token=randomBytes(32).toString('hex');
const appChanges=new AppChanges({appRoot:root,dataRoot:store.root,store,learning});
engine.learning=learning;engine.nativeComputer=nativeComputer;
Object.assign(engine,{skills,recall,integrations,notifications,plugins});
engine.appChanges=appChanges;
const account=new AccountConnection({executable:resolveCrewEngine()});
const modelSettings=new ModelSettings({account,providers});
const phoneSetup=new PhoneSetupRunner();
const hostMonitor=createHostMonitor({dataRoot:store.root});
let mobile;
const sync=new StateSync(),usage=new Usage({dataRoot:store.root});engine.usage=usage;
const backups=new Backups({dataRoot:store.root,vault,isIdle:()=>!store.db.tasks.some(t=>['queued','running','waiting'].includes(t.status))});backups.start();
const push=new PushNotifications({dataRoot:store.root,vault,isDeviceActive:id=>mobile?.status().devices.some(d=>d.id===id)===true});engine.push=push;
const state=()=>({version:3,workspaceId:store.db.workspaceId,bots:store.db.bots.filter(b=>!b.archived).map(view),tasks:store.db.tasks.slice(-300),routines:store.db.routines.map(r=>({...r,policySummary:routineSummary(r)})),routineCalendar:calendarDays(store.db.routines),channels:store.db.channels,notifications:store.db.notifications});
function migrateCredentials(){providers.persist();integrations.persist(integrations.items);plugins.persist(plugins.items);notifications.protect();}

const view=b=>({...b,...engine.status(b),modelPreference:b.model||'',computer:computers.summary(b.id),files:store.files(b)});
function json(res,status,value){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));}
function textFile(p){return fs.existsSync(p)?fs.readFileSync(p,'utf8'):'';}
const server=http.createServer(async(req,res)=>{try{
 if(isManagedBrowserRequest(req))return json(res,403,{error:'Use the FOLKLET app to manage permissions. Managed browsers cannot access FOLKLET.'});
 const host=req.headers.host,port=server.address().port;if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(host))return json(res,403,{error:'Invalid host'});
 const url=new URL(req.url,'http://'+host);
 if(req.method==='GET'&&url.pathname==='/auth/openrouter/callback'){
  let ok=false;try{await providers.handleOAuthCallback({code:url.searchParams.get('code'),state:url.searchParams.get('state'),error:url.searchParams.get('error')});ok=true;}catch{}
  res.writeHead(ok?200:400,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'"});
  return res.end('<!doctype html><html><title>FOLKLET connection</title><body style="font:18px system-ui;background:#111;color:#eee;padding:64px;max-width:650px"><h1>'+(ok?'OpenRouter connected':'Connection not completed')+'</h1><p>'+(ok?'Return to FOLKLET. You can close this tab.':'The sign-in expired or was not completed. Return to FOLKLET and start a new connection.')+'</p></body></html>');
 }
 if(req.method==='GET'&&url.pathname==='/health')return json(res,200,{app:'Crew',version:5,pid:process.pid});
 if(req.method==='GET'&&url.pathname==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'"});return res.end(fs.readFileSync(path.join(root,'index.html'),'utf8').replace('__TOKEN__',token));}
 if(req.method==='GET'&&['/app.js','/connection-state.mjs','/hosting-ui.mjs','/draft-storage.mjs','/sync-client.mjs','/reliability-ui.mjs','/markdown.mjs','/settings-ui.mjs','/model-settings-ui.mjs','/review-ui-common.mjs','/skills-ui.mjs','/learning-review-ui.mjs','/recall-ui.mjs','/integrations-ui.mjs','/notifications-ui.mjs','/routine-policy-ui.mjs','/fallback-ui.mjs','/app-changes-ui.mjs','/plugins-ui.mjs','/style.css'].includes(url.pathname)){res.writeHead(200,{'Content-Type':!url.pathname.endsWith('.css')?'text/javascript':'text/css','Cache-Control':'no-store'});return res.end(fs.readFileSync(path.join(root,url.pathname.slice(1))));}
 const pwaAssets={'/manifest.webmanifest':'application/manifest+json','/service-worker.js':'text/javascript','/pwa.js':'text/javascript','/offline.html':'text/html; charset=utf-8','/icons/crew-192.png':'image/png','/icons/crew-512.png':'image/png','/icons/crew-maskable-512.png':'image/png','/icons/apple-touch-icon.png':'image/png','/icons/crew.ico':'image/x-icon'};
 if(req.method==='GET'&&pwaAssets[url.pathname]){res.writeHead(200,{'Content-Type':pwaAssets[url.pathname],'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});return res.end(fs.readFileSync(path.join(root,url.pathname.slice(1))));}
 if(req.headers['x-crew-token']!==token)return json(res,403,{error:'Connection expired. Refresh the app.',code:'CONNECTION_EXPIRED'});
 if(req.method==='GET'){
  if(url.pathname==='/api/vault-status')return json(res,200,vault.status());
  if(url.pathname==='/api/backup-status')return json(res,200,backups.status());
  if(url.pathname==='/api/backup-download')return sendDownload(res,backups.download(url.searchParams.get('id')));
  if(url.pathname==='/api/usage-status')return json(res,200,usage.status());
  if(url.pathname==='/api/push-status')return json(res,200,push.status(req.headers['x-crew-device']));
  if(url.pathname==='/api/plugin-catalog')return json(res,200,pluginCatalog);
  if(url.pathname==='/api/state-delta')return json(res,200,sync.update(state(),url.searchParams.get('cursor')));
  if(url.pathname==='/api/history')return json(res,200,historyPage(store.bot(url.searchParams.get('id')),url.searchParams.get('before'),url.searchParams.get('message'),url.searchParams.get('task')));
  if(url.pathname==='/api/host-status')return json(res,200,workspaceHostStatus(await hostMonitor(),{...store.db,providers:providers.list(),phone:mobile?.status(),plugins:plugins.list(),integrations:integrations.list(),notifications:notifications.status(),vault:vault.status(),backups:backups.status(),push:push.status()}));
  if(url.pathname==='/api/model-settings')return json(res,200,await modelSettings.get(url.searchParams.get('providerId')||'codex',url.searchParams.get('model')||''));
  if(url.pathname==='/api/providers')return json(res,200,providers.list());
  if(url.pathname==='/api/provider-models')return json(res,200,await providers.modelList(url.searchParams.get('id')));
  if(url.pathname==='/api/learning')return json(res,200,learning.list());
  if(url.pathname==='/api/learning-history')return json(res,200,learning.history(url.searchParams.get('id')));
  if(url.pathname==='/api/memory-policy')return json(res,200,learning.memoryPolicy());
  if(url.pathname==='/api/learning-policy')return json(res,200,learning.memoryPolicy());
  if(url.pathname==='/api/learning-memory')return json(res,200,{text:learning.readMemory(url.searchParams.get('botId'),url.searchParams.get('scope'))});
  if(url.pathname==='/api/plugins')return json(res,200,plugins.list());
  if(url.pathname==='/api/plugin-packages')return json(res,200,pluginPackages.list());
  if(url.pathname==='/api/skills')return json(res,200,skills.list());
  if(url.pathname==='/api/app-changes')return json(res,200,appChanges.list());
  if(url.pathname==='/api/app-change')return json(res,200,appChanges.get(url.searchParams.get('id')));
  if(url.pathname==='/api/app-change-file')return json(res,200,appChanges.read({id:url.searchParams.get('id'),path:url.searchParams.get('path')}));
  if(url.pathname==='/api/skill-get')return json(res,200,skills.get(url.searchParams.get('id')));
  if(url.pathname==='/api/skill-export')return json(res,200,skills.exportSkill(url.searchParams.get('id'),url.searchParams.get('revisionId')));
  if(url.pathname==='/api/recall-settings')return json(res,200,recall.settings(url.searchParams.get('botId')));
  if(url.pathname==='/api/integrations')return json(res,200,integrations.list());
  if(url.pathname==='/api/notification-status')return json(res,200,notifications.status());
  if(url.pathname==='/api/routine-policy')return json(res,200,store.routinePolicy(url.searchParams.get('routineId')));
  if(url.pathname==='/api/fallback-settings'){const bot=store.bot(url.searchParams.get('id'));return json(res,200,{id:bot.id,fallback:normalizeFallback(bot.fallback),providers:providers.list()});}
  if(url.pathname==='/api/native-status')return json(res,200,nativeComputer.status());
  if(url.pathname==='/api/guide'){const name=url.searchParams.get('name'),titles={'QUICKSTART.md':'Quick start','HOSTING.md':'Cloud hosting','PROVIDERS.md':'Models & connections','PLUGINS.md':'Plugins & portable bundles','RECOVERY.md':'Backup, restore & credential protection','FEATURES.md':'Skills, learning & connections','SECURITY.md':'Security & privacy','RELEASE-CHECKS.md':'Release checks','FEATURE-ROADMAP.md':'Feature roadmap'};if(!titles[name])throw Error('Guide not found');return json(res,200,{title:titles[name],text:fs.readFileSync(path.join(root,name),'utf8')});}
  if(url.pathname==='/api/account-status')return json(res,200,await account.status());
  if(url.pathname==='/api/mobile-status')return json(res,200,{...mobile.status(),platform:process.platform,setup:phoneSetup.state});
  if(url.pathname==='/api/state')return json(res,200,state());
  const b=store.bot(url.searchParams.get('id'));
  if(url.pathname==='/api/models'){if(b.providerId&&b.providerId!=='codex')return json(res,200,{data:(await providers.modelList(b.providerId)).map(m=>({...m,displayName:m.name}))});const l=await engine.connect(b);const r=await engine.rpc(l,'model/list',{includeHidden:false,limit:100});return json(res,200,r);}
  if(url.pathname==='/api/preview'){const rel=url.searchParams.get('path'),file=store.safeFile(b,rel);const st=fs.statSync(file);if(!st.isFile())throw Error('Not a file');if(st.size>250000)throw Error('This file is too large to preview. Download it instead.');const ext=path.extname(file).toLowerCase();if(!['.md','.txt','.json','.csv','.tsv','.js','.mjs','.ts','.css','.html','.py','.yaml','.yml','.log'].includes(ext))throw Error('Preview is unavailable for this file type. Download it instead.');return json(res,200,{name:rel,text:fs.readFileSync(file,'utf8'),markdown:ext==='.md'});}
  if(url.pathname==='/api/files')return json(res,200,store.files(b));
  if(url.pathname==='/api/memory')return json(res,200,{bot:learning.readMemory(b.id,'bot'),team:learning.readMemory(b.id,'team')});
  if(url.pathname==='/api/file'){const file=store.safeFile(b,url.searchParams.get('path'));if(!fs.statSync(file).isFile())throw Error('Not a file');return sendDownload(res,file);}
  if(url.pathname==='/api/screen'){const c=await computers.snapshot(b);res.writeHead(200,{'Content-Type':'image/jpeg','Cache-Control':'no-store'});return res.end(c.frame);}
  return json(res,404,{error:'Not found'});
 }
 if(req.method!=='POST')return json(res,404,{error:'Not found'});
 const a=await readJSON(req,{maxBytes:['/api/backup-inspect','/api/backup-restore'].includes(url.pathname)?180*1024*1024:15000000});
 const route=url.pathname.slice(5);
 if(route==='vault-configure'){vault.configure(a);migrateCredentials();return json(res,200,vault.status());}
 if(route==='vault-unlock'){vault.unlock(a.password);migrateCredentials();return json(res,200,vault.status());}
 if(route==='backup-create')return json(res,200,backups.create(a.password));
 if(route==='backup-configure')return json(res,200,backups.configure(a));
 if(route==='backup-inspect')return json(res,200,inspectBackup(Buffer.from(String(a.base64||''),'base64'),a.password).summary);
 if(route==='backup-restore')return json(res,200,backups.restore(Buffer.from(String(a.base64||''),'base64'),a.password));
 if(route==='usage-configure')return json(res,200,usage.configure(a));
 if(route==='push-configure')return json(res,200,push.configure(a));
 if(route==='push-subscribe')return json(res,200,push.subscribe(req.headers['x-crew-device'],a.subscription));
 if(route==='push-unsubscribe')return json(res,200,push.unsubscribe(req.headers['x-crew-device']));
 if(route==='catalog-prepare')return json(res,200,plugins.save(catalogRecipe(a.id,a)));
 if(route==='catalog-skill')return json(res,200,skills.importSkill(catalogSkill(a.id)));
 if(route==='update-check')return json(res,200,await checkUpdates({current:JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version,includePreviews:a.includePreviews===true}));
 if(route==='plugin-save')return json(res,200,plugins.save(a));
 if(route==='plugin-connect')return json(res,200,await plugins.connect(a));
 if(route==='plugin-remove')return json(res,200,await plugins.remove(a.id));
 if(route==='plugin-inspect')return json(res,200,await pluginPackages.inspect(a));
 if(route==='plugin-file')return json(res,200,await pluginPackages.readFile(a));
 if(route==='plugin-install')return json(res,200,await pluginPackages.install(a));
 if(route==='plugin-package-remove')return json(res,200,await pluginPackages.remove(a.id));
 if(route==='provider-save')return json(res,200,providers.save(a));
 if(route==='provider-remove'){if(store.db.bots.some(b=>!b.archived&&b.providerId===a.id))throw Error('Choose another connection for the bots using this provider before removing it.');providers.remove(a.id);return json(res,200,{ok:true});}
 if(route==='provider-login')return json(res,200,providers.beginOpenRouterLogin({callbackUrl:`http://127.0.0.1:${server.address().port}/auth/openrouter/callback`,name:a.name,persistKey:a.persistKey===true}));
 if(route==='learning-accept')return json(res,200,learning.accept(a.id));
 if(route==='learning-reject')return json(res,200,learning.reject(a.id));
 if(route==='learning-revise')return json(res,200,learning.revise(a.id,a));
 if(route==='learning-undo')return json(res,200,learning.undo(a.id));
 if(route==='memory-policy-save')return json(res,200,learning.setMemoryPolicy(a));
 if(route==='learning-policy')return json(res,200,learning.setMemoryPolicy(a));
 if(route==='learning-memory-save')return json(res,200,learning.saveMemory(a));
 if(route==='skill-propose')return json(res,200,skills.propose(a));
 if(route==='app-change-create')return json(res,200,appChanges.create(a));
 if(route==='app-change-write')return json(res,200,appChanges.write(a));
 if(route==='app-change-check')return json(res,200,await appChanges.check(a.id));
 if(route==='app-change-tests')return json(res,200,await appChanges.runTests(a));
 if(route==='app-change-apply')return json(res,200,appChanges.apply(a));
 if(route==='app-change-undo')return json(res,200,appChanges.undo(a));
 if(route==='skill-accept')return json(res,200,skills.accept(a.id,a.revisionId));
 if(route==='skill-reject')return json(res,200,skills.reject(a.id,a.revisionId));
 if(route==='skill-enable')return json(res,200,skills.setEnabled(a.id,a.botId,a.enabled));
 if(route==='skill-import')return json(res,200,skills.importSkill(a.document));
 if(route==='skill-use'){const prompt=skills.promptFor(a.id,a.botId,a.instruction),task=store.enqueue(a.botId,prompt,{source:'skill:'+a.id});engine.drain();return json(res,200,task);}
 if(route==='recall-settings-save')return json(res,200,recall.configure(a));
 if(route==='recall-search')return json(res,200,recall.search(a.botId,{query:a.query}));
 if(route==='integration-save')return json(res,200,integrations.save(a));
 if(route==='integration-remove')return json(res,200,integrations.remove(a.id));
 if(route==='notification-configure')return json(res,200,await notifications.configure(a));
 if(route==='notification-pair')return json(res,200,await notifications.beginPairing());
 if(route==='notification-check')return json(res,200,await notifications.checkPairing());
 if(route==='notification-activate')return json(res,200,notifications.activate(a));
 if(route==='notification-revoke')return json(res,200,notifications.revoke());
 if(route==='routine-policy-save')return json(res,200,store.updateRoutinePolicy(a.routineId,a));
 if(route==='fallback-save'){
  const bot=store.bot(a.id),fallback=normalizeFallback(a.fallback);
  if((bot.providerId||'codex')!=='codex'&&fallback.choices.some(choice=>choice.providerId==='codex'))throw Error('API bots cannot automatically switch to Codex because it has additional tools. Choose another API fallback.');
  for(const choice of fallback.choices){if(!providers.list().some(p=>p.id===choice.providerId))throw Error('Choose an available fallback connection.');await modelSettings.validate(choice.providerId,choice.model,choice.reasoningEffort);}
  if(store.db.tasks.some(t=>t.botId===bot.id&&['running','waiting'].includes(t.status)))throw Error('Stop or finish this bot’s task before changing its fallback permissions.');
  bot.fallback=fallback;store.save();return json(res,200,{id:bot.id,fallback});
 }
 if(route==='native-enable'){if(typeof a.enabled!=='boolean')throw Error('Choose whether to enable desktop control.');nativeComputer.setEnabled(a.enabled);return json(res,200,nativeComputer.status());}
 if(route==='account-login')return json(res,200,await account.beginLogin());
 if(route==='account-cancel')return json(res,200,await account.cancel(a.loginId));
 if(route==='shutdown'){json(res,200,{ok:true});setTimeout(close,100);return;}
 if(route==='mobile-configure')return json(res,200,await mobile.configure(a.origin));
 if(route==='mobile-disable')return json(res,200,await mobile.disable());
 if(route==='mobile-pair')return json(res,200,mobile.createPairing());
 if(route==='mobile-revoke')return json(res,200,mobile.revoke(a.deviceId));
 if(route==='mobile-setup'){if(process.platform!=='win32')return json(res,200,phoneSetup.start({localPort:server.address().port,localToken:token,mobilePort:mobile.port}));const script=path.join(root,'mobile','Setup-iPhone.ps1');if(!fs.existsSync(script))throw Error('The iPhone setup helper is missing.');const helper=spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',script],{cwd:root,detached:true,stdio:'ignore',windowsHide:false});helper.on('error',()=>{phoneSetup.state={status:'failed',error:'The Windows phone setup could not start. Run mobile/Setup-iPhone.ps1 from the FOLKLET folder.'};});helper.unref();return json(res,200,{ok:true,status:'external'});}
 if(route==='create')return json(res,200,view(store.create(a)));
 if(route==='channel'){if(!String(a.name||'').trim())throw Error('Name the channel');const members=[...new Set(a.members||[])];if(!members.length)throw Error('Choose at least one bot');members.forEach(id=>store.bot(id));const ch={id:uid(),name:String(a.name).slice(0,60),members,createdAt:Date.now()};store.db.channels.push(ch);store.save();return json(res,200,ch);}
 if(route==='read-notifications'){for(const n of store.db.notifications)n.read=true;store.save();return json(res,200,{ok:true});}
 if(route==='routine'){const r=store.routine(a);return json(res,200,r);}
 if(route==='routine-toggle')return json(res,200,store.setRoutineEnabled(a.routineId,a.enabled));
 if(route==='routine-run'){const r=store.db.routines.find(r=>r.id===a.routineId);if(!r)throw Error('Routine not found');store.enqueue(r.botId,r.prompt,{source:'routine:'+r.id});engine.drain();return json(res,200,{ok:true});}
 const b=store.bot(a.id);
 if(route==='contact'){if(typeof a.pinned==='boolean')b.pinned=a.pinned;if(typeof a.readAt==='number')b.readAt=Math.min(Date.now(),a.readAt);store.save();return json(res,200,{ok:true});}
 if(route==='duplicate'){const copy=store.create({name:b.name+' copy',role:b.role,memory:b.memory,color:b.color,icon:b.icon});copy.model=b.model;copy.reasoningEffort=b.reasoningEffort||'';copy.providerId=b.providerId||'codex';store.save();return json(res,200,view(copy));}
 if(route==='send'){if(a.channelId){const ch=store.db.channels.find(c=>c.id===a.channelId);if(!ch?.members.includes(b.id))throw Error('Choose a member of this channel.');}const prompt=attachToMessage(store,b,a.text,a.attachments);const t=store.enqueue(b.id,prompt,{channelId:a.channelId||null});engine.drain();return json(res,200,t);}
 if(route==='retry'){const t=store.db.tasks.find(t=>t.id===a.taskId&&t.botId===b.id);if(!t)throw Error('Task not found');store.enqueue(b.id,t.prompt,{channelId:t.channelId,source:'retry'});engine.drain();}
 else if(route==='stop')await engine.interrupt(b);
 else if(route==='answer')engine.answer(b,a.requestId,a.answer);

 else if(route==='update'){
  if(typeof a.name==='string'&&!a.name.trim())throw Error('Name cannot be empty');
  if(a.color!==undefined&&(typeof a.color!=='string'||!/^#[a-f0-9]{6}$/i.test(a.color)))throw Error('Choose a valid avatar color.');
  if(a.icon!==undefined&&!['spark','research','writer','builder','chief'].includes(a.icon))throw Error('Choose a valid avatar shape.');
  const list=providers.list();
  if(a.providerId!==undefined&&!list.some(p=>p.id===a.providerId))throw Error('Choose an available connection.');
  if(a.model!==undefined&&(typeof a.model!=='string'||a.model.length>200))throw Error('Model ID must be under 200 characters.');
  const providerId=a.providerId??b.providerId??'codex',changingProvider=providerId!==(b.providerId||'codex');
  const nextModel=typeof a.model==='string'?a.model.trim():changingProvider?list.find(p=>p.id===providerId)?.defaultModel||'':b.model||'';
  if(providerId!=='codex'&&!nextModel)throw Error('Choose a model ID for this connection.');
  const changingModel=nextModel!==(b.model||''),nextEffort=a.reasoningEffort!==undefined?a.reasoningEffort:changingProvider||changingModel?'':b.reasoningEffort||'';
  await modelSettings.validate(providerId,nextModel,nextEffort);
  const engineChanged=changingProvider||changingModel||nextEffort!==(b.reasoningEffort||'');
  // Validate all requested fields before touching the current conversation.
  await engine.disconnect(b);
  if(engineChanged){if(b.threadId)b.previousThreads=[...new Set([...(b.previousThreads||[]),b.threadId])];b.threadId=null;b.toolVersion=null;}
  b.providerId=providerId;b.model=nextModel;b.reasoningEffort=nextEffort;
  for(const field of ['name','role','memory'])if(typeof a[field]==='string')b[field]=a[field].slice(0,field==='memory'?24000:field==='name'?60:12000);
  if(a.color!==undefined)b.color=a.color;if(a.icon!==undefined)b.icon=a.icon;store.save();
 }
 else if(route==='archive'){await engine.disconnect(b);b.archived=true;for(const r of store.db.routines)if(r.botId===b.id)r.enabled=false;for(const t of store.db.tasks)if(t.botId===b.id&&t.status==='queued')t.status='cancelled';store.save();}
 else if(route==='memory')return json(res,200,learning.saveMemory({botId:b.id,scope:a.scope,text:a.text}));
 else if(route==='upload'){if(typeof a.name!=='string'||a.name!==path.basename(a.name)||/[<>:"/\\|?*]/.test(a.name))throw Error('Invalid filename');const file=store.safeFile(b,'attachments/'+Date.now()+'-'+a.name,false);fs.mkdirSync(path.dirname(file),{recursive:true});const buf=Buffer.from(String(a.base64||''),'base64');if(buf.length>10000000)throw Error('File too large');fs.writeFileSync(file,buf);return json(res,200,{path:path.relative(b.cwd,file).replaceAll('\\','/')});}
 else if(route==='computer-start')await computers.get(b);
 else if(route==='computer-control')await computers.control(b,a.paused===true);
 else if(route==='computer-action'){const c=await computers.get(b);if(!c.paused)throw Error('Take control of the browser first.');await computers.act(b,a,'user');}
 else if(route==='record-start')await computers.record(b,true);
 else if(route==='record-stop'){const steps=await computers.record(b,false);const instructions=`Carry out this demonstrated workflow. Inspect the page before every action and adapt if the layout changes. Ask the user for values omitted from the recording. Do not infer permission for external actions from the recording.\n\n${JSON.stringify(steps,null,2)}`;const file=store.safeFile(b,'routines/demonstration-'+Date.now()+'.json',false);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(steps,null,2));return json(res,200,{prompt:instructions,steps:steps.length});}
 else return json(res,404,{error:'Not found'});
 json(res,200,{ok:true});
}catch(e){if(!res.headersSent)json(res,400,{error:e.message});else res.end();}});
server.listen(Number(process.env.CREW_PORT||4318),'127.0.0.1',async()=>{computers.protectControlOrigin(`http://127.0.0.1:${server.address().port}`);plugins.protectControlOrigin(`http://127.0.0.1:${server.address().port}`);console.log(`FOLKLET is running at http://127.0.0.1:${server.address().port}`);mobile=new MobileAccess({dataRoot:store.root,appRoot:root,localPort:server.address().port,localToken:token,port:Number(process.env.CREW_MOBILE_PORT||4320),protectOrigin:origin=>{computers.protectControlOrigin(origin);plugins.protectControlOrigin(origin);}});try{await mobile.start();}catch(e){mobile.lastError=e.message;console.error('Phone access:',e.message);}});
async function close(){backups.close();push.close();appChanges.close();phoneSetup.close();nativeComputer.setEnabled(false);await mobile?.close();await account.close();await engine.close();await nativeComputer.close();providers.close();integrations.close();await plugins.close();await notifications.close();vault.close();server.close();process.exit();}process.on('SIGINT',close);process.on('SIGTERM',close);
