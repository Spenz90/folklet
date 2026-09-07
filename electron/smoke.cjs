'use strict';
const fs=require('node:fs');
const path=require('node:path');

function smokeOptions(argv=[],env={}){
 const index=argv.indexOf('--smoke-test');if(index<0)return null;
 const root=env.CREW_SMOKE_ROOT,report=argv[index+1],hostPid=Number(env.CREW_SMOKE_HOST_PID);
 if(!root||!path.isAbsolute(root)||!report||!path.isAbsolute(report)||!Number.isInteger(hostPid)||hostPid<=0)throw Error('Desktop smoke requires an isolated root, report and owned host PID.');
 const relative=path.relative(root,report);
 if(!relative||relative.startsWith('..')||path.isAbsolute(relative)||path.extname(report)!=='.json')throw Error('Smoke report must be inside the isolated root.');
 for(let current=path.resolve(root);;){if(fs.lstatSync(current,{throwIfNoEntry:false})?.isSymbolicLink())throw Error('Smoke root cannot contain links.');const parent=path.dirname(current);if(parent===current)break;current=parent;}
 return {root,report,hostPid};
}
function validSmokePage(page){return page?.title==='FOLKLET'&&page.app===true&&page.main===true&&page.rendered===true&&page.tokenPresent===true&&page.nodeAbsent===true;}
const pageExpression=`({title:document.title,app:!!document.getElementById('app'),main:!!document.querySelector('main'),rendered:!!document.querySelector('#page .team-home'),tokenPresent:typeof window.CREW_TOKEN==='string'&&window.CREW_TOKEN.length===64,nodeAbsent:typeof require==='undefined'&&typeof process==='undefined'})`;
function prepareSmokeWindow(window,options,{show,exit,capture=captureSmoke}={}){
 let loaded=false,painted=false,started=false;
 const begin=()=>{if(loaded&&painted&&!started){started=true;void capture(window.webContents,options,{exit});}};
 // Exercise the normal visible-window path. did-finish-load alone establishes
 // DOM readiness, not the first compositor surface needed by capturePage.
 window.once('ready-to-show',()=>{painted=true;show();begin();});
 window.webContents.once('did-finish-load',()=>{loaded=true;begin();});
}
async function captureSmoke(contents,options,{exit,timeout=20000}={}){
 const deadline=Date.now()+timeout;let page,phase='read-page';
 try{
  while(Date.now()<deadline){page=await contents.executeJavaScript(pageExpression);if(validSmokePage(page))break;await new Promise(resolve=>setTimeout(resolve,200));}
  if(!validSmokePage(page))throw Error('Workspace did not render.');
  phase='paint-page';await contents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))');
  phase='capture-page';const image=await contents.capturePage();
  phase='write-screenshot';fs.writeFileSync(options.report.replace(/\.json$/,'.png'),image.toPNG());
  phase='write-report';
  fs.writeFileSync(options.report,JSON.stringify({passed:true,page,rendererSandboxed:contents.getLastWebPreferences().sandbox===true,contextIsolation:contents.getLastWebPreferences().contextIsolation===true,nodeIntegration:contents.getLastWebPreferences().nodeIntegration===true})+'\n');exit(0);
 }catch(error){
  const detail=String(error?.message||'Desktop rendering smoke failed.').slice(0,4000).replaceAll(options.root,'<isolated>').replace(/\b(?:sk-|ghp_|github_pat_)[A-Za-z0-9_-]+/g,'<redacted>').replace(/\b[a-f\d]{64,}\b/gi,'<redacted>').replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,1000);
  const checkedPage=page?{titleExpected:page.title==='FOLKLET',...Object.fromEntries(['app','main','rendered','tokenPresent','nodeAbsent'].map(key=>[key,page[key]===true]))}:null;
  fs.writeFileSync(options.report,JSON.stringify({passed:false,phase,error:detail,page:checkedPage})+'\n');exit(1);
 }
}
module.exports={smokeOptions,validSmokePage,captureSmoke,prepareSmokeWindow};
