import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const appRoot=path.dirname(fileURLToPath(import.meta.url));
const isFile=file=>{try{return fs.statSync(file,{throwIfNoEntry:false})?.isFile()===true;}catch{return false;}};
export function resolveCrewEngine({root=appRoot,env=process.env,platform=process.platform}={}){
 if(!['win32','darwin','linux'].includes(platform))throw Error('Crew supports Windows, macOS, and Linux.');
 const directory=path.join(root,'runtime','codex');
 const candidates=platform==='win32'?[path.join(directory,'codex.exe')]:[path.join(directory,'bin','codex'),path.join(directory,'codex')];
 const executable=candidates.find(isFile);
 if(executable)return executable;
 const override=env.CREW_CODEX_OVERRIDE;
 if(override&&path.isAbsolute(override)&&isFile(override))return override;
 throw Error('Crew’s bundled engine is missing. Extract the complete Crew package again.');
}

export function crewEngineEnvironment(executable,{env=process.env,platform=process.platform}={}){
 const directory=path.dirname(executable),search=[directory];
 // The official Unix package keeps bundled rg separately from bin/. Preserve
 // that layout so Codex can also discover its shell and Linux sandbox resources.
 const bundledPath=path.join(directory,'..','codex-path');
 if(path.basename(directory)==='bin'&&fs.existsSync(bundledPath))search.push(path.resolve(bundledPath));
 return {...env,PATH:[...search,env.PATH||''].join(platform==='win32'?';':':')};
}
