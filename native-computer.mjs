import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';

const helpers=path.join(path.dirname(fileURLToPath(import.meta.url)),'native');
const supported=new Set(['win32','darwin','linux']);
const modifiers=new Set(['Control','Alt','Shift','Meta']);
const namedKeys=new Set(['Enter','Tab','Escape','Backspace','Delete','Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End','PageUp','PageDown',...Array.from({length:12},(_,i)=>'F'+(i+1))]);
const failure=message=>new Error(message);
export function normalizeNativeAction(input){
 if(!input||typeof input!=='object')throw failure('Choose a native computer action.');
 const {action}=input;if(!['look','click','type','key','scroll'].includes(action))throw failure('Unsupported native computer action.');
 const result={action};if(action==='look')return Object.freeze(result);
 if(typeof input.frameId!=='string'||!input.frameId)throw failure('Look at the desktop before acting, and include its frameId.');result.frameId=input.frameId;
 if(action==='click'){
  for(const key of ['x','y'])if(!Number.isFinite(input[key])||input[key]<0)throw failure('Choose coordinates from the current desktop screenshot.');
  result.x=input.x;result.y=input.y;result.button=input.button??'left';result.clicks=input.clicks??1;
  if(!['left','right','middle'].includes(result.button)||![1,2].includes(result.clicks))throw failure('Choose left, right or middle click, once or twice.');
 }else if(action==='type'){
  if(typeof input.text!=='string'||!input.text||input.text.length>4000||input.text.includes('\0'))throw failure('Native typing requires 1–4,000 characters without null bytes.');result.text=input.text;
 }else if(action==='key'){
  if(typeof input.key!=='string')throw failure('Choose a keyboard key.');const parts=input.key.split('+'),last=parts.pop();
  if(parts.length>3||new Set(parts).size!==parts.length||parts.some(key=>!modifiers.has(key))||!(/^[a-zA-Z0-9]$/.test(last)||namedKeys.has(last)))throw failure('Unsupported keyboard shortcut.');result.key=input.key;
 }else{if(!Number.isInteger(input.delta)||!input.delta||Math.abs(input.delta)>10)throw failure('Scroll by 1–10 wheel ticks; positive means down.');result.delta=input.delta;}
 return Object.freeze(result);
}

export function nativeProcess(command,args,{input='',env=process.env,signal,timeout=15000,maxBytes=32000000}={}){
 return new Promise((resolve,reject)=>{
  let child;try{child=spawn(command,args,{env,signal,windowsHide:true,stdio:['pipe','pipe','pipe']});}catch{return reject(failure('The native desktop helper could not start. Check its platform requirements.'));}
  const chunks=[];let size=0,settled=false;
  const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(value);};
  const timer=setTimeout(()=>{child.kill();finish(failure('The native desktop helper timed out.'));},timeout);
  child.stdout.on('data',chunk=>{size+=chunk.length;if(size>maxBytes){child.kill();finish(failure('The desktop screenshot is too large. Use a smaller display resolution.'));}else chunks.push(chunk);});
  child.stderr.resume();child.stdin.on('error',()=>{});
  child.once('error',()=>finish(failure('The native desktop helper could not run. Check permissions and installed dependencies.')));
  child.once('close',code=>finish(code===0?null:failure('Native desktop access failed. Check OS permissions, display access and the optional helper dependencies.'),Buffer.concat(chunks)));
  child.stdin.end(input);
 });
}

function pngInfo(bytes){
 if(!Buffer.isBuffer(bytes)||bytes.length<24||bytes.length>24000000||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes.toString('ascii',12,16)!=='IHDR')throw failure('The native helper did not return a supported PNG screenshot.');
 const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);if(!width||!height||width*height>64000000)throw failure('The desktop screenshot dimensions are unsupported.');return {width,height};
}
function geometry(value){
 if(!value||!['x','y','width','height'].every(key=>Number.isFinite(value[key]))||value.width<=0||value.height<=0||value.width>32768||value.height>32768)throw failure('The native helper returned invalid display geometry.');
 return {x:value.x,y:value.y,width:value.width,height:value.height};
}
const sameGeometry=(a,b)=>['x','y','width','height'].every(key=>a[key]===b[key]);
const unixKeys={Control:'ctrl',Alt:'alt',Shift:'shift',Meta:'super',Enter:'Return',Escape:'Escape',Backspace:'BackSpace',Space:'space',ArrowUp:'Up',ArrowDown:'Down',ArrowLeft:'Left',ArrowRight:'Right',PageUp:'Prior',PageDown:'Next'};

/** Global desktop access is separate from each bot's browser. It starts off,
 * never persists images/text, and requires a trusted approval callback for bots.
 * Host integration must choose actor; never forward a model-supplied actor flag.
 */
export class NativeComputer{
 constructor({platform=process.platform,env=process.env,runProcess=nativeProcess,helperRoot=helpers,now=Date.now,exists=fs.existsSync}={}){
  Object.assign(this,{platform,env,runProcess,helperRoot,now,exists});this.enabled=false;this.frame=null;this.revision=0;this.chain=Promise.resolve();this.abort=null;
 }
 status(){
  const requirements=this.platform==='win32'?'An unlocked interactive Windows desktop; elevated apps and secure/UAC desktops are not supported.':this.platform==='darwin'?'The bundled macOS native helper plus Screen Recording and Accessibility permission; primary display only.':'An unlocked local X11 desktop with xdotool and ImageMagick import; Wayland is not supported.';
  let reason='';if(!supported.has(this.platform))reason='This platform has no native desktop backend.';
  else if(this.platform==='win32'&&!this.exists(path.join(this.helperRoot,'windows-control.exe')))reason='The optional Windows native helper is missing. Build it with native/Build-Windows.ps1 or restore the complete Windows package.';
  else if(this.platform==='linux'&&(this.env.WAYLAND_DISPLAY||this.env.XDG_SESSION_TYPE==='wayland'||!/^:\d+(?:\.\d+)?$/.test(this.env.DISPLAY||'')))reason='Use a local X11 desktop, including an isolated X11 desktop on a VPS. Wayland, SSH display forwarding and headless shells are not supported.';
  else if(this.platform==='linux'&&['xdotool','import'].some(command=>!(this.env.PATH||'/usr/local/bin:/usr/bin:/bin').split(':').some(dir=>dir&&this.exists(path.posix.join(dir,command)))))reason='Install xdotool and ImageMagick import in this X11 environment before enabling native access.';
  else if(this.platform==='darwin'&&!this.exists(path.join(this.helperRoot,'macos-control')))reason='The optional macOS native helper has not been built. See native/README.md.';
  return {enabled:this.enabled,supported:supported.has(this.platform),available:supported.has(this.platform)&&!reason,platform:this.platform,requirements,reason,frameId:this.frame?.frameId||null};
 }
 configure({enabled}={}){if(typeof enabled!=='boolean')throw failure('Choose whether native desktop access is enabled.');this.enabled=enabled;this.revision++;this.frame=null;this.abort?.abort();return this.status();}
 setEnabled(enabled){return this.configure({enabled});}
 execute(_bot,action,approve){return this.act(action,{actor:'bot',approve});}
 check(revision){if(!this.enabled||revision!==this.revision)throw failure('Native desktop access is disabled or changed. Enable it explicitly in Crew first.');const {reason}=this.status();if(reason)throw failure(reason);}
 checkFrame(action){if(action.action==='look')return;const frame=this.frame;if(!frame||frame.frameId!==action.frameId||this.now()-frame.capturedAt>60000)throw failure('That desktop view is no longer current. Look again before acting.');if(action.action==='click'&&(action.x>=frame.width||action.y>=frame.height))throw failure('Click coordinates must stay inside the current screenshot.');}
 async command(command,args,input='',signal){return this.runProcess(command,args,{input,env:this.env,signal});}
 async windows(action,signal){const bytes=await this.command(path.join(this.helperRoot,'windows-control.exe'),[],JSON.stringify(action),signal);return JSON.parse(bytes.toString('utf8'));}
 async mac(action,signal){const bytes=await this.command(path.join(this.helperRoot,'macos-control'),[],JSON.stringify(action),signal);return JSON.parse(bytes.toString('utf8'));}
 async display(signal){
  if(this.platform==='win32')return geometry(await this.windows({action:'geometry'},signal));
  if(this.platform==='darwin')return geometry(await this.mac({action:'geometry'},signal));
  const output=(await this.command('xdotool',['getdisplaygeometry'],'',signal)).toString('utf8').trim().split(/\s+/).map(Number);return geometry({x:0,y:0,width:output[0],height:output[1]});
 }
 async capture(signal){
  const display=await this.display(signal);let png;
  if(this.platform==='win32'){const result=await this.windows({action:'look'},signal);if(!sameGeometry(display,geometry(result.display)))throw failure('The display changed. Look again.');png=Buffer.from(result.image,'base64');}
  else if(this.platform==='darwin'){
   const base=path.resolve(os.tmpdir()),dir=fs.mkdtempSync(path.join(base,'crew-native-'));fs.chmodSync(dir,0o700);const file=path.join(dir,'screen.png');
   try{await this.command('/usr/sbin/screencapture',['-x','-m','-t','png',file],'',signal);png=fs.readFileSync(file);}
   finally{const resolved=path.resolve(dir);if(path.dirname(resolved)!==base||!path.basename(resolved).startsWith('crew-native-'))throw failure('Invalid screenshot temporary folder.');fs.rmSync(resolved,{recursive:true,force:true});}
  }else png=await this.command('import',['-window','root','png:-'],'',signal);
  const dimensions=pngInfo(png);return {frameId:randomUUID(),image:png.toString('base64'),mimeType:'image/png',...dimensions,capturedAt:this.now(),display};
 }
 async input(action,signal){
  const current=await this.display(signal);if(!sameGeometry(current,this.frame.display))throw failure('The display layout changed. Look again before acting.');
  const data={...action,expected:current};delete data.frameId;
  if(data.action==='click'){data.x=current.x+Math.floor(action.x*current.width/this.frame.width);data.y=current.y+Math.floor(action.y*current.height/this.frame.height);}
  if(this.platform==='win32'){await this.windows(data,signal);return;}
  if(this.platform==='darwin'){await this.mac(data,signal);return;}
  if(data.action==='click')await this.command('xdotool',['mousemove','--sync',String(data.x),String(data.y),'click','--clearmodifiers','--repeat',String(data.clicks),'--delay','120',String({left:1,middle:2,right:3}[data.button])],'',signal);
  else if(data.action==='type')await this.command('xdotool',['type','--clearmodifiers','--delay','1','--file','-'],data.text,signal);
  else if(data.action==='key')await this.command('xdotool',['key','--clearmodifiers',data.key.split('+').map(key=>unixKeys[key]||key).join('+')],'',signal);
  else if(data.action==='scroll')await this.command('xdotool',['click','--clearmodifiers','--repeat',String(Math.abs(data.delta)),'--delay','60',data.delta>0?'5':'4'],'',signal);
 }
 act(input,{actor='bot',approve}={}){
  const action=normalizeNativeAction(input),revision=this.revision;
  if(!['bot','user'].includes(actor))return Promise.reject(failure('Unknown desktop actor.'));
  const execute=async()=>{
   this.check(revision);this.checkFrame(action);const controller=new AbortController();this.abort=controller;
   try{
    if(actor==='bot'){
     if(typeof approve!=='function')throw failure('Native computer actions need an explicit approval callback.');
     const title=action.action==='look'?'Allow a screenshot of your actual desktop?':`Allow native desktop ${action.action} and a screenshot of the result?`;
     const permission=Promise.resolve().then(()=>approve({kind:'native-computer',title,action,note:'This operates the shared OS desktop, not an isolated bot browser. Images are sent to the selected model; screenshots and typed values are not saved by this module.'}));
     const cancelled=new Promise((_,reject)=>controller.signal.addEventListener('abort',()=>reject(failure('Native desktop access was stopped.')),{once:true}));
     if(await Promise.race([permission,cancelled])!==true)throw failure('Native desktop action was not approved.');
    }
    this.check(revision);this.checkFrame(action);
    if(action.action!=='look')await this.input(action,controller.signal);
    this.check(revision);const frame=await this.capture(controller.signal);this.check(revision);this.frame=frame;
    const {display,...result}=frame;return result;
   }finally{if(this.abort===controller)this.abort=null;}
  };
  const result=this.chain.then(execute);this.chain=result.catch(()=>{});return result;
 }
 async close(){this.configure({enabled:false});await this.chain;}
}
