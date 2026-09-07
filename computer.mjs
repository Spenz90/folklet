import {createRequire} from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {managedBrowserHeader} from './http.mjs';
const require=createRequire(import.meta.url);
const bundledBrowsers=path.join(path.dirname(fileURLToPath(import.meta.url)),'runtime','browsers');
// Playwright reads this once when it is loaded. A portable installation keeps
// its downloaded browser beside the app rather than in the previous user's cache.
if(!process.env.PLAYWRIGHT_BROWSERS_PATH&&fs.existsSync(bundledBrowsers))process.env.PLAYWRIGHT_BROWSERS_PATH=bundledBrowsers;
let chromium;
try{({chromium}=require('playwright'));}catch{try{({chromium}=require(path.join(path.dirname(process.execPath),'../node_modules/playwright')));}catch{}}
const isExecutableFile=file=>{try{return fs.statSync(file,{throwIfNoEntry:false})?.isFile()===true;}catch{return false;}};
export function resolveCrewBrowser(browser,{platform=process.platform,env=process.env,homeDir=os.homedir(),exists=isExecutableFile}={}){
 if(!['win32','darwin','linux'].includes(platform))throw Error('FOLKLET browser work supports Windows, macOS, and Linux.');
 let packaged;try{packaged=browser?.executablePath();}catch{}
 // Use the actual full Chromium executable. A headless launch without this
 // option can otherwise select a separate, uninstalled headless-shell package.
 if(packaged&&exists(packaged))return {executablePath:packaged};
 let candidates=[];
 if(platform==='win32'){
  const drive=env.SystemDrive||'C:',roots=[env.LOCALAPPDATA,env.ProgramFiles||drive+'\\Program Files',env['ProgramFiles(x86)']||drive+'\\Program Files (x86)'].filter(Boolean);
  candidates=[...roots.map(root=>path.win32.join(root,'Microsoft','Edge','Application','msedge.exe')),...roots.map(root=>path.win32.join(root,'Google','Chrome','Application','chrome.exe'))];
 }else if(platform==='darwin'){
  const roots=['/Applications',...(homeDir?[path.posix.join(homeDir,'Applications')]:[])];
  candidates=[...roots.map(root=>path.posix.join(root,'Microsoft Edge.app','Contents','MacOS','Microsoft Edge')),...roots.map(root=>path.posix.join(root,'Google Chrome.app','Contents','MacOS','Google Chrome'))];
 }else candidates=['/opt/microsoft/msedge/msedge','/usr/bin/microsoft-edge','/usr/bin/microsoft-edge-stable','/opt/google/chrome/chrome','/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium','/usr/bin/chromium-browser'];
 const executablePath=candidates.find(exists);
 if(executablePath)return {executablePath};
 throw Error('FOLKLET needs a browser for this task. Install Microsoft Edge or Google Chrome, or rerun FOLKLET setup with the Chromium browser option.');
}
export class Computers {
 constructor(root,onEvent,{browser=chromium,platform=process.platform,env=process.env,homeDir=os.homedir(),exists=isExecutableFile}={}){this.root=root;this.onEvent=onEvent;this.browser=browser;this.browserOptions={platform,env,homeDir,exists};this.items=new Map();this.starting=new Map();this.closing=false;this.controlOrigins=new Set();}
 protectControlOrigin(value){const url=new URL(value);this.controlOrigins.add(url.origin);if(['127.0.0.1','localhost','[::1]'].includes(url.hostname))for(const host of ['127.0.0.1','localhost','[::1]'])this.controlOrigins.add(`${url.protocol}//${host}${url.port?':'+url.port:''}`);}
 isControlURL(value){try{return this.controlOrigins.has(new URL(value).origin);}catch{return false;}}
 async routeRequest(route){const request=route.request();if(this.isControlURL(request.url()))return route.abort('blockedbyclient');return route.continue({headers:{...request.headers(),[managedBrowserHeader]:'1'}});}
 async get(b){if(this.closing)throw Error('FOLKLET is closing');if(this.items.has(b.id))return this.items.get(b.id);if(this.starting.has(b.id))return this.starting.get(b.id);const p=this.start(b).finally(()=>this.starting.delete(b.id));this.starting.set(b.id,p);return p;}
 async start(b){if(!this.browser)throw Error('Playwright is unavailable. Rerun FOLKLET setup to install the app dependencies.');const opts={headless:true,viewport:{width:1280,height:800},acceptDownloads:true,chromiumSandbox:true,serviceWorkers:'block',extraHTTPHeaders:{[managedBrowserHeader]:'1'},...resolveCrewBrowser(this.browser,this.browserOptions)};const dir=path.join(this.root,'browser-profiles',b.id);fs.mkdirSync(dir,{recursive:true});
  const ctx=await this.browser.launchPersistentContext(dir,opts);if(this.closing){await ctx.close();throw Error('FOLKLET is closing');}try{await ctx.route('**/*',route=>this.routeRequest(route));}catch(error){await ctx.close();throw error;}ctx.setDefaultTimeout(15000);const c={ctx,page:ctx.pages()[0]||await ctx.newPage(),paused:false,recording:null,frame:null,url:'about:blank',title:'Your browser',chain:Promise.resolve(),updatedAt:0};this.items.set(b.id,c);
  ctx.on('page',p=>{c.page=p;this.attach(b,c,p);});this.attach(b,c,c.page);ctx.on('close',()=>this.items.delete(b.id));return c;
 }
 attach(b,c,p){p.on('download',async d=>{try{const name=path.basename(d.suggestedFilename()).replace(/[<>:"/\\|?*]/g,'_');const dir=path.join(b.cwd,'downloads');fs.mkdirSync(dir,{recursive:true});await d.saveAs(path.join(dir,Date.now()+'-'+name));this.onEvent(b,{kind:'download',title:'Downloaded '+name,status:'completed'});}catch{}});p.on('dialog',async d=>{await d.dismiss();this.onEvent(b,{kind:'browser',title:'Browser dialog dismissed',detail:d.message(),status:'completed'});});}
 summary(id){const c=this.items.get(id);return c?{running:true,paused:c.paused,recording:!!c.recording,url:c.url,title:c.title,updatedAt:c.updatedAt}:{running:false,paused:false,recording:false};}
 async snapshot(b){const c=await this.get(b);if(c.page.isClosed())c.page=c.ctx.pages().find(p=>!p.isClosed())||await c.ctx.newPage();c.frame=await c.page.screenshot({type:'jpeg',quality:65,timeout:10000});c.url=c.page.url();c.title=await c.page.title();c.updatedAt=Date.now();return c;}
 async inspect(b){const c=await this.snapshot(b);const tree=await c.page.locator('body').ariaSnapshot({timeout:10000}).catch(()=>'(No accessible page content)');return {url:c.url,title:c.title,tree:tree.slice(0,25000),image:c.frame.toString('base64')};}
 async act(b,a,actor='bot'){const c=await this.get(b);
  const execute=async()=>{if(this.closing)throw Error('FOLKLET is closing');if(actor==='bot'&&c.paused)throw Error('The user has control of this browser. Ask them to return control before using it.');if(actor==='user'&&!c.paused)throw Error('Take control of the browser first.');if(c.page.isClosed())c.page=c.ctx.pages().find(p=>!p.isClosed())||await c.ctx.newPage();const p=c.page;const type=a.action;
   if(type==='navigate'){const u=new URL(a.url);if(!['http:','https:'].includes(u.protocol))throw Error('Only http and https websites are supported.');if(this.isControlURL(u.href))throw Error('The managed browser cannot open FOLKLET owner settings or phone access. Use the FOLKLET app to manage permissions.');await p.goto(u.href,{waitUntil:'domcontentloaded',timeout:30000});}
   else if(type==='click'){if(a.role&&a.name)await p.getByRole(a.role,{name:a.name,exact:true}).click();else if(a.text)await p.getByText(a.text,{exact:true}).click();else if(Number.isFinite(a.x)&&Number.isFinite(a.y))await p.mouse.click(Math.max(0,Math.min(1280,a.x)),Math.max(0,Math.min(800,a.y)));else throw Error('Specify role and name, text, or coordinates from the current screenshot.');}
   else if(type==='fill'){if(!a.label)throw Error('Provide a visible field label.');await p.getByLabel(a.label,{exact:true}).fill(String(a.text||''));}
   else if(type==='type')await p.keyboard.insertText(String(a.text||''));
   else if(type==='key'){if(!/^[a-zA-Z0-9+]+$/.test(a.key)||a.key.length>40)throw Error('Invalid key');await p.keyboard.press(a.key);}
   else if(type==='scroll')await p.mouse.wheel(0,Number(a.delta)||600);
   else if(type==='back')await p.goBack({waitUntil:'domcontentloaded'});
   else if(type==='select')await p.getByLabel(a.label,{exact:true}).selectOption({label:a.text});
   else if(type!=='look')throw Error('Unsupported browser action');
   if(c.recording&&actor==='user'){const entry={action:type,url:p.url(),at:Date.now()};if(a.role)entry.role=a.role;if(a.name)entry.name=a.name;if(a.label)entry.label=a.label;if(type==='click'){entry.text=a.text;entry.x=a.x;entry.y=a.y;}if(['type','fill'].includes(type))entry.note='User entered a value (value not recorded).';if(type==='key')entry.key=a.key;c.recording.push(entry);}
   if(type!=='look')this.onEvent(b,{kind:'browser',title:actor==='user'?'You used the browser':'Browser · '+type,detail:type==='navigate'?a.url:(a.name||a.label||a.key||''),status:'completed'});
   return this.inspect(b);
  };const promise=c.chain.then(execute);c.chain=promise.catch(()=>{});return promise;
 }
 async control(b,paused){const c=await this.get(b);c.paused=paused;return this.summary(b.id);}
 async record(b,start){const c=await this.get(b);if(start){c.paused=true;c.recording=[];return [];}await c.chain;const steps=c.recording||[];c.recording=null;return steps;}
 async close(){this.closing=true;await Promise.allSettled([...this.starting.values()]);await Promise.allSettled([...this.items.values()].map(c=>c.ctx.close()));this.items.clear();}
}
