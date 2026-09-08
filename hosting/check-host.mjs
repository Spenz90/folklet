import os from 'node:os';
import path from 'node:path';
import {inspectHost} from '../host-status.mjs';

const args=process.argv.slice(2);
if(args.some(arg=>arg!=='--json')||args.length>1){console.error('Usage: ./runtime/node hosting/check-host.mjs [--json]');process.exitCode=2;}
else {
  const report=await inspectHost({dataRoot:process.env.CREW_DATA||path.join(os.homedir(),'.local/share/crew'),pid:null});
  if(args.includes('--json'))console.log(JSON.stringify(report,null,2));
  else {
    console.log('Folklet private host checks (read-only)');
    for(const item of report.checks)console.log(`\n${item.status.toUpperCase()} · ${item.title}\n${item.detail}`);
    console.log('\nThis checks service settings and capacity, not model access or end-to-end phone connectivity.');
  }
  if(report.checks.some(item=>item.status!=='ready'))process.exitCode=1;
}
