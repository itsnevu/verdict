import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { ENGINE_VERSION, checkActions, errors, meta } from '@verdictagent/core';
import { leaderboard } from '../agents.js';
import { rateLimit } from '../cache.js';
import { handleRpcPayload } from '../mcp/protocol.js';
import { runTool, type CallCtx } from '../mcp/tools.js';
import { renderPage } from '../page/render.js';
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
    const ok = db && cache;
    return reply.code(ok ? 200 : 503).send({
      data: { status: ok ? 'ok' : 'degraded', db, cache, engineVersion: ENGINE_VERSION, sources: svc.sources.map((s) => ({ name: s.name, supports: s.supports ?? 'all' })) },
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
