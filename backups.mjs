import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {atomicPrivateJSON,privateJSON,passwordWrap,passwordOpen} from './credential-vault.mjs';

const LIMIT=64*1024*1024,MAX_FILES=10000;
const excluded=new Set(['backups','restored-workspaces','browser-profiles','mobile.json','backup-settings.json']);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export function backupPath(value){if(typeof value!=='string'||value.length>600||value.includes('\\')||value.includes(':')||/[\x00-\x1f]/.test(value)||path.posix.isAbsolute(value)||value.split('/').some(p=>!p||p==='.'||p==='..'||/[. ]$/.test(p)||/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(p)))throw Error('Backup contains an unsafe file path.');return value;}
function regularDirectory(dir){const st=fs.lstatSync(dir,{throwIfNoEntry:false});if(st&&(st.isSymbolicLink()||!st.isDirectory()))throw Error('Backup folders cannot be linked paths.');fs.mkdirSync(dir,{recursive:true,mode:0o700});}
export function createBackup(dataRoot,password,{vault,now=Date.now()}={}){
 regularDirectory(dataRoot);let total=0;const files=[];
 function walk(relative=''){for(const item of fs.readdirSync(path.join(dataRoot,relative),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){if(!relative&&excluded.has(item.name)||item.name.endsWith('.tmp'))continue;const name=backupPath(relative?relative+'/'+item.name:item.name),full=path.join(dataRoot,name),before=fs.lstatSync(full);if(before.isSymbolicLink()||before.isFile()&&before.nlink!==1)throw Error('Remove linked files before backing up the workspace.');if(before.isDirectory()){walk(name);continue;}if(!before.isFile())throw Error('The workspace contains a special file that cannot be backed up.');if(files.length>=MAX_FILES||(total+=before.size)>LIMIT)throw Error('This backup exceeds 64 MB or 10,000 files. Use a private full-disk backup for larger workspaces.');let bytes=fs.readFileSync(full);const after=fs.lstatSync(full);if(before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ino!==after.ino)throw Error('A workspace file changed during backup. Stop external file changes and try again.');if(name==='credential-vault.json'&&vault)bytes=Buffer.from(JSON.stringify(vault.portable(password)));files.push({path:name,sha256:digest(bytes),data:bytes.toString('base64')});}}
 walk();if(!files.some(f=>f.path==='crew.json'))throw Error('A Folklet workspace database was not found.');
 const payload=Buffer.from(JSON.stringify({version:1,createdAt:now,excluded:[...excluded],files}));
 return Buffer.from(JSON.stringify({format:'folklet-backup-v1',...passwordWrap(payload,password,'folklet-backup-v1')}));
}
export function inspectBackup(bytes,password){
 if(bytes.length>128*1024*1024)throw Error('Backup exceeds the size limit.');let envelope;try{envelope=JSON.parse(bytes);}catch{throw Error('Choose a Folklet encrypted backup file.');}if(envelope.format!=='folklet-backup-v1')throw Error('Unsupported backup format.');
 const payload=JSON.parse(passwordOpen(envelope,password,'folklet-backup-v1').toString('utf8'));if(payload.version!==1||!Array.isArray(payload.files)||payload.files.length>MAX_FILES)throw Error('Invalid backup manifest.');let total=0;const seen=new Set();
 for(const file of payload.files){backupPath(file.path);const canonical=file.path.toLowerCase();if(seen.has(canonical)||excluded.has(file.path.split('/')[0]))throw Error('Duplicate or excluded backup path.');seen.add(canonical);if(typeof file.data!=='string'||!/^[a-zA-Z0-9+/]*={0,2}$/.test(file.data)||(total+=Buffer.byteLength(file.data,'base64'))>LIMIT)throw Error('Backup exceeds its content limit.');if(digest(Buffer.from(file.data,'base64'))!==file.sha256)throw Error('Backup file verification failed.');}
 if(!payload.files.some(f=>f.path==='crew.json'))throw Error('Backup is missing its workspace database.');
 for(const file of payload.files){const parts=file.path.toLowerCase().split('/');parts.pop();while(parts.length){if(seen.has(parts.join('/')))throw Error('Backup contains a file where a directory is required.');parts.pop();}}
 return {payload,summary:{createdAt:payload.createdAt,files:payload.files.length,bytes:total,excluded:payload.excluded}};
}
export function restoreBackup(bytes,password,destination){
 const {payload,summary}=inspectBackup(bytes,password);if(fs.existsSync(destination))throw Error('Restore requires a new, empty destination folder.');regularDirectory(path.dirname(destination));
 const database=JSON.parse(Buffer.from(payload.files.find(f=>f.path==='crew.json').data,'base64'));
 if(!Array.isArray(database.bots)||!Array.isArray(database.tasks)||!Array.isArray(database.routines))throw Error('Backup database is invalid.');
 database.workspaceId=randomUUID();
 for(const bot of database.bots){if(typeof bot.id!=='string'||! /^[a-z\d_-]+$/i.test(bot.id))throw Error('Invalid bot in backup.');const parts=String(bot.cwd||'').replace(/[\\/]+$/,'').split(/[\\/]/);if(parts.at(-2)!=='workspaces'||parts.at(-1)!==bot.id)throw Error('External bot workspaces require a manual migration.');bot.cwd=path.join(destination,'workspaces',bot.id);delete bot.threadId;delete bot.toolVersion;}
 for(const routine of database.routines){routine.enabled=false;routine.retry=null;}
 for(const task of database.tasks)if(['queued','running','waiting'].includes(task.status)){task.status='interrupted';task.error='Restored backup: review task history before retrying.';task.finishedAt=Date.now();}
 fs.mkdirSync(destination,{mode:0o700});
 // Authentication and hashes have been checked before writing any restored file.
 for(const file of payload.files){const target=path.join(destination,file.path);fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});let content=Buffer.from(file.data,'base64');if(file.path==='crew.json')content=Buffer.from(JSON.stringify(database));if(['plugin-connections.json','integrations.json','telegram-notifications.json','web-push.json'].includes(file.path.toLowerCase())){const value=JSON.parse(content);for(const item of value.connections||value.integrations||[]){item.enabled=false;if(value.connections){item.allowedTools=[];item.botIds=[];}}if(['telegram-notifications.json','web-push.json'].includes(file.path.toLowerCase()))value.enabled=false;if(file.path.toLowerCase()==='web-push.json')value.subscriptions=[];content=Buffer.from(JSON.stringify(value));}fs.writeFileSync(target,content,{flag:'wx',mode:0o600});}
 for(const bot of database.bots)fs.mkdirSync(bot.cwd,{recursive:true,mode:0o700});
 return {...summary,destination,routinesPaused:true,connectionsDisabled:true};
}
export class Backups{
 constructor({dataRoot,vault,isIdle=()=>false,now=Date.now}={}){Object.assign(this,{dataRoot,vault,isIdle,now});this.directory=path.join(dataRoot,'backups');this.file=path.join(dataRoot,'backup-settings.json');this.settings=privateJSON(this.file,{version:1,enabled:false,intervalHours:24,keep:7,lastRun:0,lastError:''});this.running=false;this.timer=null;}
 list(){if(!fs.existsSync(this.directory))return [];regularDirectory(this.directory);return fs.readdirSync(this.directory).filter(n=>/^[a-f\d-]+\.folklet-backup$/.test(n)).map(id=>{const s=fs.lstatSync(path.join(this.directory,id));if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1)throw Error('Backup storage contains a linked file.');return {id,bytes:s.size,createdAt:s.mtimeMs};}).sort((a,b)=>b.createdAt-a.createdAt);}
 status(){const {password,...settings}=this.settings;return {...settings,backups:this.list(),unlocked:!!this.vault?.key,limitBytes:LIMIT};}
 configure({enabled,intervalHours=24,keep=7,password}={}){if(typeof enabled!=='boolean'||!Number.isInteger(intervalHours)||intervalHours<1||intervalHours>168||!Number.isInteger(keep)||keep<1||keep>30)throw Error('Choose a 1–168 hour schedule and 1–30 backups.');const secret=password?this.vault.protect(password,'backup:schedule'):this.settings.password;if(enabled&&!secret)throw Error('Enter a backup password of at least 12 characters.');if(password)passwordWrap(Buffer.from('check'),password,'check');this.settings={...this.settings,enabled,intervalHours,keep,password:secret};atomicPrivateJSON(this.file,this.settings);return this.status();}
 create(password){if(!this.isIdle())throw Error('Finish or stop queued and active tasks before backing up.');const bytes=createBackup(this.dataRoot,password,{vault:this.vault,now:this.now()});regularDirectory(this.directory);const id=randomUUID()+'.folklet-backup';fs.writeFileSync(path.join(this.directory,id),bytes,{flag:'wx',mode:0o600});return {id,bytes:bytes.length};}
 download(id){if(!this.list().some(b=>b.id===id))throw Error('Backup not found.');return path.join(this.directory,id);}
 restore(bytes,password){const parent=path.join(this.dataRoot,'restored-workspaces');regularDirectory(parent);return restoreBackup(bytes,password,path.join(parent,randomUUID()));}
 tick(){if(this.running||!this.settings.enabled||this.now()-this.settings.lastRun<this.settings.intervalHours*3600000||this.now()-(this.settings.lastAttempt||0)<15*60000||!this.isIdle())return;this.running=true;this.settings.lastAttempt=this.now();try{const password=this.vault.reveal(this.settings.password,'backup:schedule',{required:true});this.create(password);this.settings.lastRun=this.now();this.settings.lastError='';for(const old of this.list().slice(this.settings.keep))fs.unlinkSync(this.download(old.id));}catch{this.settings.lastError='Scheduled backup could not run. Check vault unlock, disk space and workspace size. Retrying after 15 minutes.';}finally{try{atomicPrivateJSON(this.file,this.settings);}catch{this.settings.lastError='Backup settings could not be saved. Check available disk space and folder access.';}this.running=false;}}
 start(){this.timer=setInterval(()=>this.tick(),60000);this.timer.unref();}
 close(){clearInterval(this.timer);}
}
