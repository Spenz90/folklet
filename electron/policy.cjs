'use strict';

const HOME_URL='http://127.0.0.1:4318/';
function webURL(value){
 if(typeof value!=='string'||value.length>16384||/[\\\s\u0000-\u001f\u007f]/.test(value))return null;
 try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password?url:null;}catch{return null;}
}
function isCrewOrigin(value){const url=webURL(value);return !!url&&url.origin===new URL(HOME_URL).origin;}
function isCrewResource(value){return isCrewOrigin(value)||(typeof value==='string'&&value.startsWith('blob:')&&isCrewOrigin(value.slice(5)));}
function externalWebLink(value){const url=webURL(value);return url&&!isCrewOrigin(value)?url.href:null;}
function parseHealth(value){return value&&value.app==='Crew'&&Number.isInteger(value.version)&&value.version>=5&&Number.isInteger(value.pid)&&value.pid>0?{pid:value.pid,version:value.version}:null;}
function tokenFromHTML(html){
 if(typeof html!=='string'||!/<title>Crew<\/title>/i.test(html)||!html.includes('id="app"')||!html.includes('src="/app.js"'))return null;
 return /window\.CREW_TOKEN\s*=\s*['"]([a-f0-9]{64})['"]/i.exec(html)?.[1]||null;
}
module.exports={HOME_URL,isCrewOrigin,isCrewResource,externalWebLink,parseHealth,tokenFromHTML};
