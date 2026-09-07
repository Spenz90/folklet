import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Computers,resolveCrewBrowser} from './computer.mjs';
import {managedBrowserHeader} from './http.mjs';

const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
function browserHarness(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'crew-browser-test-'));
 const clicks=[],pages=[];
 const makePage=()=>{const p=new EventEmitter();p.closed=false;p.isClosed=()=>p.closed;p.mouse={click:async(...args)=>clicks.push(args)};p.screenshot=async()=>Buffer.from('test-frame');p.url=()=>'about:blank';p.title=async()=>'Test page';p.locator=()=>({ariaSnapshot:async()=>''});pages.push(p);return p;};
 const page=makePage(),ctx=new EventEmitter();ctx.pages=()=>pages;ctx.newPage=async()=>makePage();ctx.setDefaultTimeout=()=>{};ctx.close=async()=>{ctx.closed=true;ctx.emit('close');};ctx.route=async(pattern,handler)=>{ctx.routePattern=pattern;ctx.routeHandler=handler;};
 const browser={executablePath:()=>process.execPath,launchPersistentContext:async(_dir,options)=>{ctx.options=options;return ctx;}};
 const computers=new Computers(root,()=>{},{browser}),bot={id:'test-bot',cwd:path.join(root,'workspace')};
 t.after(async()=>{await computers.close();assert.equal(path.dirname(root),os.tmpdir());assert.match(path.basename(root),/^crew-browser-test-/);fs.rmSync(root,{recursive:true,force:true});});
 return {computers,bot,ctx,page,pages,clicks,browser,makePage};
}

test('queued bot actions stop when the user takes control before execution',async t=>{
 const {computers,bot,clicks}=browserHarness(t),c=await computers.get(bot),gate=deferred();c.chain=gate.promise;
 const blocked=assert.rejects(computers.act(bot,{action:'click',x:10,y:20}),/user has control/);
 await computers.control(bot,true);gate.resolve();await blocked;
 assert.equal(clicks.length,0);
 await computers.act(bot,{action:'click',x:30,y:40},'user');
 assert.deepEqual(clicks,[[30,40]]);
});

test('managed browser blocks Crew origins and IP aliases but preserves other local development sites',async t=>{
 const {computers,bot,page}=browserHarness(t);computers.protectControlOrigin('http://127.0.0.1:4318');computers.protectControlOrigin('http://127.0.0.1:4320');computers.protectControlOrigin('https://crew.example.ts.net:8443');
 const navigations=[];page.goto=async url=>navigations.push(url);
 for(const url of ['http://127.0.0.1:4318/','http://localhost:4318/?x=1','http://[::1]:4318/','http://2130706433:4318/','http://0x7f000001:4318/','http://127.1:4318/','http://localhost:4320/pair','https://crew.example.ts.net:8443/'])await assert.rejects(computers.act(bot,{action:'navigate',url}),/cannot open Crew owner/);
 assert.equal(navigations.length,0);
 for(const url of ['http://localhost:3000/preview','http://127.0.0.1:8080/','https://example.com/'])await computers.act(bot,{action:'navigate',url});
 assert.equal(navigations.length,3);
});

test('context routes protect popups and subrequests, with an enforced marker for redirect destinations',async t=>{
 const {computers,bot,ctx}=browserHarness(t);await computers.get(bot);
 assert.equal(ctx.options.serviceWorkers,'block');assert.equal(ctx.options.chromiumSandbox,true);assert.equal(ctx.options.extraHTTPHeaders[managedBrowserHeader],'1');assert.equal(ctx.routePattern,'**/*');
 // Protection added after a context has started also applies to its requests.
 computers.protectControlOrigin('http://localhost:4318');computers.protectControlOrigin('https://crew.example.ts.net:8443');
 const attempt=async(url,headers={})=>{const result={};await ctx.routeHandler({request:()=>({url:()=>url,headers:()=>headers}),abort:async reason=>{result.abort=reason;},continue:async options=>{result.continue=options;}});return result;};
 for(const url of ['http://127.0.0.1:4318/','http://localhost:4318/api/native-enable','https://crew.example.ts.net:8443/'])assert.deepEqual(await attempt(url),{abort:'blockedbyclient'});
 const permitted=await attempt('https://example.com/redirect-to-local',{accept:'text/html',[managedBrowserHeader]:''});
 assert.equal(permitted.continue.headers[managedBrowserHeader],'1','A page cannot erase the marker; Playwright retains overridden headers on redirects.');assert.equal(permitted.continue.headers.accept,'text/html');
 assert.equal((await attempt('http://localhost:3000/')).continue.headers[managedBrowserHeader],'1');
});

test('queued user actions stop when control is returned to the bot',async t=>{
 const {computers,bot,clicks}=browserHarness(t),c=await computers.get(bot),gate=deferred();c.chain=gate.promise;c.paused=true;
 const blocked=assert.rejects(computers.act(bot,{action:'click',x:10,y:20},'user'),/Take control/);
 await computers.control(bot,false);gate.resolve();await blocked;assert.equal(clicks.length,0);
});

test('the next action recovers a closed active tab before interacting',async t=>{
 const {computers,bot,page,makePage}=browserHarness(t),c=await computers.get(bot);const remaining=makePage();page.closed=true;
 await computers.act(bot,{action:'click',x:10,y:20});assert.equal(c.page,remaining);
 remaining.closed=true;await computers.act(bot,{action:'look'});assert.notEqual(c.page,remaining);assert.equal(c.page.isClosed(),false);
});

test('shutdown closes a browser whose startup completes after shutdown begins',async t=>{
 const {computers,bot,ctx,browser}=browserHarness(t),gate=deferred();browser.launchPersistentContext=()=>gate.promise;
 const starting=assert.rejects(computers.get(bot),/Crew is closing/),closing=computers.close();gate.resolve(ctx);
 await Promise.all([starting,closing]);assert.equal(ctx.closed,true);assert.equal(computers.items.size,0);
 await assert.rejects(computers.get(bot),/Crew is closing/);
});

test('portable Playwright Chromium is launched explicitly before installed browsers',()=>{
 const browser={executablePath:()=>'/crew/runtime/browsers/chromium/chrome'};
 for(const platform of ['win32','darwin','linux']){
  const options=resolveCrewBrowser(browser,{platform,env:{},exists:()=>true});
  assert.equal(options.executablePath,browser.executablePath());
  assert.equal(options.channel,undefined,'Full Chromium must not depend on a separately installed headless shell');
 }
});

test('Windows finds installed Edge or Chrome in system and per-user locations',()=>{
 const env={LOCALAPPDATA:'C:\\crew-test\\Local',ProgramFiles:'C:\\Program Files','ProgramFiles(x86)':'C:\\Program Files (x86)'};
 const edge='C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
 const chrome='C:\\crew-test\\Local\\Google\\Chrome\\Application\\chrome.exe';
 const browser={executablePath:()=>'/missing/chromium'};
 assert.equal(resolveCrewBrowser(browser,{platform:'win32',env,exists:file=>file===edge||file===chrome}).executablePath,edge);
 assert.equal(resolveCrewBrowser(browser,{platform:'win32',env,exists:file=>file===chrome}).executablePath,chrome);
});

test('macOS supports system and per-user browser applications',()=>{
 const homeDir='/tmp/crew-browser-user',edge=homeDir+'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
 const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
 const browser={executablePath:()=>'/missing/chromium'};
 assert.equal(resolveCrewBrowser(browser,{platform:'darwin',homeDir,exists:file=>file===edge}).executablePath,edge);
 assert.equal(resolveCrewBrowser(browser,{platform:'darwin',homeDir,exists:file=>file===chrome}).executablePath,chrome);
});

test('Linux finds standard Edge, Chrome, and distro Chromium executables',()=>{
 const browser={executablePath:()=>'/missing/chromium'};
 for(const executablePath of ['/opt/microsoft/msedge/msedge','/opt/google/chrome/chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium']){
  assert.deepEqual(resolveCrewBrowser(browser,{platform:'linux',exists:file=>file===executablePath}),{executablePath});
 }
});

test('missing browsers have setup guidance instead of an assumed Windows Edge launch',()=>{
 for(const platform of ['win32','darwin','linux']){
  assert.throws(()=>resolveCrewBrowser({executablePath:()=>'/missing/chromium'},{platform,env:{},exists:()=>false}),/Install Microsoft Edge or Google Chrome.*Chromium browser option/);
 }
});
