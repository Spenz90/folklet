import test from 'node:test';
import assert from 'node:assert/strict';
import {hostReportHTML,hostingSteps,formatUptime} from './hosting-ui.mjs';

test('host status escapes untrusted text and keeps unknown checks visible',()=>{
 const html=hostReportHTML({platform:'linux',kind:'computer',uptimeSeconds:3660,checkedAt:0,timeZone:'<script>oops</script>',checks:[{id:'probe',status:'unknown',title:'<img src=x>',detail:'Cannot verify & retry'}]});
 assert.doesNotMatch(html,/<script>|<img/);assert.match(html,/&lt;script&gt;/);assert.match(html,/data-status="unknown"/);assert.match(html,/Unavailable/);assert.match(html,/1 hr 1 min/);
 assert.equal(formatUptime(0),'Just started');
});
test('hosting steps never download unpinned scripts or expose owner ports',()=>{
 const commands=hostingSteps.map(s=>s.command||'').join('\n');
 assert.match(commands,/--dry-run/);assert.match(commands,/127\.0\.0\.1:4318:127\.0\.0\.1:4318/);
 assert.doesNotMatch(commands,/curl|wget|0\.0\.0\.0|sudo|funnel|rm -/);
 assert.match(hostingSteps.map(s=>s.note).join(' '),/does not order a server/);
});
