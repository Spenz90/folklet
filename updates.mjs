import {remoteJson} from './integrations.mjs';
export async function checkUpdates({current,includePreviews=false,fetchImpl=fetch}={}){
 const {data}=await remoteJson('https://api.github.com/repos/Spenz90/folklet/releases?per_page=20',{fetchImpl,label:'Release check',headers:{Accept:'application/vnd.github+json','User-Agent':'Folklet-update-check','X-GitHub-Api-Version':'2022-11-28'}});
 if(!Array.isArray(data))throw Error('GitHub returned an invalid release list.');
 const release=data.find(r=>!r.draft&&(includePreviews||!r.prerelease)&&typeof r.tag_name==='string'&&/^v?\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(r.tag_name)&&r.html_url==='https://github.com/Spenz90/folklet/releases/tag/'+r.tag_name);
 return {current,checkedAt:Date.now(),release:release?{tag:release.tag_name,name:String(release.name||release.tag_name).slice(0,160),url:release.html_url,prerelease:!!release.prerelease}:null};
}
