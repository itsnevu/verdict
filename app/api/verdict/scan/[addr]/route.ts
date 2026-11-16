import { NextResponse } from 'next/server';

const API = process.env.VERDICT_API_URL ?? 'http://127.0.0.1:8080';

/** Proxy to the VERDICT API so the browser never needs CORS or an API key. Read-only. */
export async function GET(_req: Request, { params }: { params: Promise<{ addr: string }> }) {
  const { addr } = await params;
  if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) {
    return NextResponse.json({ error: { code: 'INVALID_ADDRESS', message: 'paste a 0x + 40 hex token address', retryable: false } }, { status: 400 });
  }
  try {
    const r = await fetch(`${API}/v1/scan/${addr.toLowerCase()}`, { headers: { 'x-agent-id': 'landing-try-live' }, signal: AbortSignal.timeout(55_000), cache: 'no-store' });
    const body = await r.json();
    return NextResponse.json(body, { status: r.status, headers: { 'cache-control': 'public, max-age=45' } });
  } catch {
    return NextResponse.json({ error: { code: 'API_UNAVAILABLE', message: 'the VERDICT API is not reachable right now', retryable: true } }, { status: 503 });
  }
}
