import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * SSRF-safe outbound fetch for user-supplied URLs (calendar feeds, webhooks).
 * Only http(s), no credentials in URLs, and every resolved address must be public.
 * Redirects are followed manually so each hop is re-validated.
 */

function isPrivate(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v === '::1' || v === '::' || v.startsWith('fe80:') || v.startsWith('fc') || v.startsWith('fd')) return true;
    if (v.startsWith('::ffff:')) return isPrivate(v.slice(7));
    return false;
  }
  const [a, b] = ip.split('.').map(Number) as [number, number];
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

export class UnsafeUrlError extends Error {}

export async function assertPublicUrl(raw: string, allowPrivate = false): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw.replace(/^webcals?:\/\//i, 'https://'));
  } catch {
    throw new UnsafeUrlError('Invalid URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new UnsafeUrlError('Only http(s) URLs are allowed');
  if (url.username || url.password) throw new UnsafeUrlError('Credentials in URLs are not allowed');
  if (allowPrivate) return url;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((r) => r.address);
  if (!addresses.length || addresses.some(isPrivate)) throw new UnsafeUrlError('That address is not reachable from Remindora');
  return url;
}

export async function safeFetch(raw: string, init: RequestInit & { maxBytes?: number; timeoutMs?: number; allowPrivate?: boolean } = {}): Promise<{ status: number; text: string }> {
  const { maxBytes = 5 * 1024 * 1024, timeoutMs = 15_000, allowPrivate = false, ...rest } = init;
  let current = raw;
  for (let hop = 0; hop < 5; hop++) {
    const url = await assertPublicUrl(current, allowPrivate);
    const res = await fetch(url, { ...rest, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location')!, url).toString();
      continue;
    }
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > maxBytes) {
          await reader.cancel();
          throw new UnsafeUrlError('Response too large');
        }
        chunks.push(value);
      }
    }
    return { status: res.status, text: Buffer.concat(chunks).toString('utf8') };
  }
  throw new UnsafeUrlError('Too many redirects');
}
