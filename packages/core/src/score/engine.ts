import type { BreakdownRow, Flag, Label, OverrideHit, TokenInputs, Verdict } from '../types.js';
import { clamp, piecewise, round } from './clamp.js';
import { SIGNALS, ageHours } from './signals.js';

export const ENGINE_VERSION = '1.0.0';

export function labelFor(score: number): Label {
  if (score >= 75) return 'HEALTHY';
  if (score >= 55) return 'WATCH';
  if (score >= 35) return 'DECAYING';
  if (score >= 20) return 'COLLAPSING';
  return 'DEAD';
}

/** Weighted base score; unavailable signals redistribute their weight proportionally. */
export function baseScore(i: TokenInputs): { score: number | null; rows: BreakdownRow[]; raws: Record<string, number | null> } {
  const raws: Record<string, number | null> = {};
  const scored = SIGNALS.map((s) => {
    const raw = s.compute(i);
    raws[s.key] = raw;
    return { s, raw, sc: raw === null ? null : piecewise(s.points, raw) };
  });
  const avail = scored.filter((x) => x.sc !== null).reduce((a, x) => a + x.s.weight, 0);
  const rows: BreakdownRow[] = scored.map(({ s, raw, sc }) => {
    const eff = sc === null || avail === 0 ? 0 : s.weight / avail;
    return {
      signal: s.key,
      raw: raw === null ? null : round(raw, 4),
      score: sc === null ? null : round(sc, 2),
      weight: s.weight,
      effectiveWeight: round(eff, 4),
      contribution: sc === null ? 0 : round(sc * eff, 2),
      status: sc === null ? 'unavailable' : 'ok',
    };
  });
  if (avail === 0) return { score: null, rows, raws };
  const total = scored.reduce((a, x) => a + (x.sc === null ? 0 : x.sc * (x.s.weight / avail)), 0);
  return { score: total, rows, raws };
}

/** Share of the first 50 buys that came from the <=3 most common funding sources. */
export function bundleShare(i: TokenInputs): number | null {
  const buys = i.earlyBuyers?.buys.slice(0, 50) ?? [];
  const funded = buys.filter((b) => b.fundingSource);
  if (buys.length < 10 || funded.length === 0) return null;
  const counts = new Map<string, number>();
  for (const b of funded) counts.set(b.fundingSource!, (counts.get(b.fundingSource!) ?? 0) + 1);
  const top3 = [...counts.values()].sort((a, b) => b - a).slice(0, 3).reduce((a, n) => a + n, 0);
  return top3 / buys.length;
}

const STALE_MS = 120_000;

export function evaluate(i: TokenInputs, engineVersion = ENGINE_VERSION): Verdict {
  const { score: base, rows, raws } = baseScore(i);
  const overrides: OverrideHit[] = [];
  const flags = new Set<Flag>();
  let score = base;
  let label: Label | null = null;
  let confidence = 1;

  const m = i.market;
  const age = ageHours(i);

  // ── overrides, in the documented order ──
  if (score !== null && (i.contract?.honeypot === true || i.contract?.sellFails === true)) {
    if (score > 25) overrides.push({ rule: 'honeypot_or_sell_fail', effect: 'capped at 25' });
    score = Math.min(score, 25);
  }
  const dev = i.holders?.devShare ?? null;
  if (score !== null && dev !== null && dev > 0.5) {
    if (score > 35) overrides.push({ rule: 'dev_share_gt_50pct', effect: 'capped at 35' });
    score = Math.min(score, 35);
  }
  if (score !== null && m && m.liqUsd < 3000) {
    if (score > 30) overrides.push({ rule: 'liquidity_lt_3000usd', effect: 'capped at 30' });
    score = Math.min(score, 30);
  }
  let dead = false;
  if (m && m.vol24hUsd === 0 && age !== null && age > 24) {
    dead = true;
    overrides.push({ rule: 'no_volume_24h_and_age_gt_24h', effect: 'label DEAD, score ignored' });
  }
  const bundle = bundleShare(i);
  if (score !== null && bundle !== null && bundle > 0.4) {
    score = score * 0.85;
    flags.add('BUNDLED');
    overrides.push({ rule: 'bundled_launch', effect: `x0.85 (top-3 funders made ${round(bundle * 100)}% of first buys)` });
  }
  const ur = raws.unique_ratio ?? null;
  if (i.sizeVariance !== null && i.sizeVariance < 0.1 && ur !== null && ur < 0.2) {
    flags.add('WASH_SUSPECT');
    confidence -= 0.2;
    overrides.push({ rule: 'wash_suspect', effect: 'confidence -0.2' });
  }

  // ── flags ──
  const volMc = raws.vol_mc ?? null;
  const volTrend = raws.vol_trend ?? null;
  if (volMc !== null && volTrend !== null && volMc > 3 && volTrend < 0.5) flags.add('PUMP_EXHAUSTED');
  if (m && m.mcUsd > 0 && m.vol24hUsd > 10 * m.mcUsd) flags.add('MC_COLLAPSED');
  if (m && m.mcUsd > 0 && m.liqUsd < 0.05 * m.mcUsd) flags.add('THIN');
  const top10 = raws.top10_share ?? null;
  if (top10 !== null && top10 > 0.7) flags.add('INSIDER_HEAVY');
  if (age !== null && age < 1) flags.add('FRESH');

  // ── confidence ──
  confidence -= 0.2 * i.sources.filter((s) => !s.complete).reduce((set, s) => set.add(s.name), new Set<string>()).size;
  if (!i.holders || i.holders.approximate) confidence -= 0.3;
  if (i.marketFetchedAt && Date.parse(i.now) - Date.parse(i.marketFetchedAt) > STALE_MS) confidence -= 0.2;
  confidence = round(clamp(confidence, 0, 1), 2);
  if (confidence < 0.5) flags.add('LOW_CONFIDENCE');

  // ── label ──
  if (dead) { label = 'DEAD'; score = 0; }
  else if (score !== null) { score = round(score); label = labelFor(score); }

  const missingSignals = rows.filter((r) => r.status === 'unavailable').map((r) => r.signal);
  return {
    address: i.address,
    symbol: m?.symbol ?? null,
    score,
    baseScore: base === null ? null : round(base, 2),
    label,
    confidence,
    flags: ORDER.filter((f) => flags.has(f)),
    breakdown: rows,
    overrides,
    lpLocked: i.contract?.lpLocked ?? null,
    missingSignals,
    engineVersion,
    evaluatedAt: i.now,
  };
}

const ORDER: Flag[] = ['PUMP_EXHAUSTED', 'MC_COLLAPSED', 'THIN', 'INSIDER_HEAVY', 'WASH_SUSPECT', 'BUNDLED', 'FRESH', 'LOW_CONFIDENCE'];

/** Raw signal values, used by the brief generator and explain. */
export function rawSignals(i: TokenInputs): Record<string, number | null> {
  return baseScore(i).raws;
}
