'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {EventEmitter}=require('node:events');
const vm=require('node:vm');
const {HOME_URL,isCrewOrigin,isCrewResource,externalWebLink,parseHealth,tokenFromHTML}=require('./policy.cjs');
const {probeHost,bundledFiles,ensureHost,shutdownHost,installBrowser}=require('./host.cjs');

const token='a'.repeat(64);
const html=value=>`<title>FOLKLET</title><div id="app"></div><script>window.CREW_TOKEN='${value}';</script><script src="/app.js"></script>`;
function packageFixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'crew-shell-'));
 for(const name of ['runtime/node','runtime/node.exe','runtime/codex/bin/codex','runtime/codex/codex.exe','server.mjs','node_modules/playwright/cli.js']){const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'Test fixture; never execute');}
 t.after(()=>{const resolved=path.resolve(root);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert.match(path.basename(resolved),/^crew-shell-/);fs.rmSync(resolved,{recursive:true,force:true});});
 return root;
}
async function hostFixture(t){
 const state={pid:12345,token,healthApp:'Crew',root:true},requests=[];
 const server=http.createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;
  requests.push({url:req.url,method:req.method,token:req.headers['x-crew-token'],body});
  if(req.url==='/health'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({app:state.healthApp,version:5,pid:state.pid}));}
  else if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end(state.root?html(state.token):'<title>Other app</title>');}
  else if(req.url==='/api/shutdown'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:req.headers['x-crew-token']===state.token}));}
  else{res.writeHead(404);res.end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
 t.after(async()=>{server.closeAllConnections();if(server.listening)await new Promise(resolve=>server.close(resolve));});
 return {port,state,requests,server};
}

test('navigation keeps Crew resources local and allows only validated HTTP(S) external links',()=>{
 for(const value of [HOME_URL,HOME_URL+'?panel=tasks',HOME_URL+'api/file?id=test','blob:'+HOME_URL+'download'])assert.equal(isCrewResource(value),true,value);
 for(const value of ['http://localhost:4318/','http://127.0.0.1:4319/','http://127.0.0.1.evil.example:4318/','http://user@127.0.0.1:4318/','file:///private/example','data:text/html,example','javascript:alert(1)','blob:https://example.com/id','https://127.0.0.1:4318/'])assert.equal(isCrewResource(value),false,value);
 for(const value of ['javascript:alert(1)','file:///private/example','data:text/html,example','https://user@example.com/','https://example.com/\n','https://example.com\\path',HOME_URL])assert.equal(externalWebLink(value),null,value);
 assert.equal(externalWebLink('https://auth.openai.com/authorize?state=example'),'https://auth.openai.com/authorize?state=example');assert.equal(isCrewOrigin('blob:'+HOME_URL+'download'),false);
});

test('host identity requires both structured health and recognizable Crew HTML with a full token',()=>{
 assert.deepEqual(parseHealth({app:'Crew',version:5,pid:123}),{version:5,pid:123});
 for(const value of [null,{app:'Other',version:5,pid:123},{app:'Crew',version:4,pid:123},{app:'Crew',version:5,pid:'123'}])assert.equal(parseHealth(value),null);
 assert.equal(tokenFromHTML(html(token)),token);assert.equal(tokenFromHTML(html('short')),null);assert.equal(tokenFromHTML(`<script>window.CREW_TOKEN='${token}';</script>`),null);
});

test('bundled runtime selection uses each official platform layout and never PATH fallback',t=>{
 const root=packageFixture(t);
 for(const platform of ['darwin','linux']){const files=bundledFiles(root,platform);assert.equal(files.node,path.join(root,'runtime','node'));assert.equal(files.engine,path.join(root,'runtime','codex','bin','codex'));}
 assert.equal(bundledFiles(root,'win32').engine,path.join(root,'runtime','codex','codex.exe'));
 fs.unlinkSync(path.join(root,'runtime','codex','bin','codex'));assert.throws(()=>bundledFiles(root,'darwin'),/bundled runtime is missing/);
});

test('existing local service needs both identities before reuse and no second process is spawned',async t=>{
 const f=await hostFixture(t),appRoot=packageFixture(t);
 const identity=await ensureHost({appRoot,dataRoot:path.join(appRoot,'test-data'),port:f.port,spawnProcess:()=>{throw Error('Must not spawn');}});
 assert.equal(identity.pid,f.state.pid);assert.equal(identity.token,token);assert.equal(identity.child,null);
 f.state.root=false;assert.equal((await probeHost({port:f.port})).state,'occupied');
 f.state.root=true;f.state.healthApp='Other';assert.equal((await probeHost({port:f.port})).state,'occupied');
});

test('cold start launches only bundled Node and keeps writable data/browser caches outside the app',async t=>{
 const f=await hostFixture(t),appRoot=packageFixture(t);await new Promise(resolve=>f.server.close(resolve));let calls=0,received;
 const dataRoot=path.join(appRoot,'user-area','data'),browserRoot=path.join(appRoot,'user-area','browsers');
 const identity=await ensureHost({appRoot,dataRoot,browserRoot,port:f.port,spawnProcess:(file,args,options)=>{
  calls++;received={file,args,options};const child=new EventEmitter();child.pid=f.state.pid;child.unref=()=>{};f.server.listen(f.port,'127.0.0.1');return child;
 }});
 const expected=bundledFiles(appRoot);assert.equal(calls,1);assert.equal(received.file,expected.node);assert.deepEqual(received.args,[expected.server]);assert.equal(received.options.cwd,appRoot);assert.equal(received.options.env.CREW_DATA,dataRoot);assert.equal(received.options.env.PLAYWRIGHT_BROWSERS_PATH,browserRoot);assert.equal(received.options.shell,undefined);assert.equal(received.options.windowsHide,true);assert.equal(received.options.env.NODE_OPTIONS,undefined);assert.equal(identity.pid,f.state.pid);
});

test('shutdown rechecks identity and never sends credentials when the local service changed',async t=>{
 const f=await hostFixture(t),identity={...await probeHost({port:f.port}),port:f.port};
 f.state.pid++;await assert.rejects(shutdownHost(identity),/local service changed/);assert.equal(f.requests.filter(r=>r.method==='POST').length,0);
 f.state.pid--;f.state.token='b'.repeat(64);await assert.rejects(shutdownHost(identity),/local service changed/);assert.equal(f.requests.filter(r=>r.method==='POST').length,0);
 f.state.token=token;await shutdownHost(identity);const request=f.requests.find(r=>r.method==='POST');assert.deepEqual(request,{url:'/api/shutdown',method:'POST',token,body:'{}'});
});

test('optional browser install runs the pinned local Playwright CLI without shell or system installs',async t=>{
 const appRoot=packageFixture(t),browserRoot=path.join(appRoot,'user-area','browsers');let received;
 await installBrowser({appRoot,browserRoot,spawnProcess:(file,args,options)=>{received={file,args,options};const child=new EventEmitter();queueMicrotask(()=>child.emit('close',0));return child;}});
 assert.equal(received.file,bundledFiles(appRoot).node);assert.deepEqual(received.args,[path.join(appRoot,'node_modules','playwright','cli.js'),'install','chromium']);assert.equal(received.options.env.PLAYWRIGHT_BROWSERS_PATH,browserRoot);assert.equal(received.options.shell,undefined);assert.equal(received.options.windowsHide,true);
 await assert.rejects(installBrowser({appRoot,browserRoot,spawnProcess:()=>{const child=new EventEmitter();queueMicrotask(()=>child.emit('close',1));return child;}}),/Browser installation failed/);
});

test('shell first launch creates a private profile and binds Electron isolation/navigation controls',async t=>{
 const root=packageFixture(t),paths={appData:path.join(root,'user-area')},opened=[];let windowOptions,window,hostOptions,permissions,permissionCheck,deviceCheck,requests;
 const fakeApp=new EventEmitter();Object.assign(fakeApp,{setName:()=>{},getPath:name=>paths[name]||root,setPath:(name,value)=>{assert.equal(fs.existsSync(value),true);paths[name]=value;},enableSandbox:()=>{fakeApp.sandbox=true;},requestSingleInstanceLock:()=>true,whenReady:()=>Promise.resolve(),quit:()=>{}});
 const fakeSession=new EventEmitter();Object.assign(fakeSession,{setPermissionRequestHandler:fn=>{permissions=fn;},setPermissionCheckHandler:fn=>{permissionCheck=fn;},setDevicePermissionHandler:fn=>{deviceCheck=fn;},webRequest:{onBeforeRequest:fn=>{requests=fn;}}});
 class FakeWindow extends EventEmitter{
  constructor(options){super();window=this;windowOptions=options;this.webContents=new EventEmitter();Object.assign(this.webContents,{getURL:()=>HOME_URL,setWindowOpenHandler:fn=>{this.webContents.openHandler=fn;}});}
  loadURL(url){assert.equal(url,HOME_URL);return Promise.resolve();}isDestroyed(){return false;}isMinimized(){return false;}show(){}focus(){}minimize(){}
 }
 class FakeTray extends EventEmitter{setToolTip(){}setContextMenu(){}destroy(){}}
 const fakeElectron={app:fakeApp,BrowserWindow:FakeWindow,session:{fromPartition:()=>fakeSession},Menu:{buildFromTemplate:items=>({items,getMenuItemById:()=>null}),setApplicationMenu:()=>{},getApplicationMenu:()=>null},Tray:FakeTray,nativeImage:{createFromPath:()=>({resize:()=>({})})},dialog:{showErrorBox:(_title,message)=>{throw Error(message);}},shell:{openExternal:url=>{opened.push(url);return Promise.resolve();}}};
 const policy=require('./policy.cjs');
 const scope={require:name=>name==='electron'?fakeElectron:name==='./policy.cjs'?policy:name==='./host.cjs'?{ensureHost:async options=>{hostOptions=options;return {pid:123,token,port:4318};},shutdownHost:async()=>{},installBrowser:async()=>{}}:require(name),__dirname:path.join(root,'resources','app'),process:{platform:'linux'},AbortController};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'main.cjs'),'utf8'),scope);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(fakeApp.sandbox,true);assert.equal(paths.sessionData,path.join(paths.userData,'profile'));assert.equal(hostOptions.dataRoot,path.join(paths.userData,'data'));assert.equal(hostOptions.browserRoot,path.join(paths.userData,'browsers'));
 assert.equal(windowOptions.webPreferences.nodeIntegration,false);assert.equal(windowOptions.webPreferences.contextIsolation,true);assert.equal(windowOptions.webPreferences.sandbox,true);assert.equal(windowOptions.webPreferences.webviewTag,false);assert.equal(windowOptions.webPreferences.preload,undefined);
 let answer;permissions(null,'media',value=>{answer=value;});assert.equal(answer,false);assert.equal(permissionCheck(),false);assert.equal(deviceCheck(),false);requests({url:'https://example.com/code.js'},value=>{answer=value.cancel;});assert.equal(answer,true);
 let prevented=false;window.webContents.emit('will-frame-navigate',{url:'https://auth.openai.com/authorize',isMainFrame:true,preventDefault:()=>{prevented=true;}});assert.equal(prevented,true);assert.deepEqual(opened,['https://auth.openai.com/authorize']);
 const popup=window.webContents.openHandler({url:'file:///private/example'});assert.equal(popup.action,'deny');assert.equal(opened.length,1);
});
