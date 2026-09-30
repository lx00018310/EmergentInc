import { resolve, join } from 'node:path';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// No local-source fallback. The application user cannot read/write the separately installed trusted bundle.
if (process.platform !== 'linux' || process.getuid?.() !== 0) throw new Error('TRUSTED_ROOT_LINUX_REQUIRED');
const trustedRoot = '/opt/emergentinc-supervisor';
const stats = statSync(trustedRoot);
if (stats.uid !== 0 || stats.mode & 0o022 || realpathSync(trustedRoot) !== trustedRoot) throw new Error('ROOT_OF_TRUST_INSTALLATION_INVALID');
const { runEvolutionCli } = await import(pathToFileURL(join(trustedRoot, 'dist/cli.js')).href);
await runEvolutionCli(process.argv.slice(2));
