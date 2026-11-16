import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/http/app.js';
import { bootstrap } from '../src/runtime.js';
import { assertPublicUrl, isBlockedIp } from '../src/net.js';
import { leaderboard } from '../src/agents.js';
import { quotaKeyOf, runTool } from '../src/mcp/tools.js';
import { tick } from '../src/worker/worker.js';
import { KEY, T, makeSvc, withKey } from './helpers.js';

const pub = async () => ['93.184.216.34'];

describe('SSRF guard', () => {
  it('blocks private, loopback, link-local, metadata and reserved ranges', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', 'not-an-ip']) {
      expect(isBlockedIp(ip), ip).toBe(true);
    }
    for (const ip of ['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:4700::1111']) expect(isBlockedIp(ip), ip).toBe(false);
  });
  it('rejects non-https, credentials, internal names and hosts resolving inward', async () => {
    const bad = ['http://hook.example/x', 'https://user:pw@hook.example/x', 'https://localhost/x', 'https://postgres:5432/', 'https://redis/', 'https://api.internal/x', 'https://169.254.169.254/latest', 'https://[::1]/', 'ftp://hook.example', 'not a url'];
    for (const u of bad) await expect(assertPublicUrl(u, { resolve: pub }), u).rejects.toMatchObject({ code: 'UNSAFE_URL' });
    await expect(assertPublicUrl('https://rebind.example/x', { resolve: async () => ['93.184.216.34', '10.0.0.1'] })).rejects.toMatchObject({ code: 'UNSAFE_URL' });
    await expect(assertPublicUrl('https://gone.example/x', { resolve: async () => { throw new Error('ENOTFOUND'); } })).rejects.toMatchObject({ code: 'UNSAFE_URL' });
    await expect(assertPublicUrl('https://hook.example/x', { resolve: pub })).resolves.toBeInstanceOf(URL);
    await expect(assertPublicUrl('http://hook.example/x', { resolve: pub, allowInsecure: true })).resolves.toBeInstanceOf(URL);
  });
  it('watch and registry refuse internal targets before any request is made', async () => {
    let probed = 0;
    const { svc } = makeSvc({ probe: async () => { probed++; return { reachable: true, tlsValid: true, liveTools: [], checkedAt: '' }; } });
    const key = await withKey(svc);
    const k = { agentId: 'a', apiKey: key };
    const w = await runTool(svc, 'verdict_watch_token', { address: T.rushr, webhookUrl: 'https://metadata.evil/latest', idempotencyKey: 'ssrf-watch-1' }, k);
    expect(w.ok ? null : w.envelope.error.code).toBe('UNSAFE_URL');
    const r = await runTool(svc, 'verdict_register_mcp', { url: 'https://db.evil/mcp', declaredTools: [{ name: 'x' }], idempotencyKey: 'ssrf-reg-01' }, k);
    expect(r.ok ? null : r.envelope.error.code).toBe('UNSAFE_URL');
    expect(probed).toBe(0);
  });
});

describe('ownership and isolation', () => {
  it('two keys watching the same token keep separate watches and both receive alerts', async () => {
    const { svc, store, advance } = makeSvc();
    const a = await withKey(svc, ['watch'], 'key-alpha-0000000000000000');
    const b = await withKey(svc, ['watch'], 'key-bravo-0000000000000000');
    await runTool(svc, 'verdict_watch_token', { address: T.zolva, webhookUrl: 'https://a.example/hook', idempotencyKey: 'same-key-xyz' }, { agentId: 'A', apiKey: a });
    const rb = await runTool(svc, 'verdict_watch_token', { address: T.zolva, webhookUrl: 'https://b.example/hook', idempotencyKey: 'same-key-xyz' }, { agentId: 'B', apiKey: b });
    // B used the same idempotency key as A but must not see A's watch or webhook
    expect(rb.ok && (rb.envelope.data as { replayed: boolean; webhookUrl: string }).replayed).toBe(false);
    expect(rb.ok && (rb.envelope.data as { webhookUrl: string }).webhookUrl).toBe('https://b.example/hook');
    expect(store.watches.size).toBe(2);
    for (const s of store.scores) s.flags = [];
    advance(3 * 60_000);
    await svc.cache.close();
    const hits: string[] = [];
    const res = await tick(svc, { random: () => 0.5, deliver: async (u) => { hits.push(u); return true; } });
    expect(res.polled).toBe(1); // one scan for the token, not one per watcher
    expect(hits.sort()).toEqual(['https://a.example/hook', 'https://b.example/hook']);
  });
  it('another key cannot overwrite a registry entry', async () => {
    const { svc } = makeSvc();
    const a = await withKey(svc, ['registry'], 'key-alpha-0000000000000000');
    const b = await withKey(svc, ['registry'], 'key-bravo-0000000000000000');
    const args = { url: 'https://tools.example/mcp', declaredTools: [{ name: 'quote', description: 'quote a pair', readOnly: true }] };
    expect((await runTool(svc, 'verdict_register_mcp', { ...args, idempotencyKey: 'reg-a-00001' }, { agentId: 'A', apiKey: a })).ok).toBe(true);
    const hijack = await runTool(svc, 'verdict_register_mcp', { ...args, declaredTools: [{ name: 'drain', readOnly: false }], idempotencyKey: 'reg-b-00001' }, { agentId: 'B', apiKey: b });
    expect(hijack.ok ? null : hijack.envelope.error.code).toBe('ALREADY_REGISTERED');
    const update = await runTool(svc, 'verdict_register_mcp', { ...args, contractTargets: [], declaredTools: [{ name: 'quote', description: 'quote a pair, v2', readOnly: true }], idempotencyKey: 'reg-a-00002' }, { agentId: 'A', apiKey: a });
    expect(update.ok).toBe(true);
  });
});

describe('quota and leaderboard cannot be gamed with headers', () => {
  it('quota follows the IP (or API key), not X-Agent-Id', async () => {
    const { svc } = makeSvc({ quota: 1 });
    expect((await runTool(svc, 'verdict_scan_token', { address: T.rushr }, { agentId: 'one', apiKey: null, ip: '1.2.3.4' })).ok).toBe(true);
    const again = await runTool(svc, 'verdict_scan_token', { address: T.zolva }, { agentId: 'brand-new-name', apiKey: null, ip: '1.2.3.4' });
    expect(again.ok ? null : again.envelope.error.code).toBe('BUDGET_EXHAUSTED');
    expect((await runTool(svc, 'verdict_scan_token', { address: T.zolva }, { agentId: 'x', apiKey: null, ip: '5.6.7.8' })).ok).toBe(true);
    expect(quotaKeyOf({ agentId: 'x', apiKey: KEY })).toMatch(/^key:[0-9a-f]{24}$/);
  });
  it('only authenticated calls count toward the leaderboard', async () => {
    const { svc, store } = makeSvc({ minCalls: 1 });
    for (let i = 0; i < 30; i++) await store.recordCall({ agentId: 'spoof', quotaKey: 'ip:9.9.9.9', authenticated: false, tool: 'verdict_scan_token', address: T.rushr, ts: '2026-11-15T00:00:00.000Z', costUnits: 1, durationMs: 1, ok: true });
    expect((await leaderboard(store, svc.nowIso(), { minCalls: 1, minScans: 1 })).agents).toEqual([]);
  });
  it('X-Forwarded-For is ignored unless proxy hops are configured', async () => {
    const { svc } = makeSvc();
    const app = buildApp(svc);
    for (let i = 0; i < 30; i++) await app.inject({ url: `/v1/scan/${T.rushr}`, headers: { 'x-forwarded-for': `10.0.0.${i}` } });
    expect((await app.inject({ url: `/v1/scan/${T.rushr}`, headers: { 'x-forwarded-for': '10.9.9.9' } })).statusCode).toBe(429);
    const proxied = buildApp(makeSvc().svc, { trustProxyHops: 1 });
    for (let i = 0; i < 30; i++) await proxied.inject({ url: `/v1/scan/${T.rushr}`, headers: { 'x-forwarded-for': '7.7.7.7' } });
    expect((await proxied.inject({ url: `/v1/scan/${T.rushr}`, headers: { 'x-forwarded-for': '8.8.8.8' } })).statusCode).toBe(200);
  });
  it('compare charges each distinct address once', async () => {
    const { svc } = makeSvc();
    const r = await runTool(svc, 'verdict_compare_tokens', { addresses: [T.rushr, T.rushr.toUpperCase().replace('0X', '0x'), T.zolva] }, { agentId: 'c', apiKey: null, ip: '1.1.1.1' });
    expect(r.ok && r.envelope._meta.costUnits).toBe(2);
  });
});

describe('production guards', () => {
  it('refuses demo or short API keys in production', async () => {
    await expect(bootstrap({ NODE_ENV: 'production', API_KEYS: 'dev-key:watch' })).rejects.toThrow(/demo key/);
    const ok = await bootstrap({ NODE_ENV: 'production', API_KEYS: 'k_9f3c2a7d1e8b4c6a0f5d2e9b7a1c:watch', LOG_LEVEL: 'error' });
    await ok.shutdown();
  });
});
