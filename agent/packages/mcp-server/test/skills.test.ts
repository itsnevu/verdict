import { describe, expect, it } from 'vitest';
import { decodeFunctionData, erc20Abi, keccak256, toFunctionSelector } from 'viem';
import { buildApp } from '../src/http/app.js';
import { runTool } from '../src/mcp/tools.js';
import { seed } from '../src/seed.js';
import { ChainRegistry, type ChainClient } from '../src/skills/chains.js';
import { readContractReport, scanSelectors } from '../src/skills/contract.js';
import { lintSolidity } from '../src/skills/lint.js';
import { formatAlert } from '../src/skills/notify.js';
import { checkPolicy, parsePolicy } from '../src/skills/policy.js';
import { badgeSvg, reportHtml, trackRecord } from '../src/skills/report.js';
import { decodeTx, simulateTx } from '../src/skills/tx.js';
import { prepareRevokes, rateApproval, walletApprovals, walletHoldings } from '../src/skills/wallet.js';
import { T, makeSvc } from './helpers.js';

const W = '0x00000000000000000000000000000000000000aa';
const TOK = '0x000000000000000000000000000000000000a001';
const SPENDER_EOA = '0x00000000000000000000000000000000000000ee';
const SPENDER_C = '0x00000000000000000000000000000000000000cc';
const sel = (s: string) => toFunctionSelector(s).slice(2);
const CODE = `0x6080${'63' + sel('mint(address,uint256)')}${'63' + sel('setBlacklist(address,bool)')}${'63' + sel('setFees(uint256,uint256)')}00`;

/** One fake chain client that answers everything the skills ask. */
function fakeClient(over: Partial<ChainClient> = {}): ChainClient {
  return {
    getBlockNumber: async () => 1_000n,
    getCode: async ({ address }: { address: string }) => (address === TOK || address === SPENDER_C ? CODE : '0x'),
    getStorageAt: async () => '0x0000000000000000000000001111111111111111111111111111111111111111',
    readContract: async ({ functionName, address, args }: { functionName: string; address: string; args?: string[] }) => {
      if (functionName === 'owner') return '0x2222222222222222222222222222222222222222';
      if (functionName === 'paused') return false;
      if (functionName === 'symbol') return address === TOK ? 'RUSHR' : 'X';
      if (functionName === 'name') return 'Rushr';
      if (functionName === 'decimals') return 18;
      if (functionName === 'totalSupply') return 10n ** 24n;
      if (functionName === 'balanceOf') return 5n * 10n ** 18n;
      if (functionName === 'allowance') return args?.[1] === SPENDER_EOA ? 2n ** 256n - 1n : 10n ** 18n;
      throw new Error('no such function');
    },
    getLogs: async ({ args }: { args?: Record<string, string> }) => {
      if (args?.to) return [{ address: TOK }, { address: TOK }];
      if (args?.owner) return [{ address: TOK, args: { spender: SPENDER_EOA } }, { address: TOK, args: { spender: SPENDER_C } }];
      return [];
    },
    getTransaction: async () => ({ from: W, to: TOK, value: 0n, input: `0x${sel('approve(address,uint256)')}${'0'.repeat(128)}` }),
    getTransactionReceipt: async () => ({
      status: 'success', blockNumber: 99n, gasUsed: 46000n,
      logs: [{ address: TOK, topics: ['0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925', `0x${'0'.repeat(24)}${W.slice(2)}`, `0x${'0'.repeat(24)}${SPENDER_C.slice(2)}`], data: '0x05' }],
    }),
    call: async () => ({ data: '0x' }),
    estimateGas: async () => 46000n,
    ...over,
  } as unknown as ChainClient;
}

const withChains = (client = fakeClient()) => {
  const ctx = makeSvc();
  Object.assign(ctx.svc, { chains: new ChainRegistry(undefined, () => client), walletRange: 2_000n, sigLookup: async (_k: string, h: string) => (h === toFunctionSelector('approve(address,uint256)') ? 'approve(address,uint256)' : null) });
  return ctx;
};
const k = { agentId: 't', apiKey: null, ip: '1.1.1.1' };

describe('contract reader', () => {
  it('finds risky functions in the dispatcher', () => {
    expect(scanSelectors(CODE).map((x) => x.risk).sort()).toEqual(['blacklist', 'fees', 'mint']);
    expect(scanSelectors('0x6080')).toEqual([]);
  });
  it('reports owner, proxy, risks and clones', async () => {
    const hashes = new Map<string, Set<string>>();
    const r = await readContractReport(fakeClient(), TOK, hashes);
    expect(r).toMatchObject({ isContract: true, owner: '0x2222222222222222222222222222222222222222', ownershipRenounced: false, paused: false, proxy: { isProxy: true } });
    expect(r.codeHash).toBe(keccak256(CODE));
    expect(r.risks.join(' ')).toMatch(/proxy.*mint|mint/);
    expect(r.risks.some((x) => x.includes('blacklist'))).toBe(true);
    expect(r.risks.some((x) => x.includes('fees can be changed'))).toBe(true);
    const clone = await readContractReport(fakeClient(), SPENDER_C, hashes);
    expect(clone.clones).toEqual([TOK]);
    const eoa = await readContractReport(fakeClient(), W, hashes);
    expect(eoa.isContract).toBe(false);
  });
});

describe('wallet', () => {
  it('holdings come from recent transfers with live balances', async () => {
    const h = await walletHoldings(fakeClient(), W, { range: 2_000n });
    expect(h.holdings).toEqual([{ token: TOK, symbol: 'RUSHR', decimals: 18, balance: (5n * 10n ** 18n).toString(), amount: 5 }]);
    expect(h.approximate).toBe(true);
  });
  it('rates approvals: unlimited to a plain wallet is high, a bounded one to a contract is lower', async () => {
    expect(rateApproval({ allowance: 2n ** 256n - 1n, spenderIsContract: false, spenderLabel: null }).risk).toBe('high');
    expect(rateApproval({ allowance: 10n, spenderIsContract: true, spenderLabel: 'Uniswap Permit2' }).risk).toBe('low');
    expect(rateApproval({ allowance: 10n, spenderIsContract: true, spenderLabel: null }).risk).toBe('medium');
    const rows = await walletApprovals(fakeClient(), W, { range: 2_000n });
    expect(rows.map((r) => [r.spender, r.risk, r.unlimited])).toEqual([[SPENDER_EOA, 'high', true], [SPENDER_C, 'medium', false]]);
  });
  it('prepares unsigned approve(spender, 0) and simulates each', async () => {
    const txs = await prepareRevokes(fakeClient({ call: async ({ to }: { to: string }) => { if (to === SPENDER_C) throw new Error('reverted'); return { data: '0x' }; } } as never), 4663, W, [{ token: TOK, spender: SPENDER_EOA }, { token: SPENDER_C, spender: SPENDER_EOA }]);
    const d = decodeFunctionData({ abi: erc20Abi, data: txs[0]!.data });
    expect(d.functionName).toBe('approve');
    expect([String(d.args![0]).toLowerCase(), d.args![1]]).toEqual([SPENDER_EOA, 0n]);
    expect(txs[0]).toMatchObject({ chainId: 4663, to: TOK, value: '0', simulation: { ok: true } });
    expect(txs[1]!.simulation.ok).toBe(false);
  });
});

describe('transactions', () => {
  it('decodes the function and Approval events', async () => {
    const d = await decodeTx(fakeClient(), { key: 'robinhood', id: 4663, name: 'Robinhood Chain', rpc: '', explorer: 'https://x' }, `0x${'1'.repeat(64)}`, async (_k, h) => (h === toFunctionSelector('approve(address,uint256)') ? 'approve(address,uint256)' : null));
    expect(d).toMatchObject({ status: 'success', function: { signature: 'approve(address,uint256)' }, gasUsed: '46000' });
    expect(d.events[0]).toMatchObject({ kind: 'Approval', owner: W, spender: SPENDER_C, raw: '5' });
  });
  it('simulates success and revert', async () => {
    expect(await simulateTx(fakeClient(), { from: W, to: TOK })).toMatchObject({ ok: true, gas: '46000' });
    const bad = await simulateTx(fakeClient({ call: async () => { throw new Error("execution reverted with reason string 'no'\nmore"); } } as never), { from: W, to: TOK });
    expect(bad).toMatchObject({ ok: false, reason: 'no' });
  });
});

describe('solidity lint', () => {
  it('flags the classic fund-losing patterns', () => {
    const src = `pragma solidity ^0.8.0;
contract V {
  function withdraw() external { (bool ok,) = msg.sender.call{value: 1}(""); require(ok); }
  function admin() external { require(tx.origin == owner); }
  function x(address t) external { t.delegatecall(""); }
  function mint(address a, uint n) external {}
  function initialize() public {}
  function r() view returns (uint) { return uint(keccak256(abi.encode(block.timestamp))) % 10; }
}`;
    const r = lintSolidity(src);
    const rules = r.findings.map((f) => f.rule);
    for (const x of ['reentrancy', 'tx-origin-auth', 'delegatecall', 'unbounded-mint', 'public-init', 'floating-pragma', 'weak-randomness']) expect(rules).toContain(x);
    expect(r.counts.high).toBeGreaterThan(2);
    expect(lintSolidity('pragma solidity 0.8.28;\ncontract Ok { uint x; }').findings).toEqual([]);
  });
});

describe('VERDICT.md policy', () => {
  const p = parsePolicy(`# my rules
- never buy below score 55
- max 100 USDC per swap
- no unlimited approvals
- only swap through uniswap
- never touch tokens younger than 2d
- block 0x00000000000000000000000000000000000000ee
- be nice`);
  it('parses every rule form', () => {
    expect(p).toMatchObject({ minScore: 55, maxUsd: 100, noUnlimited: true, venues: ['uniswap'], minAgeHours: 48, blocked: [SPENDER_EOA] });
    expect(p.unknown).toEqual(['# my rules', '- be nice']);
  });
  it('blocks what breaks a rule and allows the rest', () => {
    expect(checkPolicy(p, { kind: 'swap', tokenScore: 40, amountUsd: 500, venue: 'sushiswap', tokenAgeHours: 3 }).violations).toHaveLength(4);
    expect(checkPolicy(p, { kind: 'approve', unlimited: true, tokenScore: 80 }).violations).toEqual(['unlimited approvals are not allowed']);
    expect(checkPolicy(p, { kind: 'swap', tokenScore: 70, amountUsd: 50, venue: 'Uniswap v4', tokenAgeHours: 100 }).allowed).toBe(true);
    expect(checkPolicy(p, { kind: 'revoke', to: SPENDER_C }).allowed).toBe(true);
    expect(checkPolicy(p, { kind: 'transfer', to: SPENDER_EOA }).allowed).toBe(false);
  });
});

describe('prove', () => {
  it('track record measures how verdicts held', async () => {
    const { svc, store } = makeSvc();
    await seed(store, new Date(Date.parse(svc.nowIso()) + 10 * 86_400_000));
    const r = await trackRecord(store, new Date(Date.parse(svc.nowIso()) + 10 * 86_400_000).toISOString(), 1);
    expect(r.verdictsChecked).toBeGreaterThan(0);
    expect(r.accuracy).toBeGreaterThanOrEqual(0);
    expect((await trackRecord(store, svc.nowIso(), 90)).accuracy).toBeNull();
  });
  it('badge always shows the real label and escapes input', () => {
    expect(badgeSvg({ score: 22, label: 'COLLAPSING' }, '<b>')).toContain('&lt;b&gt; 22 COLLAPSING');
    expect(badgeSvg(null, null)).toContain('no verdict');
  });
  it('report renders every signal', async () => {
    const { svc } = makeSvc();
    const r = await svc.scan(T.zolva);
    const html = reportHtml({ verdict: r.verdict, brief: r.brief, history: [], contract: { owner: null, proxy: { isProxy: false }, risks: ['trading can be paused'] }, generatedAt: 'now', sources: r.sources });
    for (const s of ['liq_ratio', 'PUMP_EXHAUSTED', 'trading can be paused', 'not financial advice']) expect(html).toContain(s);
  });
});

describe('alerts to chat apps', () => {
  const body = { kind: 'SCORE_DROP', address: TOK, detail: 'score 80 → 50', verdict: { score: 50, label: 'DECAYING', flags: ['THIN'] }, brief: 'b', ts: 'now' };
  it('formats Discord, Telegram and plain webhooks', () => {
    expect(formatAlert('https://discord.com/api/webhooks/1/abc', body).body).toMatchObject({ content: expect.stringContaining('SCORE_DROP') });
    expect(formatAlert('https://api.telegram.org/bot123:abc/sendMessage?chat_id=42', body).body).toMatchObject({ chat_id: '42', text: expect.stringContaining('DECAYING') });
    expect(formatAlert('https://hook.example/x', body).body).toEqual(body);
  });
});

describe('skill tools over MCP and HTTP', () => {
  it('every new tool runs and returns an envelope', async () => {
    const { svc } = withChains();
    const calls: [string, unknown][] = [
      ['verdict_read_contract', { address: TOK }],
      ['verdict_decode_tx', { hash: `0x${'1'.repeat(64)}`, chain: 'base' }],
      ['verdict_wallet_holdings', { wallet: W }],
      ['verdict_wallet_score', { wallet: W }],
      ['verdict_wallet_approvals', { wallet: W }],
      ['verdict_prepare_revoke', { wallet: W, all: true }],
      ['verdict_simulate_tx', { from: W, to: TOK, data: '0x' }],
      ['verdict_lint_solidity', { source: 'pragma solidity ^0.8.0; contract A {}' }],
      ['verdict_check_policy', { rules: 'min score 90', action: { kind: 'swap', token: T.rushr } }],
      ['verdict_track_record', {}],
    ];
    for (const [name, args] of calls) {
      const out = await runTool(svc, name, args, k);
      expect(out.ok, `${name}: ${JSON.stringify(out.envelope)}`).toBe(true);
    }
    const pol = await runTool(svc, 'verdict_check_policy', { rules: 'min score 90', action: { kind: 'swap', token: T.rushr } }, k);
    expect((pol.envelope as { data: { allowed: boolean } }).data.allowed).toBe(false);
    const bad = await runTool(svc, 'verdict_read_contract', { address: TOK, chain: 'solana' }, k);
    expect(bad.ok ? null : bad.envelope.error.code).toBe('UNKNOWN_CHAIN');
  });
  it('serves the report page, badge and HTTP routes', async () => {
    const { svc } = withChains();
    const app = buildApp(svc);
    const rep = await app.inject({ url: `/report/${T.zolva}` });
    expect(rep.headers['content-type']).toContain('text/html');
    expect(rep.body).toContain('VERDICT REPORT');
    expect(rep.headers['content-security-policy']).toContain("default-src 'none'");
    const badge = await app.inject({ url: `/badge/${T.robot}.svg` });
    expect(badge.headers['content-type']).toContain('image/svg+xml');
    expect(badge.body).toMatch(/ROBOT \d+ (COLLAPSING|DEAD)/);
    expect((await app.inject({ url: `/v1/contract/${TOK}` })).json().data.capabilities.length).toBe(3);
    expect((await app.inject({ method: 'POST', url: '/v1/lint', payload: { source: 'contract A { function f() { selfdestruct(payable(msg.sender)); } }' } })).json().data.findings[0].rule).toBe('selfdestruct');
    expect((await app.inject({ url: '/v1/track-record?days=7' })).statusCode).toBe(200);
  });
});
