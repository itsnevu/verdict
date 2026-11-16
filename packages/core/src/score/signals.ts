import type { TokenInputs } from '../types.js';
import type { Point } from './clamp.js';

export interface SignalDef {
  key: string;
  weight: number;
  points: readonly Point[];
  /** human description, used by explain */
  describe: string;
  compute(i: TokenInputs): number | null;
}

const hoursBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 3_600_000;

export function ageHours(i: TokenInputs): number | null {
  const created = i.market?.pairCreatedAt ?? i.launch?.createdAt ?? null;
  if (!created || Number.isNaN(Date.parse(created))) return null;
  return Math.max(0, hoursBetween(created, i.now));
}

const pos = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

export const SIGNALS: readonly SignalDef[] = [
  {
    key: 'liq_ratio', weight: 0.18, describe: 'liquidity / market cap',
    points: [[0, 10], [0.03, 10], [0.1, 50], [0.3, 90], [0.6, 100]],
    compute: (i) => (i.market && i.market.mcUsd > 0 ? i.market.liqUsd / i.market.mcUsd : null),
  },
  {
    key: 'top10_share', weight: 0.18, describe: 'supply held by top 10 holders (excl. pool, LP, burn)',
    points: [[0, 100], [0.3, 60], [0.6, 30], [0.85, 5], [1, 0]],
    compute: (i) => (i.holders && pos(i.holders.top10Share) ? i.holders.top10Share : null),
  },
  {
    key: 'dev_share', weight: 0.14, describe: 'supply held by the deployer wallet',
    points: [[0, 100], [0.05, 70], [0.15, 40], [0.3, 10], [0.5, 0]],
    compute: (i) => (i.holders && pos(i.holders.devShare) ? i.holders.devShare : null),
  },
  {
    key: 'vol_mc', weight: 0.14, describe: '6h volume / market cap',
    points: [[0, 20], [0.5, 55], [2, 90], [5, 100], [10, 70]],
    compute: (i) => (i.market && i.market.mcUsd > 0 ? i.market.vol6hUsd / i.market.mcUsd : null),
  },
  {
    key: 'vol_trend', weight: 0.12, describe: '(6h volume × 4) / 24h volume',
    points: [[0, 5], [0.3, 5], [0.6, 30], [1.0, 60], [1.2, 100]],
    compute: (i) => {
      if (!i.market) return null;
      if (i.market.vol24hUsd <= 0) return i.market.vol6hUsd > 0 ? null : 0;
      return (i.market.vol6hUsd * 4) / i.market.vol24hUsd;
    },
  },
  {
    key: 'unique_ratio', weight: 0.1, describe: 'unique wallets / 24h transactions',
    points: [[0, 5], [0.15, 5], [0.3, 30], [0.5, 60], [0.7, 100]],
    compute: (i) => (i.market && pos(i.market.uniqueWallets24h) && i.market.tx24h > 0 ? i.market.uniqueWallets24h / i.market.tx24h : null),
  },
  {
    key: 'holder_growth_24h', weight: 0.08, describe: 'relative change in holder count over 24h',
    points: [[-1, 10], [0, 25], [0.05, 45], [0.2, 70], [0.5, 100]],
    compute: (i) => {
      const h = i.holders;
      if (!h || !pos(h.holderCount24hAgo) || h.holderCount24hAgo <= 0) return null;
      return (h.holderCount - h.holderCount24hAgo) / h.holderCount24hAgo;
    },
  },
  {
    key: 'buy_sell_ratio', weight: 0.04, describe: '24h buys / sells',
    points: [[0, 20], [0.5, 20], [0.7, 100], [1.3, 100], [1.5, 75]],
    compute: (i) => {
      if (!i.market) return null;
      const { buys24h: b, sells24h: s } = i.market;
      if (s > 0) return b / s;
      return b > 0 ? 10 : null; // only buys: clamps at the top end
    },
  },
  {
    key: 'age_hours', weight: 0.02, describe: 'hours since the pair was created',
    points: [[0, 40], [2, 40], [12, 65], [48, 85], [96, 100]],
    compute: ageHours,
  },
];

export const SIGNAL_KEYS = SIGNALS.map((s) => s.key);
