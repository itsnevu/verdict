import type { SourceStatus, Verdict } from '../types.js';
import { ENGINE_VERSION } from '../score/engine.js';
import { isTool, type ToolName } from './tools.js';

export interface Meta {
  engineVersion: string;
  fetchedAt: string;
  sources: SourceStatus[];
  confidence: number | null;
  costUnits: number;
  degraded: boolean;
  agentId?: string | null;
}

export interface NextAction {
  tool: ToolName;
  reason: string;
  args: Record<string, unknown>;
}

export interface Envelope<T> {
  data: T;
  brief: string | null;
  _meta: Meta;
  nextActions: NextAction[];
}

export interface ApiError {
  code: string;
  message: string;
  retryable: boolean;
  fix: string;
}

export interface ErrorEnvelope {
  error: ApiError;
  _meta: Meta;
  nextActions: NextAction[];
}

export class VerdictError extends Error {
  constructor(public readonly code: string, message: string, public readonly retryable: boolean, public readonly fix: string, public readonly status = 400) {
    super(message);
  }
  toJSON(): ApiError { return { code: this.code, message: this.message, retryable: this.retryable, fix: this.fix }; }
}

export const errors = {
  invalidAddress: (a: string) => new VerdictError('INVALID_ADDRESS', `"${a}" is not a 0x-prefixed 40-hex address`, false, 'kirim address 0x + 40 hex; panggil verdict_list_runners dulu untuk dapat address valid', 400),
  notFound: (a: string) => new VerdictError('TOKEN_NOT_FOUND', `no market data for ${a}`, true, 'cek address di chain yang benar, atau panggil verdict_list_runners untuk token yang dikenal', 404),
  insufficient: (a: string) => new VerdictError('INSUFFICIENT_DATA', `no signal could be computed for ${a}`, true, 'coba lagi dalam 60 detik; sumber data sedang tidak lengkap', 503),
  scope: (scope: string) => new VerdictError('SCOPE_REQUIRED', `this tool needs the "${scope}" scope`, false, `minta scope ${scope}, lalu kirim header Authorization: Bearer <key>`, 403),
  idempotency: () => new VerdictError('IDEMPOTENCY_KEY_REQUIRED', 'write tools need an idempotencyKey', false, 'tambahkan idempotencyKey unik (mis. UUID) ke argumen', 400),
  idemConflict: () => new VerdictError('IDEMPOTENCY_CONFLICT', 'this idempotencyKey was used with different arguments', false, 'pakai idempotencyKey baru untuk argumen yang berbeda', 409),
  budget: () => new VerdictError('BUDGET_EXHAUSTED', 'daily cost-unit quota used up', true, 'panggil verdict_budget untuk melihat reset; pakai verdict_agent_brief (0.2 unit) untuk menghemat', 429),
  rateLimited: (resetS: number) => new VerdictError('RATE_LIMITED', 'too many requests', true, `tunggu ${resetS} detik, lalu ulangi`, 429),
  validation: (msg: string) => new VerdictError('INVALID_ARGUMENTS', msg, false, 'perbaiki argumen sesuai inputSchema di tools/list', 400),
  unknownTool: (n: string) => new VerdictError('UNKNOWN_TOOL', `no tool named ${n}`, false, 'panggil tools/list untuk daftar tool yang ada', 404),
  notFoundGeneric: (what: string) => new VerdictError('NOT_FOUND', `${what} not found`, false, 'cek id atau panggil verdict_registry_search', 404),
  internal: () => new VerdictError('INTERNAL', 'unexpected failure, nothing was written', true, 'ulangi sekali; kalau tetap gagal laporkan dengan _meta.fetchedAt', 503),
};

export const ADDR_RE = /^0x[0-9a-f]{40}$/;
export function normAddress(a: unknown): string {
  const s = String(a ?? '').trim().toLowerCase();
  if (!ADDR_RE.test(s)) throw errors.invalidAddress(String(a));
  return s;
}

export function meta(p: Partial<Meta> & { costUnits: number }): Meta {
  const sources = p.sources ?? [];
  return {
    engineVersion: ENGINE_VERSION,
    fetchedAt: p.fetchedAt ?? new Date().toISOString(),
    sources,
    confidence: p.confidence ?? null,
    costUnits: p.costUnits,
    degraded: p.degraded ?? sources.some((s) => !s.complete),
    agentId: p.agentId ?? null,
  };
}

/** Throws if any nextAction references a tool that does not exist. */
export function checkActions(a: NextAction[]): NextAction[] {
  for (const x of a) if (!isTool(x.tool)) throw new Error(`nextActions references unknown tool ${x.tool}`);
  return a;
}

/** Valid follow-ups after a scan, chosen from the verdict. */
export function scanNextActions(v: Verdict): NextAction[] {
  const out: NextAction[] = [];
  const address = v.address;
  if (v.label === 'HEALTHY' || v.label === 'WATCH') out.push({ tool: 'verdict_watch_token', reason: 'monitor for decay instead of re-scanning', args: { address, ttlHours: 24, idempotencyKey: `watch-${address}` } });
  if (v.flags.length || v.overrides.length) out.push({ tool: 'verdict_explain_score', reason: 'see which signal drove the score', args: { address, signal: v.flags.includes('THIN') ? 'liq_ratio' : undefined } });
  out.push({ tool: 'verdict_token_history', reason: 'check the direction over time', args: { address, hours: 24 } });
  if (v.label === 'DEAD' || v.label === 'COLLAPSING') out.push({ tool: 'verdict_list_runners', reason: 'find healthier alternatives', args: { label: 'HEALTHY', limit: 5 } });
  if (v.confidence < 0.5) out.push({ tool: 'verdict_scan_token', reason: 'retry once sources recover', args: { address } });
  return checkActions(out);
}
