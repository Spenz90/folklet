import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {TelegramNotifications,inQuietHours} from './notifications.mjs';
const token='123456789:fixture_token_for_mock_test_only',reply=result=>new Response(JSON.stringify({ok:true,result}));
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'crew-notification-unit-')),calls=[];let now=Date.parse('2026-09-06T12:00:00Z'),updates=[];
 const notifications=new TelegramNotifications({dataRoot:root,now:()=>now,fetchImpl:async(url,options)=>{const method=url.split('/').at(-1),body=JSON.parse(options.body);calls.push({url,method,body,options});return reply(method==='getMe'?{is_bot:true,username:'CrewFixtureBot'}:method==='getUpdates'?updates:{message_id:1});}});
 t.after(async()=>{await notifications.close();assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.match(path.basename(root),/^crew-notification-unit-/);fs.rmSync(root,{recursive:true,force:true});});
 const message=(code,extra={})=>({update_id:1,message:{text:'/start '+code,date:Math.floor(now/1000),chat:{type:'private',id:1234},from:{id:1234,is_bot:false,first_name:'Fixture',username:'fixture_user'},...extra}});
 const pair=async()=>{notifications.configure({token});const start=await notifications.beginPairing();updates=[message(start.code)];const found=await notifications.checkPairing();notifications.activate({pairingId:found.pairingId,recipientId:found.preview.id});return found;};
 return {root,calls,notifications,pair,message,updates:value=>{updates=value;},advance:ms=>{now+=ms;}};
}
test('Telegram setup is opt-in and session tokens are never exposed or saved implicitly',async t=>{
 const f=fixture(t);assert.equal(f.notifications.status().enabled,false);assert.equal(f.calls.length,0);await f.notifications.notify({id:'one',kind:'completed'});assert.equal(f.calls.length,0);
 f.notifications.configure({token});assert.equal(f.calls.length,0);assert.equal(f.notifications.status().tokenStorage,'session');assert.ok(!JSON.stringify(f.notifications.status()).includes(token));assert.ok(!fs.readFileSync(f.notifications.file,'utf8').includes(token));
 f.notifications.configure({persistToken:true});assert.ok(fs.readFileSync(f.notifications.file,'utf8').includes(token));assert.equal(new TelegramNotifications({dataRoot:f.root}).status().tokenStorage,'disk');
 f.notifications.configure({persistToken:false});assert.ok(!fs.readFileSync(f.notifications.file,'utf8').includes(token));
});
test('pairing requires the exact fresh message from a private human chat then explicit recipient activation',async t=>{
 const f=fixture(t);f.notifications.configure({token});const start=await f.notifications.beginPairing();assert.match(start.url,/^https:\/\/t.me\/CrewFixtureBot\?start=crew_/);
 const examples=[f.message('wrong'),f.message(start.code,{chat:{type:'group',id:1234}}),f.message(start.code,{date:1}),f.message(start.code,{forward_origin:{type:'user'}}),f.message(start.code,{from:{id:1234,is_bot:true}})];f.updates(examples);assert.equal((await f.notifications.checkPairing()).preview,null);assert.throws(()=>f.notifications.activate({pairingId:start.pairingId,recipientId:'1234'}),/Review a fresh/);
 f.updates([f.message(start.code)]);const found=await f.notifications.checkPairing();assert.equal(found.preview.id,'1234');assert.equal(found.preview.name,'Fixture');assert.equal(f.notifications.status().enabled,false);assert.throws(()=>f.notifications.activate({pairingId:start.pairingId,recipientId:'9999'}),/Review a fresh/);
 f.notifications.activate({pairingId:start.pairingId,recipientId:'1234'});assert.equal(f.notifications.status().enabled,true);assert.equal(f.calls.some(call=>call.method==='sendMessage'),false);
 assert.ok(f.calls.every(call=>call.options.redirect==='error'&&call.url.startsWith('https://api.telegram.org/bot')));
});
test('activated notifications send only generic text and a private task link, once per event',async t=>{
 const f=fixture(t);await f.pair();f.notifications.configure({baseUrl:'https://crew-fixture.example.ts.net'});
 const event={id:'one',kind:'approval',botId:'bot-1',taskId:'task-2',text:'private task and API key',title:'sensitive title'};
 assert.equal((await f.notifications.notify(event)).delivered,true);assert.equal((await f.notifications.notify(event)).reason,'duplicate');const calls=f.calls.filter(call=>call.method==='sendMessage');assert.equal(calls.length,1);
 assert.equal(calls[0].body.chat_id,'1234');assert.match(calls[0].body.text,/approval or answer/);assert.match(calls[0].body.text,/\?bot=bot-1&task=task-2/);assert.doesNotMatch(calls[0].body.text,/private task|sensitive title/);assert.equal(calls[0].body.link_preview_options.is_disabled,true);assert.equal(calls[0].body.protect_content,true);
});
test('quiet hours handle overnight ranges and suppress notifications instead of replaying them',async t=>{
 const quiet={enabled:true,start:'22:00',end:'08:00',timeZone:'UTC'};assert.equal(inQuietHours(quiet,Date.parse('2026-09-06T23:00:00Z')),true);assert.equal(inQuietHours(quiet,Date.parse('2026-09-07T07:59:00Z')),true);assert.equal(inQuietHours(quiet,Date.parse('2026-09-07T08:00:00Z')),false);
 const f=fixture(t);await f.pair();f.notifications.configure({quietHours:{...quiet,start:'11:00',end:'13:00'}});assert.equal((await f.notifications.notify({id:'quiet',kind:'completed'})).reason,'quiet-hours');f.advance(7200000);assert.equal((await f.notifications.notify({id:'quiet',kind:'completed'})).reason,'duplicate');assert.equal(f.calls.some(call=>call.method==='sendMessage'),false);
});
test('revocation aborts current delivery and stops queued messages without retry',async t=>{
 const f=fixture(t);await f.pair();let entered,release,calls=0;const started=new Promise(resolve=>{entered=resolve;});f.notifications.fetchImpl=async()=>{calls++;entered();return new Promise(resolve=>{release=()=>resolve(reply({message_id:1}));});};
 const first=f.notifications.notify({id:'first',kind:'completed'}),second=f.notifications.notify({id:'second',kind:'completed'});await started;f.notifications.revoke();release();assert.equal((await first).delivered,false);assert.equal((await second).reason,'changed');assert.equal(calls,1,'The queued message must not start after revocation');assert.equal(f.notifications.status().enabled,false);assert.equal(f.notifications.status().recipient,null);
});
test('private notification links accept normalized HTTPS443 and Crew8443 while rejecting other ports or URL parts',async t=>{
 const f=fixture(t);await f.pair();
 for(const [input,expected]of [['https://crew-fixture.example.ts.net/','https://crew-fixture.example.ts.net'],['https://crew-fixture.example.ts.net:443/','https://crew-fixture.example.ts.net'],['https://crew-fixture.example.ts.net:8443/','https://crew-fixture.example.ts.net:8443']])assert.equal(f.notifications.configure({baseUrl:input}).baseUrl,expected);
 await f.notifications.notify({id:'private-port-link',kind:'completed',botId:'bot',taskId:'task'});assert.match(f.calls.find(call=>call.method==='sendMessage').body.text,/https:\/\/crew-fixture\.example\.ts\.net:8443\/\?bot=bot&task=task/);
 for(const baseUrl of ['https://crew-fixture.example.ts.net:8080','http://crew-fixture.example.ts.net:8443','https://user@crew-fixture.example.ts.net:8443','https://crew-fixture.example.ts.net:8443/path','https://crew-fixture.example.ts.net:8443/?token=fixture','https://crew-fixture.example.ts.net:8443/#fragment','https://not-private.example:8443'])assert.throws(()=>f.notifications.configure({baseUrl}));
 assert.equal(f.notifications.status().baseUrl,'https://crew-fixture.example.ts.net:8443');
});
test('Telegram failures never expose the token or upstream body and have no automatic retry',async t=>{
 const f=fixture(t);await f.pair();let calls=0;f.notifications.fetchImpl=async()=>{calls++;throw Error('URL contained '+token);};const result=await f.notifications.notify({id:'failed',kind:'failed'});assert.equal(result.delivered,false);assert.equal(calls,1);assert.ok(!JSON.stringify(f.notifications.status()).includes(token));assert.match(f.notifications.status().error,/could not complete/);
});
test('changing tokens invalidates recipient and pairing; session restart cannot send without a token',async t=>{
 const f=fixture(t);await f.pair();const restored=new TelegramNotifications({dataRoot:f.root});assert.equal(restored.status().enabled,false);assert.equal((await restored.notify({id:'one',kind:'completed'})).reason,'disabled');await restored.close();
 f.notifications.configure({token:'987654321:replacement_fixture_token_only'});assert.equal(f.notifications.status().enabled,false);assert.equal(f.notifications.status().recipient,null);assert.equal(f.notifications.status().pairing,null);
});
test('invalid Telegram settings leave existing state unchanged and expired pairings cannot activate',async t=>{
 const f=fixture(t);f.notifications.configure({token});const original=f.notifications.status();for(const input of [{baseUrl:'https://public.example'},{token:'invalid'},{quietHours:{enabled:true,start:'12:00',end:'12:00',timeZone:'UTC'}},{quietHours:{enabled:false,start:'12:00',end:'13:00',timeZone:'Invalid/Zone'}}])assert.throws(()=>f.notifications.configure(input));assert.deepEqual(f.notifications.status(),original);
 const pairing=await f.notifications.beginPairing();f.advance(300001);await assert.rejects(f.notifications.checkPairing(),/expired/);assert.throws(()=>f.notifications.activate({pairingId:pairing.pairingId,recipientId:'1234'}),/fresh/);
});
