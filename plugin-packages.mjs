import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {crc32} from 'node:zlib';
import {isIP} from 'node:net';
import yauzl from 'yauzl';
import {loadReviewData,saveReviewData} from './review-data.mjs';
import {parseSkillMarkdown} from './skills.mjs';

const FILE_LIMIT=1024*1024,TOTAL_LIMIT=8*1024*1024,FILE_COUNT=256,INDEX_LIMIT=2*1024*1024;
const PLUGIN_SCHEMA='https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',MCP_SCHEMA='https://agent-plugins.org/schemas/1.0.0/mcp.schema.json';
const copy=value=>structuredClone(value),hash=value=>createHash('sha256').update(value).digest('hex'),object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const ident=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const decode=buffer=>{try{return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(buffer);}catch{throw Error('Manifest and skill files must use UTF-8 text.');}};
function text(value,label,max=2000){if(typeof value!=='string'||!value.trim()||value.length>max||/[\u0000-\u001f\u007f]/.test(value))throw Error('Invalid '+label+'.');return value;}
function json(buffer,label){let value;try{value=JSON.parse(decode(buffer));}catch{throw Error(label+' must contain a JSON object.');}if(!object(value))throw Error(label+' must contain a JSON object.');return value;}
function fields(value,allowed,label){if(Object.keys(value).some(key=>!allowed.includes(key)))throw Error(label+' contains unsupported fields.');}
function stringMap(value,label){if(value===undefined)return {};if(!object(value)||Object.keys(value).length>40||Object.entries(value).some(([key,val])=>typeof val!=='string'||key.length>120||val.length>4000||/[\r\n\0]/.test(key+val)))throw Error('Invalid '+label+'.');return value;}

export function packagePath(value){
 if(typeof value!=='string'||!value||value.length>240||value!==value.normalize('NFC')||/[\\:<>"|?*\u0000-\u001f\u007f]/.test(value)||value.startsWith('/'))throw Error('Unsafe package path.');
 for(const part of value.split('/'))if(!part||part==='.'||part==='..'||/[. ]$/.test(part)||/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part))throw Error('Unsafe package path.');
 return value;
}
function validateFiles(files){
 if(!Array.isArray(files)||!files.length||files.length>FILE_COUNT)throw Error('Import a bundle with 1–256 files.');let total=0;const names=new Map(),parents=new Map();
 for(const entry of files){packagePath(entry.path);if(!Buffer.isBuffer(entry.bytes)||entry.bytes.length>FILE_LIMIT)throw Error('Each package file must be under 1 MiB.');total+=entry.bytes.length;
  const key=entry.path.toLowerCase();if(names.has(key))throw Error('Duplicate or case-colliding package path.');names.set(key,entry.path);
  const parts=entry.path.split('/');for(let i=1;i<=parts.length;i++){const prefix=parts.slice(0,i).join('/'),fold=prefix.toLowerCase();if(parents.has(fold)&&parents.get(fold)!==prefix)throw Error('Case-colliding package directory.');parents.set(fold,prefix);}
 }
 if(total>TOTAL_LIMIT)throw Error('Keep the whole package under 8 MiB.');
 for(const name of names.keys()){const parts=name.split('/');parts.pop();while(parts.length){if(names.has(parts.join('/')))throw Error('A package file cannot also be a directory.');parts.pop();}}
 return files.slice().sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
}
function unwrapFiles(files){
 const rootMarker=files.some(file=>['plugin.json','openclaw.plugin.json','plugin.yaml','package.json','SKILL.md','.codex-plugin/plugin.json','.claude-plugin/plugin.json','.cursor-plugin/plugin.json'].includes(file.path)||file.path.startsWith('skills/'));
 if(rootMarker)return files;const prefix=files[0]?.path.split('/')[0];if(prefix&&files.every(file=>file.path.startsWith(prefix+'/')))return validateFiles(files.map(file=>({...file,path:file.path.slice(prefix.length+1)})));return files;
}
async function archiveFiles(archive){
 if(typeof archive!=='string'||archive.length>16*1024*1024||!archive.length||archive.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(archive))throw Error('Choose a base64 ZIP archive under 12 MiB.');
 const buffer=Buffer.from(archive,'base64');if(buffer.toString('base64')!==archive||buffer.length>12*1024*1024)throw Error('Invalid ZIP encoding.');
 const zip=await new Promise((resolve,reject)=>yauzl.fromBuffer(buffer,{lazyEntries:true,decodeStrings:false,validateEntrySizes:true},(error,value)=>error?reject(Error('Choose a valid ZIP archive.')):resolve(value)));
 const result=[],seen=new Map();let count=0,total=0;
 try{await new Promise((resolve,reject)=>{
  zip.once('error',reject);zip.once('end',resolve);zip.on('entry',entry=>{(async()=>{
   if(++count>FILE_COUNT*2)throw Error('Too many ZIP entries.');const raw=decode(entry.fileName),directory=raw.endsWith('/'),name=packagePath(directory?raw.slice(0,-1):raw),key=name.toLowerCase();
   if(seen.has(key))throw Error('Duplicate or case-colliding ZIP entry.');seen.set(key,{name,directory});
   const mode=entry.externalFileAttributes>>>16,type=mode&0o170000;
   if((type&&type!==(directory?0o040000:0o100000))||(entry.externalFileAttributes&0x400)||entry.generalPurposeBitFlag&1)throw Error('ZIP links, special files and encrypted entries are not supported.');
   if(entry.extraFields.some(field=>![0x5455,0x7875,0x7075].includes(field.id)))throw Error('ZIP link, extended or unknown file metadata is not supported.');
   if(directory){if(entry.uncompressedSize)throw Error('Invalid ZIP directory.');zip.readEntry();return;}
   if(entry.uncompressedSize>FILE_LIMIT||(total+=entry.uncompressedSize)>TOTAL_LIMIT||result.length>=FILE_COUNT)throw Error('Package exceeds its file or byte limit.');
   const stream=await new Promise((yes,no)=>zip.openReadStream(entry,(error,value)=>error?no(error):yes(value))),chunks=[];let size=0;
   for await(const chunk of stream){size+=chunk.length;if(size>FILE_LIMIT||size>entry.uncompressedSize){stream.destroy();throw Error('ZIP file exceeds its declared size.');}chunks.push(chunk);}
   const bytes=Buffer.concat(chunks);if(size!==entry.uncompressedSize||crc32(bytes)!==entry.crc32)throw Error('ZIP file integrity check failed.');result.push({path:name,bytes,executable:!!(mode&0o111)});zip.readEntry();
  })().catch(reject);});zip.readEntry();
 });
  // Explicit directories must agree with every inferred parent, including case.
  for(const entry of result)for(const [key,dir] of seen)if(dir.directory&&entry.path.toLowerCase().startsWith(key+'/')&&!entry.path.startsWith(dir.name+'/'))throw Error('Case-colliding ZIP directory.');
  for(const [key,dir] of seen)if(dir.directory&&result.some(entry=>entry.path.toLowerCase()===key))throw Error('ZIP path is both a directory and file.');
  return validateFiles(result);
 }finally{zip.close();}
}
function regularTree(root){
 const result=[];let total=0;
 const visit=(dir,prefix='')=>{const stat=fs.lstatSync(dir);if(stat.isSymbolicLink()||!stat.isDirectory())throw Error('Package directories cannot contain links.');for(const name of fs.readdirSync(dir)){const relative=prefix?prefix+'/'+name:name,file=path.join(dir,name),s=fs.lstatSync(file);packagePath(relative);if(s.isSymbolicLink()||s.isFile()&&s.nlink!==1)throw Error('Package files cannot contain symbolic links or hard links.');if(s.isDirectory())visit(file,relative);else if(s.isFile()){if(s.size>FILE_LIMIT||(total+=s.size)>TOTAL_LIMIT||result.length>=FILE_COUNT)throw Error('Package exceeds its file or byte limit.');result.push({path:relative,bytes:fs.readFileSync(file),executable:process.platform==='win32'?false:!!(s.mode&0o111)});}else throw Error('Package contains a special file.');}};
 visit(root);return validateFiles(result);
}
function validPortable(manifest){
 fields(manifest,['$schema','name','version','description','author','homepage','repository','license','keywords','extensions'],'plugin.json');
 if(manifest.$schema!==PLUGIN_SCHEMA)throw Error('plugin.json must declare the Agent Plugins 1.0.0 schema.');
 if(typeof manifest.name!=='string'||manifest.name.length>64||!/^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(manifest.name))throw Error('Invalid portable plugin name.');
 for(const key of ['version','description','homepage','repository','license'])if(manifest[key]!==undefined&&typeof manifest[key]!=='string')throw Error('Invalid plugin '+key+'.');
 if(manifest.author!==undefined){if(!object(manifest.author))throw Error('Invalid plugin author.');fields(manifest.author,['name','email','url'],'author');if(Object.values(manifest.author).some(value=>typeof value!=='string'))throw Error('Invalid plugin author.');}
 if(manifest.keywords!==undefined&&(!Array.isArray(manifest.keywords)||manifest.keywords.some(value=>typeof value!=='string')))throw Error('Invalid plugin keywords.');
 if(manifest.extensions!==undefined&&(!object(manifest.extensions)||Object.values(manifest.extensions).some(value=>!object(value))))throw Error('Invalid plugin extensions.');
}
function relativeConfig(value){if(typeof value!=='string')throw Error('Expected a package-relative path.');return packagePath(value.startsWith('./')?value.slice(2):value);}
function scopedTemplate(value){text(value,'plugin working path',500);if(value==='${PLUGIN_ROOT}'||value==='${PLUGIN_DATA}')return value;const match=/^(\.\/|\$\{PLUGIN_ROOT\}\/|\$\{PLUGIN_DATA\}\/)(.+)$/.exec(value);if(!match)throw Error('Paths must stay under PLUGIN_ROOT or PLUGIN_DATA.');packagePath(match[2]);return value;}
function validateArgument(value){if(typeof value!=='string'||value.length>4000||/[\0\r\n]/.test(value))throw Error('Invalid MCP argument.');if(value.includes('${')){const match=/^(?:--[A-Za-z0-9_-]+=)?(\$\{(?:PLUGIN_ROOT|PLUGIN_DATA)\}(?:\/.*)?)$/.exec(value);if(!match)throw Error('Set argument credentials or unsupported environment placeholders manually.');scopedTemplate(match[1]);}return value;}
function connectionDefinition(name,raw,portable,unsupported){
 text(name,'MCP server name',100);if(!object(raw))throw Error('MCP definition must be an object.');const transport=raw.type||raw.transport||(raw.command?'stdio':undefined);
 if(!['stdio','streamable-http'].includes(transport))throw Error('Only stdio and Streamable HTTP are supported; legacy SSE is not imported.');
 const allowed=transport==='stdio'?['type','command','args','env','cwd']:['type','url','headers'];if(!portable)allowed.push('transport','connectionTimeoutMs','requestTimeoutMs');fields(raw,allowed,'MCP server');
 const value={name,type:'mcp',transport,botIds:[],allowedTools:[],allowPackageInstall:false},requirements=[];
 if(transport==='stdio'){
  const command=text(raw.command,'MCP executable',500);if(/^(?:bash|sh|zsh|dash|fish|cmd(?:\.exe)?|powershell(?:\.exe)?|pwsh(?:\.exe)?|wscript|cscript)$/i.test(command))throw Error('Shell launchers need separate manual setup; no shell is run.');
  if(/^(?:npx|npm|pnpm|yarn|uv|uvx|pip|pip3|bun|bunx|easy_install)(?:\.cmd|\.exe)?$/i.test(command))requirements.push('This command may download and run packages. Enable that separate permission before connecting.');
  if(command.startsWith('./'))relativeConfig(command);else if(!/^[A-Za-z0-9_.-]+$/.test(command)||['.','..'].includes(command))throw Error('Use a bare executable name or a ./ package executable.');value.command=command;
  if(raw.args!==undefined&&(!Array.isArray(raw.args)||raw.args.length>80))throw Error('Invalid MCP arguments.');value.args=(raw.args||[]).map(validateArgument);value.cwd=scopedTemplate(raw.cwd||'${PLUGIN_ROOT}');
  const env=stringMap(raw.env,'MCP environment');for(const key of Object.keys(env)){if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)||['PLUGIN_ROOT','PLUGIN_DATA'].includes(key.toUpperCase()))throw Error('Invalid or reserved MCP environment name.');requirements.push('Enter environment value '+key+' separately. Imported values are not saved.');}value.env={};
 }else{
  const rawUrl=text(raw.url,'MCP URL',2000);if(rawUrl.includes('${'))throw Error('Set URL credentials or placeholders manually.');let url;try{url=new URL(rawUrl);}catch{throw Error('Invalid MCP URL.');}
  const host=url.hostname.replace(/^\[|\]$/g,''),loopback=host==='localhost'||host==='::1'||isIP(host)===4&&host.startsWith('127.');
  if(!['http:','https:'].includes(url.protocol)||url.protocol==='http:'&&!loopback||url.username||url.password||url.search||url.hash)throw Error('MCP URLs need HTTPS (or loopback HTTP), without credentials, query strings or fragments.');value.url=url.href;
  const headers=stringMap(raw.headers,'MCP headers'),seen=new Set();for(const key of Object.keys(headers)){if(!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(key)||seen.has(key.toLowerCase()))throw Error('Invalid or duplicate MCP header.');seen.add(key.toLowerCase());requirements.push('Enter header '+key+' separately. Imported values are not saved.');}value.headers={};
 }
 for(const warning of requirements)unsupported.push(name+': '+warning);return {...value,requirements};
}

function analyze(files){
 const map=new Map(files.map(file=>[file.path,file])),has=file=>map.has(file),read=file=>json(map.get(file)?.bytes||Buffer.alloc(0),file),unsupported=[];let format='skill-bundle',name='Imported skills',manifest={},skillRoots=['skills'],mcpSources=[];
 if(has('openclaw.plugin.json')||has('package.json')&&object(read('package.json').openclaw)){
  format='openclaw-native';manifest=has('openclaw.plugin.json')?read('openclaw.plugin.json'):read('package.json');name=manifest.name||manifest.id||(has('package.json')?read('package.json').name:null)||'OpenClaw plugin';unsupported.push('Native OpenClaw JavaScript/TypeScript entrypoints, SDK registration, hooks, channels and providers are not executed by this importer.');
  if(Array.isArray(manifest.skills))skillRoots.push(...manifest.skills.map(relativeConfig));if(object(manifest.mcpServers))mcpSources.push({value:{mcpServers:manifest.mcpServers},label:'openclaw.plugin.json'});
 }else if(has('plugin.yaml')){format='hermes-native';name='Hermes native plugin';unsupported.push('Native Hermes Python entrypoints, register(ctx), hooks, channels and providers are not executed by this importer.');}
 else{const marker=['.codex-plugin/plugin.json','.claude-plugin/plugin.json','.cursor-plugin/plugin.json'].find(has);
  if(marker){format=marker.split('/')[0].slice(1).replace('-plugin','')+'-bundle';manifest=read(marker);name=manifest.name||'Imported plugin';if(manifest.skills!==undefined)skillRoots.push(...(Array.isArray(manifest.skills)?manifest.skills:[manifest.skills]).map(relativeConfig));
   if(manifest.mcpServers!==undefined){if(typeof manifest.mcpServers==='string')mcpSources.push({path:relativeConfig(manifest.mcpServers)});else if(object(manifest.mcpServers))mcpSources.push({value:{mcpServers:manifest.mcpServers},label:marker});else throw Error('Invalid manifest MCP configuration.');}
  }else if(has('plugin.json')){format='agent-plugins-v1';manifest=read('plugin.json');validPortable(manifest);name=manifest.name;if(manifest.extensions&&Object.keys(manifest.extensions).length)unsupported.push('Client-specific extension metadata is retained as source only; no activation settings are applied.');}
  else if(!files.some(file=>file.path==='SKILL.md'||file.path.endsWith('/SKILL.md')))throw Error('No supported plugin manifest or SKILL.md was found at the package root.');
 }
 name=text(name,'package name',120);
 if(format==='agent-plugins-v1'){if(has('mcp.json'))mcpSources.push({path:'mcp.json',portable:true});}
 else{if(has('.mcp.json'))mcpSources.push({path:'.mcp.json'});if(has('mcp.json'))mcpSources.push({path:'mcp.json',portable:true});}
 const skills=[];for(const file of files){const eligible=file.path==='SKILL.md'||file.path.endsWith('/SKILL.md')&&skillRoots.some(root=>file.path.startsWith(root+'/'));if(!eligible)continue;
  if(format==='agent-plugins-v1'&&!/^skills\/[^/]+\/SKILL\.md$/.test(file.path)){unsupported.push(file.path+': portable v1 only discovers direct skills/<name>/SKILL.md folders.');continue;}
  try{const parsed=parseSkillMarkdown(decode(file.bytes));if(format==='agent-plugins-v1'&&(parsed.skill.title!==file.path.split('/')[1]||parsed.skill.title.length>64||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(parsed.skill.title)||parsed.skill.whenToUse.length>1024))throw Error('Portable skill name must match its directory and use Agent Skills naming.');skills.push({path:file.path,name:parsed.skill.title,description:parsed.skill.whenToUse,requirements:parsed.requirements,sha256:hash(file.bytes)});}catch(error){unsupported.push(file.path+': '+error.message);}
 }
 const connections=[],seen=new Set();for(const source of mcpSources){try{const label=source.path||source.label,config=source.value||read(source.path);if(source.portable){if(config.$schema!==MCP_SCHEMA)throw Error('mcp.json must declare the Agent Plugins 1.0.0 MCP schema.');fields(config,['$schema','mcpServers'],'mcp.json');}
   const servers=config.mcpServers||config.mcp?.servers;if(!object(servers)||Object.keys(servers).length>40)throw Error('MCP configuration needs a bounded mcpServers object.');
   for(const [server,raw] of Object.entries(servers)){try{if(seen.has(server.toLowerCase()))throw Error('Duplicate MCP server name.');seen.add(server.toLowerCase());connections.push(connectionDefinition(server,raw,!!source.portable,unsupported));}catch(error){unsupported.push(label+' / '+server+': '+error.message);}}
  }catch(error){unsupported.push((source.path||source.label)+': '+error.message);}}
 if(files.some(file=>/(^|\/)(?:hooks|agents|commands|rules|node_modules)(?:\/|$)|(?:^|\/)HOOK\.md$/.test(file.path)))unsupported.push('Hooks, command dispatch, agent definitions, rules and bundled dependencies are kept as files only; no installation or activation occurs.');
 if(has('package.json')){const pkg=read('package.json');if(pkg.scripts||pkg.dependencies||pkg.optionalDependencies)unsupported.push('Package install scripts and dependency installation are not run. Commands requiring missing dependencies need manual setup.');}
 if(skills.length>40||connections.length>40)throw Error('Import at most 40 skills and 40 connections per package.');
 const manifestFiles=files.map(file=>({path:file.path,sha256:hash(file.bytes),bytes:file.bytes.length,executable:!!file.executable}));
 return {name,format,files:manifestFiles.map(file=>file.path),skills,connections,unsupported,reviewHash:hash(JSON.stringify({version:1,files:manifestFiles})),manifestFiles};
}

export class PluginPackages{
 constructor({dataRoot,skills,connections}){
  const base=path.resolve(dataRoot);if(fs.lstatSync(base,{throwIfNoEntry:false})?.isSymbolicLink())throw Error('Plugin data root cannot be a link.');fs.mkdirSync(base,{recursive:true});this.base=fs.realpathSync(base);this.root=path.join(this.base,'plugin-packages');this.skills=skills;this.connections=connections;this.busy=false;this.inspecting=0;
  this.directory(this.root);this.directory(path.join(this.root,'staged'));this.directory(path.join(this.root,'installed'));this.file=path.join(this.root,'index.json');this.db=loadReviewData(this.file,{version:1,packages:[]},INDEX_LIMIT);
  if(this.db.version!==1||!Array.isArray(this.db.packages)||this.db.packages.length>50||this.db.packages.some(record=>!ident(record.id)||!Array.isArray(record.skillIds)||!Array.isArray(record.connectionIds)))throw Error('Invalid plugin package storage.');
 }
 directory(dir){const relative=path.relative(this.base,dir);if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('Plugin path escapes its data directory.');let current=this.base;for(const name of relative.split(path.sep).filter(Boolean)){current=path.join(current,name);const stat=fs.lstatSync(current,{throwIfNoEntry:false});if(stat&&(stat.isSymbolicLink()||!stat.isDirectory()))throw Error('Plugin directories cannot contain links.');if(!stat)fs.mkdirSync(current,{mode:0o700});}return dir;}
 location(kind,id){if(!['staged','installed'].includes(kind)||!ident(id))throw Error('Invalid plugin package identity.');this.directory(this.root);this.directory(path.join(this.root,kind));const dir=path.join(this.root,kind,id);const stat=fs.lstatSync(dir,{throwIfNoEntry:false});if(stat&&(stat.isSymbolicLink()||!stat.isDirectory()))throw Error('Plugin directories cannot contain links.');return dir;}
 save(){saveReviewData(this.file,this.db,INDEX_LIMIT);}
 public(record){const value=copy(record);delete value.manifestFiles;return value;}
 list(){return this.db.packages.map(record=>this.public(record));}
 readFile({id,path:relative,reviewHash}={}){
  packagePath(relative);const kind=this.db.packages.some(record=>record.id===id)?'installed':'staged',captured=this.captured(this.location(kind,id));
  if(reviewHash!==undefined&&reviewHash!==captured.report.reviewHash)throw Error('The file preview does not match the reviewed package hash.');
  const file=captured.files.find(entry=>entry.path===relative);if(!file)throw Error('Choose a file listed in this package review.');const bytes=file.bytes.length;let value;
  try{value=decode(file.bytes);}catch{return {path:relative,text:'',bytes,truncated:false,binary:true};}
  if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))return {path:relative,text:'',bytes,truncated:false,binary:true};
  let length=Math.min(value.length,64000);if(length<value.length&&/[\uD800-\uDBFF]/.test(value[length-1]))length--;
  return {path:relative,text:value.slice(0,length),bytes,truncated:length<value.length,binary:false};
 }
 async inspect(input){
  if(!object(input)||(input.archive===undefined)===(input.files===undefined))throw Error('Choose a ZIP archive or text folder files.');if(fs.readdirSync(this.directory(path.join(this.root,'staged'))).length+this.inspecting>=8)throw Error('Remove an earlier staged review before importing more packages.');this.inspecting++;
  try{
  if(input.archive===undefined&&(!Array.isArray(input.files)||!input.files.length||input.files.length>FILE_COUNT))throw Error('Import a bundle with 1–256 files.');
  const files=unwrapFiles(input.archive!==undefined?await archiveFiles(input.archive):validateFiles(input.files.map(file=>{if(!object(file)||Object.keys(file).some(key=>!['path','content'].includes(key))||typeof file.content!=='string')throw Error('Text folder files need only path and content.');if(Buffer.byteLength(file.content)>FILE_LIMIT)throw Error('Each package file must be under 1 MiB.');return {path:file.path,bytes:Buffer.from(file.content),executable:false};})));
  const id=randomUUID(),report=this.report(files,id),dir=this.location('staged',id);this.directory(dir);const source=this.directory(path.join(dir,'files'));
  try{for(const file of files){const target=path.join(source,...file.path.split('/'));this.directory(path.dirname(target));fs.writeFileSync(target,file.bytes,{flag:'wx',mode:file.executable?0o700:0o600});}
   // Preserve executable metadata on Windows, whose filesystem does not expose
   // Unix mode bits. It is part of the captured review hash on every platform.
   saveReviewData(path.join(dir,'review.json'),{id,...report},INDEX_LIMIT);return {id,...this.public(report)};
  }catch(error){this.cleanup(dir);throw error;}
  }finally{this.inspecting--;}
 }
 captured(dir){
  const stored=loadReviewData(path.join(dir,'review.json'),null,INDEX_LIMIT);if(!stored||!Array.isArray(stored.manifestFiles))throw Error('Package review is missing.');const files=regularTree(path.join(dir,'files'));
  if(process.platform==='win32')for(const file of files){const original=stored.manifestFiles.find(item=>item.path===file.path);file.executable=original?.executable===true;}
  const report=this.report(files,stored.id);if(report.reviewHash!==stored.reviewHash)throw Error('Package files or connection requirements changed after review. Inspect the package again.');return {files,report};
 }
 report(files,id){const result=analyze(files),source=path.join(this.root,'installed',id,'files'),data=path.join(this.root,'installed',id,'data');result.connections=result.connections.filter(value=>{try{
   if(value.transport==='stdio'){if(value.command.startsWith('./')&&!files.some(file=>file.path===relativeConfig(value.command)))throw Error('The package executable is missing.');const cwd=value.cwd.startsWith('./')?relativeConfig(value.cwd):value.cwd.startsWith('${PLUGIN_ROOT}/')?value.cwd.slice(15):'';if(cwd&&!files.some(file=>file.path.startsWith(cwd+'/')))throw Error('The package working directory is missing.');}
   this.connections?.validate?.(this.installDefinition(value,id,source,data));return true;
  }catch(error){result.unsupported.push(value.name+': '+error.message);return false;}});result.reviewHash=hash(JSON.stringify({version:1,files:result.manifestFiles,connections:result.connections,unsupported:result.unsupported}));return result;}
 expand(value,source,data){return value.replace(/\$\{(PLUGIN_ROOT|PLUGIN_DATA)\}/g,(_match,key)=>key==='PLUGIN_ROOT'?source:data);}
 installDefinition(value,id,source,data){const result=copy(value);delete result.requirements;result.name=value.name;result.sourcePackageId=id;result.persistSecrets=false;
  if(value.transport==='stdio'){result.command=value.command.startsWith('./')?path.join(source,...relativeConfig(value.command).split('/')):value.command;result.args=value.args.map(arg=>this.expand(arg,source,data));result.cwd=path.resolve(value.cwd.startsWith('./')?path.join(source,...relativeConfig(value.cwd).split('/')):this.expand(value.cwd,source,data));result.packageRoot=source;result.packageData=data;result.env={};}
  return result;
 }
 async install({id,reviewHash,confirmed}={}){
  if(confirmed!==true)throw Error('Review and confirm this package before importing it.');if(this.busy)throw Error('Another package change is in progress.');if(!ident(id)||typeof reviewHash!=='string')throw Error('Choose a staged package review.');
  const existing=this.db.packages.find(record=>record.id===id);if(existing){if(existing.reviewHash!==reviewHash||existing.status!=='installed')throw Error('This package needs cleanup before it can be imported again.');return this.public(existing);}
  if(this.db.packages.length>=50)throw Error('Remove a package before importing another.');this.busy=true;let target,record;
  try{const stage=this.location('staged',id),captured=this.captured(stage);if(captured.report.reviewHash!==reviewHash)throw Error('The approved package hash does not match this review.');target=this.location('installed',id);if(fs.existsSync(target))throw Error('Package installation directory already exists.');
   fs.renameSync(stage,target);record={id,...captured.report,status:'installing',skillIds:[],connectionIds:[],installedAt:Date.now()};this.db.packages.push(record);this.save();const source=path.join(target,'files'),data=this.directory(path.join(target,'data'));
   for(const skill of record.skills){const document=decode(captured.files.find(file=>file.path===skill.path).bytes),imported=this.skills.importSkill(document,{packageId:id});record.skillIds.push(imported.skillId);this.save();}
   for(const definition of record.connections){const value=this.installDefinition(definition,id,source,data);if(value.transport==='stdio'&&(value.cwd===data||value.cwd.startsWith(data+path.sep)))this.directory(value.cwd);const saved=this.connections.save(value);record.connectionIds.push(saved.id);this.save();}
   record.status='installed';this.save();return this.public(record);
  }catch(error){if(record){try{await this.removeDefinitions(id);this.cleanup(target);this.db.packages=this.db.packages.filter(item=>item.id!==id);this.save();}catch{record.status='cleanup-required';try{this.save();}catch{}throw Error('Package import was interrupted. Remove this package to finish cleanup; its imported connections are disabled.');}}throw error;
  }finally{this.busy=false;}
 }
 async removeDefinitions(id){for(const definition of this.connections?.list?.()||[])if(definition.sourcePackageId===id)await this.connections.remove(definition.id);for(const skill of this.skills?.list?.()||[])if(skill.sourcePackageId===id)this.skills.removeImported(skill.id,id);}
 cleanup(dir){if(!dir)return;const parent=path.dirname(dir);if(![path.join(this.root,'staged'),path.join(this.root,'installed')].includes(parent)||!ident(path.basename(dir)))throw Error('Refusing cleanup outside the package directory.');this.location(path.basename(parent),path.basename(dir));if(!fs.existsSync(dir))return;
  // Scan every path before recursive deletion; never traverse an injected link.
  const scan=folder=>{for(const name of fs.readdirSync(folder)){const file=path.join(folder,name),stat=fs.lstatSync(file);if(stat.isSymbolicLink()||stat.isFile()&&stat.nlink!==1)throw Error('Package cleanup cannot follow links.');if(stat.isDirectory())scan(file);else if(!stat.isFile())throw Error('Package cleanup found a special file.');}};scan(dir);fs.rmSync(dir,{recursive:true,force:true});
 }
 async remove(id){if(!ident(id))throw Error('Invalid plugin package identity.');if(this.busy)throw Error('Another package change is in progress.');this.busy=true;try{const record=this.db.packages.find(item=>item.id===id);if(record){await this.removeDefinitions(id);this.cleanup(this.location('installed',id));const before=this.db;try{this.db={...this.db,packages:this.db.packages.filter(item=>item.id!==id)};this.save();}catch(error){this.db=before;throw error;}}else this.cleanup(this.location('staged',id));return {removed:true};}finally{this.busy=false;}}
}
