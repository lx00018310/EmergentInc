import { createHash } from 'node:crypto';

/** JSON object field order is not part of a receipt's identity; array order is. */
export function companyFactHash(value: unknown): string {
  const canonical=(v:any):any=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(key=>[key,canonical(v[key])])):v;
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
