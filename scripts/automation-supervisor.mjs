import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { RootlessSandbox } from '../packages/tools/dist/index.js';
import { AutomationSupervisor } from '../apps/server/dist/services/automation_supervisor.js';
import { acquireWorkspaceLock } from '../apps/server/dist/runtime_config.js';

// Trusted maintenance entry point. It is not registered on the application HTTP router.
let supervisor, release;
try {
  const [directory, action, value, approvalHash] = process.argv.slice(2);
  if (!directory || !['submit','list','show','validate','approve','activate','run','rollback'].includes(action))
    throw new Error('Usage: node scripts/automation-supervisor.mjs <private-root> submit <request.json> | list | show/validate/activate/rollback <change-id> | approve <change-id> <candidate-hash> | run <input.json>');
  process.umask(0o077);
  const root = resolve(directory); mkdirSync(root, { recursive: true, mode: 0o700 });
  const stats = statSync(root);
  if (process.platform === 'linux' && (stats.uid !== process.getuid() || (stats.mode & 0o077))) throw new Error('SUPERVISOR_DIRECTORY_MUST_BE_PRIVATE');
  release = acquireWorkspaceLock(root);
  const runner = new RootlessSandbox({ dockerPath: process.env.EMERGENTINC_DOCKER_PATH ?? '/usr/bin/docker',
    socket: `unix:///run/user/${process.getuid?.() ?? -1}/docker.sock`, image: process.env.EMERGENTINC_SANDBOX_IMAGE ?? '' });
  supervisor = new AutomationSupervisor(join(root, 'changes.sqlite3'), runner, true);
  if (['validate','activate','run'].includes(action)) await supervisor.recover();
  let result;
  if (action === 'submit') result = supervisor.submit(JSON.parse(readFileSync(value, 'utf8')));
  else if (action === 'list') result = supervisor.list();
  else if (action === 'show') result = supervisor.get(value);
  else if (action === 'validate') result = await supervisor.validate(value);
  else if (action === 'approve') result = supervisor.approve(value, approvalHash);
  else if (action === 'activate') result = await supervisor.activate(value);
  else if (action === 'run') result = await supervisor.run(JSON.parse(readFileSync(value, 'utf8')));
  else result = supervisor.rollback(value, 'Owner requested rollback through trusted maintenance channel');
  console.log(JSON.stringify(result, null, 2));
} catch (e) { console.error(e.message); process.exitCode = 1; }
finally { supervisor?.close(); release?.(); }
