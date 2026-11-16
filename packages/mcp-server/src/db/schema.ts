import { boolean, doublePrecision, index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

const ts = (n: string) => timestamp(n, { withTimezone: true, mode: 'string' });

export const tokens = pgTable('tokens', {
  addr: text('addr').primaryKey(),
  symbol: text('symbol'),
  firstSeen: ts('first_seen').notNull(),
  lastScanned: ts('last_scanned'),
  webhookUrl: text('webhook_url'),
  watchedUntil: ts('watched_until'),
  nextPollAt: ts('next_poll_at'),
  watchAgentId: text('watch_agent_id'),
  watchIdemKey: text('watch_idem_key'),
  watchArgsHash: text('watch_args_hash'),
}, (t) => [uniqueIndex('tokens_watch_idem_key').on(t.watchIdemKey), index('tokens_next_poll').on(t.nextPollAt)]);

export const snapshots = pgTable('snapshots', {
  id: serial('id').primaryKey(),
  addr: text('addr').notNull(),
  ts: ts('ts').notNull(),
  inputs: jsonb('inputs').notNull(),
}, (t) => [index('snapshots_addr_ts').on(t.addr, t.ts.desc())]);

export const scores = pgTable('scores', {
  id: serial('id').primaryKey(),
  addr: text('addr').notNull(),
  symbol: text('symbol'),
  ts: ts('ts').notNull(),
  score: integer('score'),
  label: text('label'),
  confidence: doublePrecision('confidence').notNull(),
  flags: jsonb('flags').$type<string[]>().notNull(),
  engineVersion: text('engine_version').notNull(),
  verdict: jsonb('verdict').notNull(),
  brief: text('brief').notNull(),
  liqUsd: doublePrecision('liq_usd'),
}, (t) => [index('scores_addr_ts').on(t.addr, t.ts.desc()), index('scores_score').on(t.score)]);

export const fundingLinks = pgTable('funding_links', {
  id: serial('id').primaryKey(),
  addr: text('addr').notNull(),
  wallet: text('wallet').notNull(),
  fundedBy: text('funded_by'),
  ts: ts('ts').notNull(),
}, (t) => [index('funding_links_addr_ts').on(t.addr, t.ts.desc())]);

export const alerts = pgTable('alerts', {
  id: serial('id').primaryKey(),
  dedupeKey: text('dedupe_key').notNull(),
  addr: text('addr').notNull(),
  kind: text('kind').notNull(),
  ts: ts('ts').notNull(),
  payload: jsonb('payload').notNull(),
  delivered: boolean('delivered').notNull().default(false),
}, (t) => [uniqueIndex('alerts_dedupe_key').on(t.dedupeKey), index('alerts_addr_ts').on(t.addr, t.ts.desc())]);

export const mcpEndpoints = pgTable('mcp_endpoints', {
  id: text('id').primaryKey(),
  url: text('url').notNull(),
  declaredTools: jsonb('declared_tools').notNull(),
  contractTargets: jsonb('contract_targets').$type<string[]>().notNull(),
  registeredAt: ts('registered_at').notNull(),
  ownerAgentId: text('owner_agent_id'),
  ownerKey: text('owner_key'),
  probe: jsonb('probe'),
  trust: integer('trust'),
  idempotencyKey: text('idempotency_key').notNull(),
  argsHash: text('args_hash').notNull(),
}, (t) => [uniqueIndex('mcp_endpoints_url').on(t.url), uniqueIndex('mcp_endpoints_idem').on(t.idempotencyKey)]);

export const agents = pgTable('agents', {
  id: text('id').primaryKey(),
  firstSeen: ts('first_seen').notNull(),
  lastSeen: ts('last_seen').notNull(),
});

export const agentCalls = pgTable('agent_calls', {
  id: serial('id').primaryKey(),
  agentId: text('agent_id').notNull(),
  tool: text('tool').notNull(),
  addr: text('addr'),
  ts: ts('ts').notNull(),
  costUnits: doublePrecision('cost_units').notNull(),
  durationMs: integer('duration_ms').notNull(),
  ok: boolean('ok').notNull(),
  quotaKey: text('quota_key'),
  authenticated: boolean('authenticated').notNull().default(false),
}, (t) => [index('agent_calls_agent_ts').on(t.agentId, t.ts), index('agent_calls_quota_ts').on(t.quotaKey, t.ts)]);

export const scopes = pgTable('scopes', {
  apiKey: text('api_key').primaryKey(),
  scopes: jsonb('scopes').$type<string[]>().notNull(),
  createdAt: ts('created_at').notNull(),
});

export const watches = pgTable('watches', {
  id: text('id').primaryKey(),
  addr: text('addr').notNull(),
  ownerKey: text('owner_key').notNull(),
  agentId: text('agent_id'),
  webhookUrl: text('webhook_url'),
  watchedUntil: ts('watched_until').notNull(),
  nextPollAt: ts('next_poll_at').notNull(),
  idemKey: text('idem_key').notNull(),
  argsHash: text('args_hash').notNull(),
}, (t) => [uniqueIndex('watches_owner_idem').on(t.ownerKey, t.idemKey), index('watches_next_poll').on(t.nextPollAt), index('watches_addr').on(t.addr)]);
