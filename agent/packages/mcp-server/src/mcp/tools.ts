import { z } from 'zod';
import {
  SIGNALS, TOOLS, VerdictError, inputsHash, toOracleVerdict, checkActions, errors, meta, normAddress, scanNextActions, trustScore,
  type Envelope, type ErrorEnvelope, type Label, type NextAction, type ToolName,
} from '@verdictagent/core';
import { sha, type VerdictService } from '../service.js';
import type { Endpoint } from '../store/types.js';
import { SKILL_DEFS } from './skill-tools.js';

export interface CallCtx {
  /** self-declared (X-Agent-Id / _meta.agent_id); used for logs only, never for quota or ownership */
  agentId: string;
  apiKey: string | null;
  ip?: string;
}

/** sha256 of the API key; what ownership and authenticated quota are bound to */
export const keyHash = (apiKey: string) => sha(`verdict-key:${apiKey}`);
/** quota identity: the API key when present, else the client IP (headers cannot reset it) */
export const quotaKeyOf = (c: CallCtx) => (c.apiKey ? `key:${keyHash(c.apiKey).slice(0, 24)}` : `ip:${c.ip ?? c.agentId}`);

const addr = z.string().describe('token contract address, 0x + 40 hex (any case)');
const LABELS = ['HEALTHY', 'WATCH', 'DECAYING', 'COLLAPSING', 'DEAD'] as const;
const idem = z.string().min(8).max(128).describe('unique key per intended write; retries with the same key and args return the original result');

interface ToolDef<S extends z.ZodTypeAny> {
  name: ToolName;
  description: string;
  input: S;
  cost: (args: z.infer<S>) => number;
  scope?: string;
  run(args: z.infer<S>, ctx: CallCtx, svc: VerdictService): Promise<Omit<Envelope<unknown>, '_meta'> & { _meta?: Partial<Envelope<unknown>['_meta']> }>;
}
const def = <S extends z.ZodTypeAny>(d: ToolDef<S>) => d;

const scanEnvelope = (r: Awaited<ReturnType<VerdictService['scan']>>) => ({
  _meta: { fetchedAt: r.inputs.now, sources: r.sources, confidence: r.verdict.confidence, degraded: r.sources.some((s) => !s.complete) },
});

export const TOOL_DEFS = [
  def({
    name: 'verdict_scan_token',
    description:
      'Judge whether a token is still alive before you act on it. Returns a deterministic score 0-100, label (HEALTHY, WATCH, DECAYING, COLLAPSING, DEAD), confidence, flags and the full signal breakdown. ' +
      'Use once right before deciding to enter or hold. Do NOT call it repeatedly to monitor a token; use verdict_watch_token instead. ' +
      'If you only need a sentence to forward to a human, use verdict_agent_brief (0.2 units). Cost: 1 unit. Results are cached 45s.',
    input: z.object({ address: addr }),
    cost: () => TOOLS.verdict_scan_token.cost,
    async run(a, _c, svc) {
      const r = await svc.scan(normAddress(a.address));
      const onchain = await readOnchain(svc, r.verdict.address, r.inputs);
      const next = scanNextActions(r.verdict);
      if (onchain && !onchain.matchesCurrent && svc.oracle?.writable) next.push({ tool: 'verdict_attest_token', reason: 'record this verdict onchain so other agents and contracts can verify it', args: { address: r.verdict.address, idempotencyKey: `attest-${r.verdict.address}-${Date.parse(r.inputs.now)}` } });
      return { data: { ...r.verdict, cached: r.cached, ...(onchain ? { onchain } : {}) }, brief: r.brief, nextActions: next, ...scanEnvelope(r) };
    },
  }),
  def({
    name: 'verdict_agent_brief',
    description:
      'Get only the one-paragraph verdict for a token, ready to pass to a human. Use when you are short on context or cost. ' +
      'Do NOT use when you need the numbers to decide; use verdict_scan_token. Cost: 0.2 units.',
    input: z.object({ address: addr }),
    cost: () => TOOLS.verdict_agent_brief.cost,
    async run(a, _c, svc) {
      const r = await svc.scan(normAddress(a.address));
      return { data: { address: r.verdict.address, label: r.verdict.label, score: r.verdict.score }, brief: r.brief, nextActions: checkActions([{ tool: 'verdict_scan_token', reason: 'get the full breakdown', args: { address: r.verdict.address } }]), ...scanEnvelope(r) };
    },
  }),
  def({
    name: 'verdict_list_runners',
    description:
      'List recently judged tokens ranked by score, optionally filtered by label or minimum score. Use to discover candidates or find healthier alternatives. ' +
      'Only returns tokens that were already scanned; it does not search the whole chain. Cost: 0.5 units.',
    input: z.object({ label: z.enum(LABELS).optional(), minScore: z.number().min(0).max(100).optional(), limit: z.number().int().min(1).max(50).default(10) }),
    cost: () => TOOLS.verdict_list_runners.cost,
    async run(a, _c, svc) {
      const rows = await svc.store.latestScores({ label: a.label as Label | undefined, minScore: a.minScore, limit: a.limit });
      const data = rows.map((r) => ({ address: r.address, symbol: r.symbol, score: r.score, label: r.label, confidence: r.confidence, flags: r.flags, scannedAt: r.ts }));
      const top = data[0];
      return {
        data,
        brief: data.length ? `${data.length} token terdaftar${a.label ? ` dengan label ${a.label}` : ''}; teratas ${(top!.symbol ?? top!.address).toUpperCase()} skor ${top!.score} (${top!.label}).` : 'Belum ada token yang cocok dengan filter ini.',
        nextActions: checkActions(top ? [{ tool: 'verdict_scan_token', reason: 'refresh the top candidate before acting', args: { address: top.address } }] : []),
        _meta: { confidence: null },
      };
    },
  }),
  def({
    name: 'verdict_token_history',
    description:
      'Return the stored score timeline of one token for the last N hours (1-720), oldest first. Use to see direction (decaying or recovering). ' +
      'Does not fetch fresh data; call verdict_scan_token for the current state. Cost: 0.5 units.',
    input: z.object({ address: addr, hours: z.number().int().min(1).max(720).default(24) }),
    cost: () => TOOLS.verdict_token_history.cost,
    async run(a, _c, svc) {
      const address = normAddress(a.address);
      const since = new Date(svc.now().getTime() - a.hours * 3_600_000).toISOString();
      const rows = await svc.store.history(address, since);
      const data = rows.map((r) => ({ ts: r.ts, score: r.score, label: r.label, confidence: r.confidence, flags: r.flags }));
      const f = data[0], l = data[data.length - 1];
      const brief = !f || !l ? `Belum ada riwayat untuk ${address} dalam ${a.hours} jam terakhir.`
        : `${data.length} putusan dalam ${a.hours} jam: skor ${f.score} (${f.label}) menjadi ${l.score} (${l.label}), ${(l.score ?? 0) >= (f.score ?? 0) ? 'naik' : 'turun'} ${Math.abs((l.score ?? 0) - (f.score ?? 0))} poin.`;
      return { data, brief, nextActions: checkActions([{ tool: data.length ? 'verdict_watch_token' : 'verdict_scan_token', reason: data.length ? 'get alerted on the next drop' : 'create the first data point', args: data.length ? { address, ttlHours: 24, idempotencyKey: `watch-${address}` } : { address } }]), _meta: { confidence: null } };
    },
  }),
  def({
    name: 'verdict_explain_score',
    description:
      'Explain how a token\'s score was built: per-signal raw value, signal score, weight, contribution, the normalisation points, and every override applied. ' +
      'Pass `signal` to focus on one signal. Use when a score surprises you or before overruling it. Cost: 0.5 units.',
    input: z.object({ address: addr, signal: z.enum(SIGNALS.map((s) => s.key) as [string, ...string[]]).optional() }),
    cost: () => TOOLS.verdict_explain_score.cost,
    async run(a, _c, svc) {
      const r = await svc.scan(normAddress(a.address));
      const rows = r.verdict.breakdown.filter((b) => !a.signal || b.signal === a.signal).map((b) => {
        const s = SIGNALS.find((x) => x.key === b.signal)!;
        return { ...b, describe: s.describe, points: s.points };
      });
      const top = [...r.verdict.breakdown].filter((b) => b.status === 'ok').sort((x, y) => x.contribution - y.contribution)[0];
      const brief = a.signal
        ? `${a.signal}: mentah ${rows[0]?.raw ?? 'tidak tersedia'}, skor sinyal ${rows[0]?.score ?? '-'}, kontribusi ${rows[0]?.contribution ?? 0} dari skor dasar ${r.verdict.baseScore}.`
        : `Skor dasar ${r.verdict.baseScore}, akhir ${r.verdict.score}. Kontribusi terlemah ${top?.signal ?? '-'} (${top?.contribution ?? 0}). ${r.verdict.overrides.length} override diterapkan.`;
      return { data: { address: r.verdict.address, score: r.verdict.score, baseScore: r.verdict.baseScore, breakdown: rows, overrides: r.verdict.overrides, missingSignals: r.verdict.missingSignals }, brief, nextActions: checkActions([{ tool: 'verdict_token_history', reason: 'see whether this signal is getting worse', args: { address: r.verdict.address, hours: 24 } }]), ...scanEnvelope(r) };
    },
  }),
  def({
    name: 'verdict_compare_tokens',
    description:
      'Scan 2-5 tokens and rank them by score in one call. Use when choosing between candidates. Cost: 1 unit per address.',
    input: z.object({ addresses: z.array(addr).min(2).max(5) }),
    cost: (a) => new Set(a.addresses.map((x: string) => x.toLowerCase())).size * TOOLS.verdict_compare_tokens.cost,
    async run(a, _c, svc) {
      const list = [...new Set(a.addresses.map(normAddress))];
      const res = await Promise.all(list.map((x) => svc.scan(x)));
      const data = res.map((r) => ({ address: r.verdict.address, symbol: r.verdict.symbol, score: r.verdict.score, label: r.verdict.label, confidence: r.verdict.confidence, flags: r.verdict.flags }))
        .sort((x, y) => (y.score ?? -1) - (x.score ?? -1));
      const best = data[0]!;
      const sources = res.flatMap((r) => r.sources);
      return {
        data,
        brief: `${data.length} token dibandingkan. Terbaik ${(best.symbol ?? best.address).toUpperCase()} skor ${best.score} (${best.label}); terburuk ${(data[data.length - 1]!.symbol ?? '').toUpperCase() || data[data.length - 1]!.address} skor ${data[data.length - 1]!.score}.`,
        nextActions: checkActions([{ tool: 'verdict_explain_score', reason: 'check why the winner scores higher', args: { address: best.address } }]),
        _meta: { sources, confidence: Math.min(...res.map((r) => r.verdict.confidence)), degraded: sources.some((s) => !s.complete) },
      };
    },
  }),
  def({
    name: 'verdict_budget',
    description: 'Return your remaining cost units for today (UTC) and when the quota resets. Free. Call before a batch of scans.',
    input: z.object({}),
    cost: () => 0,
    async run(_a, c, svc) {
      const b = await svc.budget(quotaKeyOf(c));
      return { data: b, brief: `Sisa ${b.remainingUnits} dari ${b.quotaUnits} unit, reset ${b.resetsAt}.`, nextActions: [], _meta: { confidence: null } };
    },
  }),
  def({
    name: 'verdict_watch_token',
    description:
      'Monitor a token and get alerted (optional webhook) when it decays: score drops >20 in 1h, PUMP_EXHAUSTED appears, dev share rises >10 points, or liquidity falls >40% in 1h. ' +
      'Use instead of polling verdict_scan_token. Requires scope "watch" and an idempotencyKey. Cost: 1 unit.',
    input: z.object({ address: addr, webhookUrl: z.string().url().optional(), ttlHours: z.number().int().min(1).max(168).default(24), idempotencyKey: idem }),
    cost: () => TOOLS.verdict_watch_token.cost,
    scope: 'watch',
    async run(a, c, svc) {
      const address = normAddress(a.address);
      const argsHash = sha({ address, webhookUrl: a.webhookUrl ?? null, ttlHours: a.ttlHours });
      const owner = keyHash(c.apiKey!);
      const prev = await svc.store.getWatchByKey(owner, a.idempotencyKey);
      if (prev) {
        if (prev.argsHash !== argsHash) throw errors.idemConflict();
        return { data: { ...prev, replayed: true }, brief: `Pantauan ${address} sudah aktif sampai ${prev.watchedUntil} (permintaan ulang, tidak dibuat dua kali).`, nextActions: checkActions([{ tool: 'verdict_token_history', reason: 'see what the watch has recorded', args: { address, hours: 24 } }]), _meta: { confidence: null } };
      }
      if (a.webhookUrl) await svc.checkUrl(a.webhookUrl);
      const r = await svc.scan(address);
      const now = svc.now().getTime();
      const stagger = parseInt(sha(address).slice(0, 6), 16) % 60_000;
      const w = { id: sha(`${owner}:${address}`), ownerKey: owner, address, webhookUrl: a.webhookUrl ?? null, watchedUntil: new Date(now + a.ttlHours * 3_600_000).toISOString(), nextPollAt: new Date(now + 60_000 + stagger).toISOString(), agentId: c.agentId, idempotencyKey: a.idempotencyKey, argsHash };
      await svc.store.upsertWatch(w);
      return { data: { ...w, replayed: false, baseline: { score: r.verdict.score, label: r.verdict.label } }, brief: `Memantau ${(r.verdict.symbol ?? address).toUpperCase()} (skor awal ${r.verdict.score}, ${r.verdict.label}) selama ${a.ttlHours} jam.`, nextActions: checkActions([{ tool: 'verdict_token_history', reason: 'read the recorded timeline later', args: { address, hours: a.ttlHours } }]), ...scanEnvelope(r) };
    },
  }),
  def({
    name: 'verdict_register_mcp',
    description:
      'Register a third-party MCP endpoint in the verdict registry. It is probed (reachable, TLS, live tool list) and given a trust score. ' +
      'Declare every tool with readOnly true/false and the contract addresses write tools touch; write tools without targets cap trust at 40. ' +
      'Requires scope "registry" and an idempotencyKey. Cost: 1 unit.',
    input: z.object({
      url: z.string().url(),
      declaredTools: z.array(z.object({ name: z.string().min(1), description: z.string().optional(), readOnly: z.boolean().optional(), contractTargets: z.array(z.string()).optional() })).min(1).max(100),
      contractTargets: z.array(z.string()).default([]),
      idempotencyKey: idem,
    }),
    cost: () => TOOLS.verdict_register_mcp.cost,
    scope: 'registry',
    async run(a, c, svc) {
      const targets = a.contractTargets.map(normAddress);
      const tools = a.declaredTools.map((t) => ({ ...t, ...(t.contractTargets ? { contractTargets: t.contractTargets.map(normAddress) } : {}) }));
      const argsHash = sha({ url: a.url, tools, targets });
      const owner = keyHash(c.apiKey!);
      const prev = await svc.store.getEndpointByKey(owner, a.idempotencyKey);
      if (prev) {
        if (prev.argsHash !== argsHash) throw errors.idemConflict();
        return { data: { ...prev, replayed: true }, brief: `${prev.url} sudah terdaftar (trust ${prev.trust}); permintaan ulang tidak membuat entri baru.`, nextActions: checkActions([{ tool: 'verdict_registry_check', reason: 're-probe the endpoint', args: { idOrUrl: prev.id } }]), _meta: { confidence: null } };
      }
      await svc.checkUrl(a.url);
      const existing = await svc.store.getEndpoint(a.url);
      if (existing && existing.ownerKey !== owner) {
        throw new VerdictError('ALREADY_REGISTERED', `${a.url} is registered by another key`, false, 'hanya pemilik yang bisa mengubah entri ini; pakai verdict_registry_check untuk membaca trust-nya', 409);
      }
      const probe = await svc.probe(a.url);
      const e: Endpoint = { id: existing?.id ?? `mcp_${sha(a.url).slice(0, 12)}`, url: a.url, declaredTools: tools, contractTargets: targets, registeredAt: existing?.registeredAt ?? svc.nowIso(), ownerAgentId: c.agentId, ownerKey: owner, probe, trust: null, idempotencyKey: a.idempotencyKey, argsHash };
      const t = trustScore({ declaredTools: tools, contractTargets: targets, probe, registeredAt: e.registeredAt, now: svc.nowIso() });
      e.trust = t.trust;
      await svc.store.saveEndpoint(e);
      return { data: { ...e, trustParts: t.parts, capped: t.capped, replayed: false }, brief: `${a.url} terdaftar dengan trust ${t.trust}${t.capped ? ' (dibatasi 40: tool write tanpa target kontrak)' : ''}; probe ${probe.reachable ? 'terjangkau' : 'gagal'}.`, nextActions: checkActions([{ tool: 'verdict_registry_search', reason: 'see how it ranks', args: { query: new URL(a.url).hostname } }]), _meta: { confidence: null } };
    },
  }),
  def({
    name: 'verdict_registry_search',
    description: 'Search registered third-party MCP endpoints by URL or tool name, ranked by trust. Use before connecting to an unknown MCP server. Cost: 0.2 units.',
    input: z.object({ query: z.string().max(200).optional(), minTrust: z.number().min(0).max(100).optional(), limit: z.number().int().min(1).max(50).default(10) }),
    cost: () => TOOLS.verdict_registry_search.cost,
    async run(a, _c, svc) {
      const rows = await svc.store.searchEndpoints({ query: a.query, minTrust: a.minTrust, limit: a.limit });
      const data = rows.map((e) => ({ id: e.id, url: e.url, trust: e.trust, tools: e.declaredTools.map((t) => ({ name: t.name, readOnly: t.readOnly ?? false })), registeredAt: e.registeredAt, lastProbe: e.probe?.checkedAt ?? null }));
      return { data, brief: data.length ? `${data.length} endpoint ditemukan; trust tertinggi ${data[0]!.url} (${data[0]!.trust}).` : 'Tidak ada endpoint yang cocok.', nextActions: checkActions(data[0] ? [{ tool: 'verdict_registry_check', reason: 're-probe before trusting it', args: { idOrUrl: data[0].id } }] : []), _meta: { confidence: null } };
    },
  }),
  def({
    name: 'verdict_registry_check',
    description: 'Re-probe one registered MCP endpoint (by id or URL) and recompute its trust score with the breakdown. Use right before you call that server. Cost: 1 unit.',
    input: z.object({ idOrUrl: z.string().min(3) }),
    cost: () => TOOLS.verdict_registry_check.cost,
    async run(a, _c, svc) {
      const e = await svc.store.getEndpoint(a.idOrUrl);
      if (!e) throw new VerdictError('NOT_FOUND', `no registered endpoint ${a.idOrUrl}`, false, 'panggil verdict_registry_search untuk id yang valid', 404);
      await svc.checkUrl(e.url);
      const probe = await svc.probe(e.url);
      const t = trustScore({ declaredTools: e.declaredTools, contractTargets: e.contractTargets, probe, registeredAt: e.registeredAt, now: svc.nowIso() });
      const next = { ...e, probe, trust: t.trust };
      await svc.store.saveEndpoint(next);
      const live = new Set(probe.liveTools ?? []);
      const undeclared = [...live].filter((n) => !e.declaredTools.some((d) => d.name === n));
      return {
        data: { id: e.id, url: e.url, trust: t.trust, trustParts: t.parts, capped: t.capped, probe, undeclaredTools: undeclared, readOnlyTools: e.declaredTools.filter((d) => d.readOnly === true).map((d) => d.name), writeTools: e.declaredTools.filter((d) => d.readOnly !== true).map((d) => d.name), contractTargets: e.contractTargets },
        brief: `${e.url} trust ${t.trust}; ${probe.reachable ? 'terjangkau' : 'tidak terjangkau'}, TLS ${probe.tlsValid ? 'valid' : 'tidak valid'}${undeclared.length ? `, ${undeclared.length} tool tidak dideklarasikan` : ''}.`,
        nextActions: checkActions([{ tool: 'verdict_registry_search', reason: 'compare with other endpoints', args: { minTrust: 60 } }]),
        _meta: { confidence: null },
      };
    },
  }),
] as const;

export const ATTEST_DEF = def({
  name: 'verdict_attest_token',
  description:
    'Write the current verdict for a token to the VerdictOracle contract on Robinhood Chain, so other agents and smart contracts can read and verify it ' +
    '(score, label, confidence, flags and a keccak256 commitment to the exact inputs). Use after verdict_scan_token when the verdict must be provable onchain. ' +
    'Do NOT call it to monitor; it costs gas. If the same inputs are already onchain it returns the existing record without a new transaction. ' +
    'Requires scope "attest" and an idempotencyKey. Cost: 2 units.',
  input: z.object({ address: addr, idempotencyKey: idem }),
  cost: () => TOOLS.verdict_attest_token.cost,
  scope: 'attest',
  async run(a, c, svc) {
    const o = svc.oracle;
    if (!o || !o.writable) throw new VerdictError('ORACLE_NOT_CONFIGURED', 'this server has no VerdictOracle attester configured', false, 'set ORACLE_ADDRESS and ATTESTER_PRIVATE_KEY on the server, or read verdicts with verdict_scan_token', 503);
    const address = normAddress(a.address);
    const idemKey = `attest:${keyHash(c.apiKey!)}:${a.idempotencyKey}`;
    const prior = await svc.cache.get<Record<string, unknown>>(idemKey);
    if (prior) return { data: { ...prior, replayed: true }, brief: `Putusan ${address} sudah dicatat onchain (permintaan ulang).`, nextActions: [], _meta: { confidence: null } };
    const r = await svc.scan(address);
    const block = await o.blockNumber();
    const payload = toOracleVerdict(r.verdict, r.inputs, block);
    if (!payload) throw errors.insufficient(address);
    const current = await o.read(address as `0x${string}`);
    let out: Record<string, unknown>;
    if (current.attested && current.inputsHash === payload.inputsHash) {
      out = { address, oracle: o.address, chainId: o.chainId, txHash: null, alreadyOnchain: true, inputsHash: payload.inputsHash, onchain: current };
    } else {
      const tx = await o.attest(address as `0x${string}`, payload);
      out = { address, oracle: o.address, chainId: o.chainId, txHash: tx.txHash, txUrl: o.txUrl(tx.txHash), blockNumber: tx.blockNumber.toString(), alreadyOnchain: false, inputsHash: payload.inputsHash, onchain: await o.read(address as `0x${string}`) };
    }
    await svc.cache.set(idemKey, out, 86_400);
    return {
      data: { ...out, replayed: false },
      brief: out.alreadyOnchain ? `Putusan ${(r.verdict.symbol ?? address).toUpperCase()} dengan input yang sama sudah ada onchain; tidak ada transaksi baru.` : `Putusan ${(r.verdict.symbol ?? address).toUpperCase()} skor ${r.verdict.score} (${r.verdict.label}) dicatat di Robinhood Chain, tx ${String(out.txHash).slice(0, 10)}….`,
      nextActions: checkActions([{ tool: 'verdict_scan_token', reason: 'read it back with the onchain field', args: { address } }]),
      ...scanEnvelope(r),
    };
  },
});

/** Onchain record for a token plus whether it commits to the inputs just scored. Never throws. */
async function readOnchain(svc: VerdictService, address: string, inputs: Parameters<typeof inputsHash>[0]) {
  if (!svc.oracle) return null;
  try {
    const v = await svc.oracle.read(address as `0x${string}`);
    return { oracle: svc.oracle.address, chainId: svc.oracle.chainId, ...v, matchesCurrent: v.attested && v.inputsHash === inputsHash(inputs) };
  } catch (e) {
    svc.log.warn('oracle_read_failed', { addr: address, err: (e as Error).message.split('\n')[0] });
    return { oracle: svc.oracle.address, chainId: svc.oracle.chainId, attested: false, error: 'oracle read failed', matchesCurrent: false };
  }
}

type AnyTool = (typeof TOOL_DEFS)[number] | typeof ATTEST_DEF | (typeof SKILL_DEFS)[number];
export const ALL_TOOLS: readonly AnyTool[] = [...TOOL_DEFS, ATTEST_DEF, ...SKILL_DEFS];
export const TOOL_MAP = new Map<string, AnyTool>(ALL_TOOLS.map((t) => [t.name, t]));

/** JSON Schema for tools/list (zod v4 built-in). */
export function toolList() {
  return ALL_TOOLS.map((t) => {
    const schema = z.toJSONSchema(t.input, { io: 'input' }) as Record<string, unknown>;
    delete schema.$schema;
    return {
      name: t.name,
      description: t.description,
      inputSchema: schema,
      annotations: { readOnlyHint: !TOOLS[t.name].write, idempotentHint: true, openWorldHint: true },
    };
  });
}

export type ToolOutcome = { ok: true; envelope: Envelope<unknown> } | { ok: false; status: number; envelope: ErrorEnvelope };

/** Validate → scope → budget → run → record. Never throws; failures become `{code,message,retryable,fix}`. */
export async function runTool(svc: VerdictService, name: string, raw: unknown, ctx: CallCtx): Promise<ToolOutcome> {
  const started = performance.now();
  const t = TOOL_MAP.get(name);
  let cost = 0;
  let address: string | null = null;
  let authed = false;
  const fail = (e: unknown): ToolOutcome => {
    const ve = e instanceof VerdictError ? e : errors.internal();
    if (!(e instanceof VerdictError)) svc.log.error('tool_failed', { tool: name, agent_id: ctx.agentId, err: (e as Error)?.message });
    const next: NextAction[] = ve.code === 'INVALID_ADDRESS' || ve.code === 'TOKEN_NOT_FOUND' ? [{ tool: 'verdict_list_runners', reason: 'get a valid address', args: { limit: 5 } }]
      : ve.code === 'BUDGET_EXHAUSTED' ? [{ tool: 'verdict_budget', reason: 'see when the quota resets', args: {} }] : [];
    return { ok: false, status: ve.status, envelope: { error: ve.toJSON(), _meta: meta({ costUnits: 0, agentId: ctx.agentId }), nextActions: checkActions(next) } };
  };
  try {
    if (!t) throw errors.unknownTool(name);
    const parsed = t.input.safeParse(raw ?? {});
    if (!parsed.success) {
      const msg = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
      if (/idempotencyKey/.test(msg)) throw errors.idempotency();
      throw errors.validation(msg);
    }
    const args = parsed.data as never;
    authed = !!ctx.apiKey && (await svc.store.scopesFor(keyHash(ctx.apiKey))).length > 0;
    if (t.scope) {
      const scopes = ctx.apiKey ? await svc.store.scopesFor(keyHash(ctx.apiKey)) : [];
      if (!scopes.includes(t.scope)) throw errors.scope(t.scope);
    }
    cost = t.cost(args);
    address = typeof (args as { address?: unknown }).address === 'string' ? String((args as { address: string }).address).toLowerCase() : null;
    if (cost > 0) {
      const b = await svc.budget(quotaKeyOf(ctx));
      if (b.remainingUnits < cost) throw errors.budget();
    }
    const out = await t.run(args, ctx, svc);
    const envelope: Envelope<unknown> = {
      data: out.data,
      brief: out.brief,
      _meta: meta({ ...out._meta, costUnits: cost, agentId: ctx.agentId }),
      nextActions: checkActions(out.nextActions),
    };
    const durationMs = performance.now() - started;
    await svc.store.recordCall({ agentId: ctx.agentId, quotaKey: quotaKeyOf(ctx), authenticated: authed, tool: name, address, ts: svc.nowIso(), costUnits: cost, durationMs, ok: true });
    svc.log.info('tool_call', { tool: name, agent_id: ctx.agentId, addr: address, duration_ms: Math.round(durationMs), costUnits: cost });
    return { ok: true, envelope };
  } catch (e) {
    await svc.store.recordCall({ agentId: ctx.agentId, quotaKey: quotaKeyOf(ctx), authenticated: authed, tool: name, address, ts: svc.nowIso(), costUnits: 0, durationMs: performance.now() - started, ok: false }).catch(() => {});
    return fail(e);
  }
}
