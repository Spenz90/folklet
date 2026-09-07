import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeComputer,normalizeNativeAction} from './native-computer.mjs';

// Header-only fixture used by the mock backend. No real screen is captured.
function png(width=200,height=160){const bytes=Buffer.alloc(24);Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);bytes.write('IHDR',12,'ascii');bytes.writeUInt32BE(width,16);bytes.writeUInt32BE(height,20);return bytes;}
function setup({now=()=>1000,platform='win32',env={}}={}){
 const calls=[],display={x:0,y:0,width:100,height:80};
 const runProcess=async(command,args,options)=>{
  calls.push({command,args,options});const action=JSON.parse(options.input);
  if(action.action==='geometry')return Buffer.from(JSON.stringify(display));
  if(action.action==='look')return Buffer.from(JSON.stringify({display,image:png().toString('base64')}));
  return Buffer.from('{"ok":true}');
 };
 return {computer:new NativeComputer({platform,env,now,runProcess,exists:()=>true}),calls,display};
}
const permit={actor:'bot',approve:async()=>true};

test('native access starts disabled and status/enable never capture or control the desktop',async()=>{
 const {computer,calls}=setup();assert.equal(computer.status().enabled,false);assert.equal(computer.status().platform,'win32');
 await assert.rejects(computer.act({action:'look'},permit),/disabled/);computer.setEnabled(true);assert.equal(computer.status().enabled,true);assert.equal(calls.length,0);
 await computer.close();assert.equal(computer.status().enabled,false);assert.equal(calls.length,0);assert.equal(new NativeComputer().status().enabled,false);
});

test('every model screenshot and action requires explicit approval and model flags cannot bypass it',async()=>{
 const {computer,calls}=setup();computer.setEnabled(true);
 await assert.rejects(computer.act({action:'look',actor:'user',approved:true}),/approval callback/);
 await assert.rejects(computer.act({action:'look'},{actor:'bot',approve:async()=>false}),/not approved/);
 await assert.rejects(computer.act({action:'look'},{actor:'bot',approve:async()=>'accept'}),/not approved/);assert.equal(calls.length,0);
 let approval;const result=await computer.execute({id:'test'},{action:'look'},async request=>{approval=request;return true;});assert.equal(approval.kind,'native-computer');assert.match(approval.title,/actual desktop/);assert.equal(result.mimeType,'image/png');assert.equal(result.display,undefined);assert.equal(result.width,200);
});

test('clicks use the current screenshot frame and map image pixels into display coordinates',async()=>{
 const {computer,calls}=setup();computer.setEnabled(true);const frame=await computer.act({action:'look'},permit);
 await computer.act({action:'click',frameId:frame.frameId,x:100,y:80,button:'right',clicks:2},permit);
 const input=calls.map(call=>JSON.parse(call.options.input)).find(action=>action.action==='click');assert.equal(input.x,50);assert.equal(input.y,40);assert.equal(input.button,'right');assert.equal(input.clicks,2);assert.deepEqual(input.expected,{x:0,y:0,width:100,height:80});
 await assert.rejects(computer.act({action:'key',frameId:frame.frameId,key:'Enter'},permit),/no longer current/);
});

test('typing stays data on stdin and typed content is not included in status',async()=>{
 const {computer,calls}=setup();computer.setEnabled(true);const frame=await computer.act({action:'look'},permit),text="Literal $value; 'quoted' 😀";
 await computer.act({action:'type',frameId:frame.frameId,text},permit);const input=calls.find(call=>JSON.parse(call.options.input).action==='type');
 assert.deepEqual(input.args,[]);assert.equal(JSON.parse(input.options.input).text,text);assert.ok(!input.command.includes(text));assert.ok(!JSON.stringify(computer.status()).includes(text));
});

test('stale screenshots, changed display layouts and out-of-bounds clicks refuse input',async()=>{
 let now=1000;const {computer,calls,display}=setup({now:()=>now});computer.setEnabled(true);const frame=await computer.act({action:'look'},permit);
 await assert.rejects(computer.act({action:'click',frameId:frame.frameId,x:200,y:0},permit),/inside the current screenshot/);
 now+=60001;await assert.rejects(computer.act({action:'key',frameId:frame.frameId,key:'Control+A'},permit),/no longer current/);
 now=1000;display.width=120;await assert.rejects(computer.act({action:'key',frameId:frame.frameId,key:'Control+A'},permit),/layout changed/);
 assert.equal(calls.some(call=>['click','key'].includes(JSON.parse(call.options.input).action)),false);
});

test('disabling native access during approval cancels the pending action before any helper runs',async()=>{
 const {computer,calls}=setup();computer.setEnabled(true);let approvalStarted;
 const ready=new Promise(resolve=>{approvalStarted=resolve;});const pending=computer.act({action:'look'},{actor:'bot',approve:()=>{approvalStarted();return new Promise(()=>{});}});
 await ready;computer.setEnabled(false);await assert.rejects(pending,/stopped/);assert.equal(calls.length,0);await computer.close();
});

test('two queued native actions revalidate their frame after earlier actions complete',async()=>{
 const {computer,calls}=setup();computer.setEnabled(true);const frame=await computer.act({action:'look'},permit);
 const first=computer.act({action:'key',frameId:frame.frameId,key:'Tab'},permit),second=computer.act({action:'key',frameId:frame.frameId,key:'Enter'},permit);
 await first;await assert.rejects(second,/no longer current/);assert.equal(calls.filter(call=>JSON.parse(call.options.input).action==='key').length,1);
});

test('Linux requires local X11 and runs only bounded xdotool/ImageMagick arguments',async()=>{
 for(const env of [{},{DISPLAY:'localhost:10.0'},{DISPLAY:':1',WAYLAND_DISPLAY:'wayland-0'},{DISPLAY:':1',XDG_SESSION_TYPE:'wayland'}]){
  const computer=new NativeComputer({platform:'linux',env,runProcess:()=>{throw Error('Must not run');}});computer.setEnabled(true);await assert.rejects(computer.act({action:'look'},permit),/local X11/);
 }
 const calls=[];const computer=new NativeComputer({platform:'linux',env:{DISPLAY:':77'},exists:()=>true,runProcess:async(command,args,options)=>{calls.push({command,args,options});if(args[0]==='getdisplaygeometry')return Buffer.from('200 160');if(command==='import')return png();return Buffer.alloc(0);}});computer.setEnabled(true);
 const frame=await computer.act({action:'look'},permit);await computer.act({action:'type',frameId:frame.frameId,text:'Example text'},permit);
 const typed=calls.find(call=>call.args[0]==='type');assert.equal(typed.command,'xdotool');assert.deepEqual(typed.args,['type','--clearmodifiers','--delay','1','--file','-']);assert.equal(typed.options.input,'Example text');assert.equal(typed.options.env.DISPLAY,':77');
});

test('action validation refuses unsupported operations and malformed shortcuts before helper use',()=>{
 for(const action of [{action:'shell'},{action:'click',frameId:'frame',x:-1,y:1},{action:'key',frameId:'frame',key:'Control+run program'},{action:'key',frameId:'frame',key:'Control+Control+A'},{action:'scroll',frameId:'frame',delta:11},{action:'type',frameId:'frame',text:'x'.repeat(4001)}])assert.throws(()=>normalizeNativeAction(action));
 assert.deepEqual(normalizeNativeAction({action:'key',frameId:'frame',key:'Meta+Shift+ArrowLeft',actor:'user'}),{action:'key',frameId:'frame',key:'Meta+Shift+ArrowLeft'});
});

test('missing optional native dependencies are reported by status without running them',()=>{
 for(const [platform,env] of [['win32',{}],['darwin',{}],['linux',{DISPLAY:':1'}]]){
  const computer=new NativeComputer({platform,env,exists:()=>false,runProcess:()=>{throw Error('Must not run');}});const state=computer.status();assert.equal(state.supported,true);assert.equal(state.available,false);assert.ok(state.reason);assert.equal(state.enabled,false);
 }
});
