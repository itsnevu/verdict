import { describe, expect, it } from 'vitest';
import { getContractAddress } from 'viem';
import { runTool } from '../src/mcp/tools.js';
import { ChainRegistry, type ChainClient } from '../src/skills/chains.js';
import type { DexPair } from '../src/skills/deep.js';
import { bridgeSides, deployerHistory, labelAddress, lpStatus, traceFunding, uniswapLink, walletMoves, walletPnl, washCheck } from '../src/skills/deep.js';
import { tick } from '../src/worker/worker.js';
import { KEY, T, makeSvc, withKey } from './helpers.js';

const TOKEN = '0x000000000000000000000000000000000000a001';
const PAIR = '0x00000000000000000000000000000000000000b1';
const W = '0x00000000000000000000000000000000000000aa';
const DEV = '0x00000000000000000000000000000000000000d0';
const OTHER = '0x00000000000000000000000000000000000000bb';
const TORNADO = '0x12d66f87a04a9e220743712ce6d9bb1b5616b8fc';
const created = [0, 1, 2].map((n) => getContractAddress({ from: DEV, nonce: BigInt(n) }).toLowerCase());

const pair = (o: Partial<DexPair> = {}): DexPair => ({
  chainId: 'robinhood', dexId: 'uniswap', pairAddress: PAIR, baseToken: { address: TOKEN, symbol: 'RUSHR' }, quoteToken: { address: '0xq', symbol: 'WETH' },
  priceUsd: '2', liquidity: { usd: 10_000 }, volume: { h24: 400_000 }, txns: { h24: { buys: 1500, sells: 1490 } }, priceChange: { h24: 0.5 }, ...o,
});
const dex = async () => [pair()];

const transfers = [
  { address: TOKEN, args: { from: W, to: OTHER, value: 10n }, blockNumber: 5n, transactionHash: '0x1' },
  { address: TOKEN, args: { from: OTHER, to: W, value: 10n }, blockNumber: 6n, transactionHash: '0x2' },
  { address: TOKEN, args: { from: PAIR, to: W, value: 3n * 10n ** 18n }, blockNumber: 7n, transactionHash: '0x3' },
  { address: TOKEN, args: { from: W, to: PAIR, value: 1n * 10n ** 18n }, blockNumber: 8n, transactionHash: '0x4' },
  { address: TOKEN, args: { from: TORNADO, to: W, value: 1n }, blockNumber: 1n, transactionHash: '0x5' },
];

function client(): ChainClient {
  return {
    getBlockNumber: async () => 100n,
    getLogs: async ({ address, args }: { address?: string; args?: { from?: string; to?: string } }) => {
      if (address === PAIR) return [{ address: PAIR, args: { from: '0x0000000000000000000000000000000000000000', to: DEV, value: 1n }, blockNumber: 1n, transactionHash: '0x9' }];
      let rows = transfers.filter((t) => !address || t.address === address);
      if (args?.to) rows = rows.filter((t) => t.args.to === args.to);
      if (args?.from) rows = rows.filter((t) => t.args.from === args.from);
      return rows.concat(address === TOKEN && !args?.to && !args?.from ? Array.from({ length: 60 }, (_, i) => ({ address: TOKEN, args: i % 2 ? { from: W, to: OTHER, value: 1n } : { from: OTHER, to: W, value: 1n }, blockNumber: 50n, transactionHash: `0x${i}` })) : []);
    },
    readContract: async ({ address, functionName, args }: { address: string; functionName: string; args?: string[] }) => {
      if (functionName === 'totalSupply') return address === PAIR ? 1000n : 10n ** 24n;
      if (functionName === 'balanceOf') return address === PAIR ? (args?.[0] === DEV ? 900n : 0n) : 2n * 10n ** 18n;
      if (functionName === 'symbol') return created.includes(address) ? `T${created.indexOf(address)}` : 'RUSHR';
      if (functionName === 'decimals') return 18;
      if (functionName === 'token0' && address === PAIR) return TOKEN;
      throw new Error('nope');
    },
    getCode: async ({ address }: { address: string }) => (created.includes(address) || address === TOKEN || address === PAIR ? '0x6080' : '0x'),
    getTransactionCount: async ({ address }: { address: string }) => (address === DEV ? 3 : 12),
    getStorageAt: async () => '0x',
  } as unknown as ChainClient;
}

const svcWith = () => {
  const ctx = makeSvc();
  Object.assign(ctx.svc, { chains: new ChainRegistry(undefined, () => client()), walletRange: 400n, dex });
  return ctx;
};
const k = { agentId: 't', apiKey: null, ip: '9.9.9.9' };

describe('judge: wash trading and LP', () => {
  it('flags fake volume and circular transfers', async () => {
    const r = await washCheck(client(), TOKEN, 'robinhood', { range: 100n, dex });
    expect(r.washTrading).toBe('likely');
    expect(r.signals.join(' ')).toMatch(/40× liquidity/);
    expect(r.signals.join(' ')).toMatch(/bounce between the same wallets/);
    const clean = await washCheck(client(), TOKEN, 'robinhood', { range: 100n, dex: async () => [pair({ volume: { h24: 5000 }, txns: { h24: { buys: 100, sells: 40 } }, priceChange: { h24: 12 } })] });
    expect(clean.score).toBeLessThan(r.score);
  });
  it('LP held by a plain wallet can be pulled; v4 positions cannot be locked', async () => {
    const r = await lpStatus(client(), TOKEN, 'robinhood', { range: 100n, dex });
    expect(r).toMatchObject({ status: 'unlocked', risk: 'high' });
    const v4 = await lpStatus(client(), TOKEN, 'robinhood', { range: 100n, dex: async () => [pair({ pairAddress: `0x${'ab'.repeat(32)}` })] });
    expect(v4.status).toBe('position-based');
    expect((await lpStatus(client(), TOKEN, 'robinhood', { range: 100n, dex: async () => [] })).status).toBe('no market');
  });
});

describe('inspect: deployer, funding, labels, moves, pnl', () => {
  it('lists every CREATE deployment from the deployer nonce', async () => {
    const h = await deployerHistory(client(), DEV);
    expect(h.contracts.map((c) => c.address)).toEqual(created);
    expect(h.contracts.every((c) => c.isToken)).toBe(true);
  });
  it('traces first funders and labels a mixer', async () => {
    const r = await traceFunding(client(), W, { range: 100n, label: (a) => (a === TORNADO ? 'Tornado Cash 0.1 ETH' : null) });
    expect(r.firstFunders[0]).toMatchObject({ from: TORNADO, label: 'Tornado Cash 0.1 ETH' });
  });
  it('labels known addresses and reads traits', async () => {
    expect(await labelAddress(client(), TORNADO as `0x${string}`)).toMatchObject({ label: 'Tornado Cash 0.1 ETH', kind: 'mixer' });
    expect((await labelAddress(client(), PAIR)).kind).toBe('liquidity pool');
    expect((await labelAddress(client(), W)).traits[0]).toBe('12 transactions sent');
  });
  it('marks buys and sells against the pool', async () => {
    const r = await walletMoves(client(), W, { range: 100n, token: TOKEN, pools: new Set([PAIR]) });
    expect(r.sold).toBe(1);
    expect(r.bought).toBe(1);
  });
  it('values flows at current prices', async () => {
    const r = await walletPnl(client(), W, 'robinhood', { range: 100n, dex });
    const t = r.tokens.find((x) => x.token === TOKEN)!;
    expect(t).toMatchObject({ boughtQty: 3, soldQty: 1, heldQty: 2, heldUsd: 4, netFlowUsd: -4 });
  });
});

describe('act: swap, bridge, stop-loss', () => {
  it('builds a prefilled Uniswap link', () => {
    expect(uniswapLink('robinhood', 'NATIVE', TOKEN, '0.5')).toBe(`https://app.uniswap.org/swap?chain=robinhood&inputCurrency=NATIVE&outputCurrency=${TOKEN}&exactAmount=0.5&exactField=input`);
  });
  it('prepare_swap refuses dying tokens and rule breaks, prepares healthy ones', async () => {
    const { svc } = svcWith();
    const ok = await runTool(svc, 'verdict_prepare_swap', { from: 'NATIVE', to: T.rushr, amount: '0.1' }, k);
    expect((ok.envelope as { data: { prepared: boolean; link: string } }).data).toMatchObject({ prepared: true });
    const dying = await runTool(svc, 'verdict_prepare_swap', { from: 'NATIVE', to: T.robot }, k);
    expect((dying.envelope as { data: { prepared: boolean; link: null } }).data).toMatchObject({ prepared: false, link: null });
    const rule = await runTool(svc, 'verdict_prepare_swap', { from: 'NATIVE', to: T.rushr, amountUsd: 500, rules: 'max 100 usd per swap' }, k);
    expect((rule.envelope as { data: { prepared: boolean } }).data.prepared).toBe(false);
  });
  it('bridge check warns when the destination has no market', async () => {
    const r = await bridgeSides(TOKEN, 'ethereum', 'robinhood', undefined, async () => [pair({ chainId: 'ethereum' })]);
    expect(r.from).not.toBeNull();
    expect(r.to).toBeNull();
  });
  it('stop-loss fires once when the score crosses below the threshold', async () => {
    const { svc, store, advance } = makeSvc();
    const key = await withKey(svc, ['watch']);
    await runTool(svc, 'verdict_watch_token', { address: T.zolva, webhookUrl: 'https://hook.example/sl', stopLossBelow: 60, idempotencyKey: 'stop-loss-01' }, { agentId: 'a', apiKey: key });
    for (const s of store.scores) s.score = 70;
    advance(3 * 60_000);
    await svc.cache.close();
    const sent: { kind: string; detail: string }[] = [];
    const r = await tick(svc, { random: () => 0.5, deliver: async (_u, b) => { sent.push(b as never); return true; } });
    expect(r.fired.map((f) => f.kind)).toContain('STOP_LOSS');
    expect(sent.find((s) => s.kind === 'STOP_LOSS')!.detail).toContain('app.uniswap.org/swap');
    advance(3 * 60_000);
    await svc.cache.close();
    expect((await tick(svc, { random: () => 0.5, deliver: async () => true })).fired.filter((f) => f.kind === 'STOP_LOSS')).toHaveLength(0);
    expect(KEY).toBeTruthy();
  });
});

describe('every deep tool runs over MCP', () => {
  it('returns envelopes', async () => {
    const { svc } = svcWith();
    const calls: [string, unknown][] = [
      ['verdict_wash_check', { address: TOKEN }],
      ['verdict_lp_status', { address: TOKEN }],
      ['verdict_deployer_history', { address: DEV, judge: false }],
      ['verdict_trace_funding', { wallet: W }],
      ['verdict_label_address', { address: W }],
      ['verdict_wallet_moves', { wallet: W, token: TOKEN }],
      ['verdict_wallet_pnl', { wallet: W }],
      ['verdict_prepare_swap', { from: 'NATIVE', to: T.rushr }],
      ['verdict_bridge_check', { token: TOKEN, fromChain: 'robinhood', toChain: 'robinhood' }],
    ];
    for (const [name, args] of calls) {
      const out = await runTool(svc, name, args, k);
      expect(out.ok, `${name}: ${JSON.stringify(out.envelope).slice(0, 300)}`).toBe(true);
    }
  });
});
