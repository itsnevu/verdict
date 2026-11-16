import type { DataSource, EarlyBuyerData, SourceMethod, SourceResult, SourceStatus, TokenInputs } from '../types.js';
import { nowIso } from './retry.js';

const supports = (s: DataSource, m: SourceMethod) => !s.supports || s.supports.includes(m);

/**
 * Asks every adapter that supports a method, in order. The first complete answer wins;
 * otherwise the first partial answer is used. Every attempt is recorded in `sources`.
 */
export async function collectInputs(address: string, sources: DataSource[], now: () => string = nowIso): Promise<TokenInputs> {
  const statuses: SourceStatus[] = [];
  const call = async <T>(m: SourceMethod, run: (s: DataSource) => Promise<SourceResult<T>>): Promise<SourceResult<T> | null> => {
    let partial: SourceResult<T> | null = null;
    for (const s of sources.filter((x) => supports(x, m))) {
      let r: SourceResult<T>;
      try { r = await run(s); } catch (e) { r = { data: null, fetchedAt: now(), source: s.name, complete: false, error: (e as Error).message }; }
      statuses.push({ name: s.name, method: m, fetchedAt: r.fetchedAt, complete: r.complete, ...(r.error ? { error: r.error } : {}) });
      if (r.complete && r.data !== null) return r;
      if (!partial && r.data !== null) partial = r;
    }
    return partial;
  };

  const [market, launch, contract] = await Promise.all([
    call('getMarket', (s) => s.getMarket(address)),
    call('getLaunchMeta', (s) => s.getLaunchMeta(address)),
    call('getContractFlags', (s) => s.getContractFlags(address)),
  ]);
  const pairAddress = market?.data?.pairAddress ?? null;
  const devAddress = launch?.data?.devAddress ?? null;
  const [holders, early] = await Promise.all([
    call('getHolders', (s) => s.getHolders(address, { pairAddress, devAddress })),
    call('getEarlyBuyers', (s) => s.getEarlyBuyers(address, { pairAddress })),
  ]);

  const earlyBuyers = early?.data ? await traceFunding(early.data, sources, statuses) : null;

  return {
    address,
    now: now(),
    market: market?.data ?? null,
    marketFetchedAt: market?.fetchedAt ?? null,
    holders: holders?.data ?? null,
    earlyBuyers,
    contract: contract?.data ?? null,
    launch: launch?.data ?? null,
    sizeVariance: sizeVariance(earlyBuyers),
    sources: statuses,
  };
}

/** Fill missing funding sources for early buyers from adapters that can trace them. */
async function traceFunding(e: EarlyBuyerData, sources: DataSource[], statuses: SourceStatus[]): Promise<EarlyBuyerData> {
  const tracers = sources.filter((s) => supports(s, 'getFundingSource'));
  if (!tracers.length) return e;
  const buys = await Promise.all(e.buys.slice(0, 50).map(async (b) => {
    if (b.fundingSource) return b;
    for (const s of tracers) {
      const r = await s.getFundingSource(b.wallet).catch(() => null);
      if (r?.data?.fundedBy) return { ...b, fundingSource: r.data.fundedBy.toLowerCase() };
    }
    return b;
  }));
  const traced = buys.filter((b) => b.fundingSource).length;
  for (const s of tracers) statuses.push({ name: s.name, method: 'getFundingSource', fetchedAt: nowIso(), complete: traced === buys.length || traced > 0 });
  return { buys };
}

/** Coefficient of variation of early buy sizes; low values mean suspiciously uniform trades. */
export function sizeVariance(e: EarlyBuyerData | null): number | null {
  const v = (e?.buys ?? []).map((b) => b.amountUsd).filter((x) => x > 0);
  if (v.length < 10) return null;
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length);
  return mean === 0 ? null : sd / mean;
}
