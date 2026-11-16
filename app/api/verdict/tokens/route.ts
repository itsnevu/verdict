import { NextResponse } from 'next/server';

const API = process.env.VERDICT_API_URL ?? 'http://127.0.0.1:8080';

/** Latest verdicts for the live strip. Empty list when the API is down. */
export async function GET() {
  try {
    const r = await fetch(`${API}/v1/tokens?limit=12`, { headers: { 'x-agent-id': 'landing-strip' }, signal: AbortSignal.timeout(8_000), cache: 'no-store' });
    const body = (await r.json()) as { data?: unknown[] };
    return NextResponse.json({ data: Array.isArray(body.data) ? body.data : [] }, { headers: { 'cache-control': 'public, max-age=30' } });
  } catch {
    return NextResponse.json({ data: [] });
  }
}
