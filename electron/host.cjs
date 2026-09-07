'use strict';

const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {parseHealth,tokenFromHTML}=require('./policy.cjs');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function requestLocal(route,{port=4318,method='GET',token,timeout=2000,maxBytes=262144}={}){
 return new Promise((resolve,reject)=>{
  const headers={};if(token)headers['X-Crew-Token']=token;
  if(method==='POST'){headers['Content-Type']='application/json';headers['Content-Length']=2;}
  const request=http.request({hostname:'127.0.0.1',port,path:route,method,headers},response=>{
   let size=0;const chunks=[];
   response.on('data',chunk=>{size+=chunk.length;if(size>maxBytes)request.destroy(new Error('Local response exceeded its limit.'));else chunks.push(chunk);});
   response.on('end',()=>resolve({status:response.statusCode,type:String(response.headers['content-type']||''),text:Buffer.concat(chunks).toString('utf8')}));
   response.on('error',reject);
  });
  request.on('error',reject);request.setTimeout(timeout,()=>request.destroy(Object.assign(new Error('Local host did not respond.'),{code:'ETIMEDOUT'})));
  request.end(method==='POST'?'{}':undefined);
 });
}

async function probeHost({port=4318}={}){
 try{
  const response=await requestLocal('/health',{port,maxBytes:4096});
  if(response.status!==200||!response.type.startsWith('application/json'))return {state:'occupied'};
  let health;try{health=parseHealth(JSON.parse(response.text));}catch{return {state:'occupied'};}
  if(!health)return {state:'occupied'};
  const page=await requestLocal('/',{port}),token=page.status===200&&page.type.startsWith('text/html')?tokenFromHTML(page.text):null;
  return token?{state:'ready',...health,token}:{state:'occupied'};
 }catch(error){return {state:error.code==='ECONNREFUSED'?'absent':error.code==='ETIMEDOUT'||error.code==='ECONNRESET'?'pending':'occupied'};}
}

function bundledFiles(appRoot,platform=process.platform){
 const node=path.join(appRoot,'runtime',platform==='win32'?'node.exe':'node');
 const engine=path.join(appRoot,'runtime','codex',...(platform==='win32'?['codex.exe']:['bin','codex']));
 const server=path.join(appRoot,'server.mjs');
 for(const file of [node,engine,server])if(!fs.existsSync(file)||!fs.statSync(file).isFile())throw Error('Folklet’s bundled runtime is missing. Restore the complete Folklet app.');
 return {node,engine,server};
}

async function ensureHost({appRoot,dataRoot,browserRoot,port=4318,spawnProcess=spawn,timeout=30000,existingOnly=false,expectedPid}={}){
 const runtime=bundledFiles(appRoot);let child=null,failed=false;
 const deadline=Date.now()+timeout;
 while(Date.now()<deadline){
  const state=await probeHost({port});
  if(state.state==='ready'){
   if(expectedPid&&state.pid!==expectedPid)throw Error('The smoke host identity changed. No process was stopped.');
   if(child&&state.pid!==child.pid)throw Error('Another local service took Folklet’s port. No process was stopped.');
   return {...state,child,port};
  }
  if(state.state==='occupied')throw Error('Another local service is using Folklet’s port. Close that service and reopen Folklet.');
  if(failed)throw Error('Folklet’s background service stopped before it was ready. Check that this app supports your computer.');
  if(state.state==='absent'&&!child){
   if(existingOnly)throw Error('The smoke test requires its isolated host to be running.');
   fs.mkdirSync(dataRoot,{recursive:true});
   const env={...process.env,CREW_DATA:dataRoot,CREW_PORT:String(port),CREW_MOBILE_PORT:'4320'};
   if(browserRoot)env.PLAYWRIGHT_BROWSERS_PATH=browserRoot;
   env.PATH=[path.dirname(runtime.node),path.dirname(runtime.engine),path.join(appRoot,'runtime','codex','codex-path'),env.PATH||''].join(path.delimiter);
   delete env.CREW_CODEX_OVERRIDE;delete env.NODE_OPTIONS;delete env.NODE_PATH;
   child=spawnProcess(runtime.node,[runtime.server],{cwd:appRoot,env,detached:true,windowsHide:true,stdio:'ignore'});
   child.once('error',()=>{failed=true;});child.once('exit',()=>{failed=true;});child.unref();
  }
  await pause(250);
 }
 throw Error('Folklet’s background service did not become ready. Reopen Folklet to try again.');
}

function installBrowser({appRoot,browserRoot,signal,spawnProcess=spawn}={}){
 const {node}=bundledFiles(appRoot),cli=path.join(appRoot,'node_modules','playwright','cli.js');
 if(!fs.existsSync(cli)||!fs.statSync(cli).isFile())return Promise.reject(Error('Folklet’s browser installer is missing. Restore the complete app.'));
 fs.mkdirSync(browserRoot,{recursive:true});
 return new Promise((resolve,reject)=>{
  const env={...process.env,PLAYWRIGHT_BROWSERS_PATH:browserRoot};delete env.NODE_OPTIONS;delete env.NODE_PATH;
  const child=spawnProcess(node,[cli,'install','chromium'],{cwd:appRoot,env,windowsHide:true,stdio:'ignore',signal});
  child.once('error',()=>reject(Error('Browser installation could not start. Check your connection and try again.')));
  child.once('close',code=>code===0?resolve():reject(Error('Browser installation failed. Check your connection, free disk space and operating-system support, then try again.')));
 });
}

async function shutdownHost(identity){
 if(!identity)return;
 const current=await probeHost({port:identity.port});
 if(current.state==='absent')return;
 if(current.state!=='ready'||current.pid!==identity.pid||current.token!==identity.token)throw Error('The local service changed. Folklet did not send a shutdown request.');
 const response=await requestLocal('/api/shutdown',{port:identity.port,method:'POST',token:current.token,timeout:5000,maxBytes:4096});
 let body;try{body=JSON.parse(response.text);}catch{}
 if(response.status!==200||body?.ok!==true)throw Error('The background service did not confirm shutdown.');
}
module.exports={requestLocal,probeHost,bundledFiles,ensureHost,shutdownHost,installBrowser};
