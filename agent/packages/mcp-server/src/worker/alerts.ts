import type { ScoreRow } from '../store/types.js';

export type AlertKind = 'SCORE_DROP' | 'PUMP_EXHAUSTED' | 'DEV_SHARE_UP' | 'LIQUIDITY_DROP';
export interface AlertCandidate { kind: AlertKind; detail: string; payload: Record<string, unknown> }

const dev = (r: ScoreRow) => r.verdict.breakdown.find((b) => b.signal === 'dev_share')?.raw ?? null;

/**
 * Pure alert rules. `hourAgo` is the earliest score inside the last hour (null if none).
 * - score drops > 20 within 1h
 * - PUMP_EXHAUSTED appears (absent before)
 * - dev_share rises > 10 percentage points
 * - liquidity falls > 40% within 1h
 */
export function evaluateAlerts(current: ScoreRow, hourAgo: ScoreRow | null, previous: ScoreRow | null, liqNow: number | null, liqHourAgo: number | null): AlertCandidate[] {
  const out: AlertCandidate[] = [];
  if (hourAgo && hourAgo.score !== null && current.score !== null && hourAgo.score - current.score > 20) {
    out.push({ kind: 'SCORE_DROP', detail: `score ${hourAgo.score} → ${current.score} within 1h`, payload: { from: hourAgo.score, to: current.score } });
  }
  if (current.flags.includes('PUMP_EXHAUSTED') && !(previous?.flags.includes('PUMP_EXHAUSTED') ?? false)) {
    out.push({ kind: 'PUMP_EXHAUSTED', detail: 'pump exhausted: high 6h volume with a collapsing rate', payload: {} });
  }
  const base = previous ?? hourAgo;
  const d0 = base ? dev(base) : null, d1 = dev(current);
  if (d0 !== null && d1 !== null && d1 - d0 > 0.1) {
    out.push({ kind: 'DEV_SHARE_UP', detail: `dev share ${Math.round(d0 * 100)}% → ${Math.round(d1 * 100)}%`, payload: { from: d0, to: d1 } });
  }
  if (liqNow !== null && liqHourAgo !== null && liqHourAgo > 0 && (liqHourAgo - liqNow) / liqHourAgo > 0.4) {
    out.push({ kind: 'LIQUIDITY_DROP', detail: `liquidity $${Math.round(liqHourAgo)} → $${Math.round(liqNow)} within 1h`, payload: { from: liqHourAgo, to: liqNow } });
  }
  return out;
}

export const dedupeKey = (address: string, kind: string, tsIso: string) => `${address}:${kind}:${tsIso.slice(0, 13)}`;
