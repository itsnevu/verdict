import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  FLAG_BITS, LABEL_INDEX, bytes32Text, canonicalJson, evaluate, flagsToMask, inputsHash, maskToFlags, toOracleVerdict, type OracleVerdict, type TokenInputs,
} from '@verdictagent/core';
import { buildApp } from '../src/http/app.js';
import { runTool } from '../src/mcp/tools.js';
import type { OnchainVerdict } from '../src/oracle.js';
import type { Oracle } from '../src/service.js';
import { T, makeSvc, withKey } from './helpers.js';

const fx = (n: string): TokenInputs => JSON.parse(readFileSync(fileURLToPath(new URL(`../../../test/fixtures/${n}.json`, import.meta.url)), 'utf8'));

describe('onchain encoding (must match VerdictOracle.sol)', () => {
  it('canonical JSON ignores key order, so the inputs hash is stable', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { y: 1, x: 2 }], c: null } })).toBe('{"a":{"c":null,"d":[3,{"x":2,"y":1}]},"b":1}');
    const i = fx('zolva');
    // rebuild every object with its keys in reverse order
    const reverseKeys = (v: unknown): unknown => (Array.isArray(v) ? v.map(reverseKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reverseKeys(x)])) : v);
    const shuffled = reverseKeys(i) as TokenInputs;
    expect(JSON.stringify(shuffled)).not.toBe(JSON.stringify(i));
    expect(inputsHash(shuffled)).toBe(inputsHash(i));
    expect(inputsHash(i)).toMatch(/^0x[0-9a-f]{64}$/);
    expect(inputsHash({ ...i, now: '2026-11-16T12:00:01.000Z' })).not.toBe(inputsHash(i));
  });
  it('labels and flag bits match the contract', () => {
    expect(LABEL_INDEX).toEqual({ HEALTHY: 0, WATCH: 1, DECAYING: 2, COLLAPSING: 3, DEAD: 4 });
    expect(FLAG_BITS.PUMP_EXHAUSTED).toBe(1);
    expect(FLAG_BITS.LOW_CONFIDENCE).toBe(128);
    expect(maskToFlags(flagsToMask(['THIN', 'BUNDLED', 'FRESH']))).toEqual(['THIN', 'BUNDLED', 'FRESH']);
    expect(() => bytes32Text('x'.repeat(32))).toThrow();
  });
  it('maps an engine verdict to the contract struct', () => {
    const i = fx('zolva');
    const v = evaluate(i);
    const o = toOracleVerdict(v, i, 123n)!;
    expect(o.score).toBe(v.score);
    expect(o.label).toBe(LABEL_INDEX[v.label!]);
    expect(o.confidenceBps).toBe(10_000);
    expect(maskToFlags(o.flags)).toEqual(v.flags);
    expect(o.evaluatedAt).toBe(BigInt(Date.parse(i.now) / 1000));
    expect(o.inputsHash).toBe(inputsHash(i));
    const none = fx('degraded');
    none.market = null;
    expect(toOracleVerdict(evaluate(none), none, 1n)).toBeNull();
  });
});

/** In-memory stand-in for the deployed contract, with the same forward-only rule. */
class FakeOracle implements Oracle {
  address = '0x00000000000000000000000000000000000oracle'.replace('oracle', '0bacle') as `0x${string}`;
  chainId = 4663;
  writable = true;
  sent: { token: string; v: OracleVerdict }[] = [];
  private store = new Map<string, OracleVerdict>();
  async blockNumber() { return 115_000_000n; }
  async status() { return { paused: false, canAttest: true }; }
  txUrl(h: string) { return `https://robinhoodchain.blockscout.com/tx/${h}`; }
  async read(token: `0x${string}`): Promise<OnchainVerdict> {
    const v = this.store.get(token);
    if (!v) return { attested: false };
    return { attested: true, score: v.score, inputsHash: v.inputsHash, evaluatedAt: new Date(Number(v.evaluatedAt) * 1000).toISOString() };
  }
  async attest(token: `0x${string}`, v: OracleVerdict) {
    const prev = this.store.get(token);
    if (prev && v.evaluatedAt <= prev.evaluatedAt) throw new Error('NotNewer');
    this.store.set(token, v);
    this.sent.push({ token, v });
    return { txHash: `0x${String(this.sent.length).padStart(64, '0')}` as `0x${string}`, blockNumber: 115_000_001n };
  }
}

const withOracle = (o: FakeOracle | null) => {
  const ctx = makeSvc();
  (ctx.svc as { oracle: Oracle | null }).oracle = o;
  return ctx;
};

describe('verdict_attest_token', () => {
  it('reports ORACLE_NOT_CONFIGURED without an attester', async () => {
    const { svc } = withOracle(null);
    const key = await withKey(svc, ['attest']);
    const r = await runTool(svc, 'verdict_attest_token', { address: T.zolva, idempotencyKey: 'attest-0001' }, { agentId: 'a', apiKey: key });
    expect(r.ok ? null : r.envelope.error.code).toBe('ORACLE_NOT_CONFIGURED');
  });
  it('needs the attest scope', async () => {
    const { svc } = withOracle(new FakeOracle());
    const key = await withKey(svc, ['watch']);
    const r = await runTool(svc, 'verdict_attest_token', { address: T.zolva, idempotencyKey: 'attest-0002' }, { agentId: 'a', apiKey: key });
    expect(r.ok ? null : r.envelope.error.code).toBe('SCOPE_REQUIRED');
  });
  it('writes once, then reuses the onchain record for identical inputs, and replays by idempotency key', async () => {
    const o = new FakeOracle();
    const { svc } = withOracle(o);
    const key = await withKey(svc, ['attest']);
    const k = { agentId: 'a', apiKey: key };
    const first = await runTool(svc, 'verdict_attest_token', { address: T.zolva, idempotencyKey: 'attest-0003' }, k);
    expect(first.ok).toBe(true);
    const d1 = (first as { envelope: { data: Record<string, unknown> } }).envelope.data;
    expect(d1.alreadyOnchain).toBe(false);
    expect(d1.txHash).toMatch(/^0x0+1$/);
    expect(o.sent).toHaveLength(1);
    expect(o.sent[0]!.v.inputsHash).toBe(inputsHash((await svc.scan(T.zolva)).inputs));

    const replay = await runTool(svc, 'verdict_attest_token', { address: T.zolva, idempotencyKey: 'attest-0003' }, k);
    expect((replay as { envelope: { data: { replayed: boolean } } }).envelope.data.replayed).toBe(true);

    const same = await runTool(svc, 'verdict_attest_token', { address: T.zolva, idempotencyKey: 'attest-0004' }, k);
    expect((same as { envelope: { data: { alreadyOnchain: boolean } } }).envelope.data.alreadyOnchain).toBe(true);
    expect(o.sent).toHaveLength(1);
  });
  it('scan shows the onchain record and suggests attesting when it is stale', async () => {
    const o = new FakeOracle();
    const { svc } = withOracle(o);
    const before = await runTool(svc, 'verdict_scan_token', { address: T.rushr }, { agentId: 'a', apiKey: null });
    const env = (before as { envelope: { data: { onchain: { attested: boolean; matchesCurrent: boolean } }; nextActions: { tool: string }[] } }).envelope;
    expect(env.data.onchain).toMatchObject({ attested: false, matchesCurrent: false, chainId: 4663 });
    expect(env.nextActions.map((n) => n.tool)).toContain('verdict_attest_token');
    const key = await withKey(svc, ['attest']);
    await runTool(svc, 'verdict_attest_token', { address: T.rushr, idempotencyKey: 'attest-0005' }, { agentId: 'a', apiKey: key });
    const after = await runTool(svc, 'verdict_scan_token', { address: T.rushr }, { agentId: 'a', apiKey: null });
    const env2 = (after as { envelope: { data: { onchain: { matchesCurrent: boolean } }; nextActions: { tool: string }[] } }).envelope;
    expect(env2.data.onchain.matchesCurrent).toBe(true);
    expect(env2.nextActions.map((n) => n.tool)).not.toContain('verdict_attest_token');
  });
  it('a broken oracle never breaks a scan', async () => {
    const o = new FakeOracle();
    o.read = async () => { throw new Error('rpc down\nlong body'); };
    const { svc } = withOracle(o);
    const r = await runTool(svc, 'verdict_scan_token', { address: T.rushr }, { agentId: 'a', apiKey: null });
    expect(r.ok).toBe(true);
    expect((r as { envelope: { data: { onchain: { error: string } } } }).envelope.data.onchain.error).toBe('oracle read failed');
  });
  it('is exposed over HTTP and in health', async () => {
    const { svc } = withOracle(new FakeOracle());
    const key = await withKey(svc, ['attest']);
    const app = buildApp(svc);
    const r = await app.inject({ method: 'POST', url: '/v1/attest', headers: { authorization: `Bearer ${key}` }, payload: { address: T.nifty, idempotencyKey: 'attest-http-1' } });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.txHash).toMatch(/^0x/);
    const h = (await app.inject({ url: '/v1/health' })).json().data;
    expect(h.oracle).toMatchObject({ chainId: 4663, writable: true, paused: false, canAttest: true });
  });
});
