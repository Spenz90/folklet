import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {collectReleaseFiles} from './release-files.mjs';
import {verifyCorrespondingSource,correspondingSource} from './Prepare-Corresponding-Source.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const desktopArchives={'win32-x64':'Crew-Windows.zip','darwin-arm64':'Crew-Mac-AppleSilicon.zip','darwin-x64':'Crew-Mac-Intel.zip','linux-x64':'Crew-Linux-x64.zip'};
export function validateSmokeEvidence(report,{platform,version,sha256,channel='preview'}={}){
 if(!['preview','stable'].includes(channel))throw Error('Choose preview or stable.');
 if(report?.schemaVersion!==1||report.passed!==true||report.platform!==platform||report.version!==version||report.archive!==desktopArchives[platform]||report.archiveSha256!==sha256||report.hostStarted!==true||report.workspaceRendered!==true||report.isolatedData!==true||report.ownedProcessesClosed!==true)throw Error('Missing matching packaged startup evidence for '+platform+'.');
 if(channel==='stable'){
  if(platform==='win32-x64'&&(report.signing?.authenticodeValid!==true||report.signing?.timestamped!==true))throw Error('Stable Windows release requires valid timestamped publisher signing.');
  if(platform.startsWith('darwin')&&(report.signing?.codesignValid!==true||report.signing?.gatekeeperAccepted!==true||report.signing?.notarizationStapled!==true))throw Error('Stable Mac release requires verified publisher signing and notarization.');
 }
 return true;
}
export function checkDependencyNotices(sourceRoot=root){
 collectReleaseFiles(sourceRoot,'Source');
 const pkg=JSON.parse(fs.readFileSync(path.join(sourceRoot,'package.json'))),lock=JSON.parse(fs.readFileSync(path.join(sourceRoot,'package-lock.json')));
 if(pkg.version!==lock.version||pkg.version!==lock.packages[''].version)throw Error('Package versions differ.');
 for(const [name,item] of Object.entries(lock.packages)){
  if(!name)continue;
  if(!item.resolved?.startsWith('https://registry.npmjs.org/')||!/^sha512-[A-Za-z\d+/]+=*$/.test(item.integrity||''))throw Error('Dependency lacks a pinned official registry archive.');
 }
 for(const library of ['playwright','playwright-core']){
  const dir=path.join(sourceRoot,'node_modules',library),actual=JSON.parse(fs.readFileSync(path.join(dir,'package.json')));
  if(actual.version!=='1.62.1')throw Error('Unexpected browser dependency version.');
  for(const name of ['LICENSE','NOTICE'])if(fs.statSync(path.join(dir,name)).size<20)throw Error('Browser dependency notice is missing.');
 }
 for(const relative of ['LICENSE','THIRD-PARTY-NOTICES.md','desktop/WebView2-LICENSE.txt','runtime/LICENSE.txt','runtime/codex/LICENSE','runtime/codex/NOTICE','runtime/codex/BUBBLEWRAP-COPYING','runtime/codex/ZSH-LICENCE','runtime/codex/UNIX-SOURCES.md'])if(fs.statSync(path.join(sourceRoot,relative)).size<20)throw Error('Runtime license or source notice is missing.');
 return {passed:true,version:pkg.version,lockedPackages:Object.keys(lock.packages).length-1,dependencyNotices:true};
}
const sha=async file=>{const hash=createHash('sha256');for await(const chunk of fs.createReadStream(file))hash.update(chunk);return hash.digest('hex');};
export async function checkRelease({artifacts,evidence,platform,channel='preview'}={}){
 const dependency=checkDependencyNotices(),targets=platform?[platform]:Object.keys(desktopArchives);if(targets.some(target=>!desktopArchives[target]))throw Error('Unknown release platform.');
 artifacts=path.resolve(artifacts||path.join(root,'dist'));evidence=path.resolve(evidence||path.join(root,'test-results'));
 for(const target of targets){
  const archive=path.join(artifacts,desktopArchives[target]),hash=await sha(archive),checksum=fs.readFileSync(archive+'.sha256','utf8').trim().split(/\s+/)[0];if(hash!==checksum)throw Error('Release archive checksum differs.');
  validateSmokeEvidence(JSON.parse(fs.readFileSync(path.join(evidence,target+'-smoke.json'))),{platform:target,version:dependency.version,sha256:hash,channel});
  if(target==='linux-x64')await verifyCorrespondingSource(path.join(artifacts,correspondingSource.output));
 }
 return {...dependency,channel,platforms:targets,packagedStartupVerified:true,...targets.includes('linux-x64')?{correspondingSourceVerified:true}:{}};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const options={},args=process.argv.slice(2);if(args.length===1&&args[0]==='--dependencies-only')console.log(JSON.stringify(checkDependencyNotices()));else{for(let i=0;i<args.length;i++){const key={'--artifacts':'artifacts','--evidence':'evidence','--platform':'platform','--channel':'channel'}[args[i]];if(!key||!args[i+1])throw Error('Use [--platform <target>] [--artifacts <folder>] [--evidence <folder>] [--channel preview|stable].');options[key]=args[++i];}console.log(JSON.stringify(await checkRelease(options)));}
}
