// End-to-end smoke test against the *built* server, as a real client would see it.
// Covers section 21/22 checks that do not need Docker:
//   health, MCP over HTTP + stdio, envelope shape, degraded scan with an adapter off,
//   and one real scan against live DexScreener (skip with SMOKE_OFFLINE=1).
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const server = join(root, 'packages/mcp-server/dist/server.js');
const stdioBin = join(root, 'packages/mcp-server/bin/verdict-mcp');
const PORT = 18080 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;
// DEGEN on Base: a long-lived, liquid token so the live check is stable
const REAL = (process.env.SMOKE_REAL_TOKEN ?? '0x4ed4e862860bed51a9570b96d89af5e1b0efefed').toLowerCase();
const FIX = '0x000000000000000000000000000000000000a002';

let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failures++; };
const envelopeOk = (b) => b && 'data' in b && 'brief' in b && '_meta' in b && Array.isArray(b.nextActions)
  && ['engineVersion', 'fetchedAt', 'sources', 'confidence', 'costUnits', 'degraded'].every((k) => k in b._meta);

function start(env) {
  const p = spawn(process.execPath, [server], { env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', LOG_LEVEL: 'warn', ...env }, stdio: ['ignore', 'ignore', 'pipe'] });
  let err = '';
  p.stderr.on('data', (d) => { err += d; });
  return { p, err: () => err };
}
async function waitHealthy() {
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(`${BASE}/v1/health`); if (r.ok) return r; } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('server never became healthy');
}
const rpc = (body, headers = {}) => fetch(`${BASE}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers }, body: JSON.stringify(body) }).then((r) => r.json());

// ── 1. server with fixtures, basedbot switched off ──
let s = start({ USE_MOCK_SOURCE: '1', DISABLE_SOURCES: 'basedbot', API_KEYS: 'smoke:watch|registry' });
try {
  const h = await waitHealthy();
  const hb = await h.json();
  ok(h.status === 200 && hb.data.status === 'ok', 'GET /v1/health → 200 ok');
  ok(!hb.data.sources.some((x) => x.name === 'basedbot'), 'DISABLE_SOURCES removes the adapter');

  const init = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } } });
  ok(init.result?.serverInfo?.name === 'verdictagent', 'MCP initialize');
  const list = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  ok(list.result?.tools?.length === 11, `MCP tools/list → ${list.result?.tools?.length} tools`);
  const call = await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'verdict_scan_token', arguments: { address: FIX } } }, { 'x-agent-id': 'smoke-agent' });
  ok(envelopeOk(call.result?.structuredContent), 'MCP tools/call returns a valid envelope');
  ok(call.result?.structuredContent?.data?.flags?.includes('PUMP_EXHAUSTED'), 'fixture ZOLVA → PUMP_EXHAUSTED');

  const http = await fetch(`${BASE}/v1/scan/${FIX}`);
  ok(http.headers.get('x-ratelimit-limit') === '30' && envelopeOk(await http.json()), 'HTTP /v1/scan envelope + X-RateLimit-*');
  const scope = await fetch(`${BASE}/v1/watch`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address: FIX, idempotencyKey: 'smoke-watch-1' }) });
  ok(scope.status === 403 && (await scope.json()).error.code === 'SCOPE_REQUIRED', 'write without scope → SCOPE_REQUIRED');
  const page = await (await fetch(`${BASE}/?address=${FIX}`)).text();
  ok(page.includes('<table') && page.includes('PUMP_EXHAUSTED'), 'server-rendered page');
} catch (e) { ok(false, `server 1: ${e.message}\n${s.err()}`); } finally { s.p.kill('SIGTERM'); await new Promise((r) => s.p.once('exit', r)); }

// ── 2. real data: DexScreener live; RPC and BasedBot not configured, so holder signals are missing ──
if (process.env.SMOKE_OFFLINE !== '1') {
  s = start({ DISABLE_SOURCES: 'basedbot' });
  try {
    await waitHealthy();
    const r = await fetch(`${BASE}/v1/scan/${REAL}`);
    const b = await r.json();
    if (r.status === 200) {
      ok(envelopeOk(b) && b.data.score !== null, `real scan ${REAL}: ${b.data.symbol} score ${b.data.score} (${b.data.label}), confidence ${b.data.confidence}`);
      ok(b.data.confidence < 1 && b.data.missingSignals.includes('top10_share'), `real scan reports what it could not see: ${b.data.missingSignals.join(', ')}`);
      console.log(`      brief: ${b.brief}`);
    } else {
      ok(b.error && b.error.retryable !== undefined, `real scan returned a structured error ${b.error?.code} (network?)`);
    }
  } catch (e) { ok(false, `server 2: ${e.message}`); } finally { s.p.kill('SIGTERM'); await new Promise((r) => s.p.once('exit', r)); }
}

// ── 3. stdio transport ──
await new Promise((resolve) => {
  const p = spawn(process.execPath, [stdioBin], { env: { ...process.env, USE_MOCK_SOURCE: '1', LOG_LEVEL: 'error' }, stdio: ['pipe', 'pipe', 'ignore'] });
  let out = '';
  p.stdout.on('data', (d) => { out += d; });
  p.on('exit', () => {
    const msgs = out.split('\n').filter(Boolean).map((l) => JSON.parse(l));
    ok(msgs.find((m) => m.id === 1)?.result?.serverInfo?.name === 'verdictagent', 'stdio initialize');
    ok(msgs.find((m) => m.id === 2)?.result?.structuredContent?.brief?.startsWith('ROBOT'), 'stdio tools/call');
    resolve();
  });
  p.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })}\n`);
  p.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'verdict_agent_brief', arguments: { address: '0x000000000000000000000000000000000000a003' } } })}\n`);
  setTimeout(() => p.stdin.end(), 1500);
});

console.log(failures ? `\nsmoke: ${failures} failure(s)` : '\nsmoke: all checks passed');
process.exit(failures ? 1 : 0);
