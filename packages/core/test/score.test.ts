import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  SIGNALS, buildBrief, bundleShare, evaluate, labelFor, piecewise, wordCount, type TokenInputs,
} from '@verdictagent/core';

const fx = (n: string): TokenInputs =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../../../test/fixtures/${n}.json`, import.meta.url)), 'utf8'));
const sig = (k: string) => SIGNALS.find((s) => s.key === k)!;

describe('piecewise clamp', () => {
  it('returns exact values at every documented point and clamps outside', () => {
    for (const s of SIGNALS) {
      for (const [x, y] of s.points) {
        // repeated x (step) returns the later point's y at that x
        const later = [...s.points].reverse().find((p) => p[0] === x)!;
        const first = s.points.find((p) => p[0] === x)!;
        const v = piecewise(s.points, x);
        expect([first[1], later[1], y]).toContain(v);
      }
      expect(piecewise(s.points, s.points[0]![0] - 1000)).toBe(s.points[0]![1]);
      expect(piecewise(s.points, s.points[s.points.length - 1]![0] + 1000)).toBe(s.points[s.points.length - 1]![1]);
    }
  });

  it('interpolates linearly between points', () => {
    expect(piecewise(sig('liq_ratio').points, 0.065)).toBeCloseTo(30, 6);
    expect(piecewise(sig('top10_share').points, 0.15)).toBeCloseTo(80, 6);
    expect(piecewise(sig('dev_share').points, 0.4)).toBeCloseTo(5, 6);
    expect(piecewise(sig('vol_mc').points, 7.5)).toBeCloseTo(85, 6);
    expect(piecewise(sig('vol_trend').points, 0.8)).toBeCloseTo(45, 6);
    expect(piecewise(sig('unique_ratio').points, 0.6)).toBeCloseTo(80, 6);
    expect(piecewise(sig('holder_growth_24h').points, -0.5)).toBeCloseTo(17.5, 6);
    expect(piecewise(sig('buy_sell_ratio').points, 1.4)).toBeCloseTo(87.5, 6);
    expect(piecewise(sig('age_hours').points, 72)).toBeCloseTo(92.5, 6);
  });

  it('flat segments stay flat and steps work', () => {
    expect(piecewise(sig('liq_ratio').points, 0.015)).toBe(10);
    expect(piecewise(sig('vol_trend').points, 0.15)).toBe(5);
    expect(piecewise([[0, 1], [0, 5], [1, 9]], 0)).toBe(1);
    expect(piecewise([[0, 1], [1, 3], [1, 7], [2, 9]], 1)).toBe(3);
  });

  it('rejects empty and NaN', () => {
    expect(() => piecewise([], 1)).toThrow();
    expect(() => piecewise([[0, 0]], Number.NaN)).toThrow();
  });

  it('weights sum to 1', () => {
    expect(SIGNALS.reduce((a, s) => a + s.weight, 0)).toBeCloseTo(1, 10);
  });
});

describe('labels', () => {
  it('maps boundaries', () => {
    expect(labelFor(75)).toBe('HEALTHY');
    expect(labelFor(74)).toBe('WATCH');
    expect(labelFor(55)).toBe('WATCH');
    expect(labelFor(54)).toBe('DECAYING');
    expect(labelFor(35)).toBe('DECAYING');
    expect(labelFor(34)).toBe('COLLAPSING');
    expect(labelFor(20)).toBe('COLLAPSING');
    expect(labelFor(19)).toBe('DEAD');
  });
});

describe('golden fixtures', () => {
  it('rushr → HEALTHY', () => {
    const v = evaluate(fx('rushr'));
    expect(v.label).toBe('HEALTHY');
    expect(v.confidence).toBe(1);
    expect(v.flags).toEqual([]);
  });
  it('zolva → PUMP_EXHAUSTED, label ≤ DECAYING', () => {
    const v = evaluate(fx('zolva'));
    expect(v.flags).toContain('PUMP_EXHAUSTED');
    expect(['DECAYING', 'COLLAPSING', 'DEAD']).toContain(v.label);
  });
  it('robot → ≤30 and INSIDER_HEAVY', () => {
    const v = evaluate(fx('robot'));
    expect(v.score!).toBeLessThanOrEqual(30);
    expect(v.flags).toContain('INSIDER_HEAVY');
  });
  it('nifty → THIN + COLLAPSING', () => {
    const v = evaluate(fx('nifty'));
    expect(v.flags).toContain('THIN');
    expect(v.label).toBe('COLLAPSING');
  });
  it('degraded → confidence < 0.5 and LOW_CONFIDENCE', () => {
    const v = evaluate(fx('degraded'));
    expect(v.confidence).toBeLessThan(0.5);
    expect(v.flags).toContain('LOW_CONFIDENCE');
    expect(v.breakdown.filter((r) => r.status === 'unavailable').map((r) => r.signal)).toEqual(
      expect.arrayContaining(['top10_share', 'dev_share', 'holder_growth_24h']),
    );
  });
  it('is deterministic', () => {
    for (const n of ['rushr', 'zolva', 'robot', 'nifty', 'degraded']) expect(evaluate(fx(n))).toEqual(evaluate(fx(n)));
  });
  it('redistributes weight of unavailable signals', () => {
    const v = evaluate(fx('degraded'));
    const eff = v.breakdown.filter((r) => r.status === 'ok').reduce((a, r) => a + r.effectiveWeight, 0);
    expect(eff).toBeCloseTo(1, 3);
    expect(v.breakdown.filter((r) => r.status === 'unavailable').every((r) => r.effectiveWeight === 0)).toBe(true);
  });
});

describe('overrides run in order', () => {
  const base = () => fx('rushr');
  it('honeypot caps at 25', () => {
    const i = base(); i.contract = { honeypot: true, sellFails: null, lpLocked: true };
    const v = evaluate(i);
    expect(v.score).toBe(25);
    expect(v.overrides[0]!.rule).toBe('honeypot_or_sell_fail');
  });
  it('dev > 50% caps at 35', () => {
    const i = base(); i.holders = { ...i.holders!, devShare: 0.51 };
    expect(evaluate(i).score!).toBeLessThanOrEqual(35);
  });
  it('liq < $3000 caps at 30', () => {
    const i = base(); i.market = { ...i.market!, liqUsd: 2999, mcUsd: 10000 };
    expect(evaluate(i).score!).toBeLessThanOrEqual(30);
  });
  it('honeypot cap applies before the dev cap (both recorded in order)', () => {
    const i = base();
    i.contract = { honeypot: true, sellFails: null, lpLocked: true };
    i.holders = { ...i.holders!, devShare: 0.6 };
    const v = evaluate(i);
    expect(v.score).toBe(25);
    expect(v.overrides.map((o) => o.rule)).toEqual(['honeypot_or_sell_fail']);
  });
  it('dead: no volume and older than 24h → DEAD regardless of score', () => {
    const i = base(); i.market = { ...i.market!, vol24hUsd: 0, vol6hUsd: 0 };
    const v = evaluate(i);
    expect(v.label).toBe('DEAD');
    expect(v.score).toBe(0);
  });
  it('young token with no volume is not forced DEAD', () => {
    const i = base(); i.market = { ...i.market!, vol24hUsd: 0, vol6hUsd: 0, pairCreatedAt: '2026-11-16T00:00:00.000Z' };
    expect(evaluate(i).overrides.some((o) => o.rule.startsWith('no_volume'))).toBe(false);
  });
  it('bundle multiplies by 0.85 after caps and flags BUNDLED', () => {
    const i = base();
    const clean = evaluate(i).score!;
    i.earlyBuyers = { buys: Array.from({ length: 50 }, (_, k) => ({ wallet: `0x${k}`, amountUsd: 100 + k, fundingSource: k < 25 ? '0xaaa' : `0xf${k}` })) };
    expect(bundleShare(i)).toBeGreaterThan(0.4);
    const v = evaluate(i);
    expect(v.flags).toContain('BUNDLED');
    expect(v.score).toBe(Math.round(evaluate(fx('rushr')).baseScore! * 0.85));
    expect(v.score).toBeLessThan(clean);
  });
  it('wash suspect lowers confidence by 0.2', () => {
    const i = base(); i.sizeVariance = 0.05; i.market = { ...i.market!, uniqueWallets24h: 500 };
    const v = evaluate(i);
    expect(v.flags).toContain('WASH_SUSPECT');
    expect(v.confidence).toBe(0.8);
  });
});

describe('flags', () => {
  it('MC_COLLAPSED, FRESH and stale market confidence', () => {
    const i = fx('rushr');
    i.market = { ...i.market!, vol24hUsd: i.market!.mcUsd * 11, pairCreatedAt: '2026-11-16T11:30:00.000Z' };
    i.marketFetchedAt = '2026-11-16T11:57:00.000Z';
    const v = evaluate(i);
    expect(v.flags).toEqual(expect.arrayContaining(['MC_COLLAPSED', 'FRESH']));
    expect(v.confidence).toBe(0.8);
  });
  it('no signals at all → null score and label', () => {
    const i = fx('degraded'); i.market = null;
    const v = evaluate(i);
    expect(v.score).toBeNull();
    expect(v.label).toBeNull();
  });
});

describe('brief', () => {
  it('matches the documented zolva shape', () => {
    const i = fx('zolva');
    const b = buildBrief(evaluate(i), i);
    expect(b).toMatch(/^ZOLVA skor \d+ \((DECAYING|COLLAPSING|DEAD), confidence 1\)\./);
    expect(b).toContain('Volume 6 jam 3.1× market cap tapi laju turun 71% dibanding 24 jam');
    expect(b).toContain('Likuiditas 14% MC.');
    expect(b).toContain('PUMP_EXHAUSTED');
  });
  it('obeys the rules for every fixture', () => {
    for (const n of ['rushr', 'zolva', 'robot', 'nifty', 'degraded']) {
      const i = fx(n);
      const b = buildBrief(evaluate(i), i);
      expect(wordCount(b)).toBeLessThanOrEqual(60);
      expect(b.toLowerCase()).not.toContain('mungkin');
      expect(b).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });
  it('low confidence names the missing signals', () => {
    const i = fx('degraded');
    const b = buildBrief(evaluate(i), i);
    expect(b).toContain('sinyal hilang');
    expect(b).toContain('top10_share');
  });
  it('covers the other templates', () => {
    const r = fx('robot'); expect(buildBrief(evaluate(r), r)).toContain('10 holder teratas memegang 82%');
    const d = fx('rushr'); d.market = { ...d.market!, vol24hUsd: 0, vol6hUsd: 0 };
    expect(buildBrief(evaluate(d), d)).toContain('Tidak ada volume 24 jam');
    const h = fx('rushr'); h.contract = { honeypot: true, sellFails: null, lpLocked: null };
    expect(buildBrief(evaluate(h), h)).toContain('honeypot');
    const c = fx('nifty'); c.market = { ...c.market!, vol24hUsd: c.market!.mcUsd * 12, vol6hUsd: c.market!.mcUsd * 12 };
    expect(buildBrief(evaluate(c), c)).toContain('nilai pasar sudah runtuh');
    const n = fx('degraded'); n.market = null;
    expect(buildBrief(evaluate(n), n)).toContain('belum bisa diputus');
    const ok = fx('rushr'); expect(buildBrief(evaluate(ok), ok)).toMatch(/laju (naik|turun)/);
  });
});

describe('brief number formatting', () => {
  it('keeps small ratios visible instead of rounding them to 0×', () => {
    const i = fx('rushr');
    i.market = { ...i.market!, vol6hUsd: i.market!.mcUsd * 0.004 };
    expect(buildBrief(evaluate(i), i)).toContain('0.004× market cap');
  });
});
