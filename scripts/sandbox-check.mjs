import { readFileSync, writeFileSync } from 'node:fs';
import { RootlessSandbox, validateAutomation } from '../packages/tools/dist/index.js';

// Administrator tool only. It never installs Docker/images, inherits an application secret or enables a candidate.
const runner = new RootlessSandbox({ dockerPath: process.env.EMERGENTINC_DOCKER_PATH ?? '/usr/bin/docker',
  socket: `unix:///run/user/${process.getuid?.() ?? -1}/docker.sock`, image: process.env.EMERGENTINC_SANDBOX_IMAGE ?? '' });
try {
  const [action, sourceFile, receiptFile] = process.argv.slice(2);
  if (action === 'probe') console.log(JSON.stringify(await runner.probe(), null, 2));
  else if (action === 'validate' && sourceFile && receiptFile) {
    const source = readFileSync(sourceFile, 'utf8');
    if (Buffer.byteLength(source) > 65536) throw new Error('INVALID_AUTOMATION_SOURCE');
    const receipt = await validateAutomation(source, runner);
    writeFileSync(receiptFile, JSON.stringify(receipt, null, 2), { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify(receipt, null, 2));
    if (!receipt.passed) process.exitCode = 1;
  } else throw new Error('Usage: node scripts/sandbox-check.mjs probe | validate <candidate.mjs> <new-receipt.json>');
} catch (e) { console.error(e.message); process.exitCode = 1; }
