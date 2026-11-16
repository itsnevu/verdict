import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { ENGINE_VERSION, checkActions, errors, meta } from '@verdictagent/core';
import { leaderboard } from '../agents.js';
import { rateLimit } from '../cache.js';
import { handleRpcPayload } from '../mcp/protocol.js';
import { runTool, type CallCtx } from '../mcp/tools.js';
import { renderPage } from '../page/render.js';
import { badgeSvg, reportHtml } from '../skills/report.js';
import { readContractReport } from '../skills/contract.js';
import type { VerdictService } from '../service.js';

const LIMITS: Record<string, number> = { scan: 30, brief: 60, default: 60, mcp: 120 };

function ctxOf(req: FastifyRequest): CallCtx {
  const h = req.headers['x-agent-id'];
  const agent = (Array.isArray(h) ? h[0] : h)?.trim().slice(0, 120);
  const auth = req.headers.authorization;
  const apiKey = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : null;
  return { agentId: agent || `anon:${req.ip}`, apiKey, ip: req.ip };
}

export function buildApp(svc: VerdictService, o: { trustProxyHops?: number } = {}) {
  // only trust X-Forwarded-For from a known number of proxies; otherwise clients could spoof their IP to dodge limits
  const app = Fastify({ logger: false, trustProxy: o.trustProxyHops ? (_addr: string, hop: number) => hop < o.trustProxyHops! : false, bodyLimit: 256 * 1024 });

  // security headers on every response; the page needs inline styles only (no scripts at all)
  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    reply.header('Cross-Origin-Resource-Policy', 'same-site');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    reply.header('Content-Security-Policy', req.url === '/' || req.url.startsWith('/?') || req.url.startsWith('/report/')
      ? "default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
      : "default-src 'none'; frame-ancestors 'none'");
    return payload;
  });

  const limit = async (req: FastifyRequest, reply: FastifyReply, bucket: string) => {
    const max = LIMITS[bucket] ?? LIMITS.default!;
    const r = await rateLimit(svc.cache, `${bucket}:${req.ip}`, max, 60);
    reply.header('X-RateLimit-Limit', r.limit).header('X-RateLimit-Remaining', r.remaining).header('X-RateLimit-Reset', r.reset);
    if (!r.ok) {
      const e = errors.rateLimited(r.reset);
      reply.header('Retry-After', r.reset).code(429).send({ error: e.toJSON(), _meta: meta({ costUnits: 0 }), nextActions: [] });
      return false;
    }
    return true;
  };

  const tool = (bucket: string, name: string, args: (req: FastifyRequest) => unknown, cacheSeconds?: number) =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      if (!(await limit(req, reply, bucket))) return reply;
      const out = await runTool(svc, name, args(req), ctxOf(req));
      if (out.ok && cacheSeconds) reply.header('Cache-Control', `public, max-age=${cacheSeconds}`);
      return reply.code(out.ok ? 200 : out.status).send(out.envelope);
    };

  type P = { addr: string };
  type Q = Record<string, string | undefined>;
  const num = (v?: string) => (v === undefined || v === '' ? undefined : Number(v));

  app.get('/v1/scan/:addr', tool('scan', 'verdict_scan_token', (r) => ({ address: (r.params as P).addr }), 45));
  app.get('/v1/brief/:addr', tool('brief', 'verdict_agent_brief', (r) => ({ address: (r.params as P).addr }), 45));
  app.get('/v1/tokens', tool('default', 'verdict_list_runners', (r) => { const q = r.query as Q; return { label: q.label, minScore: num(q.minScore), limit: num(q.limit) }; }));
  app.get('/v1/tokens/:addr/history', tool('default', 'verdict_token_history', (r) => ({ address: (r.params as P).addr, hours: num((r.query as Q).hours) })));
  app.get('/v1/explain/:addr', tool('default', 'verdict_explain_score', (r) => ({ address: (r.params as P).addr, signal: (r.query as Q).signal })));
  app.get('/v1/compare', tool('default', 'verdict_compare_tokens', (r) => ({ addresses: ((r.query as Q).addresses ?? '').split(',').filter(Boolean) })));
  app.get('/v1/budget', tool('default', 'verdict_budget', () => ({})));
  app.post('/v1/watch', tool('default', 'verdict_watch_token', (r) => r.body ?? {}));
  app.post('/v1/registry', tool('default', 'verdict_register_mcp', (r) => r.body ?? {}));
  app.get('/v1/registry', tool('default', 'verdict_registry_search', (r) => { const q = r.query as Q; return { query: q.query, minTrust: num(q.minTrust), limit: num(q.limit) }; }));
  app.get('/v1/contract/:addr', tool('default', 'verdict_read_contract', (r) => ({ address: (r.params as P).addr, chain: (r.query as Q).chain })));
  app.get('/v1/tx/:hash', tool('default', 'verdict_decode_tx', (r) => ({ hash: (r.params as { hash: string }).hash, chain: (r.query as Q).chain })));
  app.get('/v1/wallet/:addr/holdings', tool('default', 'verdict_wallet_holdings', (r) => ({ wallet: (r.params as P).addr, chain: (r.query as Q).chain })));
  app.get('/v1/wallet/:addr/approvals', tool('default', 'verdict_wallet_approvals', (r) => ({ wallet: (r.params as P).addr, chain: (r.query as Q).chain })));
  app.get('/v1/wallet/:addr/score', tool('default', 'verdict_wallet_score', (r) => ({ wallet: (r.params as P).addr })));
  app.post('/v1/revoke/prepare', tool('default', 'verdict_prepare_revoke', (r) => r.body ?? {}));
  app.post('/v1/simulate', tool('default', 'verdict_simulate_tx', (r) => r.body ?? {}));
  app.post('/v1/lint', tool('default', 'verdict_lint_solidity', (r) => r.body ?? {}));
  app.post('/v1/policy/check', tool('default', 'verdict_check_policy', (r) => r.body ?? {}));
  app.get('/v1/wash/:addr', tool('default', 'verdict_wash_check', (r) => ({ address: (r.params as P).addr, chain: (r.query as Q).chain })));
  app.get('/v1/lp/:addr', tool('default', 'verdict_lp_status', (r) => ({ address: (r.params as P).addr, chain: (r.query as Q).chain })));
  app.get('/v1/deployer/:addr', tool('default', 'verdict_deployer_history', (r) => ({ address: (r.params as P).addr, chain: (r.query as Q).chain })));
  app.get('/v1/wallet/:addr/funding', tool('default', 'verdict_trace_funding', (r) => ({ wallet: (r.params as P).addr, chain: (r.query as Q).chain })));
  app.get('/v1/label/:addr', tool('default', 'verdict_label_address', (r) => ({ address: (r.params as P).addr, chain: (r.query as Q).chain })));
  app.get('/v1/wallet/:addr/moves', tool('default', 'verdict_wallet_moves', (r) => ({ wallet: (r.params as P).addr, token: (r.query as Q).token, chain: (r.query as Q).chain })));
  app.get('/v1/wallet/:addr/pnl', tool('default', 'verdict_wallet_pnl', (r) => ({ wallet: (r.params as P).addr, chain: (r.query as Q).chain })));
  app.post('/v1/swap/prepare', tool('default', 'verdict_prepare_swap', (r) => r.body ?? {}));
  app.get('/v1/bridge/check', tool('default', 'verdict_bridge_check', (r) => { const q = r.query as Q; return { token: q.token, fromChain: q.from, toChain: q.to, toToken: q.toToken }; }));
  app.get('/v1/track-record', tool('default', 'verdict_track_record', (r) => ({ horizonDays: num((r.query as Q).days) })));

  // shareable report page and badge (read-only, same scan cache)
  app.get('/report/:addr', async (req, reply) => {
    if (!(await limit(req, reply, 'scan'))) return reply;
    const out = await runTool(svc, 'verdict_scan_token', { address: (req.params as P).addr }, { ...ctxOf(req), agentId: `report:${req.ip}` });
    reply.header('content-type', 'text/html; charset=utf-8');
    if (!out.ok) return reply.code(out.status).send(renderPage({ address: (req.params as P).addr, result: out }));
    const v = out.envelope.data as Parameters<typeof reportHtml>[0]['verdict'];
    const history = await svc.store.history(v.address, '1970-01-01T00:00:00.000Z');
    const contract = await readContractReport(svc.chains.client('robinhood'), v.address as `0x${string}`, svc.codeHashes).then((c) => c as unknown as Record<string, unknown>, () => null);
    return reply.send(reportHtml({ verdict: v, brief: out.envelope.brief ?? '', history, contract, generatedAt: svc.nowIso().slice(0, 19).replace('T', ' '), sources: out.envelope._meta.sources }));
  });
  app.get('/badge/:file', async (req, reply) => {
    const addrPart = (req.params as { file: string }).file.replace(/\.svg$/, '');
    if (!(await limit(req, reply, 'brief'))) return reply;
    const out = await runTool(svc, 'verdict_agent_brief', { address: addrPart }, { ...ctxOf(req), agentId: `badge:${req.ip}` });
    const d = out.ok ? (out.envelope.data as { score: number | null; label: string | null }) : null;
    const scan = out.ok ? await svc.scan(addrPart.toLowerCase()).catch(() => null) : null;
    return reply.header('content-type', 'image/svg+xml').header('cache-control', 'public, max-age=300')
      .send(badgeSvg(d ? { score: d.score, label: d.label as never } : null, scan?.verdict.symbol ?? null));
  });

  app.post('/v1/attest', tool('default', 'verdict_attest_token', (r) => r.body ?? {}));
  app.get('/v1/registry/check', tool('default', 'verdict_registry_check', (r) => ({ idOrUrl: (r.query as Q).id ?? (r.query as Q).url })));

  app.get('/v1/agents', async (req, reply) => {
    if (!(await limit(req, reply, 'default'))) return reply;
    const lb = await leaderboard(svc.store, svc.nowIso(), { minCalls: svc.leaderboardMinCalls });
    return reply.send({
      data: lb,
      brief: lb.active ? `${lb.agents.length} agent memenuhi syarat (min 20 scan). Teratas ${lb.agents[0]?.agentId ?? '-'} hit rate ${lb.agents[0]?.hitRate ?? '-'}.` : `Leaderboard aktif setelah ${lb.activatesAt} panggilan nyata; saat ini ${lb.totalCalls}.`,
      _meta: meta({ costUnits: 0, agentId: ctxOf(req).agentId }),
      nextActions: checkActions([{ tool: 'verdict_list_runners', reason: 'see the tokens agents are judging', args: { limit: 10 } }]),
    });
  });

  app.get('/v1/health', async (_req, reply) => {
    const [db, cache] = await Promise.all([svc.store.ping(), svc.cache.ping()]);
    const oracle = svc.oracle ? await svc.oracle.status().then((s) => ({ address: svc.oracle!.address, chainId: svc.oracle!.chainId, writable: svc.oracle!.writable, ...s }), () => ({ address: svc.oracle!.address, chainId: svc.oracle!.chainId, error: 'unreachable' })) : null;
    const ok = db && cache;
    return reply.code(ok ? 200 : 503).send({
      data: { status: ok ? 'ok' : 'degraded', db, cache, engineVersion: ENGINE_VERSION, oracle, sources: svc.sources.map((s) => ({ name: s.name, supports: s.supports ?? 'all' })) },
      brief: ok ? 'Semua komponen sehat.' : 'Ada komponen yang tidak sehat; lihat data.',
      _meta: meta({ costUnits: 0, degraded: !ok }),
      nextActions: [],
    });
  });

  // MCP Streamable HTTP, stateless: JSON responses, no sessions, no server-initiated stream.
  app.post('/mcp', async (req, reply) => {
    if (!(await limit(req, reply, 'mcp'))) return reply;
    const res = await handleRpcPayload(svc, req.body, ctxOf(req));
    if (res === null) return reply.code(202).send();
    return reply.header('content-type', 'application/json').send(res);
  });
  const noStream = async (_req: FastifyRequest, reply: FastifyReply) => reply.code(405).header('Allow', 'POST').send({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'This server is stateless; use POST /mcp' } });
  app.get('/mcp', noStream);
  app.delete('/mcp', noStream);

  app.get('/', async (req, reply) => {
    const q = req.query as Q;
    reply.header('content-type', 'text/html; charset=utf-8');
    if (!q.address) return reply.send(renderPage({}));
    if (!(await limit(req, reply, 'scan'))) return reply;
    const out = await runTool(svc, 'verdict_scan_token', { address: q.address }, { ...ctxOf(req), agentId: `web:${req.ip}` });
    return reply.code(out.ok ? 200 : out.status).send(renderPage({ address: q.address, result: out }));
  });

  app.setNotFoundHandler((req, reply) => reply.code(404).send({ error: { code: 'NOT_FOUND', message: `${req.method} ${req.url} does not exist`, retryable: false, fix: 'lihat README: GET /v1/scan/:address, POST /mcp' }, _meta: meta({ costUnits: 0 }), nextActions: [] }));
  app.setErrorHandler((err: { statusCode?: number; message?: string }, _req, reply) => {
    const bad = (err.statusCode ?? 500) < 500;
    const e = bad ? errors.validation(err.message ?? 'bad request') : errors.internal();
    if (!bad) svc.log.error('http_error', { err: err.message });
    reply.code(bad ? 400 : 503).send({ error: e.toJSON(), _meta: meta({ costUnits: 0 }), nextActions: [] });
  });

  return app;
}
