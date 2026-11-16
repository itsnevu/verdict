import type { DataSource, LaunchMeta, SourceResult } from '../types.js';
import { NonRetryable, incomplete, nowIso, withRetry } from './retry.js';

export interface BasedBotOpts {
  baseUrl?: string;
  /** path template, e.g. "/v1/tokens/{address}" */
  launchPath?: string;
  /** set only after the response schema has been checked against real data */
  schemaVerified?: boolean;
  fetch?: typeof fetch;
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const pick = (o: Record<string, unknown>, keys: string[]) => { for (const k of keys) if (o[k] !== undefined) return o[k]; return undefined; };

/**
 * BasedBot launch metadata. The public schema is not documented, so the parser is
 * defensive and every result stays `complete: false` until `schemaVerified` is set.
 */
export class BasedBotSource implements DataSource {
  readonly name = 'basedbot';
  readonly supports = ['getLaunchMeta'] as const;
  constructor(private o: BasedBotOpts = {}) {}

  async getLaunchMeta(address: string): Promise<SourceResult<LaunchMeta>> {
    if (!this.o.baseUrl || !this.o.launchPath) return incomplete(this.name, 'BASEDBOT_BASE_URL / BASEDBOT_LAUNCH_PATH not configured');
    const f = this.o.fetch ?? fetch;
    const url = this.o.baseUrl.replace(/\/$/, '') + this.o.launchPath.replace('{address}', address);
    try {
      const body = await withRetry(async (signal) => {
        const r = await f(url, { signal, headers: { accept: 'application/json' } });
        if (r.status >= 400 && r.status < 500) throw new NonRetryable(`basedbot ${r.status}`);
        if (!r.ok) throw new Error(`basedbot ${r.status}`);
        return (await r.json()) as unknown;
      });
      const data = parseBasedBot(body);
      if (!data) return incomplete(this.name, 'response did not contain recognisable launch fields');
      return { data, fetchedAt: nowIso(), source: this.name, complete: !!this.o.schemaVerified, ...(this.o.schemaVerified ? {} : { error: 'schema unverified' }) };
    } catch (e) {
      return incomplete(this.name, (e as Error).message);
    }
  }

  async getMarket() { return incomplete<never>(this.name, 'not provided by basedbot'); }
  async getHolders() { return incomplete<never>(this.name, 'not provided by basedbot'); }
  async getEarlyBuyers() { return incomplete<never>(this.name, 'not provided by basedbot'); }
  async getFundingSource() { return incomplete<never>(this.name, 'not provided by basedbot'); }
  async getContractFlags() { return incomplete<never>(this.name, 'not provided by basedbot'); }
}

export function parseBasedBot(body: unknown): LaunchMeta | null {
  if (!body || typeof body !== 'object') return null;
  const root = body as Record<string, unknown>;
  const o = (root.data && typeof root.data === 'object' ? root.data : root) as Record<string, unknown>;
  const created = pick(o, ['createdAt', 'created_at', 'launchedAt', 'launched_at', 'timestamp']);
  const dev = str(pick(o, ['creator', 'deployer', 'dev', 'devAddress', 'owner']));
  let createdAt: string | null = null;
  if (typeof created === 'number') createdAt = new Date(created < 1e12 ? created * 1000 : created).toISOString();
  else if (typeof created === 'string' && !Number.isNaN(Date.parse(created))) createdAt = new Date(created).toISOString();
  const devAddress = dev && /^0x[0-9a-fA-F]{40}$/.test(dev) ? dev.toLowerCase() : null;
  if (!createdAt && !devAddress) return null;
  return { createdAt, devAddress, launchpad: 'basedbot' };
}
