import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {readJSON,sendDownload} from './http.mjs';

test('JSON request decoding preserves Unicode split across transport chunks',async()=>{
 const expected={name:'Zoë 🌍',text:'Résumé 日本語'},bytes=Buffer.from(JSON.stringify(expected));
 const chunks=Array.from(bytes,value=>Buffer.from([value]));
 assert.deepEqual(await readJSON(Readable.from(chunks)),expected);
 assert.deepEqual(await readJSON(Readable.from([])),{});
});

test('JSON requests enforce a byte limit and require an object',async()=>{
 const bytes=Buffer.from(JSON.stringify({text:'ééé'}));
 await assert.rejects(readJSON(Readable.from([bytes]),{maxBytes:bytes.length-1}),/Request too large/);
 assert.deepEqual(await readJSON(Readable.from([bytes]),{maxBytes:bytes.length}),{text:'ééé'});
 for(const value of ['null','[]','"text"','5','{unfinished'])await assert.rejects(readJSON(Readable.from([value])));
});

test('a disappeared download returns a safe error and subsequent downloads still work',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'crew-http-test-'));
 const present=path.join(dir,"résumé's report.bin"),missing=path.join(dir,'removed.bin'),bytes=Buffer.from([0,255,128,42]);
 fs.writeFileSync(present,bytes);fs.writeFileSync(missing,'temporary');assert.equal(fs.statSync(missing).isFile(),true);fs.unlinkSync(missing);
 const server=http.createServer((req,res)=>sendDownload(res,req.url==='/missing'?missing:present));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));const resolved=path.resolve(dir);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert.match(path.basename(resolved),/^crew-http-test-/);fs.rmSync(resolved,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${server.address().port}`;
 const absent=await fetch(base+'/missing');assert.equal(absent.status,404);const message=await absent.text();assert.match(message,/no longer available/);assert.ok(!message.includes(dir));
 const download=await fetch(base+'/file');assert.equal(download.status,200);assert.deepEqual(Buffer.from(await download.arrayBuffer()),bytes);
 assert.equal(download.headers.get('cache-control'),'no-store');assert.match(download.headers.get('content-disposition'),/r%C3%A9sum%C3%A9%27s%20report.bin/);
});
