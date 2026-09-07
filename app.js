import {renderMarkdown as md} from './markdown.mjs';
import {createSettingsUI} from './settings-ui.mjs';
import {createAppChangesUI} from './app-changes-ui.mjs';
const $=id=>document.getElementById(id),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icons={home:'<path d="m3 10 9-7 9 7v10H3z"/><path d="M9 20v-7h6v7"/>',inbox:'<path d="M4 4h16l2 13v3H2v-3z"/><path d="M2 15h6l2 3h4l2-3h6"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',board:'<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M9 3v18M15 3v18"/>',computer:'<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',file:'<path d="M5 2h9l5 5v15H5zM14 2v6h5"/>',settings:'<path d="m9 3-1 3-3 1 1 4-2 2 3 3v4l4 1 2-3 4 1 2-4-2-3 1-4-4-1-2-3z"/><circle cx="12" cy="12" r="3"/>'};
const icon=name=>`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${icons[name]||icons.home}</svg>`;
const symbols={spark:'✳',research:'◈',writer:'✎',builder:'⌘',chief:'✦'};
let data={bots:[],tasks:[],channels:[],routines:[],notifications:[]},view='bot',selected=null,channel=null,inspect=null,inspectTab='overview',renderKey='',msgKey='',panelKey='',screenBusy=false,screenUrl=null,attachments=[],drafts={},draftAttachments={},modalType=null,refreshing=false;
let workspaceWasAutomatic=false,initialSourcePending=true;
const sendingDrafts=new Set();
const uploadingDrafts=new Map();
const attachmentLabel=file=>file.path.split('/').pop().replace(/^\d{13}-/,'');
function renderAttachments(){if($('attachments'))$('attachments').innerHTML=attachments.map((file,index)=>'<span class="attachment-tag">'+icon('file')+'<span>'+esc(attachmentLabel(file))+'</span><button type="button" data-remove-attachment="'+index+'" aria-label="Remove '+esc(attachmentLabel(file))+' from message" title="Remove from message" '+(sendingDrafts.has(channel||selected)?'disabled':'')+'>×</button></span>').join('');}
function removeAttachment(index){const key=channel||selected;if(sendingDrafts.has(key)||!Number.isInteger(index)||index<0||index>=attachments.length)return;attachments.splice(index,1);draftAttachments[key]=[...attachments];renderAttachments();}
const phoneQuery=window.matchMedia('(max-width:600px)');
let phoneMode=phoneQuery.matches,phoneReturn='phone-bots';
const phoneSearch={bots:'',groups:''};
if(phoneMode){view='phone-bots';history.replaceState({...history.state,crewPhone:{view,id:null,detail:false}},'');}
const phoneRoot=next=>['phone-bots','phone-groups','phone-settings','inbox'].includes(next);
function saveDraft(){if($('prompt')){const key=channel||selected;drafts[key]=$('prompt').value;draftAttachments[key]=[...attachments];}}
function phoneHistory(next,id){
 const detail=!phoneRoot(next),returnView=next==='channel'?'phone-groups':next==='bot'?'phone-bots':phoneRoot(view)?view:'phone-settings';
 const state={view:next,id:id||null,detail,returnView:detail?(history.state?.crewPhone?.detail?history.state.crewPhone.returnView||phoneReturn:returnView):null};
 if(detail&&!history.state?.crewPhone?.detail){
  history.replaceState({...history.state,crewPhone:{view:returnView,id:null,detail:false}},'');
  history.pushState({...history.state,crewPhone:state},'');
 }else history.replaceState({...history.state,crewPhone:state},'');
}
const phoneBackLabel=()=>({'phone-bots':'bots','phone-groups':'groups','phone-settings':'settings',inbox:'activity'}[history.state?.crewPhone?.returnView||phoneReturn]||'Crew');
function phoneBack(){
 if(inspect){inspect=null;panelKey='';renderInspector();return;}
 if(history.state?.crewPhone?.detail)history.back();else navigate(phoneReturn,null,{history:false});
}
const bot=id=>data.bots.find(b=>b.id===id),current=()=>bot(selected),busy=b=>b&&['Working','Connecting','Needs you','Stopping'].includes(b.status);
const brightColors=['#9159fe','#1084fe','#ff309b','#ff6700','#ff9800','#00bca6','#00c972','#a3a3a3'];
const avatarColor=b=>brightColors.includes(b?.color?.toLowerCase())?b.color:({chief:'#ff9800',research:'#1084fe',writer:'#ff309b',builder:'#00c972'}[b?.icon]||'#9159fe');
const avatar=(b,large=false)=>{
 const type=b?.icon||'spark';
 const shape={
  spark:'M32 4C48 4 60 16 60 33S48 60 31 60 4 48 4 33C4 18 14 10 26 8L30 3Z',
  research:'M18 7Q20 3 26 8L31 12 38 6Q44 2 46 11L47 16Q61 21 59 38C58 52 46 60 31 59 15 59 4 47 5 32 5 21 10 12 18 7Z',
  chief:'M29 7Q33 1 38 8L59 44Q65 56 51 59L15 59Q1 57 7 44Z',
  writer:'M24 7Q35 0 44 10 57 8 59 23 67 32 57 41 60 57 44 58 32 67 23 57 7 58 7 44-3 33 8 24 8 10 24 7Z',
  builder:'M14 7 49 10Q59 11 58 22L55 50Q54 59 43 58L13 54Q4 53 5 42L7 17Q8 6 14 7Z'
 }[type]||'M32 4a28 28 0 1 1 0 56 28 28 0 0 1 0-56';
 return `<span class="avatar ${large?'large ':''}${busy(b)?'is-working ':''}${b?.status==='Needs you'?'needs-you ':''}" style="--color:${avatarColor(b)}" title="${esc(b?.activity||b?.status||'Ready')}"><svg viewBox="0 0 64 64" aria-hidden="true"><path d="${shape}" fill="currentColor"/><g class="eyes" fill="var(--bg,#070707)"><rect x="21" y="24" width="6" height="15" rx="3" transform="rotate(-6 24 31)"/><rect x="37" y="24" width="6" height="15" rx="3" transform="rotate(-6 40 31)"/></g></svg></span>`;
};

const pill=s=>`<span class="pill ${esc(String(s).toLowerCase().replaceAll(' ','-'))}">${esc(s)}</span>`;
const time=at=>at?new Date(at).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}):'';
const date=at=>at?new Date(at).toLocaleString([],{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'—';
const short=s=>String(s||'').slice(0,120);
const templates=[{name:'Chief of Staff',icon:'chief',color:'#ff9800',role:'Organize projects, break work into concrete tasks, coordinate teammates, and keep me informed when a decision is needed.'},{name:'Researcher',icon:'research',color:'#1084fe',role:'Research topics using the browser and reliable sources. Compare options, verify claims, and save useful findings with citations.'},{name:'Writer',icon:'writer',color:'#ff309b',role:'Help me write, edit, and refine clear documents. Learn my preferences, produce complete drafts, and save finished work as files.'},{name:'Builder',icon:'builder',color:'#00c972',role:'Build useful tools, automate repetitive work, debug issues, and deliver tested projects with clear instructions.'}];
async function api(route,body){let r;try{r=await fetch('/api/'+route,{method:body?'POST':'GET',headers:{'X-Crew-Token':window.CREW_TOKEN,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});}catch{throw Error('Crew cannot reach your host. Check your connection and keep Crew running.');}if(r.status===401&&window.CREW_MOBILE)location.replace('/');let result;try{result=await r.json();}catch{throw Error('Crew could not read the response. Check your connection and try again.');}if(!r.ok)throw Error(result.error||'Request failed');return result;}
let toastTimer;function toast(s){$('toast').textContent=s;$('toast').classList.remove('hidden');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.add('hidden'),6000);}
function navigate(next,id,options={}){
 if(phoneMode&&next==='home')next='phone-bots';
 if(next==='bot'&&!bot(id)){toast('This bot was archived.');next=phoneMode?'phone-bots':'home';}
 saveDraft();
 if(phoneMode){if(next==='bot')phoneReturn='phone-bots';else if(next==='channel')phoneReturn='phone-groups';else if(!phoneRoot(next))phoneReturn='phone-settings';if(options.history!==false)phoneHistory(next,id);}
 view=next;channel=next==='channel'?id:null;
 if(next==='bot'){selected=id;localStorage.setItem('crew.lastBot',id);api('contact',{id,readAt:Date.now()}).catch(()=>{});}
 if(next==='channel'){const ch=data.channels.find(c=>c.id===id);if(!ch?.members.includes(selected)||!bot(selected))selected=ch?.members.find(id=>bot(id));if(!selected){view=phoneMode?'phone-groups':'home';channel=null;}}
 if(!['bot','channel'].includes(next))inspect=null;else if(inspect)inspect=selected;
 renderKey='';msgKey='';approvalKey='';panelKey='';render();
}
let refreshPromise=null,refreshFollowup=null;
function refresh(){
 if(refreshPromise){if(!refreshFollowup)refreshFollowup=refreshPromise.then(()=>{refreshFollowup=null;return refresh();});return refreshFollowup;}
 refreshPromise=refreshOnce().finally(()=>{refreshPromise=null;});return refreshPromise;
}
async function refreshOnce(){if(refreshing)return;refreshing=true;try{data=await api('state');if(!selected||!bot(selected)){const saved=localStorage.getItem('crew.lastBot');selected=data.bots.find(b=>b.id===saved)?.id||data.bots.find(b=>b.messages.length)?.id||data.bots[0]?.id;if(!selected&&['bot','channel','home'].includes(view))view=phoneMode?'phone-bots':'home';else if(selected&&window.innerWidth>=1100){inspect=selected;inspectTab='overview';workspaceWasAutomatic=true;}}if(view==='channel'){const ch=data.channels.find(c=>c.id===channel);if(!ch?.members.some(id=>bot(id))){view=phoneMode?'phone-groups':'home';channel=null;renderKey='';}}if(view==='bot'&&document.visibilityState==='visible'){const b=current(),last=b?.messages.filter(m=>m.role==='assistant').at(-1);if(last?.at>(b.readAt||0)){b.readAt=Date.now();api('contact',{id:b.id,readAt:b.readAt}).catch(()=>{});}}render();if(initialSourcePending){initialSourcePending=false;if(new URLSearchParams(location.search).has('bot'))openSource(location.href);}}catch(e){toast(e.message);}finally{refreshing=false;}}
const htmlCache=new Map();function setHTML(id,html){if(htmlCache.get(id)===html)return;htmlCache.set(id,html);$(id).innerHTML=html;} function sidebar(){
 setHTML('nav','');
 const query=($('roster-filter').value||'').trim().toLowerCase();
 const latest=b=>b.messages?.filter(m=>m.role==='assistant'||m.role==='user').at(-1);
 const roster=[...data.bots].sort((a,b)=>Number(!!b.pinned)-Number(!!a.pinned));
 setHTML('bots',roster.filter(b=>(b.name+' '+b.role).toLowerCase().includes(query)).map(b=>{
  const m=latest(b),unread=m?.role==='assistant'&&(m.at||0)>(b.readAt||0)&&!(selected===b.id&&view==='bot');
  const preview=b.status==='Needs you'?'Needs your input':busy(b)?'Working…':m?.text?.replace(/[#*`]/g,'').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1')||b.role||'Start a conversation';
  return `<button class="bot-item ${view==='bot'&&selected===b.id?'active':''}" data-bot="${b.id}">${avatar(b)}<span class="contact-copy"><span class="contact-top"><b>${esc(b.name)}</b><time>${time(m?.at)}</time></span><small>${esc(preview)}</small></span>${unread?'<i class="unread-dot"></i>':b.pinned?'<span class="pin-mark">⌁</span>':''}</button>`;
 }).join(''));
 setHTML('channels',data.channels.filter(c=>c.name.toLowerCase().includes(query)).map(c=>{
  const members=c.members.map(bot).filter(Boolean);
  const last=members.flatMap(b=>b.messages.filter(m=>m.channelId===c.id).map(m=>({...m,speaker:b.name}))).sort((a,b)=>(a.at||0)-(b.at||0)).at(-1);
  return `<button class="channel-item ${channel===c.id?'active':''}" data-channel="${c.id}"><span class="group-avatar">${members.slice(0,3).map(b=>avatar(b)).join('')}</span><span class="contact-copy"><span class="contact-top"><b>${esc(c.name)}</b><time>${time(last?.at)}</time></span><small>${esc(last?(last.role==='user'?'You':last.speaker)+': '+last.text.replace(/[#*`]/g,''):members.map(b=>b.name).join(', '))}</small></span></button>`;
 }).join(''));
 const count=data.notifications.filter(n=>!n.read).length;
 $('inbox-count').textContent=count||'';$('inbox-count').classList.toggle('hidden',!count);
}


function header(){
 const b=current(),ch=data.channels.find(c=>c.id===channel),chat=['bot','channel'].includes(view);
 if(phoneMode){
  if(chat){
   const members=ch?.members.map(bot).filter(Boolean)||[];
   const face=ch?'<span class="group-avatar">'+members.slice(0,3).map(x=>avatar(x)).join('')+'</span>':avatar(b);
   setHTML('header',`<button class="phone-back icon-btn" data-phone-back aria-label="Back to ${phoneBackLabel()}">${icon('back')}</button><button class="header-identity phone-chat-identity" ${ch?'data-phone-group-info="'+ch.id+'"':'data-contact-menu="'+b?.id+'"'}>${face}<span><h1>${esc(ch?.name||b?.name||'Conversation')}</h1><small>${esc(ch?members.length+' bots':b?.status==='Needs you'?'Needs your input':busy(b)?'Working…':(b?.model||'Ready').replace('gpt-','GPT-'))}</small></span></button><button class="icon-btn computer-chip ${b?.computer.running?'lit':''}" data-workspace-toggle title="Show or hide workspace" aria-label="Show or hide workspace">${icon('computer')}</button>`);
  }else{
   const title={'phone-bots':'Bots','phone-groups':'Groups','phone-settings':'Settings',inbox:'Activity',routines:'Routines',tasks:'Tasks'}[view]||'Crew';
   setHTML('header',`${phoneRoot(view)?'':'<button class="phone-back icon-btn" data-phone-back aria-label="Back to '+phoneBackLabel()+'">'+icon('back')+'</button>'}<div class="phone-page-title"><h1>${title}</h1>${view==='phone-bots'?'<small><i></i> Your personal team</small>':''}</div><div class="actions">${view==='phone-bots'?'<button class="icon-btn" data-phone-tab="phone-settings" aria-label="Settings">'+icon('settings')+'</button>':view==='phone-groups'?'<button class="icon-btn" data-create-group aria-label="New group">+</button>':view==='routines'?'<button class="icon-btn" data-new-routine aria-label="New routine">+</button>':''}</div>`);
  }
  return;
 }
 setHTML('header',chat?`<button class="header-identity" ${ch?'data-phone-group-info="'+ch.id+'"':'data-contact-menu="'+b?.id+'"'} title="${ch?'Group details':'Bot details'}">${ch?'<span class="channel-avatar">#</span>':avatar(b)}<h1>${esc(ch?.name||b?.name||'Conversation')}</h1></button><div class="actions"><button class="icon-btn computer-chip ${b?.computer.running?'lit':''}" data-workspace-toggle title="Show or hide workspace" aria-label="Show or hide workspace">${icon('computer')}</button></div>`:`<h1>${{home:'Bots',inbox:'Activity',routines:'Routines',tasks:'Tasks'}[view]||'Crew'}</h1><div class="actions"><button class="icon-btn" ${view==='routines'?'data-new-routine':'data-create'} aria-label="${view==='routines'?'New routine':'New bot'}">+</button></div>`);
}


function render(){
 $('app').classList.toggle('phone-chat',phoneMode&&['bot','channel'].includes(view));
 $('app').classList.toggle('phone-root',phoneMode&&phoneRoot(view));
 sidebar();header();
 if(phoneMode&&['phone-bots','phone-groups'].includes(view))renderPhoneRoster();
 else if(phoneMode&&view==='phone-settings')renderPhoneSettings();
 else if(['bot','channel'].includes(view)&&current())renderChat();
 else{const key=JSON.stringify([view,data.tasks,data.routines,data.routineCalendar,data.notifications,data.bots.map(b=>[b.id,b.name,b.role,b.status,b.queue])]);if(key!==renderKey){renderKey=key;if(view==='home')renderHome();else if(view==='routines')renderRoutines();else if(view==='tasks')renderBoard();else if(view==='inbox')renderInbox();}}
 renderPhoneNav();renderInspector();
}
function renderPhoneNav(){
 if(!phoneMode)return;
 const count=data.notifications.filter(n=>!n.read).length;
 setHTML('phone-nav',[['phone-bots','bot','Bots'],['phone-groups','group','Groups'],['inbox','inbox','Activity'],['phone-settings','settings','Settings']].map(([next,symbol,label])=>`<button data-phone-tab="${next}" ${view===next?'aria-current="page"':''}>${icon(symbol)}<span>${label}</span>${next==='inbox'&&count?'<i aria-label="'+count+' unread updates"></i>':''}</button>`).join(''));
}
function renderPhoneRoster(){
 const groups=view==='phone-groups',kind=groups?'groups':'bots';
 if(renderKey!==view){
  renderKey=view;
  $('page').innerHTML=`<div class="phone-roster"><label class="phone-search">${icon('search')}<input id="phone-search" type="search" aria-label="Search ${kind}" placeholder="Search ${kind}" autocomplete="off"></label><div id="phone-list" class="phone-list"></div></div>${groups?'':'<div class="phone-create-bar"><button data-create-group>'+icon('group')+' New group</button><button class="primary" data-create>'+icon('plus')+' New bot</button></div>'}`;
  htmlCache.delete('phone-list');$('phone-search').value=phoneSearch[kind];
  $('phone-search').oninput=e=>{phoneSearch[kind]=e.target.value;renderPhoneRoster();};
 }
 const query=phoneSearch[kind].trim().toLowerCase();
 const clean=s=>String(s||'').replace(/[#*`]/g,'').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1');
 const rows=groups?data.channels.filter(c=>c.name.toLowerCase().includes(query)).map(c=>{
  const members=c.members.map(bot).filter(Boolean),last=members.flatMap(b=>b.messages.filter(m=>m.channelId===c.id).map(m=>({...m,speaker:b.name}))).sort((a,b)=>(a.at||0)-(b.at||0)).at(-1);
  return `<button class="phone-contact" data-channel="${c.id}"><span class="group-avatar">${members.slice(0,3).map(b=>avatar(b)).join('')||icon('group')}</span><span class="phone-contact-copy"><span class="phone-contact-top"><b>${esc(c.name)}</b><time>${time(last?.at)}</time></span><small>${esc(last?(last.role==='user'?'You':last.speaker)+': '+clean(last.text):members.length?members.map(b=>b.name).join(', '):'No active bots')}</small><span class="phone-contact-status">${members.length} bot${members.length===1?'':'s'}</span></span></button>`;
 }):[...data.bots].sort((a,b)=>Number(!!b.pinned)-Number(!!a.pinned)).filter(b=>(b.name+' '+b.role).toLowerCase().includes(query)).map(b=>{
  const last=b.messages?.filter(m=>['assistant','user'].includes(m.role)).at(-1),unread=last?.role==='assistant'&&(last.at||0)>(b.readAt||0);
  return `<button class="phone-contact" data-bot="${b.id}">${avatar(b)}<span class="phone-contact-copy"><span class="phone-contact-top"><b>${esc(b.name)}</b><time>${time(last?.at)}</time></span><small>${esc(last?(last.role==='user'?'You: ':'')+clean(last.text):b.role||'Start a conversation')}</small><span class="phone-contact-status ${busy(b)?'busy':''}"><i></i>${esc(b.status==='Needs you'?'Needs your input':busy(b)?'Working…':'Ready')}${b.pinned?' · Pinned':''}</span></span>${unread?'<i class="phone-unread" aria-label="Unread message"></i>':''}</button>`;
 });
 setHTML('phone-list',rows.join('')||`<div class="phone-empty">${icon(groups?'group':'bot')}<h2>${query?'No matches':groups?'Better together.':'Meet your next teammate.'}</h2><p>${query?'Try another name or keyword.':groups?'Bring your bots into a shared conversation.':'Give a bot a name, a job, and a little context.'}</p>${query?'':'<button class="btn primary" '+(groups?'data-create-group':'data-create')+'>'+(groups?'Create a group':'Create a bot')+'</button>'}</div>`);
}
function renderPhoneSettings(){
 const key='phone-settings:'+!!window.CREW_MOBILE;if(renderKey===key)return;renderKey=key;
 $('page').innerHTML=`<div class="phone-settings"><div class="phone-workspace-card">${avatar({icon:'spark',color:'#9159fe',status:'Ready'},true)}<div><b>Your Crew</b><p>Bots, conversations, and work. All together.</p></div></div><div class="phone-settings-section"><button data-phone-tab="phone-bots">${icon('bot')}<span>Manage bots</span><span>›</span></button><button data-nav="routines">${icon('clock')}<span>Routines</span><span>›</span></button><button data-nav="tasks">${icon('board')}<span>Task history</span><span>›</span></button><button data-crew-settings="models">${icon('settings')}<span>Models & reasoning</span><span>›</span></button><button data-crew-settings="skills">${icon('file')}<span>Skills</span><span>›</span></button><button data-crew-settings="recall">${icon('clock')}<span>Past work</span><span>›</span></button><button data-crew-settings="learning">${icon('memory')}<span>Learning review</span><span>›</span></button>${window.CREW_MOBILE?'':'<button data-crew-app-changes>'+icon('file')+'<span>App changes</span><span>›</span></button><button data-crew-settings="integrations">'+icon('computer')+'<span>Integrations</span><span>›</span></button><button data-crew-settings="notifications">'+icon('inbox')+'<span>Private notifications</span><span>›</span></button>'}</div><div class="phone-settings-section"><button data-theme>${icon('theme')}<span>Switch appearance</span><span>›</span></button>${window.CREW_MOBILE?'':'<button data-crew-settings="connections">'+icon('bot')+'<span>Connections</span><span>›</span></button>'}<button data-phone>${icon('computer')}<span>${window.CREW_MOBILE?'This iPhone':'Connect iPhone'}</span><span>›</span></button><button data-crew-settings="computer">${icon('computer')}<span>Computer access</span><span>›</span></button><button data-crew-settings="cloud">${icon('home')}<span>Cloud hosting</span><span>›</span></button><button data-settings-guide="FEATURES.md">${icon('file')}<span>Feature guide</span><span>›</span></button><button data-settings-guide="QUICKSTART.md">${icon('info')}<span>Quick start</span><span>›</span></button></div><p class="phone-settings-note">Your bots work where Crew is running. Keep that computer or server online.</p></div>`;
}
function phoneGroupInfo(id){const ch=data.channels.find(c=>c.id===id);if(!ch)return;const members=ch.members.map(bot).filter(Boolean);modal(esc(ch.name),'A shared conversation for your team.',`<div class="phone-group-members">${members.map(b=>`<button data-contact-menu="${b.id}">${avatar(b)}<span><b>${esc(b.name)}</b><small>${esc(b.role)}</small></span>${icon('settings')}</button>`).join('')||'<p class="note">This group has no active bots.</p>'}</div><p class="note">Choose who receives each message using the recipient menu above the composer.</p>`,'group-info');}
function taskRow(t){const b=bot(t.botId);return `<button class="task-row" data-bot="${t.botId}">${avatar(b)}<span class="task-title"><b>${esc(short(t.prompt))}</b><small>${esc(b?.name||'Archived bot')} · ${t.source?.startsWith('routine:')?'Routine':esc(t.source||'Task')}</small></span><time>${time(t.createdAt)}</time>${pill(t.status)}</button>`;}
function renderHome(){const ready=data.bots.filter(b=>b.status==='Needs you');$('page').innerHTML='<div class="team-home"><div class="team-home-title"><h2>Your bots</h2><p>Give a bot responsibility, and pick up the conversation whenever you need.</p></div>'+(ready.length?'<div class="attention-strip">'+ready.map(b=>'<button data-bot="'+b.id+'">'+avatar(b)+'<span><b>'+esc(b.name)+' needs you</b><small>'+esc(b.approval?.title||'Open the conversation')+'</small></span>↗</button>').join('')+'</div>':'')+'<div class="team-grid">'+data.bots.map(b=>'<button class="team-card" data-bot="'+b.id+'">'+avatar(b,true)+'<h3>'+esc(b.name)+'</h3><p>'+esc(b.role)+'</p><div class="card-bottom">'+pill(b.status)+'<span>Message ↗</span></div></button>').join('')+'<button class="team-card new" data-create><span>+</span><h3>Create a bot</h3><p>Give your next teammate a job.</p></button></div><div class="section-heading"><h3>Find the right kind of help</h3></div><div class="template-strip">'+templates.map((t,i)=>'<button class="template" data-template="'+i+'">'+avatar(t)+'<span><b>'+esc(t.name)+'</b><small>'+['Keep projects moving','Find useful answers','Put ideas into words','Build something useful'][i]+'</small></span></button>').join('')+'</div></div>';}
function renderBoard(){const groups=[['Queued',['queued']],['In progress',['running','waiting']],['Completed',['completed']],['Needs attention',['failed','interrupted','cancelled']]];$('page').innerHTML=`<div class="dashboard"><div class="greeting"><div><div class="eyebrow">WORK IN MOTION</div><h2>Task history</h2><p>Tasks update here as your bots work.</p></div></div><div class="board">${groups.map(([name,statuses])=>`<div class="board-col"><h3>${name.toUpperCase()} · ${data.tasks.filter(t=>statuses.includes(t.status)).length}</h3>${data.tasks.filter(t=>statuses.includes(t.status)).slice(-25).reverse().map(t=>`<div class="board-task"><button data-bot="${t.botId}"><p>${esc(short(t.prompt))}</p></button><div class="row between"><small>${esc(bot(t.botId)?.name||'Archived')}</small>${pill(t.status)}</div>${t.error?`<p class="note">${esc(t.error)}</p>`:''}${['failed','interrupted','cancelled'].includes(t.status)?`<button class="btn" data-retry="${t.id}" data-owner="${t.botId}" style="margin-top:10px">Retry task</button>`:''}</div>`).join('')}</div>`).join('')}</div></div>`;}
function renderInbox(){$('page').innerHTML=`<div class="dashboard"><div class="section-heading"><h3>${data.notifications.filter(n=>!n.read).length} unread updates</h3><button class="btn" data-read>Mark all read</button></div>${data.notifications.length?data.notifications.map(n=>`<div class="inbox-card ${n.read?'':'unread'}" data-bot="${n.botId}"><div class="row">${avatar(bot(n.botId))}<div><b style="font-size:12px">${esc(bot(n.botId)?.name)} · ${esc(n.title)}</b><small style="display:block">${date(n.at)}</small></div></div><p>${esc(n.text)}</p></div>`).join(''):'<div class="empty-box">You’re all caught up. Completed work and requests for input will land here.</div>'}</div>`;}
function scheduleLabel(r){const kind=r.scheduleKind||'interval',tm=r.time||'09:00',fmt=new Date('2000-01-01T'+tm).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});return kind==='daily'?'Every day at '+fmt:kind==='weekdays'?'Weekdays at '+fmt:kind==='weekly'?'Every '+['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][r.weekday??1]+' at '+fmt:r.minutes===60?'Every hour':r.minutes===1440?'Every 24 hours':'Every '+r.minutes+' minutes';}
function renderRoutines(){const upcoming=[...data.routines].filter(r=>r.enabled).sort((a,b)=>a.nextRun-b.nextRun);$('page').innerHTML='<div class="routines-page"><div class="routine-intro"><h2>Scheduled work</h2><p>Teach your bot what to do. Decide when it should happen.</p></div>'+(upcoming.length?'<div class="next-routine"><div class="eyebrow">UP NEXT</div>'+avatar(bot(upcoming[0].botId))+'<div><b>'+esc(upcoming[0].name)+'</b><small>'+date(upcoming[0].nextRun)+'</small></div></div>':'')+calendarAgenda()+'<div class="routine-grid">'+data.routines.map(r=>'<div class="routine-card"><div class="row between">'+avatar(bot(r.botId))+pill(r.enabled?'Scheduled':'Paused')+'</div><h3>'+esc(r.name)+'</h3><p>'+esc(r.prompt)+'</p><div class="routine-schedule">'+icon('clock')+esc(scheduleLabel(r))+'</div><small>'+esc(bot(r.botId)?.name)+'</small><p class="note">'+esc(r.policySummary?.nextExplanation||'')+'</p><div class="row"><button class="btn" data-routine-run="'+r.id+'">Run now</button><button class="btn" data-routine-toggle="'+r.id+'">'+(r.enabled?'Pause':'Enable')+'</button><button class="btn" data-routine-policy="'+r.id+'">Reliability</button><button class="icon-btn" data-routine-edit="'+r.id+'" title="Edit routine">•••</button></div></div>').join('')+'<button class="routine-card new-routine" data-new-routine><span>+</span><h3>Create a routine</h3><p>Start with a simple task you repeat.</p></button></div><p class="note">Routines run while Crew’s host is online.</p></div>';}
function chatMessage(m,index,messages,ch){
 if(m.role==='system')return `<div class="system-message">${esc(m.text)}</div>`;
 const user=m.role==='user',previous=messages[index-1],next=messages[index+1];
 const same=x=>x&&x.role===m.role&&(user||x.owner?.id===m.owner.id)&&(!x.at||!m.at||Math.abs(x.at-m.at)<120000);
 const newGroup=!same(previous),endGroup=!same(next);
 const divider=m.at&&(!previous?.at||m.at-previous.at>600000)?`<div class="message-time">${date(m.at)}</div>`:'';
 const paragraphs=!user&&!/```|~~~|^\s*(?:#|[-*] |\d+\. |> )|\|/m.test(m.text)?m.text.split(/\n\s*\n+/).filter(Boolean):[m.text];
 return divider+`<div data-source-message="${esc(m.id)}" class="chat-message ${user?'is-user':'is-bot'} ${newGroup?'group-start':''} ${endGroup?'group-end':''}">${ch&&!user&&newGroup?`<div class="sender-label">${esc(m.owner.name)}</div>`:''}${m.source?.startsWith('routine:')?'<div class="sender-label">Scheduled routine</div>':''}<div class="bubble-stack">${paragraphs.map(p=>`<div class="message-text bubble">${md(p)}</div>`).join('')}</div>${taskExtras(m)}</div>`;
}

function closeRecipientPicker(restoreFocus=false){
 const trigger=$('recipient'),menu=$('recipient-options');if(!trigger||!menu)return;
 trigger.setAttribute('aria-expanded','false');menu.hidden=true;
 if(restoreFocus)trigger.focus();
}
function openRecipientPicker(position){
 const trigger=$('recipient'),menu=$('recipient-options');if(!trigger||!menu)return;
 const pageTop=$('page').getBoundingClientRect().top;
 menu.style.maxHeight=Math.max(60,Math.min(320,trigger.getBoundingClientRect().top-pageTop-12))+'px';
 menu.hidden=false;trigger.setAttribute('aria-expanded','true');
 const options=[...menu.querySelectorAll('[role=option]')];
 const index=position==='first'?0:position==='last'?options.length-1:Math.max(0,options.findIndex(el=>el.getAttribute('aria-selected')==='true'));
 options[index]?.focus({preventScroll:true});options[index]?.scrollIntoView({block:'nearest'});
}
function renderRecipientPicker(ch){
 const picker=$('recipient-picker');if(!picker)return;
 const members=ch.members.map(bot).filter(Boolean),chosen=bot(selected);
 const key=JSON.stringify([selected,members.map(b=>[b.id,b.name,b.icon,b.color])]);
 if(picker.dataset.renderKey===key)return;
 picker.dataset.renderKey=key;
 const trigger=$('recipient'),menu=$('recipient-options'),focused=document.activeElement?.dataset.recipientId;
 const quietAvatar=b=>avatar({...b,status:'Ready',activity:''});
 trigger.innerHTML=`<span class="recipient-to">To</span>${quietAvatar(chosen)}<span class="recipient-name">${esc(chosen?.name||'Choose a bot')}</span><svg class="recipient-chevron" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg>`;
 trigger.setAttribute('aria-label','Send to '+(chosen?.name||'a bot'));
 menu.innerHTML=`<div class="recipient-heading" aria-hidden="true">Send to</div>${members.map(b=>`<button type="button" class="recipient-option" role="option" aria-selected="${b.id===selected}" tabindex="-1" data-recipient-id="${esc(b.id)}">${quietAvatar(b)}<span>${esc(b.name)}</span><svg class="recipient-check" width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m4 10 4 4 8-8"/></svg></button>`).join('')}`;
 if(!menu.hidden&&focused){const options=[...menu.querySelectorAll('[role=option]')];(options.find(el=>el.dataset.recipientId===focused)||options.find(el=>el.getAttribute('aria-selected')==='true'))?.focus({preventScroll:true});}
}
function bindRecipientPicker(){
 const picker=$('recipient-picker');if(!picker)return;
 $('recipient').onclick=()=>{if($('recipient-options').hidden)openRecipientPicker();else closeRecipientPicker();};
 picker.onclick=e=>{
  const option=e.target.closest('[data-recipient-id]');if(!option)return;
  const id=option.dataset.recipientId,ch=data.channels.find(c=>c.id===channel);
  if(!bot(id)||!ch?.members.includes(id))return;
  selected=id;closeRecipientPicker(true);if(inspect)inspect=selected;
  panelKey='';approvalKey='';header();renderChat();renderInspector();
 };
 picker.onkeydown=e=>{
  if(e.key==='Escape'){if(!$('recipient-options').hidden){e.preventDefault();e.stopPropagation();closeRecipientPicker(true);}return;}
  if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){
   e.preventDefault();
   if($('recipient-options').hidden){openRecipientPicker(e.key==='Home'?'first':e.key==='End'?'last':undefined);return;}
   const options=[...$('recipient-options').querySelectorAll('[role=option]')],index=options.indexOf(document.activeElement);
   const next=e.key==='Home'?0:e.key==='End'?options.length-1:(index+(e.key==='ArrowDown'?1:-1)+options.length)%options.length;
   options[next]?.focus({preventScroll:true});options[next]?.scrollIntoView({block:'nearest'});
  }else if((e.key==='Enter'||e.key===' ')&&e.target.matches('[data-recipient-id]')){e.preventDefault();e.target.click();}
 };
 picker.onfocusout=e=>{if(!picker.contains(e.relatedTarget))closeRecipientPicker();};
}
document.addEventListener('pointerdown',e=>{const picker=$('recipient-picker');if(picker&&!picker.contains(e.target))closeRecipientPicker();});

function renderChat(){
 const b=current(),ch=data.channels.find(c=>c.id===channel),key=view+':'+(channel||selected);
 if(renderKey!==key){
  renderKey=key;msgKey='';attachments=[...(draftAttachments[channel||selected]||[])];
  $('page').innerHTML=`<div class="conversation"><div class="messages" id="messages"></div><div class="compose-wrap"><div id="approval"></div><div id="working"></div><div id="attachments"></div>${ch?'<div class="recipient-row"><div class="recipient-picker" id="recipient-picker"><button type="button" class="recipient-trigger" id="recipient" aria-haspopup="listbox" aria-expanded="false" aria-controls="recipient-options"></button><div class="recipient-options" id="recipient-options" role="listbox" aria-label="Choose a bot" hidden></div></div></div>':''}<form id="composer" class="composer"><button type="button" class="icon-btn attach-btn" id="attach" aria-label="Attach a file">+</button><textarea id="prompt" rows="1" aria-label="Message your bot" placeholder="Message ${esc(ch?.name||b.name)}"></textarea><button type="button" id="stop-task" class="icon-btn stop-btn hidden" title="Stop task" aria-label="Stop task">■</button><button class="send-btn" id="send" title="Send task" aria-label="Send task">↑</button></form></div></div>`;
  renderAttachments();const input=$('prompt');input.value=drafts[channel||selected]||'';
  const size=()=>{input.style.height='20px';if(input.value)input.style.height=Math.min(120,input.scrollHeight)+'px';$('composer').classList.toggle('has-text',!!input.value.trim());};
  input.oninput=size;size();
  input.onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&(!phoneMode||e.ctrlKey||e.metaKey)){e.preventDefault();$('composer').requestSubmit();}};
  $('composer').onsubmit=async e=>{await send(e);if($('prompt')===input)size();};
  $('attach').onclick=()=>chooseFile();$('stop-task').onclick=()=>act('stop',{id:selected});
  if(ch)bindRecipientPicker();
 }
 if(ch)renderRecipientPicker(ch);
 const messages=ch?data.bots.flatMap(owner=>owner.messages.filter(m=>m.channelId===channel).map(m=>({...m,owner}))).sort((a,b)=>(a.at||0)-(b.at||0)):b.messages.map(m=>({...m,owner:b}));
 const owners=ch?data.bots.filter(x=>ch.members.includes(x.id)):[b],ownerIds=owners.map(x=>x.id);
 const nextKey=JSON.stringify([messages.map(m=>[m.id,m.text]),data.tasks.filter(t=>ownerIds.includes(t.botId)).map(t=>[t.id,t.status]),owners.map(x=>[x.id,x.files,x.events])]);
 if(nextKey!==msgKey){
  const el=$('messages'),bottom=el.scrollHeight-el.scrollTop-el.clientHeight<100,scrollTop=el.scrollTop,expanded=[...el.querySelectorAll('details[data-trace-id][open]')].map(x=>x.dataset.traceId);
  el.innerHTML=messages.length?messages.map((m,i)=>chatMessage(m,i,messages,ch)).join(''):`<div class="intro">${avatar(b,true)}<h2>${esc(ch?.name||b.name)}</h2><p>${esc(ch?'A conversation for your team.':b.role.split(/\. /)[0])}</p><button class="quiet-button" ${ch?'data-phone-group-info="'+ch.id+'"':'data-contact-menu="'+b.id+'"'}>${ch?'Group details':'Bot details'} ${icon('settings')}</button></div>`;
  el.classList.toggle('is-empty',!messages.length);
  el.querySelectorAll('details[data-trace-id]').forEach(x=>{x.open=expanded.includes(x.dataset.traceId);});
  el.scrollTop=bottom||!msgKey?el.scrollHeight:scrollTop;msgKey=nextKey;
 }
 $('working').innerHTML=busy(b)?`<button class="working-bar" data-inspect="activity">${avatar(b)}<span>${esc(b.status==='Needs you'?'Waiting for your input':b.status==='Connecting'?'Connecting…':b.status==='Stopping'?'Stopping…':'Working…')}${b.queue?' · '+b.queue+' queued':''}</span></button>`:b.queue?`<div class="working-bar">${b.queue} queued</div>`:'';
 $('stop-task').classList.toggle('hidden',!busy(b)&&!b.queue);$('send').title=busy(b)?'Add to task queue':'Send task';$('send').disabled=sendingDrafts.has(channel||selected)||uploadingDrafts.has(channel||selected);renderApproval(b);
}

function taskExtras(m){
 if(m.role!=='assistant'||!m.taskId)return '';
 const t=data.tasks.find(t=>t.id===m.taskId);if(!t)return '';
 const owner=m.owner,last=owner.messages.filter(x=>x.taskId===t.id&&x.role==='assistant').at(-1);if(last?.id!==m.id)return '';
 const events=(owner.events||[]).filter(e=>e.taskId===t.id&&e.kind!=='dynamicToolCall'),children=data.tasks.filter(x=>x.parentId===t.id);
 const labels={browser:'Used the browser',team:'Worked with a teammate',memory:'Updated memory',routines:'Managed a routine',ask:'Asked for your input'};
 const status={completed:'Work completed',waiting:'Waiting for input',failed:'Task failed',interrupted:'Task interrupted',cancelled:'Task stopped',queued:'Task queued'}[t.status]||'Work in progress';
 let out=t.effectiveConnection?'<p class="note">Used approved fallback '+esc(t.effectiveConnection.model)+'. '+esc(t.fallbackReason||'')+'</p>':'';
 if(events.length)out+='<details class="work-trace" data-trace-id="'+t.id+'"><summary><span class="trace-status '+esc(t.status)+'">'+(t.status==='completed'?'✓':'◌')+'</span> '+status+' <span>'+events.length+' steps</span></summary><div>'+events.slice(-15).map(e=>'<div class="trace-step"><i></i><span><b>'+esc(labels[e.title]||e.title)+'</b><small>'+esc(String(e.detail||'').slice(0,180))+'</small></span></div>').join('')+'</div></details>';
 if(children.length)out+='<div class="handoff-cards">'+children.map(c=>'<button data-bot="'+c.botId+'" class="handoff-card">'+avatar(bot(c.botId))+'<span><b>'+esc(bot(c.botId)?.name||'Teammate')+'</b><small>'+esc(c.status)+' · '+esc(short(c.prompt).replace(/^From teammate [^:]+: /,''))+'</small></span>↗</button>').join('')+'</div>';
 if(t.status==='completed'){
  const files=(owner.files||[]).filter(f=>f.modified>=(t.startedAt||t.createdAt)-1000&&f.modified<=(t.finishedAt||Date.now())+1000&&!f.path.includes('MEMORY.md')&&!f.path.startsWith('attachments/'));
  out+=files.slice(0,6).map(f=>'<button class="artifact-card" data-preview="'+esc(f.path)+'" data-owner="'+owner.id+'"><span class="artifact-icon">'+icon('file')+'</span><span><b>'+esc(f.path.split('/').pop())+'</b><small>'+esc(f.path.endsWith('.md')?'Document':f.path.split('.').pop().toUpperCase()+' file')+' · Open preview</small></span><span>↗</span></button>').join('');
 }
 return out;
}
let approvalKey='';function renderApproval(b){const a=b.approval,key=JSON.stringify(a);if(key===approvalKey)return;approvalKey=key;const el=$('approval');if(!a){el.innerHTML='';return;}const command=a.details?.command||a.details?.action;el.innerHTML='<div class="approval-card"><div class="approval-heading">'+avatar(b)+'<span><small>'+esc(b.name)+' needs you</small><h3>'+esc(a.title)+'</h3></span></div>'+(a.kind==='approval'?(command?'<p class="approval-action">'+esc(typeof command==='string'?command:JSON.stringify(command))+'</p>':'')+'<details class="approval-details"><summary>Review action details</summary><pre>'+esc(JSON.stringify(a.details,null,2))+'</pre></details><div class="row"><button class="btn primary" data-approve="accept">Approve once</button><button class="btn" data-approve="decline">Decline</button></div>':a.kind==='questions'?'<div>'+(a.details.questions||[]).map(q=>'<label style="display:block;margin:8px 0">'+esc(q.question)+'</label><input data-question="'+esc(q.id)+'" placeholder="'+esc(q.options?.map(o=>o.label).join(' / ')||'Your answer')+'" style="width:100%">').join('')+'</div><button class="btn primary" data-answer style="margin-top:10px">Send answers</button>':'<textarea id="answer-text" placeholder="'+(a.kind==='elicitation'?'Enter the requested JSON, or leave blank to decline':'Your answer…')+'"></textarea><button class="btn primary" data-answer style="margin-top:10px">Reply</button>')+'</div>';}
async function send(e){
 e.preventDefault();
 const input=$('prompt');if(!input||input.dataset.sending)return;
 const originalText=input.value,text=originalText.trim();if(!text)return;
 const draftKey=channel||selected,channelId=channel,files=[...attachments],button=$('send');
 if(sendingDrafts.has(draftKey))return;
 if(uploadingDrafts.has(draftKey)){toast('Wait for your file to finish adding, then send.');return;}
 let id=selected;
 const mention=data.bots.find(b=>text.toLowerCase().startsWith('@'+b.name.toLowerCase()+' '));
 if(mention&&(!channel||data.channels.find(c=>c.id===channel)?.members.includes(mention.id)))id=mention.id;
 input.dataset.sending='true';button.disabled=true;sendingDrafts.add(draftKey);renderAttachments();
 try{
  await api('send',{id,text,attachments:files,channelId});
  const unsent=list=>(list||[]).filter(file=>!files.some(sent=>sent.owner===file.owner&&sent.path===file.path));
  if(drafts[draftKey]===originalText)drafts[draftKey]='';
  draftAttachments[draftKey]=unsent(draftAttachments[draftKey]);
  if((channel||selected)===draftKey&&$('prompt')){if($('prompt').value===originalText){$('prompt').value='';drafts[draftKey]='';$('prompt').dispatchEvent(new Event('input'));}attachments=unsent(attachments);draftAttachments[draftKey]=[...attachments];renderAttachments();}
  await refresh();
 }catch(e){toast(e.message);}finally{delete input.dataset.sending;button.disabled=false;sendingDrafts.delete(draftKey);if((channel||selected)===draftKey&&$('send')){$('send').disabled=uploadingDrafts.has(draftKey);renderAttachments();}}
}
async function act(route,args){try{const r=await api(route,args);await refresh();return r;}catch(e){toast(e.message);return null;}}
function openPanel(tab){inspect=selected;inspectTab=tab;panelKey='';renderInspector();}
function renderDetailInspector(){const el=$('inspector'),b=bot(inspect);el.classList.toggle('hidden',!b);if(!b)return;const c=b.computer,key=inspect+':'+inspectTab+':'+(inspectTab==='computer'?JSON.stringify([c.running,c.paused,c.recording]):inspectTab==='activity'?JSON.stringify(b.events):'');if(key===panelKey)return;panelKey=key;el.innerHTML=`<div class="inspector-head"><div class="row">${avatar(b)}<b>${esc(b.name)}’s workspace</b></div><div class="row"><button class="icon-btn" data-expand-panel title="Expand workspace" aria-label="Expand workspace">⤢</button><button class="icon-btn" data-close-panel aria-label="Close workspace">×</button></div></div><div class="tabs">${['computer','activity','files','memory'].map(t=>`<button class="tab ${inspectTab===t?'active':''}" data-tab="${t}">${{computer:'Browser',activity:'Activity',files:'Files',memory:'Memory'}[t]}</button>`).join('')}</div><div class="inspect-body" id="inspect-body"></div>`;const body=$('inspect-body');
 if(inspectTab==='computer'){if(!c.running){body.innerHTML=`<div class="computer-empty">${icon('computer')}<h3>A browser of their own.</h3><p>${esc(b.name)} can browse websites and work in apps here. Sign in to the tools you want this bot to use.</p><button class="btn primary" data-computer-start>Start browser</button></div><p class="note">A separate browser profile on your host. Your personal browser session is not shared.</p>`;return;}
 body.innerHTML=`<div class="browser-toolbar"><button class="icon-btn" data-browser-action="back" ${!c.paused?'disabled':''} title="Back">←</button><input id="browser-url" aria-label="Browser address" value="${esc(c.url==='about:blank'?'':c.url)}" placeholder="https://…" ${!c.paused?'disabled':''}><button class="icon-btn" data-go ${!c.paused?'disabled':''} title="Go">↗</button></div><img id="browser-screen" tabindex="0" class="browser-screen ${c.paused?'controlling':''}" alt="Live view of this bot’s browser"><div class="computer-controls"><button class="btn ${c.paused?'primary':''}" data-control>${c.paused?'Return control to bot':'Take control'}</button><button class="btn" data-record>${c.recording?'■ Finish demonstration':'◎ Teach a workflow'}</button><button class="btn" data-screen-refresh>↻</button></div>${c.paused?`<div class="type-control"><input id="browser-type" aria-label="Text to type into the browser" type="password" placeholder="Text to type into selected field"><button class="btn" data-type>Type</button></div><div class="computer-controls">${['Enter','Tab','Backspace','Control+A','Escape'].map(k=>`<button class="btn" data-key="${k}">${k}</button>`).join('')}<button class="btn" data-scroll="600">Scroll ↓</button><button class="btn" data-scroll="-600">Scroll ↑</button></div>`:''}<p class="note">${c.recording?'Recording navigation and clicks. Typed values are omitted. Finish to turn this demonstration into a routine.':c.paused?'You have control. Click the browser image and type directly, or use the controls below. Return control when you’re done.':'Live browser preview. Your bot can work here while you watch. Take control to sign in or show it how.'}</p><p class="note">Browser profiles retain sign-ins locally. This is a browser workspace, not a hosted desktop.</p>`;
 $('browser-screen').onclick=e=>{if(!c.paused)return;e.target.focus();const r=e.target.getBoundingClientRect();browserAction({action:'click',x:Math.round((e.clientX-r.left)/r.width*1280),y:Math.round((e.clientY-r.top)/r.height*800)});};$('browser-screen').onkeydown=e=>{if(!c.paused)return;e.preventDefault();if(e.key.length===1&&!e.ctrlKey&&!e.metaKey&&!e.altKey){queueTyping(e.key);}else{const owner=inspect;flushTyping().then(()=>browserAction({action:'key',key:(e.ctrlKey||e.metaKey?'Control+':'')+(e.altKey?'Alt+':'')+(e.shiftKey&&e.key.length>1?'Shift+':'')+e.key},owner));}};$('browser-screen').onpaste=e=>{if(!c.paused)return;e.preventDefault();queueTyping(e.clipboardData.getData('text'));};if($('browser-url'))$('browser-url').onkeydown=e=>{if(e.key==='Enter')goBrowser();};screen();
 }else if(inspectTab==='activity')body.innerHTML=b.events.length?b.events.slice(-70).reverse().map(e=>`<div class="event"><div class="row between"><b>${esc(e.title)}</b><small>${time(e.at)}</small></div><p>${esc(e.detail)}</p>${e.output?`<details><summary>View output</summary><pre>${esc(e.output)}</pre></details>`:''}<small>${esc(e.status)}</small></div>`).join(''):'<div class="empty-box">Tool calls, browser actions, and file work will appear here.</div>';
 else if(inspectTab==='files'){body.innerHTML='<small>Loading files…</small>';loadFiles(b);}
 else{body.innerHTML='<small>Loading memory…</small>';loadMemory(b);}
}
async function screen(){const b=bot(inspect);if(screenBusy||!['computer','overview'].includes(inspectTab)||!b?.computer.running||!$('browser-screen'))return;screenBusy=true;try{const r=await fetch('/api/screen?id='+b.id,{headers:{'X-Crew-Token':window.CREW_TOKEN}});if(!r.ok)throw Error((await r.json()).error);const blob=await r.blob();if($('browser-screen')&&inspect===b.id){const old=screenUrl;screenUrl=URL.createObjectURL(blob);$('browser-screen').src=screenUrl;if(old)URL.revokeObjectURL(old);}}catch(e){toast(e.message);}finally{screenBusy=false;}}
async function browserAction(a,id=inspect){if(!id)return;const r=await act('computer-action',{id,...a});if(r&&inspect===id)await screen();}
let typedBuffer='',typedOwner=null,typedTimer;function queueTyping(text){if(typedBuffer&&typedOwner!==inspect)flushTyping();typedOwner=inspect;typedBuffer+=text;clearTimeout(typedTimer);typedTimer=setTimeout(flushTyping,100);}async function flushTyping(){clearTimeout(typedTimer);if(!typedBuffer)return;const text=typedBuffer,id=typedOwner;typedBuffer='';typedOwner=null;await browserAction({action:'type',text},id);}function goBrowser(){let url=$('browser-url').value.trim();if(url&&!/^https?:\/\//i.test(url))url='https://'+url;browserAction({action:'navigate',url});}
async function loadFiles(b){try{const files=await api('files?id='+b.id);if(inspect!==b.id||inspectTab!=='files')return;$('inspect-body').innerHTML=`<div class="row between" style="margin-bottom:15px"><small>Workspace files</small><button class="btn" data-upload>+ Add file</button></div>${files.map(f=>`<div class="file-row">${icon('file')}<div class="name"><button class="file-preview-link" data-preview="${esc(f.path)}" data-owner="${b.id}">${esc(f.path)}</button><small>${f.size<1024?f.size+' B':Math.round(f.size/1024)+' KB'} · ${date(f.modified)}</small></div><button class="icon-btn" data-download="${esc(f.path)}" title="Download file">↓</button></div>`).join('')||'<p class="note">Files your bot creates and files you attach appear here.</p>'}<p class="note">${esc(b.cwd)}</p>`;}catch(e){toast(e.message);}}
async function loadMemory(b){try{const m=await api('memory?id='+b.id);if(inspect!==b.id||inspectTab!=='memory')return;$('inspect-body').innerHTML=`<label class="memory-label" for="bot-memory">${esc(b.name)}’S NOTES</label><textarea id="bot-memory" class="memory-area">${esc(m.bot)}</textarea><button class="btn" data-save-memory="bot">Save bot memory</button><p class="note">Your bot can read and update these notes across tasks.</p><label class="memory-label" for="team-memory">SHARED TEAM NOTES</label><textarea id="team-memory" class="memory-area">${esc(m.team)}</textarea><button class="btn" data-save-memory="team">Save shared memory</button><p class="note">Available to every bot through its memory tool.</p>`;}catch(e){toast(e.message);}}
function modal(title,subtitle,body,type){modalType=type;$('modal').dataset.kind=type;$('modal-content').innerHTML=`<div class="modal-head"><div><h2 id="modal-title">${title}</h2><p id="modal-subtitle">${subtitle}</p></div><button class="icon-btn" data-close-modal aria-label="Close dialog">×</button></div><div class="modal-body">${body}<div class="modal-error" id="modal-error" role="alert"></div></div>`;if(!$('modal').open)$('modal').showModal();}
const avatarNames={spark:'Round',research:'Fox',chief:'Triangle',writer:'Flower',builder:'Square'};
const colorNames=['Purple','Blue','Pink','Orange','Amber','Teal','Green','Gray'];
function appearanceFields(initial){
 const chosen={icon:initial.icon||'spark',color:avatarColor(initial),status:'Ready'};
 return `<div class="appearance-preview" id="appearance-preview">${avatar(chosen,true)}</div><fieldset class="appearance-field"><legend>Avatar</legend><div class="avatar-choices">${Object.entries(avatarNames).map(([shape,name])=>`<button type="button" data-avatar-shape="${shape}" aria-label="${name} avatar" aria-pressed="${chosen.icon===shape}">${avatar({...chosen,icon:shape})}</button>`).join('')}</div></fieldset><fieldset class="appearance-field"><legend>Color</legend><div class="avatar-colors">${brightColors.map((color,i)=>`<button type="button" data-avatar-color="${color}" aria-label="${colorNames[i]} avatar color" aria-pressed="${chosen.color===color}"><span style="background:${color}"></span></button>`).join('')}</div></fieldset>`;
}
function bindAppearance(initial){
 const state={icon:initial.icon||'spark',color:avatarColor(initial)};
 const update=()=>{
  $('appearance-preview').innerHTML=avatar({...state,status:'Ready'},true);
  document.querySelectorAll('[data-avatar-shape]').forEach(el=>{el.setAttribute('aria-pressed',String(el.dataset.avatarShape===state.icon));el.innerHTML=avatar({...state,icon:el.dataset.avatarShape,status:'Ready'});});
  document.querySelectorAll('[data-avatar-color]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.avatarColor===state.color)));
 };
 document.querySelectorAll('[data-avatar-shape]').forEach(el=>el.onclick=()=>{state.icon=el.dataset.avatarShape;update();});
 document.querySelectorAll('[data-avatar-color]').forEach(el=>el.onclick=()=>{state.color=el.dataset.avatarColor;update();});
 return state;
}
function createBot(template={}){
 modal('Create a bot','Give it a name and a job.',`<form id="bot-form">${appearanceFields(template)}<label for="bot-name">Name</label><input id="bot-name" maxlength="60" required value="${esc(template.name||'')}" placeholder="e.g. Chief of Staff"><label for="bot-role">What is their job?</label><textarea id="bot-role" required placeholder="What should this bot take off your plate?">${esc(template.role||'')}</textarea><label for="bot-preferences">Preferences and context</label><textarea id="bot-preferences" placeholder="How you like to work, what matters to you…"></textarea><div class="row between form-actions"><small>Browser · Files · Memory</small><button class="btn primary">Create teammate</button></div></form>`,'create');
 const appearance=bindAppearance(template);
 $('bot-form').onsubmit=async e=>{e.preventDefault();const submit=e.submitter;if(submit)submit.disabled=true;try{const b=await api('create',{name:$('bot-name').value,role:$('bot-role').value,memory:$('bot-preferences').value,...appearance});$('modal').close();await refresh();navigate('bot',b.id);await settingsUI.setupBot(b.id);}catch(e){$('modal-error').textContent=e.message;}finally{if(submit)submit.disabled=false;}};
}
function settings(id){
 const b=bot(id);if(!b)return;
 modal(esc(b.name)+'’s settings','Make this teammate your own.',`<form id="settings-form">${appearanceFields(b)}<label for="edit-name">Name</label><input id="edit-name" maxlength="60" value="${esc(b.name)}" required><label for="edit-role">Role</label><textarea id="edit-role">${esc(b.role)}</textarea><label for="edit-memory">Personal preferences</label><textarea id="edit-memory">${esc(b.memory)}</textarea><button type="button" class="settings-option" data-connection-bot="${id}"><span><b>Model & reasoning</b><small>${esc(b.model||'Default model')} · ${esc(b.reasoningEffort||'Default reasoning')}</small></span><span>›</span></button><p class="note">Changes apply to the next task. Finish or stop active work before saving.</p><div class="row between form-actions"><button type="button" class="btn danger" id="archive-bot">Archive bot</button><button class="btn primary">Save changes</button></div></form>`,'settings');
 const appearance=bindAppearance(b);
 $('settings-form').onsubmit=async e=>{e.preventDefault();const submit=e.submitter;if(submit)submit.disabled=true;try{await api('update',{id,name:$('edit-name').value,role:$('edit-role').value,memory:$('edit-memory').value,...appearance});$('modal').close();await refresh();}catch(e){$('modal-error').textContent=e.message;}finally{if(submit)submit.disabled=false;}};
 $('archive-bot').onclick=async()=>{try{await api('archive',{id});$('modal').close();await refresh();navigate('home');}catch(e){$('modal-error').textContent=e.message;}};
}
function createChannel(){if(!data.bots.length)return createBot();modal('New group','Bots in a channel share conversation context and can hand off work.',`<form id="channel-form"><label for="channel-name">Channel name</label><input id="channel-name" required placeholder="e.g. My next project"><label>Teammates</label>${data.bots.map(b=>`<label class="check"><input type="checkbox" name="member" value="${b.id}" checked>${avatar(b)} ${esc(b.name)}</label>`).join('')}<div class="row"><button class="btn primary">Create channel</button></div></form>`,'channel');$('channel-form').onsubmit=async e=>{e.preventDefault();try{const c=await api('channel',{name:$('channel-name').value,members:[...document.querySelectorAll('[name=member]:checked')].map(el=>el.value)});$('modal').close();await refresh();navigate('channel',c.id);}catch(e){$('modal-error').textContent=e.message;}};}
function routineForm(r={}){if(!data.bots.length)return createBot();const kind=r.scheduleKind||'interval';modal(r.id?'Edit routine':'New routine','A task, a teammate, and a time.', '<form id="routine-form"><label for="routine-name">Name</label><input id="routine-name" required value="'+esc(r.name||'')+'" placeholder="Morning briefing"><label for="routine-bot">Teammate</label><select id="routine-bot">'+data.bots.map(b=>'<option value="'+b.id+'" '+((r.botId||selected)===b.id?'selected':'')+'>'+esc(b.name)+'</option>').join('')+'</select><label for="routine-prompt">What should happen?</label><textarea id="routine-prompt" required placeholder="Review my project notes and tell me what needs attention today.">'+esc(r.prompt||'')+'</textarea><div class="schedule-fields"><div><label for="routine-kind">Repeat</label><select id="routine-kind"><option value="daily">Every day</option><option value="weekdays">Weekdays</option><option value="weekly">Every week</option><option value="interval">Custom interval</option></select></div><div id="schedule-time"><label for="routine-time">At</label><input type="time" id="routine-time" value="'+esc(r.time||'09:00')+'"></div><div id="schedule-day"><label for="routine-day">Day</label><select id="routine-day">'+['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map((d,i)=>'<option value="'+i+'" '+((r.weekday??1)===i?'selected':'')+'>'+d+'</option>').join('')+'</select></div><div id="schedule-interval"><label for="routine-minutes">Every (minutes)</label><input type="number" id="routine-minutes" min="5" max="525600" value="'+(r.minutes||60)+'"></div></div><label class="check"><input type="checkbox" id="routine-enabled" '+(r.enabled?'checked':'')+'>Enable this schedule</label><p class="note">Uses the host’s local time. Proposals stay paused until you enable them.</p><div class="row"><button class="btn primary">Save routine</button></div></form>','routine');$('routine-kind').value=r.id?kind:'daily';const update=()=>{const k=$('routine-kind').value;$('schedule-time').classList.toggle('hidden',k==='interval');$('schedule-day').classList.toggle('hidden',k!=='weekly');$('schedule-interval').classList.toggle('hidden',k!=='interval');};$('routine-kind').onchange=update;update();$('routine-form').onsubmit=async e=>{e.preventDefault();try{await api('routine',{id:r.id,botId:$('routine-bot').value,name:$('routine-name').value,prompt:$('routine-prompt').value,minutes:Number($('routine-minutes').value),scheduleKind:$('routine-kind').value,time:$('routine-time').value,weekday:Number($('routine-day').value),enabled:$('routine-enabled').checked});$('modal').close();await refresh();navigate('routines');}catch(e){$('modal-error').textContent=e.message;}};}
function search(){
 modal('Search','Find a teammate or a previous task.','<input id="search-query" aria-label="Search teammates and tasks" placeholder="Type a name or keyword…" autocomplete="off"><div id="search-results" class="search-results"></div>','search');
 $('search-query').oninput=e=>{const q=e.target.value.trim().toLowerCase(),bots=data.bots.filter(b=>(b.name+' '+b.role).toLowerCase().includes(q)),tasks=data.tasks.filter(t=>bot(t.botId)&&t.prompt.toLowerCase().includes(q)).slice(-12).reverse();
 $('search-results').innerHTML=bots.map(b=>'<button class="search-result" data-search-bot="'+b.id+'"><b>'+esc(b.name)+'</b><small>'+esc(short(b.role))+'</small></button>').join('')+tasks.map(t=>'<button class="search-result" data-search-bot="'+t.botId+'"><b>'+esc(short(t.prompt))+'</b><small>'+esc(bot(t.botId).name)+' · '+esc(t.status)+'</small></button>').join('')||'<div class="empty-box" role="status">No matches. Try another name or keyword.</div>';};
 $('search-query').focus();$('search-query').dispatchEvent(new Event('input'));
}
let fileTarget=null;
function chooseFile(owner=selected,draftKey=channel||selected){fileTarget={owner,draftKey};$('file-input').click();}
$('file-input').onchange=async e=>{const file=e.target.files[0],target=fileTarget;fileTarget=null;if(!file||!target?.owner){e.target.value='';return;}const {owner,draftKey}=target;if(draftKey){uploadingDrafts.set(draftKey,(uploadingDrafts.get(draftKey)||0)+1);if((channel||selected)===draftKey&&$('send'))$('send').disabled=true;}try{if(file.size>10000000)throw Error('Files must be 10 MB or smaller.');const base64=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result.split(',')[1]);r.onerror=()=>reject(Error('Could not read this file. Try choosing it again.'));r.readAsDataURL(file);});const r=await api('upload',{id:owner,name:file.name,base64});if(draftKey){const attachment={owner,path:r.path};draftAttachments[draftKey]=[...(draftAttachments[draftKey]||[]),attachment];if((channel||selected)===draftKey&&$('attachments')){attachments.push(attachment);draftAttachments[draftKey]=[...attachments];renderAttachments();}}if(inspectTab==='files'&&inspect===owner)loadFiles(bot(owner));toast('File added to workspace');}catch(e){toast(e.message);}finally{e.target.value='';if(draftKey){const count=(uploadingDrafts.get(draftKey)||1)-1;if(count)uploadingDrafts.set(draftKey,count);else uploadingDrafts.delete(draftKey);if((channel||selected)===draftKey&&$('send'))$('send').disabled=sendingDrafts.has(draftKey)||uploadingDrafts.has(draftKey);}}};
document.addEventListener('click',async e=>{const el=e.target.closest('button,[data-bot]');if(!el)return;const d=el.dataset;
 if(d.removeAttachment!==undefined)removeAttachment(Number(d.removeAttachment));else if(d.nav)navigate(d.nav);else if(d.bot)navigate('bot',d.bot);else if(d.channel)navigate('channel',d.channel);else if(d.create!==undefined)createBot();else if(d.template!==undefined)createBot(templates[Number(d.template)]);else if(d.settings)settings(d.settings);else if(d.inspect)openPanel(d.inspect);else if(d.tab){inspectTab=d.tab;panelKey='';renderInspector();}else if(d.expandPanel!==undefined){$('inspector').classList.toggle('expanded');}else if(d.closePanel!==undefined){inspect=null;renderInspector();}else if(d.closeModal!==undefined)$('modal').close();else if(d.newRoutine!==undefined)routineForm();else if(d.routineEdit)routineForm(data.routines.find(r=>r.id===d.routineEdit));else if(d.routineRun){await act('routine-run',{routineId:d.routineRun});toast('Routine queued');}else if(d.routineToggle){const r=data.routines.find(r=>r.id===d.routineToggle);await act('routine-toggle',{routineId:r.id,enabled:!r.enabled});}else if(d.retry)await act('retry',{id:d.owner,taskId:d.retry});else if(d.read!==undefined)await act('read-notifications',{});else if(d.suggest){$('prompt').value=d.suggest;$('prompt').focus();}else if(d.approve){const b=current();if(b?.approval)await act('answer',{id:b.id,requestId:b.approval.id,answer:d.approve});}else if(d.answer!==undefined){const b=current();let answer=$('answer-text')?.value||'';if(b.approval.kind==='questions')answer=Object.fromEntries([...document.querySelectorAll('[data-question]')].map(el=>[el.dataset.question,{answers:[el.value]}]));await act('answer',{id:b.id,requestId:b.approval.id,answer});}else if(d.computerStart!==undefined){el.disabled=true;el.textContent='Starting…';await act('computer-start',{id:inspect});panelKey='';renderInspector();}else if(d.control!==undefined)await act('computer-control',{id:inspect,paused:!bot(inspect).computer.paused});else if(d.go!==undefined)goBrowser();else if(d.browserAction)browserAction({action:d.browserAction});else if(d.key)browserAction({action:'key',key:d.key});else if(d.scroll)browserAction({action:'scroll',delta:Number(d.scroll)});else if(d.type!==undefined){const text=$('browser-type').value;$('browser-type').value='';browserAction({action:'type',text});}else if(d.screenRefresh!==undefined)screen();else if(d.record!==undefined){if(bot(inspect).computer.recording){const id=inspect,r=await act('record-stop',{id});if(r)routineForm({botId:id,name:'Demonstrated workflow',prompt:r.prompt,enabled:false});}else await act('record-start',{id:inspect});}else if(d.saveMemory){const r=await act('memory',{id:inspect,scope:d.saveMemory,text:$(d.saveMemory+'-memory').value});if(r)toast('Memory saved');}else if(d.upload!==undefined)chooseFile(inspect,null);else if(d.download){try{const r=await fetch('/api/file?id='+inspect+'&path='+encodeURIComponent(d.download),{headers:{'X-Crew-Token':window.CREW_TOKEN}});if(!r.ok)throw Error((await r.json()).error);const url=URL.createObjectURL(await r.blob()),a=document.createElement('a');a.href=url;a.download=d.download.split('/').pop();a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}catch(e){toast(e.message);}}else if(d.searchBot){$('modal').close();navigate('bot',d.searchBot);}
});
for(const id of ['add-top','new-bot','add-bottom'])$(id).onclick=()=>createBot();$('new-channel').onclick=createChannel;$('search-button').onclick=search;$('about').onclick=()=>settingsUI.welcome();document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();search();}});
function contactMenu(id){const b=bot(id);if(!b)return;modal(esc(b.name),'Manage this teammate.','<div class="contact-actions"><button data-toggle-pin="'+id+'">'+(b.pinned?'Unpin bot':'Pin bot')+'</button><button data-mark-unread="'+id+'">Mark unread</button><button data-duplicate="'+id+'">Duplicate bot</button><button data-edit-bot="'+id+'">Edit role and preferences</button><button data-model="'+id+'">Model & reasoning</button></div>','contact');}
async function modelMenu(id){return settingsUI.botConnection(id);}
async function previewFile(id,file){modal(esc(file.split('/').pop()),'Saved in '+esc(bot(id)?.name||'the bot')+'’s workspace.','<div id="file-preview" class="message-text">Loading…</div><div class="row"><button class="btn" data-file-download="'+esc(file)+'" data-owner="'+id+'">Download</button></div>','preview');const target=$('file-preview');try{const p=await api('preview?id='+id+'&path='+encodeURIComponent(file));if($('modal').open&&$('file-preview')===target)target.innerHTML=p.markdown?md(p.text):'<pre>'+esc(p.text)+'</pre>';}catch(e){if($('modal').open&&$('file-preview')===target)target.textContent=e.message;}}
async function downloadFile(id,file){const r=await fetch('/api/file?id='+id+'&path='+encodeURIComponent(file),{headers:{'X-Crew-Token':window.CREW_TOKEN}});if(!r.ok)throw Error((await r.json()).error);const url=URL.createObjectURL(await r.blob()),a=document.createElement('a');a.href=url;a.download=file.split('/').pop();a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
document.addEventListener('click',async e=>{const el=e.target.closest('button');if(!el)return;const d=el.dataset;try{if(d.calendarDay){calendarSelected=Number(d.calendarDay);renderRoutines();}else if(d.contactMenu)contactMenu(d.contactMenu);else if(d.model)await modelMenu(d.model);else if(d.editBot){$('modal').close();settings(d.editBot);}else if(d.togglePin){await api('contact',{id:d.togglePin,pinned:!bot(d.togglePin).pinned});$('modal').close();await refresh();}else if(d.markUnread){await api('contact',{id:d.markUnread,readAt:0});$('modal').close();navigate('home');await refresh();}else if(d.duplicate){const b=await api('duplicate',{id:d.duplicate});$('modal').close();await refresh();navigate('bot',b.id);}else if(d.preview)previewFile(d.owner,d.preview);else if(d.fileDownload)await downloadFile(d.owner,d.fileDownload);else if(d.theme!==undefined){document.documentElement.dataset.theme=document.documentElement.dataset.theme==='light'?'dark':'light';localStorage.setItem('crew.theme',document.documentElement.dataset.theme);}}catch(e){if($('modal').open)$('modal-error').textContent=e.message;else toast(e.message);}});
document.documentElement.dataset.theme=localStorage.getItem('crew.theme')||'dark';
if($('roster-filter'))$('roster-filter').oninput=sidebar;
refresh();setInterval(refresh,1800);setInterval(screen,3000);

let calendarSelected=null;
function calendarAgenda(){
 const days=data.routineCalendar||[];if(!days.length)return '';
 const selected=days.find(d=>d.start===calendarSelected)||days[0];
 const strip='<div class="week-strip">'+days.map(d=>{const day=new Date(d.start);return '<button class="week-day '+(d===selected?'today':'')+'" data-calendar-day="'+d.start+'" aria-pressed="'+(d===selected)+'"><small>'+day.toLocaleDateString([],{weekday:'short'})+'</small><b>'+day.getDate()+'</b><div>'+d.items.slice(0,4).map(item=>{const r=data.routines.find(r=>r.id===item.routineId);return '<i style="background:'+esc(bot(r?.botId)?.color||'#999')+'"></i>';}).join('')+'</div></button>';}).join('')+'</div>';
 const label=new Date(selected.start).toLocaleDateString([],{weekday:'long',month:'short',day:'numeric'});
 return strip+'<div class="day-agenda"><div class="agenda-heading"><b>'+label+'</b><small>'+selected.items.length+' scheduled routine'+(selected.items.length===1?'':'s')+'</small></div>'+selected.items.map(item=>{const r=data.routines.find(r=>r.id===item.routineId);if(!r)return '';return '<button class="agenda-item" data-routine-edit="'+r.id+'"><time>'+time(item.firstRun)+'</time>'+avatar(bot(r.botId))+'<span><b>'+esc(r.name)+'</b><small>'+esc(bot(r.botId)?.name)+(item.count>1?' · '+item.count+' runs, '+scheduleLabel(r).toLowerCase():'')+'</small></span><span>↗</span></button>';}).join('')+(!selected.items.length?'<p class="agenda-empty">A clear day. Enable a routine to put your bot on the schedule.</p>':'')+'</div>';
}
function renderInspector(){
 const b=bot(inspect);$('app').classList.toggle('workspace-open',!!b);
 if(!b||inspectTab!=='overview')return renderDetailInspector();
 const c=b.computer,routines=data.routines.filter(r=>r.botId===b.id);
 const key=JSON.stringify(['overview',b.id,b.name,b.model,c.running,c.paused,routines,b.files]);if(key===panelKey)return;panelKey=key;
 const el=$('inspector');el.classList.remove('hidden','expanded');
 el.innerHTML=`<div class="inspector-head"><button class="icon-btn" data-close-panel aria-label="Close workspace">‹</button><div class="row"><button class="icon-btn" data-settings="${b.id}" aria-label="Bot settings">${icon('settings')}</button><button class="icon-btn" data-close-panel aria-label="Close workspace">×</button></div></div><div class="workspace-overview">${c.running?`<button class="screen-preview" data-inspect="computer"><img id="browser-screen" alt="Live preview of ${esc(b.name)}’s browser"></button>`:`<button class="screen-preview screen-placeholder" data-computer-start><span class="screen-start">${icon('computer')}<span>Start browser</span></span></button>`}<div class="screen-caption">${esc(b.name)}’s browser${c.running?'':' · Not started'}</div><div class="overview-section"><div class="section-heading"><h3>Routines</h3><button class="icon-btn" data-new-routine aria-label="New routine">+</button></div>${routines.length?routines.map(r=>`<button class="overview-routine" data-routine-edit="${r.id}"><span class="routine-indicator ${r.enabled?'enabled':''}">${icon('clock')}</span><span><b>${esc(r.name)}</b><small>${esc(r.enabled?scheduleLabel(r):'Paused')}</small></span></button>`).join(''):'<button class="empty-routines" data-new-routine>Add a recurring task</button>'}</div><div class="overview-section overview-files"><div class="section-heading"><h3>Workspace</h3></div><button class="overview-link" data-inspect="files">${icon('file')}<span>Files</span><small>${b.files?.length||0}</small></button><button class="overview-link" data-inspect="memory">${icon('memory')}<span>Memory</span><span>›</span></button><button class="overview-link" data-inspect="activity">${icon('activity')}<span>Activity</span><span>›</span></button></div><div class="overview-model"><button class="quiet-button" data-model="${b.id}">${esc((b.model||'Codex default').replace('gpt-','GPT-'))} ⌄</button><small>Runs on your host</small></div></div>`;
 if(c.running)screen();
}

function accountMenu(){
 modal('Crew','Your workspace',`<div class="contact-actions"><button data-close-nav="home">${icon('home')} Manage bots</button><button data-close-nav="routines">${icon('clock')} All routines</button><button data-close-nav="tasks">${icon('board')} Task history</button><button data-crew-settings="models">${icon('settings')} Models & reasoning</button><button data-crew-settings="skills">${icon('file')} Skills</button><button data-crew-settings="recall">${icon('clock')} Past work</button><button data-crew-settings="learning">${icon('memory')} Learning review</button>${window.CREW_MOBILE?'':'<button data-crew-app-changes>'+icon('file')+' App changes</button><button data-crew-settings="integrations">'+icon('computer')+' Integrations</button><button data-crew-settings="notifications">'+icon('inbox')+' Private notifications</button>'}<button data-theme>${icon('theme')} Switch appearance</button>${window.CREW_MOBILE?'':'<button data-crew-settings="connections">'+icon('bot')+' Connections</button>'}<button data-phone>${icon('computer')} ${window.CREW_MOBILE?'This iPhone':'Connect iPhone'}</button><button data-crew-settings="computer">${icon('computer')} Computer access</button><button data-crew-settings="cloud">${icon('home')} Cloud hosting</button><button data-settings-guide="FEATURES.md">${icon('file')} Feature guide</button><button data-settings-guide="QUICKSTART.md">${icon('info')} Quick start</button></div>`,'account');
}
function newConversation(){
 modal('New conversation','',`<div class="contact-actions"><button data-create>${icon('bot')} Create a bot</button><button data-create-group>${icon('group')} Create a group</button></div><div class="new-bot-templates"><small>Start with a role</small>${templates.map((t,i)=>`<button data-template="${i}">${avatar(t)}<span>${esc(t.name)}</span></button>`).join('')}</div>`,'new-conversation');
}

Object.assign(icons,{back:'<path d="m14 5-7 7 7 7"/>',plus:'<path d="M12 5v14M5 12h14"/>',search:'<circle cx="10" cy="10" r="6.5"/><path d="m15 15 5 5"/>',memory:'<path d="M6 4h12v16H6zM9 8h6M9 12h6M9 16h4"/>',activity:'<path d="M3 12h4l3-8 4 16 3-8h4"/>',theme:'<path d="M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9Z"/>',info:'<circle cx="12" cy="12" r="9"/><path d="M12 10v7M12 7v.5"/>',bot:'<rect x="4" y="5" width="16" height="15" rx="6"/><path d="M9 11v3M15 11v3M12 2v3"/>',group:'<circle cx="9" cy="8" r="3"/><path d="M3 20v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M18 14c3 0 4 3 4 6"/>'});
$('new-bot').onclick=newConversation;$('profile-menu').onclick=accountMenu;
document.addEventListener('click',e=>{
 const d=e.target.closest('button')?.dataset;if(!d)return;
 if(d.workspaceToggle!==undefined){workspaceWasAutomatic=false;if(inspect===selected)inspect=null;else{inspect=selected;inspectTab='overview';}panelKey='';renderInspector();}
 else if(d.closeNav){$('modal').close();navigate(d.closeNav);}
 else if(d.createGroup!==undefined)createChannel();
 else if(d.aboutPanel!==undefined)$('about').click();
});

window.addEventListener('resize',()=>{if(window.innerWidth<1100&&workspaceWasAutomatic&&inspect){inspect=null;workspaceWasAutomatic=false;panelKey='';renderInspector();}});
document.addEventListener('click',e=>{
 const d=e.target.closest('button')?.dataset;if(!d)return;
 if(d.phoneTab){$('modal').close();navigate(d.phoneTab);}
 else if(d.phoneBack!==undefined)phoneBack();
 else if(d.phoneGroupInfo)phoneGroupInfo(d.phoneGroupInfo);
});
window.addEventListener('popstate',e=>{
 if(!phoneMode||!e.state?.crewPhone)return;
 $('modal').close();inspect=null;
 const target=e.state.crewPhone;
 navigate(target.view,target.id,{history:false});
});
phoneQuery.addEventListener('change',e=>{
 saveDraft();phoneMode=e.matches;inspect=null;workspaceWasAutomatic=false;
 if(phoneMode){view=channel?'phone-groups':'phone-bots';channel=null;history.replaceState({...history.state,crewPhone:{view,id:null,detail:false}},'');}
 else if(view.startsWith('phone-')){view=current()?'bot':'home';channel=null;}
 renderKey='';msgKey='';approvalKey='';panelKey='';render();
});
window.addEventListener('online',()=>refresh());
window.addEventListener('pageshow',e=>{if(e.persisted)refresh();});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refresh();});


let phonePoll=null;
async function phonePanel(pairing=null,{quiet=false}={}){
 clearTimeout(phonePoll);
 if(window.CREW_MOBILE){modal('Crew on your iPhone','Connected to your computer.', '<p class="note">In Safari, open Share → Add to Home Screen, leave Open as Web App enabled if shown, and tap Add.</p><p class="note">Keep Tailscale connected on both devices and Crew running on your awake computer. Your bots, chats, files and routines are shared.</p><button class="btn danger" data-phone-signout>Disconnect this iPhone</button>','phone');return;}
 if(!quiet)modal('Connect iPhone','Take your Crew with you.','<p class="note">Checking your connection…</p>','phone');
 try{
 const status=await api('mobile-status');if(modalType!=='phone'||!$('modal').open)return;
 const deviceList=status.devices.length?'<div class="phone-devices">'+status.devices.map(d=>'<div class="row between"><span>'+esc(d.name)+'<small>Paired '+date(d.createdAt)+'</small></span><button class="btn quiet" data-phone-revoke="'+d.id+'">Remove</button></div>').join('')+'</div>':'<p class="note">No paired devices yet.</p>';
 const ready=status.enabled,unix=['darwin','linux'].includes(status.platform),setup=status.setup||{},working=setup.status==='running';
 let actionUrl='';try{const link=new URL(setup.actionUrl);if(link.protocol==='https:'&&['tailscale.com','login.tailscale.com'].includes(link.hostname)&&!link.username&&!link.password&&(!link.port||link.port==='443'))actionUrl=link.href;}catch{}
 const setupDetails=(working?'<p class="note">Checking your private Tailscale connection…</p>':'')+(setup.error||status.error?'<p class="note">'+esc(setup.error||status.error)+'</p>':'')+(actionUrl?'<a class="btn" href="'+esc(actionUrl)+'" target="_blank" rel="noopener noreferrer">Open Tailscale setup ↗</a>':'');
 const instructions=unix?'<a href="https://tailscale.com/download/'+(status.platform==='darwin'?'mac':'linux')+'" target="_blank" rel="noopener noreferrer">2. Install Tailscale on this '+(status.platform==='darwin'?'Mac':'computer')+' ↗</a><p class="note">Open Tailscale and sign in first. Crew will then set up the private connection using your existing installation.</p><button class="btn primary" data-phone-setup '+(working?'disabled':'')+'>Set up connection</button>':'<button class="btn primary" data-phone-setup>2. Set up this PC</button><p class="note">The setup window installs Tailscale if needed and guides you through signing in. Windows may ask to allow the setup.</p>';
 const content=ready?'<p class="note">Connect Tailscale on your iPhone, then open this private address in Safari.</p><div class="phone-address">'+esc(status.origin)+'</div><div class="row"><button class="btn" data-phone-copy="'+esc(status.origin)+'">Copy address</button><button class="btn primary" data-phone-pair>Create pairing code</button></div>'+(pairing?'<div class="phone-code"><small>Enter this on your iPhone · expires in 5 minutes</small><strong>'+pairing.code.slice(0,4)+' '+pairing.code.slice(4)+'</strong></div>':'')+'<p class="note">After pairing, use Safari’s Share menu → Add to Home Screen. If the Home Screen app asks to pair again, create a fresh code here.</p><h3 class="phone-label">Paired devices</h3>'+deviceList+'<button class="btn danger" data-phone-disable>Turn off phone access</button>':'<p class="note">Crew uses Tailscale to connect your computer and iPhone privately. Sign in to the same Tailscale account on both devices.</p><div class="phone-steps"><a href="https://tailscale.com/download/ios" target="_blank" rel="noopener noreferrer">1. Get Tailscale for iPhone ↗</a>'+instructions+'<button class="btn" data-phone-refresh>Check connection</button></div>'+setupDetails;
 modal('Connect iPhone','Your bots and chats, wherever you are.',content+'<p class="note phone-footer">Keep this computer awake with Crew running. Closing the desktop window leaves Crew in the system tray.</p>','phone');
 if(working)phonePoll=setTimeout(()=>{if($('modal').open&&modalType==='phone')phonePanel(null,{quiet:true});},1500);
 if(pairing)setTimeout(()=>{const el=document.querySelector('.phone-code');if(el)el.innerHTML='<small>This code expired. Create a new pairing code.</small>';},Math.max(0,pairing.expiresAt-Date.now()));
 }catch(e){toast(e.message);}
}
document.addEventListener('click',async e=>{
 const el=e.target.closest('button'),d=el?.dataset;if(!d)return;
 try{
 if(d.phone!==undefined||d.phoneRefresh!==undefined)await phonePanel();
 else if(d.phoneSetup!==undefined){el.disabled=true;const result=await api('mobile-setup',{});if(result.status==='external')toast('Finish the setup window, then choose Check connection.');else await phonePanel();el.disabled=false;}
 else if(d.phonePair!==undefined)await phonePanel(await api('mobile-pair',{}));
 else if(d.phoneCopy){await navigator.clipboard.writeText(d.phoneCopy);toast('Private address copied');}
 else if(d.phoneRevoke){await api('mobile-revoke',{deviceId:d.phoneRevoke});await phonePanel();}
 else if(d.phoneDisable!==undefined){await api('mobile-disable',{});await phonePanel();}
 else if(d.phoneSignout!==undefined){const r=await fetch('/unpair',{method:'POST',headers:{'X-Crew-Token':window.CREW_TOKEN}});if(!r.ok)throw Error('Could not disconnect. Try again.');location.replace('/');}
 }catch(error){if(el)el.disabled=false;toast(error.message);}
});


let accountPoll=null,accountRequest=false,accountLogin=null,accountKey='';
function drawAccount(state){
 const signed=state.connected&&state.type==='chatgpt';
 const pending=state.login?.status==='pending';
 const key=JSON.stringify([state,accountLogin]);if(key===accountKey)return;accountKey=key;
 let body;
 if(signed&&state.error){body='<p class="note" role="alert">Could not refresh account status. ChatGPT was connected at the last successful check.</p><p class="note">'+esc(state.error)+'</p><p class="note">Crew will check again automatically. Your sign-in has not been changed.</p><button class="btn" data-close-modal>Back to Crew</button>';}
 else if(signed){accountLogin=null;body='<div class="account-connected"><span>✓</span><div><b>ChatGPT connected</b><small>'+esc(state.plan?state.plan.charAt(0).toUpperCase()+state.plan.slice(1)+' plan':'Your ChatGPT account')+'</small></div></div><p class="note">Crew is ready. Its engine is included in this app, so you can use Crew with the Codex desktop app closed or uninstalled.</p><p class="note">Usage follows your account’s limits. Your conversations and bot files stay in Crew.</p><button class="btn primary" data-close-modal>Back to Crew</button>';}
 else if(pending&&accountLogin){body='<p class="note">Continue in your browser and sign in to ChatGPT. Then return here; Crew will connect automatically.</p><a class="btn primary account-login-link" href="'+esc(accountLogin.authUrl)+'" target="_blank" rel="noopener noreferrer">Continue to ChatGPT ↗</a><p class="note account-wait">Waiting for sign-in…</p><button class="btn quiet" data-account-cancel="'+esc(accountLogin.loginId)+'">Cancel sign-in</button>';}
 else if(pending){body='<p class="note">A sign-in is already in progress in your browser. Finish it there, or cancel to start again.</p><button class="btn" data-account-cancel="'+esc(state.login.loginId)+'">Cancel sign-in</button>';}
 else{body='<p class="note">Sign in with your ChatGPT account to start using your bots. Crew includes the engine; you do not need to install the Codex desktop app.</p>'+(state.connected?'<p class="note">This host currently uses a different sign-in method. Continue below to connect ChatGPT.</p>':'')+'<button class="btn primary" data-account-start>Sign in with ChatGPT</button><p class="note account-wait">Your password is entered only on the official ChatGPT sign-in page.</p>'+(state.login?.error||state.error?'<p class="note">'+esc(state.login?.error||state.error)+'</p>':'');}
 modal('ChatGPT account','Built into your Crew.',body,'chatgpt-account');
}
async function accountPanel(){
 if(window.CREW_MOBILE)return;
 clearInterval(accountPoll);accountKey='';
 modal('ChatGPT account','Built into your Crew.','<p class="note">Checking your account…</p>','chatgpt-account');
 await updateAccountPanel();
 accountPoll=setInterval(updateAccountPanel,2000);
}
async function updateAccountPanel(){
 if(!$('modal').open||modalType!=='chatgpt-account'){clearInterval(accountPoll);return;}
 if(accountRequest)return;accountRequest=true;
 try{const state=await api('account-status');if($('modal').open&&modalType==='chatgpt-account')drawAccount(state);}
 catch(e){if($('modal').open&&modalType==='chatgpt-account'){accountKey='';modal('ChatGPT account','Built into your Crew.','<p class="note" role="alert">Could not refresh account status.</p><p class="note">'+esc(e.message)+'</p><p class="note">Crew will check again automatically. Your sign-in has not been changed.</p><button class="btn" data-close-modal>Back to Crew</button>','chatgpt-account');}}
 finally{accountRequest=false;}
}
document.addEventListener('click',async event=>{
 const el=event.target.closest('button'),d=el?.dataset;if(!d)return;
 try{
 if(d.chatgptAccount!==undefined)await accountPanel();
 else if(d.accountStart!==undefined){el.disabled=true;accountLogin=await api('account-login',{});accountKey='';await updateAccountPanel();}
 else if(d.accountCancel){el.disabled=true;await api('account-cancel',{loginId:d.accountCancel});accountLogin=null;accountKey='';await updateAccountPanel();}
 }catch(e){if(el)el.disabled=false;if($('modal-error'))$('modal-error').textContent=e.message;else toast(e.message);}
});
const appChangesUI=createAppChangesUI({api,modal});
const settingsUI=createSettingsUI({api,modal,refresh,getBots:()=>data.bots,accountPanel,md,onSource:openSource,onAppChange:()=>appChangesUI.open()});
function openSource(source){
 let url;try{url=new URL(source,location.href);}catch{toast('This conversation link is invalid.');return;}
 if(url.origin!==location.origin||url.pathname!=='/'){toast('This source is outside this Crew workspace.');return;}
 const owner=bot(url.searchParams.get('bot'));if(!owner){toast('This source bot is no longer available.');return;}
 const messageId=url.searchParams.get('message'),taskId=url.searchParams.get('task');
 const message=messageId?owner.messages.find(m=>m.id===messageId):taskId?owner.messages.find(m=>m.taskId===taskId):null;
 if(messageId&&!message){toast('This source message is no longer available.');return;}
 const task=taskId?data.tasks.find(t=>t.id===taskId&&t.botId===owner.id):null;
 if(taskId&&!message&&!task){toast('This source task is no longer available.');return;}
 const sourceChannel=message?.channelId||task?.channelId;
 if(sourceChannel&&!data.channels.some(c=>c.id===sourceChannel&&c.members.includes(owner.id))){toast('This source channel is no longer available.');return;}
 $('modal').close();selected=owner.id;navigate(sourceChannel?'channel':'bot',sourceChannel||owner.id);
 if(message)requestAnimationFrame(()=>{const element=[...document.querySelectorAll('[data-source-message]')].find(el=>el.dataset.sourceMessage===message.id);if(element){element.scrollIntoView({block:'center',behavior:'auto'});element.classList.add('source-highlight');setTimeout(()=>element.classList.remove('source-highlight'),3000);}});
}
document.addEventListener('click',event=>{const link=event.target.closest('a');if(!link||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;let url;try{url=new URL(link.href,location.href);}catch{return;}if(url.origin===location.origin&&url.pathname==='/'&&url.searchParams.has('bot')){event.preventDefault();openSource(url.href);}});
// First-run onboarding offers every configured connection.
if(!window.CREW_MOBILE)setTimeout(async()=>{
 try{const [state,connections]=await Promise.all([api('account-status'),api('providers')]);if(!data.bots.length&&!state.connected&&!connections.some(p=>p.id!=='codex'&&(p.hasKey||p.type==='ollama'||p.type==='custom'))&&!$('modal').open)settingsUI.welcome();}catch{}
},1000);

