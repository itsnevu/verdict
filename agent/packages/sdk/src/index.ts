import type { Envelope, ErrorEnvelope, Verdict } from '@verdictagent/core';

export interface ClientOpts {
  baseUrl?: string;
  agentId?: string;
  apiKey?: string;
  fetch?: typeof fetch;
}

export class VerdictApiError extends Error {
  constructor(public readonly body: ErrorEnvelope, public readonly status: number) {
    super(`${body.error.code}: ${body.error.message} (fix: ${body.error.fix})`);
  }
  get retryable() { return this.body.error.retryable; }
}

/** Thin HTTP client for verdictagent. Every method returns the full envelope. */
export class VerdictClient {
  private base: string;
  private f: typeof fetch;
  constructor(private o: ClientOpts = {}) {
    this.base = (o.baseUrl ?? 'https://verdictagent.xyz').replace(/\/$/, '');
    this.f = o.fetch ?? fetch;
  }

  private async req<T>(path: string, init: RequestInit = {}): Promise<Envelope<T>> {
    const headers: Record<string, string> = { accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}) };
    if (this.o.agentId) headers['x-agent-id'] = this.o.agentId;
    if (this.o.apiKey) headers.authorization = `Bearer ${this.o.apiKey}`;
    const r = await this.f(this.base + path, { ...init, headers: { ...headers, ...(init.headers as Record<string, string> | undefined) } });
    const body = (await r.json()) as Envelope<T> | ErrorEnvelope;
    if ('error' in body) throw new VerdictApiError(body, r.status);
    return body;
  }

  scan(address: string) { return this.req<Verdict>(`/v1/scan/${address.toLowerCase()}`); }
  brief(address: string) { return this.req<{ address: string }>(`/v1/brief/${address.toLowerCase()}`); }
  tokens(q: { label?: string; minScore?: number; limit?: number } = {}) {
    const s = new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]));
    return this.req<unknown[]>(`/v1/tokens${s.size ? `?${s}` : ''}`);
  }
  history(address: string, hours = 24) { return this.req<unknown[]>(`/v1/tokens/${address.toLowerCase()}/history?hours=${hours}`); }
  explain(address: string, signal?: string) { return this.req<unknown>(`/v1/explain/${address.toLowerCase()}${signal ? `?signal=${signal}` : ''}`); }
  watch(a: { address: string; webhookUrl?: string; ttlHours?: number; idempotencyKey: string }) {
    return this.req<unknown>('/v1/watch', { method: 'POST', body: JSON.stringify(a) });
  }
  agents() { return this.req<unknown>('/v1/agents'); }
  health() { return this.req<unknown>('/v1/health'); }
}
