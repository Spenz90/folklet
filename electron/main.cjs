'use strict';

const {app,BrowserWindow,Menu,Tray,nativeImage,dialog,shell,session}=require('electron');
const path=require('node:path');
const fs=require('node:fs');
const {HOME_URL,isCrewOrigin,isCrewResource,externalWebLink}=require('./policy.cjs');
const {ensureHost,shutdownHost,installBrowser}=require('./host.cjs');
const {smokeOptions,captureSmoke}=require('./smoke.cjs');

app.setName('Folklet');
const smoke=smokeOptions(process.argv,process.env);
const userData=smoke?path.join(smoke.root,'desktop-user'):path.join(app.getPath('appData'),'Crew'),profileRoot=path.join(userData,'profile');
fs.mkdirSync(profileRoot,{recursive:true});
app.setPath('userData',userData);app.setPath('sessionData',profileRoot);
app.enableSandbox();
const appRoot=path.join(__dirname,'crew');
const browserRoot=path.join(app.getPath('userData'),'browsers');
let mainWindow=null,tray=null,trayMenu=null,identity=null,starting=null,quitting=false,quitPending=false,browserInstall=null;

function showWindow(){if(!mainWindow||mainWindow.isDestroyed())return;if(mainWindow.isMinimized())mainWindow.restore();mainWindow.show();mainWindow.focus();}
function openWeb(value){const url=externalWebLink(value);if(url)shell.openExternal(url).catch(()=>dialog.showErrorBox('Could not open link','Open this link in your usual web browser.'));}

function protectSession(crewSession){
 crewSession.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
 crewSession.setPermissionCheckHandler(()=>false);
 crewSession.setDevicePermissionHandler(()=>false);
 crewSession.webRequest.onBeforeRequest((details,callback)=>{
  const publicImage=/^data:image\/(?:png|jpeg|gif|webp|svg\+xml);/i.test(details.url);
  callback({cancel:!isCrewResource(details.url)&&!publicImage&&details.url!=='about:blank'});
 });
 crewSession.on('will-download',(event,item,contents)=>{
  if(contents!==mainWindow?.webContents||!isCrewOrigin(contents.getURL())||!isCrewResource(item.getURL())){event.preventDefault();return;}
  const name=path.basename(item.getFilename()).replace(/[\u0000-\u001f\u007f]/g,'_')||'Folklet download';
  item.setSaveDialogOptions({title:'Save from Folklet',defaultPath:path.join(app.getPath('downloads'),name)});
 });
}

function createWindow(){
 const crewSession=session.fromPartition('persist:crew-window');protectSession(crewSession);
 mainWindow=new BrowserWindow({title:'Folklet',width:1280,height:860,minWidth:780,minHeight:540,show:false,backgroundColor:'#070707',icon:path.join(appRoot,'icons','crew-512.png'),
  webPreferences:{session:crewSession,sandbox:true,contextIsolation:true,nodeIntegration:false,nodeIntegrationInWorker:false,nodeIntegrationInSubFrames:false,webviewTag:false,webSecurity:true,allowRunningInsecureContent:false,experimentalFeatures:false,devTools:false,navigateOnDragDrop:false,spellcheck:false}});
 const contents=mainWindow.webContents;
 contents.on('will-attach-webview',event=>event.preventDefault());
 contents.on('will-navigate',(event,url)=>{if(!isCrewOrigin(url||event.url))event.preventDefault();});
 contents.on('will-frame-navigate',event=>{if(!isCrewOrigin(event.url)){event.preventDefault();if(event.isMainFrame&&isCrewOrigin(contents.getURL()))openWeb(event.url);}});
 contents.on('will-redirect',(event,url)=>{if(!isCrewOrigin(url||event.url))event.preventDefault();});
 contents.setWindowOpenHandler(details=>{if(isCrewOrigin(contents.getURL()))openWeb(details.url);return {action:'deny'};});
 contents.on('select-bluetooth-device',(event,_devices,callback)=>{event.preventDefault();callback('');});
 mainWindow.on('page-title-updated',event=>event.preventDefault());
 mainWindow.on('close',event=>{
  if(quitting)return;event.preventDefault();
  // Linux desktops can hide tray icons. Keep the window reachable in the taskbar.
  if(process.platform==='linux')mainWindow.minimize();else mainWindow.hide();
 });
 if(smoke)contents.once('did-finish-load',()=>void captureSmoke(contents,smoke,{exit:code=>{quitting=true;app.exit(code);}}));
 else mainWindow.once('ready-to-show',showWindow);
 mainWindow.loadURL(HOME_URL).catch(()=>dialog.showErrorBox('Folklet could not open','Use View → Reload to reconnect to the local app.'));
}

function createMenus(){
 const quitItem={label:'Quit Folklet',accelerator:process.platform==='darwin'?'Command+Q':'Control+Q',click:()=>app.quit()};
 const installItem={id:'install-browser',label:'Install browser',click:()=>void downloadBrowser()};
 const template=[{label:'Folklet',submenu:[{label:'Show Folklet',click:showWindow},installItem,{type:'separator'},quitItem]},
  {label:'Edit',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},
  {label:'View',submenu:[{role:'reload'},{role:'resetZoom'},{role:'zoomIn'},{role:'zoomOut'},{type:'separator'},{role:'togglefullscreen'}]},
  {label:'Window',submenu:[{role:'minimize'},{label:'Show Folklet',click:showWindow}]}];
 Menu.setApplicationMenu(Menu.buildFromTemplate(template));
 try{const icon=nativeImage.createFromPath(path.join(appRoot,'icons','crew-192.png')).resize({width:20,height:20});tray=new Tray(icon);tray.setToolTip('Folklet');trayMenu=Menu.buildFromTemplate([{label:'Open Folklet',click:showWindow},installItem,{type:'separator'},quitItem]);tray.setContextMenu(trayMenu);tray.on('click',showWindow);}catch{/* The application menu and taskbar remain available without a tray. */}
 if(process.platform==='darwin')app.dock?.setIcon(path.join(appRoot,'icons','crew-512.png'));
}

async function downloadBrowser(){
 if(browserInstall)return;browserInstall=new AbortController();
 const setInstalling=working=>{for(const menu of [Menu.getApplicationMenu(),trayMenu]){const item=menu?.getMenuItemById('install-browser');if(item){item.enabled=!working;item.label=working?'Installing browser…':'Install browser';}}};
 setInstalling(true);
 try{await installBrowser({appRoot,browserRoot,signal:browserInstall.signal});if(!quitting&&!quitPending)await dialog.showMessageBox(mainWindow,{type:'info',title:'Browser ready',message:'Folklet’s browser is installed.',detail:'Your bots can now open their own browser.',buttons:['Done']});}
 catch(error){if(!quitting&&!quitPending)dialog.showErrorBox('Browser installation',error.message);}
 finally{browserInstall=null;if(!quitting)setInstalling(false);}
}

async function quitCrew(){
 if(quitPending)return;quitPending=true;
 browserInstall?.abort();
 try{if(starting)try{identity=await starting;}catch{}await shutdownHost(identity);quitting=true;tray?.destroy();app.quit();}
 catch(error){quitPending=false;showWindow();dialog.showErrorBox('Folklet is still running',error.message);}
}

if(!app.requestSingleInstanceLock())app.quit();
else{
 app.on('second-instance',showWindow);
 app.on('activate',showWindow);
 app.on('window-all-closed',()=>{});
 app.on('before-quit',event=>{if(!quitting){event.preventDefault();void quitCrew();}});
 app.on('certificate-error',(event,_contents,_url,_error,_certificate,callback)=>{event.preventDefault();callback(false);});
 app.on('select-client-certificate',(event,_contents,_url,_certificates,callback)=>{event.preventDefault();callback();});
 app.on('login',(event,_contents,_details,_authInfo,callback)=>{event.preventDefault();callback('','');});
 app.whenReady().then(async()=>{
  try{starting=ensureHost({appRoot,dataRoot:path.join(app.getPath('userData'),'data'),browserRoot,existingOnly:!!smoke,expectedPid:smoke?.hostPid});identity=await starting;starting=null;if(quitPending||quitting)return;createWindow();if(!smoke)createMenus();}
  catch(error){starting=null;if(smoke){fs.writeFileSync(smoke.report,JSON.stringify({passed:false,error:'Isolated desktop host startup failed.'})+'\n');quitting=true;app.exit(1);return;}if(!quitPending)dialog.showErrorBox('Folklet could not start',error.message);quitting=true;app.quit();}
 });
}
