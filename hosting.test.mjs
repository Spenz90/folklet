import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createServicePlan,envQuote,assertInstallTargets,installService} from './hosting/install-user-service.mjs';

test('cloud service is private, uses separate data and does not contain credentials',()=>{
 const plan=createServicePlan({home:'/srv/crew',root:'/srv/crew/My Crew'});
 assert.equal(plan.length,3);
 assert.match(plan[0].text,/CREW_APP="\/srv\/crew\/My Crew"/);
 assert.match(plan[0].text,/CREW_DATA="\/srv\/crew\/\.local\/share\/crew"/);
 assert.equal(plan[0].mode,0o600);
 assert.match(plan[1].text,/CREW_PORT=4318/);
 assert.match(plan[1].text,/CREW_MOBILE_PORT=4320/);
 assert.match(plan[1].text,/unset NODE_OPTIONS NODE_PATH CREW_CODEX_OVERRIDE/);
 assert.match(plan[1].text,/exec "\$CREW_APP\/runtime\/node" "\$CREW_APP\/server\.mjs"/);
 assert.match(plan[2].text,/KillMode=control-group/);
 assert.match(plan[2].text,/UMask=0077/);
 assert.doesNotMatch(plan.map(x=>x.text).join('\n'),/0\.0\.0\.0|sudo |--no-sandbox|api_key=|enable-linger/);
});
test('environment paths cannot inject more settings and quote shell-looking characters',()=>{
 for(const value of ['relative','/srv/a\nEVIL=1','/srv/a\0','/srv/../root'])assert.throws(()=>envQuote(value));
 assert.equal(envQuote('/srv/a "$`\\b'), '"/srv/a \\"\\$\\`\\\\b"');
});
test('existing edited settings or a hard link are refused before any install writes',()=>{
 const temp=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'crew-hosting-'));
 try{
  const file=path.join(temp,'crew.env'),plan=[{file,text:'expected',mode:0o600}];
  assert.doesNotThrow(()=>assertInstallTargets(plan));
  fs.writeFileSync(file,'existing private settings');
  assert.throws(()=>assertInstallTargets(plan),/Existing FOLKLET service files differ/);
  assert.equal(fs.readFileSync(file,'utf8'),'existing private settings');
  fs.writeFileSync(file,'expected');assert.doesNotThrow(()=>assertInstallTargets(plan));
  fs.linkSync(file,path.join(temp,'linked.env'));
  assert.throws(()=>assertInstallTargets(plan),/Existing FOLKLET service files differ/);
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
test('service installer fails closed on other operating systems',()=>{
 if(process.platform!=='linux'||process.arch!=='x64')assert.throws(()=>installService({dryRun:true}),/Ubuntu 24.04/);
});
