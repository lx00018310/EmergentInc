import { createServer, Server } from 'node:net';
import { randomInt } from 'node:crypto';

// Windows can assign port 0 a port blocked by Fetch. The dynamic range avoids those ports.
export async function listenTestHttp(server: Server): Promise<number> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const port = randomInt(49152, 65536);
    try {
      await new Promise<void>((done, reject) => {
        const error = (value: Error) => reject(value);
        server.once('error', error);
        server.listen(port, '127.0.0.1', () => { server.removeListener('error', error); done(); });
      });
      return port;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error; }
  }
  throw new Error('TEST_HTTP_PORT_UNAVAILABLE');
}

export async function reserveTestHttpPort(): Promise<number> {
  const server = createServer(), port = await listenTestHttp(server);
  await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
  return port;
}
