export interface RecoveryConfig {
  origin: string;
  host: string;
  port: number;
  secret: string;
  secureCookies: boolean;
  bodyOrigin: string;
}

function originOnly(value: string) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw new Error('RECOVERY_ORIGIN_INVALID');
  return url;
}

/** Separate Owner credential; never inherit the mutable application's session or .env. */
export function recoveryConfig(env: NodeJS.ProcessEnv = process.env): RecoveryConfig {
  const url = originOnly(env.EMERGENTINC_RECOVERY_ORIGIN ?? 'http://localhost:8766');
  const body = originOnly(env.EMERGENTINC_BODY_ORIGIN ?? 'http://127.0.0.1:8765');
  const secret = env.EMERGENTINC_RECOVERY_SECRET ?? '';
  if (secret.length < 32 || secret.length > 1024) throw new Error('RECOVERY_SECRET_REQUIRED_MIN_32_CHARS');
  if (url.hostname === body.hostname) throw new Error('RECOVERY_BODY_COOKIE_HOST_MUST_DIFFER');
  const secureCookies = url.protocol === 'https:';
  const host = env.EMERGENTINC_RECOVERY_HOST ?? '127.0.0.1';
  if (!secureCookies && (![host, url.hostname].every(value => ['localhost', '127.0.0.1', '[::1]', '::1'].includes(value))))
    throw new Error('RECOVERY_HTTP_REQUIRES_LOOPBACK');
  const port = Number(env.EMERGENTINC_RECOVERY_PORT ?? (url.port || (secureCookies ? 443 : 80)));
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('RECOVERY_PORT_INVALID');
  return { origin: url.origin, host, port,
    secret, secureCookies, bodyOrigin: body.origin };
}
