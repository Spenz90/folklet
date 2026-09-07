import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

export function checkedText(value,label,max,{empty=false,trim=true}={}){
 if(typeof value!=='string'||value.length>max||(!empty&&!value.trim()))throw Error(`${label} must be ${empty?'':'nonempty '}text under ${max} characters.`);
 return trim?value.trim():value;
}
function regular(file){const stat=fs.lstatSync(file,{throwIfNoEntry:false});if(stat&&(stat.isSymbolicLink()||!stat.isFile()||stat.nlink>1))throw Error('Review storage must be a regular private file; symbolic links and hard links are not allowed.');return stat;}
export function loadReviewData(file,empty,maxBytes){const stat=regular(file);if(!stat)return structuredClone(empty);if(stat.size>maxBytes)throw Error('Review storage exceeds its size limit. Restore a valid private backup.');try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{throw Error('Review storage could not be read. Restore a valid private backup.');}}
export function saveReviewData(file,data,maxBytes){
 regular(file);const body=JSON.stringify(data,null,2);if(Buffer.byteLength(body)>maxBytes)throw Error('Review history has reached its storage limit. Export older entries before adding more.');
 const temp=path.join(path.dirname(file),'.review-'+randomUUID()+'.tmp');
 try{fs.writeFileSync(temp,body,{flag:'wx',mode:0o600});fs.renameSync(temp,file);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
}
export function sourceReference(store,input){
 if(input===undefined||input===null)return null;
 if(typeof input!=='object'||Array.isArray(input))throw Error('Choose a valid source reference.');
 const bot=store.db.bots.find(bot=>bot.id===input.botId);if(!bot)throw Error('The source bot does not exist.');
 const result={botId:bot.id};
 if(input.taskId!==undefined){const task=store.db.tasks.find(task=>task.id===input.taskId&&task.botId===bot.id);if(!task)throw Error('The source task does not belong to this bot.');result.taskId=task.id;}
 if(input.messageId!==undefined){const message=(bot.messages||[]).find(message=>message.id===input.messageId);if(!message)throw Error('The source message does not belong to this bot.');result.messageId=message.id;}
 result.href='/?bot='+encodeURIComponent(bot.id)+(result.taskId?'&task='+encodeURIComponent(result.taskId):result.messageId?'&message='+encodeURIComponent(result.messageId):'');return result;
}
