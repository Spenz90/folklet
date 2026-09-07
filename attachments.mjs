import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

// Resolve user-selected uploads into the receiving bot's own workspace. Models
// receive relative paths, and changing a group recipient keeps files readable.
export function attachToMessage(store,bot,text,attachments=[]){
 if(typeof text!=='string'||!text.trim()||text.length>30000)throw Error('Write a message under 30,000 characters.');
 if(!Array.isArray(attachments)||attachments.length>20)throw Error('Attach at most 20 files.');
 let total=0;
 const files=attachments.map(item=>{
  if(!item||typeof item.owner!=='string'||typeof item.path!=='string'||!item.path.startsWith('attachments/')||item.path.length>1000||/[\\\u0000-\u001f]/.test(item.path)||item.path.split('/').some(p=>!p||p==='.'||p==='..'))throw Error('Choose a valid uploaded attachment.');
  const owner=store.bot(item.owner),source=store.safeFile(owner,item.path),uploadRoot=fs.realpathSync(store.safeFile(owner,'attachments')),inside=path.relative(uploadRoot,fs.realpathSync(source)),stat=fs.statSync(source);
  if(!inside||inside==='..'||inside.startsWith('..'+path.sep)||path.isAbsolute(inside))throw Error('Choose a file from uploaded attachments.');
  if(!stat.isFile()||stat.size>10000000||(total+=stat.size)>50000000)throw Error('Attachments must be files under 10 MB each and 50 MB combined.');
  return {source,relative:owner.id===bot.id?item.path:`attachments/${randomUUID()}-${path.basename(source)}`,copy:owner.id!==bot.id};
 });
 const created=[];
 try{
  for(const file of files){if(!file.copy)continue;const target=store.safeFile(bot,file.relative,false);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(file.source,target,fs.constants.COPYFILE_EXCL);created.push(target);}
  return text.trim()+(files.length?'\n\nAttached workspace files (relative to your workspace):\n'+files.map(f=>f.relative).join('\n'):'');
 }catch(error){for(const file of created){try{fs.unlinkSync(file);}catch{}}throw error;}
}
