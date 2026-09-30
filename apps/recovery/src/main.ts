import { recoveryConfig } from './config.js';
import { createRecoveryServer } from './server.js';

try {
  const config = recoveryConfig();
  const server = createRecoveryServer(config);
  server.on('error', () => { console.error('RECOVERY_LISTEN_FAILED'); process.exitCode = 1; });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { server.close(); server.closeAllConnections(); });
  server.listen(config.port, config.host, () => {
    console.log(JSON.stringify({ service: 'recovery', origin: config.origin, path: '/GENE' }));
    process.send?.({ ready: true });
  });
} catch (error) { console.error(error instanceof Error ? error.message : 'RECOVERY_START_FAILED'); process.exitCode = 1; }
