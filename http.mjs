import fs from 'node:fs';
import path from 'node:path';

// Managed browser requests must never acquire the owner's bootstrap token.
// Sec-* headers cannot be supplied or removed by page JavaScript. The browser
// context also enforces this marker in its request route, including redirects.
export const managedBrowserHeader='sec-crew-browser';
export const isManagedBrowserRequest=request=>Object.hasOwn(request.headers,managedBrowserHeader);

export async function readJSON(request,{maxBytes=15000000}={}){
 const chunks=[];let size=0;
 for await(const chunk of request){
  const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);size+=bytes.length;
  if(size>maxBytes)throw Error('Request too large (10 MB file limit)');
  chunks.push(bytes);
 }
 // Decode once: a transport chunk may end in the middle of a UTF-8 character.
 const value=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Expected a JSON object');
 return value;
}

export function sendDownload(response,file){
 const stream=fs.createReadStream(file);
 stream.once('open',()=>{
  const filename=encodeURIComponent(path.basename(file)).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
  response.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename*=UTF-8''${filename}`,'X-Content-Type-Options':'nosniff','Cache-Control':'no-store'});
  stream.pipe(response);
 });
 // A file can disappear after the route's stat check. Handle that race without
 // taking down the host or returning an operating-system path in the response.
 stream.once('error',()=>{
  if(response.headersSent)response.destroy();
  else{response.writeHead(404,{'Content-Type':'application/json','Cache-Control':'no-store'});response.end(JSON.stringify({error:'This file is no longer available. Refresh the files list.'}));}
 });
 response.once('close',()=>stream.destroy());
 return stream;
}
