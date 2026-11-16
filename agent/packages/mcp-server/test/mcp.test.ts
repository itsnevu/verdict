import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { TOOLS, TOOL_NAMES, type Envelope, type ErrorEnvelope } from '@verdictagent/core';
import { handleRpc, handleRpcPayload, type JsonRpcResponse } from '../src/mcp/protocol.js';
import { serveStdio } from '../src/mcp/stdio.js';
import { TOOL_DEFS, runTool, toolList } from '../src/mcp/tools.js';
import { KEY, T, makeSvc, withKey } from './helpers.js';

const ctx = { agentId: 'agent-a', apiKey: null };
const call = async (svc: ReturnType<typeof makeSvc>['svc'], name: string, args: unknown, c: { agentId: string; apiKey: string | null } = ctx) => {
  const r = (await handleRpc(svc, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, c)) as JsonRpcResponse;
  const res = r.result as { structuredContent: Envelope<any> & ErrorEnvelope; isError: boolean; content: { text: string }[] };
  expect(JSON.parse(res.content[0]!.text)).toEqual(res.structuredContent);
  return res;
};

describe('MCP protocol', () => {
  it('initializes with tools capability and negotiates the version', async () => {
    const { svc } = makeSvc();
    const r = (await handleRpc(svc, { jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-03-26' } }, ctx))!;
    expect(r.result).toMatchObject({ protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'verdictagent' } });
    const r2 = (await handleRpc(svc, { jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '1999-01-01' } }, ctx))!;
    expect((r2.result as { protocolVersion: string }).protocolVersion).toBe('2025-06-18');
  });

  it('lists every tool with an object input schema and LLM-oriented description', async () => {
    const { svc } = makeSvc();
    const r = (await handleRpc(svc, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, ctx))!;
    const tools = (r.result as { tools: { name: string; description: string; inputSchema: { type: string } }[] }).tools;
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
    for (const t of tools) {
      expect(t.name.startsWith('verdict_')).toBe(true);
      expect(t.inputSchema.type).toBe('object');
      expect(t.description).toMatch(/Cost|Free/);
    }
    expect(toolList().find((t) => t.name === 'verdict_watch_token')!.annotations.readOnlyHint).toBe(false);
  });

  it('handles notifications, ping, unknown methods, bad requests and batches', async () => {
    const { svc } = makeSvc();
    expect(await handleRpc(svc, { jsonrpc: '2.0', method: 'notifications/initialized' }, ctx)).toBeNull();
    expect(await handleRpc(svc, { jsonrpc: '2.0', method: 'something/else' }, ctx)).toBeNull();
    expect((await handleRpc(svc, { jsonrpc: '2.0', id: 3, method: 'ping' }, ctx))!.result).toEqual({});
    expect((await handleRpc(svc, { jsonrpc: '2.0', id: 4, method: 'nope' }, ctx))!.error!.code).toBe(-32601);
    expect((await handleRpc(svc, { hello: 1 }, ctx))!.error!.code).toBe(-32600);
    expect((await handleRpc(svc, { jsonrpc: '2.0', id: 5, method: 'tools/call', params: {} }, ctx))!.error!.code).toBe(-32602);
    expect((await handleRpc(svc, { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'verdict_nope' } }, ctx))!.error!.code).toBe(-32602);
    const batch = await handleRpcPayload(svc, [{ jsonrpc: '2.0', id: 7, method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/initialized' }], ctx);
    expect(batch).toHaveLength(1);
    expect(await handleRpcPayload(svc, [{ jsonrpc: '2.0', method: 'notifications/initialized' }], ctx)).toBeNull();
    expect((await handleRpcPayload(svc, [], ctx) as JsonRpcResponse).error!.code).toBe(-32600);
  });
});

describe('tools', () => {
  it('scan returns the full envelope', async () => {
    const { svc } = makeSvc();
    const r = await call(svc, 'verdict_scan_token', { address: T.rushr.toUpperCase().replace('0X', '0x') });
    const env = r.structuredContent;
    expect(r.isError).toBe(false);
    expect(env.data.label).toBe('HEALTHY');
    expect(env.brief).toMatch(/^RUSHR skor/);
    expect(env._meta).toMatchObject({ engineVersion: '1.0.0', costUnits: 1, agentId: 'agent-a' });
    expect(env._meta.degraded).toBe(false); // mock answers every method completely, so basedbot is never needed
    expect(Array.isArray(env._meta.sources)).toBe(true);
    const deg = await call(svc, 'verdict_scan_token', { address: T.degraded });
    expect(deg.structuredContent._meta.degraded).toBe(true);
    expect(deg.structuredContent._meta.confidence).toBeLessThan(0.5);
    const again = await call(svc, 'verdict_scan_token', { address: T.rushr });
    expect(again.structuredContent.data.cached).toBe(true);
  });

  it('agent id can come from _meta.agent_id', async () => {
    const { svc, store } = makeSvc();
    await handleRpc(svc, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'verdict_budget', arguments: {}, _meta: { agent_id: 'from-meta' } } }, ctx);
    expect(store.calls.at(-1)!.agentId).toBe('from-meta');
  });

  it('every tool runs, and nextActions only reference tools that exist', async () => {
    const { svc } = makeSvc();
    const key = await withKey(svc);
    const k = { agentId: 'agent-b', apiKey: key };
    const runs: [string, unknown][] = [
      ['verdict_scan_token', { address: T.zolva }],
      ['verdict_scan_token', { address: T.degraded }],
      ['verdict_scan_token', { address: T.nifty }],
      ['verdict_agent_brief', { address: T.robot }],
      ['verdict_list_runners', {}],
      ['verdict_list_runners', { label: 'DEAD' }],
      ['verdict_token_history', { address: T.zolva, hours: 2 }],
      ['verdict_token_history', { address: T.unknown }],
      ['verdict_explain_score', { address: T.nifty }],
      ['verdict_explain_score', { address: T.nifty, signal: 'liq_ratio' }],
      ['verdict_compare_tokens', { addresses: [T.rushr, T.zolva, T.robot] }],
      ['verdict_budget', {}],
      ['verdict_watch_token', { address: T.rushr, idempotencyKey: 'watch-key-001' }],
      ['verdict_register_mcp', { url: 'https://quotes.example/mcp', declaredTools: [{ name: 'quote', description: 'returns a quote for a token pair', readOnly: true }], idempotencyKey: 'reg-key-0001' }],
      ['verdict_registry_search', { query: 'quote' }],
      ['verdict_registry_search', { query: 'zzz-nothing' }],
      ['verdict_registry_check', { idOrUrl: 'https://quotes.example/mcp' }],
    ];
    const seen = new Set<string>();
    for (const [name, args] of runs) {
      const out = await runTool(svc, name, args, k);
      expect(out.ok, `${name} ${JSON.stringify(out.envelope)}`).toBe(true);
      seen.add(name);
      const env = out.envelope as Envelope<unknown>;
      expect(typeof env.brief).toBe('string');
      expect(env._meta.costUnits).toBeGreaterThanOrEqual(0);
      for (const a of env.nextActions) expect(Object.keys(TOOLS)).toContain(a.tool);
    }
    expect([...seen].sort()).toEqual(TOOL_DEFS.map((t) => t.name).sort()); // verdict_attest_token is covered in oracle.test.ts
  });

  it('compare charges per address and ranks by score', async () => {
    const { svc } = makeSvc();
    const r = await call(svc, 'verdict_compare_tokens', { addresses: [T.robot, T.rushr] });
    expect(r.structuredContent._meta.costUnits).toBe(2);
    expect(r.structuredContent.data[0].address).toBe(T.rushr);
  });

  it('history reports direction', async () => {
    const { svc, advance } = makeSvc();
    await call(svc, 'verdict_scan_token', { address: T.rushr });
    advance(60_000);
    await call(svc, 'verdict_scan_token', { address: T.rushr });
    const r = await call(svc, 'verdict_token_history', { address: T.rushr, hours: 1 });
    expect(r.structuredContent.data).toHaveLength(2);
    expect(r.structuredContent.brief).toMatch(/naik 0 poin/);
  });
});

describe('errors are structured, never bare failures', () => {
  it('invalid address', async () => {
    const { svc } = makeSvc();
    const r = await call(svc, 'verdict_scan_token', { address: 'hello' });
    expect(r.isError).toBe(true);
    expect(r.structuredContent.error).toMatchObject({ code: 'INVALID_ADDRESS', retryable: false });
    expect(r.structuredContent.error.fix).toContain('verdict_list_runners');
    expect(r.structuredContent.nextActions[0].tool).toBe('verdict_list_runners');
  });
  it('unknown token and bad args', async () => {
    const { svc } = makeSvc();
    expect((await call(svc, 'verdict_scan_token', { address: T.unknown })).structuredContent.error.code).toBe('TOKEN_NOT_FOUND');
    expect((await call(svc, 'verdict_compare_tokens', { addresses: [T.rushr] })).structuredContent.error.code).toBe('INVALID_ARGUMENTS');
    expect((await call(svc, 'verdict_registry_check', { idOrUrl: 'mcp_missing' })).structuredContent.error.code).toBe('NOT_FOUND');
  });
  it('insufficient data when every market source fails', async () => {
    const { svc } = makeSvc({ sources: [{ name: 'down', supports: ['getMarket'], getMarket: async () => ({ data: null, fetchedAt: '2026-11-16T12:00:00.000Z', source: 'down', complete: false, error: 'timeout' }) } as never] });
    const r = await call(svc, 'verdict_scan_token', { address: T.rushr });
    expect(r.structuredContent.error).toMatchObject({ code: 'INSUFFICIENT_DATA', retryable: true });
  });
  it('unexpected exceptions become INTERNAL', async () => {
    const { svc } = makeSvc({ sources: [{ name: 'boom', getMarket: () => { throw new Error('x'); } } as never] });
    svc.scan = async () => { throw new Error('kaboom'); };
    const r = await call(svc, 'verdict_scan_token', { address: T.rushr });
    expect(r.structuredContent.error).toMatchObject({ code: 'INTERNAL', retryable: true });
  });
});

describe('scope gating', () => {
  it('SCOPE_REQUIRED without a key or with the wrong scope', async () => {
    const { svc } = makeSvc();
    const a = await call(svc, 'verdict_watch_token', { address: T.rushr, idempotencyKey: 'k-12345678' });
    expect(a.structuredContent.error).toMatchObject({ code: 'SCOPE_REQUIRED' });
    expect(a.structuredContent.error.fix).toContain('minta scope watch');
    await withKey(svc, ['registry']);
    const b = await call(svc, 'verdict_watch_token', { address: T.rushr, idempotencyKey: 'k-12345678' }, { agentId: 'x', apiKey: KEY });
    expect(b.structuredContent.error.code).toBe('SCOPE_REQUIRED');
    const c = await call(svc, 'verdict_register_mcp', { url: 'https://a.example/mcp', declaredTools: [{ name: 'a' }], idempotencyKey: 'k-12345678' });
    expect(c.structuredContent.error.fix).toContain('minta scope registry');
  });
});

describe('idempotency', () => {
  it('watch: same key + same args replays, different args conflict, missing key is rejected', async () => {
    const { svc, store } = makeSvc();
    const key = await withKey(svc);
    const k = { agentId: 'a', apiKey: key };
    const first = await call(svc, 'verdict_watch_token', { address: T.rushr, ttlHours: 12, idempotencyKey: 'same-key-1' }, k);
    const again = await call(svc, 'verdict_watch_token', { address: T.rushr, ttlHours: 12, idempotencyKey: 'same-key-1' }, k);
    expect(first.structuredContent.data.replayed).toBe(false);
    expect(again.structuredContent.data.replayed).toBe(true);
    expect(again.structuredContent.data.watchedUntil).toBe(first.structuredContent.data.watchedUntil);
    expect(store.watches.size).toBe(1);
    const clash = await call(svc, 'verdict_watch_token', { address: T.rushr, ttlHours: 48, idempotencyKey: 'same-key-1' }, k);
    expect(clash.structuredContent.error.code).toBe('IDEMPOTENCY_CONFLICT');
    const missing = await call(svc, 'verdict_watch_token', { address: T.rushr }, k);
    expect(missing.structuredContent.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });
  it('register: replays and conflicts the same way; write tools without targets cap trust', async () => {
    const { svc, store } = makeSvc();
    const key = await withKey(svc);
    const k = { agentId: 'a', apiKey: key };
    const args = { url: 'https://swap.example/mcp', declaredTools: [{ name: 'swap', description: 'executes a swap for the caller', readOnly: false }], idempotencyKey: 'reg-key-777' };
    const a = await call(svc, 'verdict_register_mcp', args, k);
    expect(a.structuredContent.data.capped).toBe(true);
    expect(a.structuredContent.data.trust).toBeLessThanOrEqual(40);
    expect((await call(svc, 'verdict_register_mcp', args, k)).structuredContent.data.replayed).toBe(true);
    expect(store.endpoints.size).toBe(1);
    const c = await call(svc, 'verdict_register_mcp', { ...args, contractTargets: ['0x00000000000000000000000000000000000000AA'] }, k);
    expect(c.structuredContent.error.code).toBe('IDEMPOTENCY_CONFLICT');
  });
});

describe('budget', () => {
  it('blocks calls once the daily quota is used and points to verdict_budget', async () => {
    const { svc } = makeSvc({ quota: 1.5 });
    expect((await call(svc, 'verdict_scan_token', { address: T.rushr })).isError).toBe(false);
    const r = await call(svc, 'verdict_scan_token', { address: T.zolva });
    expect(r.structuredContent.error.code).toBe('BUDGET_EXHAUSTED');
    expect(r.structuredContent.nextActions[0].tool).toBe('verdict_budget');
    const b = await call(svc, 'verdict_budget', {});
    expect(b.structuredContent.data).toMatchObject({ quotaUnits: 1.5, usedUnits: 1, remainingUnits: 0.5 });
  });
});

describe('stdio transport', () => {
  it('speaks newline-delimited JSON-RPC', async () => {
    const { svc } = makeSvc();
    const input = new PassThrough();
    const output = new PassThrough();
    const lines: string[] = [];
    output.on('data', (c) => lines.push(...String(c).split('\n').filter(Boolean)));
    const s = serveStdio(svc, { input, output, agentId: 'cli' });
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })}\n`);
    input.write('not json\n\n');
    input.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'verdict_agent_brief', arguments: { address: T.zolva } } })}\n`);
    input.end();
    await s.closed;
    const msgs = lines.map((l) => JSON.parse(l));
    expect(msgs.find((m) => m.id === 1).result.serverInfo.name).toBe('verdictagent');
    expect(msgs.find((m) => m.error?.code === -32700)).toBeTruthy();
    expect(msgs.find((m) => m.id === 2).result.structuredContent.brief).toMatch(/^ZOLVA/);
    expect(msgs).toHaveLength(3);
  });
});
