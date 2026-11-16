import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { VerdictError } from '@verdictagent/core';

export type Resolver = (host: string) => Promise<string[]>;

const defaultResolver: Resolver = async (host) => (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);

function v4ToInt(ip: string) {
  return ip.split('.').reduce((a, p) => (a << 8) + Number(p), 0) >>> 0;
}
const inV4 = (ip: string, cidr: string) => {
  const [base, bits] = cidr.split('/');
  const mask = Number(bits) === 0 ? 0 : (~0 << (32 - Number(bits))) >>> 0;
  return (v4ToInt(ip) & mask) === (v4ToInt(base!) & mask);
};
const BLOCKED_V4 = ['0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12', '192.0.0.0/24', '192.0.2.0/24', '192.168.0.0/16', '198.18.0.0/15', '198.51.100.0/24', '203.0.113.0/24', '224.0.0.0/4', '240.0.0.0/4'];

/** True when the address must never be fetched by the server (loopback, private, link-local, metadata, multicast…). */
export function isBlockedIp(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return BLOCKED_V4.some((c) => inV4(ip, c));
  if (kind === 6) {
    const x = ip.toLowerCase();
    const mapped = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isBlockedIp(mapped[1]!);
    return x === '::' || x === '::1' || /^f[cd]/.test(x) || /^fe[89ab]/.test(x) || /^ff/.test(x) || x.startsWith('64:ff9b:') || x.startsWith('2001:db8');
  }
  return true;
}

const unsafe = (url: string, why: string) =>
  new VerdictError('UNSAFE_URL', `refusing to call ${url}: ${why}`, false, 'pakai URL https publik (bukan localhost, IP privat, atau nama host internal)', 400);

/**
 * SSRF guard for every server-side fetch to a caller-supplied URL (webhooks, MCP probes).
 * Requires https (http only when allowInsecure), no credentials, and every resolved IP public.
 */
export async function assertPublicUrl(raw: string, o: { resolve?: Resolver; allowInsecure?: boolean } = {}): Promise<URL> {
  let u: URL;
  try { u = new URL(raw); } catch { throw unsafe(raw, 'not a valid URL'); }
  if (u.protocol !== 'https:' && !(o.allowInsecure && u.protocol === 'http:')) throw unsafe(raw, 'only https is allowed');
  if (u.username || u.password) throw unsafe(raw, 'credentials in URL are not allowed');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local') || !host.includes('.') && !isIP(host)) {
    throw unsafe(raw, 'internal host name');
  }
  let ips: string[];
  if (isIP(host)) ips = [host];
  else {
    try { ips = await (o.resolve ?? defaultResolver)(host); } catch { throw unsafe(raw, 'host does not resolve'); }
  }
  if (!ips.length || ips.some(isBlockedIp)) throw unsafe(raw, 'resolves to a private or reserved address');
  return u;
}

/** fetch that refuses redirects (a public URL could 30x to an internal one) and caps the body. */
export async function guardedFetch(url: string, init: RequestInit & { maxBytes?: number; timeoutMs?: number } = {}): Promise<{ status: number; ok: boolean; text: string }> {
  const r = await fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(init.timeoutMs ?? 4000) });
  const max = init.maxBytes ?? 256 * 1024;
  const reader = r.body?.getReader();
  let text = '';
  let size = 0;
  if (reader) {
    const dec = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) { await reader.cancel(); break; }
      text += dec.decode(value, { stream: true });
    }
  }
  return { status: r.status, ok: r.status >= 200 && r.status < 300, text };
}
