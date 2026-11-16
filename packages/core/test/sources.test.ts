import { describe, expect, it } from 'vitest';
import {
  BasedBotSource, DexScreenerSource, MockSource, RpcSource, collectInputs, evaluate, parseBasedBot,
  parseDexScreener, probeMcp, sizeVariance, trustScore, withRetry,
} from '@verdictagent/core';

const TOKEN = '0x000000000000000000000000000000000000a001';
const PAIR = '0x000000000000000000000000000000000000e194';
const fast = { retry: { retries: 2, baseDelayMs: 0, sleep: async () => {} } };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });

const dexBody = {
  pairs: [
    { chainId: 'ethereum', baseToken: { address: TOKEN }, liquidity: { usd: 9e9 }, marketCap: 1 },
    { chainId: 'robinhood', pairAddress: PAIR, baseToken: { address: TOKEN.toUpperCase().replace('0X', '0x'), symbol: 'RUSHR', name: 'Rushr' }, priceUsd: '0.0004', marketCap: 400000, liquidity: { usd: 140000 }, volume: { h6: 400000, h24: 1200000 }, txns: { h24: { buys: 2600, sells: 2400 } }, pairCreatedAt: 1763078400000 },
    { chainId: 'robinhood', baseToken: { address: TOKEN }, liquidity: { usd: 10 }, marketCap: 400000 },
  ],
};

describe('withRetry', () => {
  it('retries then succeeds', async () => {
    let n = 0;
    const v = await withRetry(async () => { if (++n < 3) throw new Error('flaky'); return 'ok'; }, { baseDelayMs: 0, sleep: async () => {} });
    expect(v).toBe('ok');
    expect(n).toBe(3);
  });
  it('gives up after retries and times out slow calls', async () => {
    await expect(withRetry(async () => { throw new Error('down'); }, { retries: 1, baseDelayMs: 0, sleep: async () => {} })).rejects.toThrow('down');
    await expect(withRetry((s) => new Promise((_, rej) => s.addEventListener('abort', () => rej(new Error('aborted')))), { timeoutMs: 5, retries: 0 })).rejects.toThrow('aborted');
  });
});

describe('DexScreenerSource', () => {
  it('picks the deepest pair on the configured chain', () => {
    const m = parseDexScreener(dexBody, TOKEN, 'robinhood')!;
    expect(m.liqUsd).toBe(140000);
    expect(m.pairAddress).toBe(PAIR);
    expect(m.tx24h).toBe(5000);
    expect(m.uniqueWallets24h).toBeNull();
    expect(parseDexScreener({ pairs: 'nope' }, TOKEN, 'robinhood')).toBeNull();
    const v4 = { pairs: [{ ...dexBody.pairs[1], pairAddress: '0x' + 'ab'.repeat(32) }] };
    expect(parseDexScreener(v4, TOKEN, 'robinhood')!.pairAddress).toBeNull();
    expect(parseDexScreener(dexBody, TOKEN, 'solana')).toBeNull();
    expect(parseDexScreener(dexBody, TOKEN, 'base')).toBeNull();
  });
  it('serves the last snapshot as degraded when rate limited', async () => {
    let calls = 0;
    const s = new DexScreenerSource({ ...fast, fetch: async () => (++calls === 1 ? json(dexBody) : json({}, 429)) });
    const first = await s.getMarket(TOKEN);
    expect(first.complete).toBe(true);
    const second = await s.getMarket(TOKEN);
    expect(second.complete).toBe(false);
    expect(second.data?.mcUsd).toBe(400000);
    expect(second.error).toMatch(/stale snapshot/);
  });
  it('does not retry 4xx and reports unsupported methods', async () => {
    let calls = 0;
    const s = new DexScreenerSource({ ...fast, fetch: async () => { calls++; return json({}, 404); } });
    expect((await s.getMarket(TOKEN)).complete).toBe(false);
    expect(calls).toBe(1);
    expect((await s.getHolders()).complete).toBe(false);
  });
});

describe('BasedBotSource', () => {
  it('stays incomplete until configured and verified', async () => {
    expect((await new BasedBotSource().getLaunchMeta(TOKEN)).error).toMatch(/not configured/);
    const s = new BasedBotSource({ baseUrl: 'https://bb.test/', launchPath: '/t/{address}', fetch: async (u) => { expect(String(u)).toBe(`https://bb.test/t/${TOKEN}`); return json({ data: { created_at: 1763078400, creator: '0xABCDEF0000000000000000000000000000000001' } }); } });
    const r = await s.getLaunchMeta(TOKEN);
    expect(r.complete).toBe(false);
    expect(r.data?.devAddress).toBe('0xabcdef0000000000000000000000000000000001');
    const v = new BasedBotSource({ baseUrl: 'https://bb.test', launchPath: '/t/{address}', schemaVerified: true, fetch: async () => json({ launchedAt: '2026-11-14T00:00:00Z' }) });
    expect((await v.getLaunchMeta(TOKEN)).complete).toBe(true);
  });
  it('parses defensively', () => {
    expect(parseBasedBot(null)).toBeNull();
    expect(parseBasedBot({ unrelated: 1 })).toBeNull();
    expect(parseBasedBot({ owner: 'not-an-address', timestamp: 1763078400000 })?.createdAt).toBe('2025-11-14T00:00:00.000Z');
  });
});

describe('RpcSource', () => {
  const holder = (n: number) => `0x${n.toString(16).padStart(40, '0')}`;
  const client = {
    getBlockNumber: async () => 30_000n,
    getLogs: async ({ fromBlock }: { fromBlock: bigint }) => (fromBlock === 10_000n
      ? [
        { args: { from: PAIR, to: holder(1), value: 500n }, blockNumber: 10_001n },
        { args: { from: PAIR, to: holder(2), value: 300n }, blockNumber: 10_002n },
        { args: { from: PAIR, to: PAIR, value: 999n }, blockNumber: 10_003n },
      ]
      : []),
    readContract: async ({ functionName, args }: { functionName: string; args?: string[] }) => {
      if (functionName === 'totalSupply') return 1000n;
      return ({ [holder(1)]: 400n, [holder(2)]: 100n, [holder(9)]: 50n } as Record<string, bigint>)[args![0]!] ?? 0n;
    },
    // holder(2) is a contract (think: a pool) and must be excluded from the top-10
    getCode: async ({ address }: { address?: string } = {}) => (address === holder(2) || address === TOKEN ? '0x60' : '0x'),
  };
  const rpc = new RpcSource({ client: client as never, logRange: 20_000n, chunk: 10_000n });

  it('reconstructs holders from Transfer logs, excluding the pool', async () => {
    const r = await rpc.getHolders(TOKEN, { pairAddress: PAIR, devAddress: holder(9) });
    expect(r.complete).toBe(false);
    expect(r.data).toMatchObject({ top10Share: 0.4, devShare: 0.05, holderCount: 1, approximate: true });
    expect((await rpc.getHolders(TOKEN, { pairAddress: PAIR })).data?.top10Share).toBe(0.4); // cached
  });
  it('lists early buyers from the pair and reports what plain RPC cannot do', async () => {
    const e = await rpc.getEarlyBuyers(TOKEN, { pairAddress: PAIR });
    expect(e.data?.buys.map((b) => b.wallet)).toEqual([holder(1), holder(2), PAIR]);
    expect((await rpc.getEarlyBuyers(TOKEN)).error).toMatch(/pair address unknown/);
    expect((await rpc.getContractFlags(TOKEN)).error).toMatch(/sell simulation/);
    expect((await new RpcSource().getHolders(TOKEN)).error).toMatch(/RPC_URL/);
    const broken = new RpcSource({ client: { ...client, readContract: async () => { throw new Error('boom'); } } as never });
    expect((await broken.getHolders(TOKEN)).error).toMatch(/boom/);
  });
});

describe('collectInputs', () => {
  const mock = new MockSource('mock', {}, () => '2026-11-16T12:00:00.000Z');
  mock.set(TOKEN, {
    market: parseDexScreener(dexBody, TOKEN, 'robinhood'),
    holders: { top10Share: 0.2, devShare: 0.02, holderCount: 100, holderCount24hAgo: 90 },
    earlyBuyers: { buys: Array.from({ length: 12 }, (_, k) => ({ wallet: `0xb${k}`, amountUsd: 100 + k * 13, fundingSource: null })) },
    contract: { honeypot: false, sellFails: false, lpLocked: true },
    launch: { createdAt: '2026-11-14T00:00:00.000Z', devAddress: null, launchpad: 'basedbot' },
    funding: { '0xb0': '0xF1' },
  });

  it('prefers complete answers and traces funding', async () => {
    const i = await collectInputs(TOKEN, [new BasedBotSource(), mock]);
    expect(i.market?.mcUsd).toBe(400000);
    expect(i.earlyBuyers?.buys[0]?.fundingSource).toBe('0xf1');
    expect(i.sizeVariance).toBeGreaterThan(0);
    expect(i.sources.find((s) => s.name === 'basedbot')?.complete).toBe(false);
  });

  it('still produces a verdict, degraded, with one adapter switched off', async () => {
    const dex = new DexScreenerSource({ ...fast, fetch: async () => json(dexBody) });
    const i = await collectInputs(TOKEN, [dex, new RpcSource(), new BasedBotSource()]);
    const v = evaluate(i);
    expect(v.score).not.toBeNull();
    expect(i.sources.some((s) => !s.complete)).toBe(true);
    expect(v.confidence).toBeLessThan(1);
  });

  it('sizeVariance needs enough buys', () => {
    expect(sizeVariance(null)).toBeNull();
    expect(sizeVariance({ buys: [{ wallet: 'a', amountUsd: 1, fundingSource: null }] })).toBeNull();
  });
});

describe('registry trust', () => {
  const now = '2026-11-16T12:00:00.000Z';
  it('rewards complete declarations, probe and age', () => {
    const t = trustScore({
      declaredTools: [{ name: 'quote', description: 'returns a price quote for a pair', readOnly: true }],
      contractTargets: [],
      probe: { reachable: true, tlsValid: true, liveTools: ['quote'], checkedAt: now },
      registeredAt: '2026-10-01T00:00:00.000Z', now,
    });
    expect(t.trust).toBe(100);
  });
  it('caps write tools without contract targets at 40', () => {
    const t = trustScore({
      declaredTools: [{ name: 'swap', description: 'executes a swap on behalf of the caller', readOnly: false }],
      contractTargets: [], probe: { reachable: true, tlsValid: true, liveTools: ['swap', 'extra'], checkedAt: now },
      registeredAt: '2026-01-01T00:00:00.000Z', now,
    });
    expect(t.capped).toBe(true);
    expect(t.trust).toBeLessThanOrEqual(40);
  });
  it('probes over JSON and SSE, and survives failures', async () => {
    const ok = await probeMcp('https://x.test/mcp', async () => json({ jsonrpc: '2.0', id: 1, result: { tools: [{ name: 'a' }] } }));
    expect(ok).toMatchObject({ reachable: true, tlsValid: true, liveTools: ['a'] });
    const sse = await probeMcp('http://x.test/mcp', async () => new Response('event: message\ndata: {"result":{"tools":[{"name":"b"}]}}\n\n'));
    expect(sse).toMatchObject({ tlsValid: false, liveTools: ['b'] });
    const bad = await probeMcp('https://x.test/mcp', async () => { throw new Error('self signed certificate'); });
    expect(bad.error).toMatch(/^tls:/);
  });
});

describe('shortError', () => {
  it('keeps upstream errors to one readable line', async () => {
    const { shortError } = await import('@verdictagent/core');
    const viem = 'Invalid parameters were provided to the RPC method.\nDouble check you have provided the correct parameters.\n\nStatus: 403\nURL: https://x\nRequest body: {"method":"eth_getLogs"}\n\nDetails: Archive requests require a personal token.\nVersion: viem@2';
    expect(shortError(viem)).toBe('Invalid parameters were provided to the RPC method. (Archive requests require a personal token.)');
    expect(shortError('x'.repeat(500))).toHaveLength(200);
  });
});
