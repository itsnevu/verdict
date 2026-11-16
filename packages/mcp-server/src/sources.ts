import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BasedBotSource, DexScreenerSource, MockSource, RpcSource, type DataSource, type TokenInputs } from '@verdictagent/core';
import type { Config } from './config.js';

/** Locate the bundled synthetic fixtures (repo checkout or Docker image). */
export function fixturesDir(): string | null {
  const here = fileURLToPath(new URL('.', import.meta.url));
  for (const p of [process.env.FIXTURES_DIR, join(here, '../../../test/fixtures'), join(here, '../fixtures'), '/app/test/fixtures']) {
    if (p && existsSync(p)) return p;
  }
  return null;
}

export function loadFixtures(dir = fixturesDir()): TokenInputs[] {
  if (!dir) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as TokenInputs);
}

/** A MockSource preloaded with the synthetic fixtures (tagged `synthetic: true`). */
export function fixtureSource(now: () => string = () => new Date().toISOString()): MockSource {
  const m = new MockSource('mock', {}, now);
  for (const f of loadFixtures()) {
    m.set(f.address, {
      market: f.market,
      holders: f.holders,
      earlyBuyers: f.earlyBuyers,
      contract: f.contract,
      launch: f.launch,
    });
  }
  return m;
}

/** Real adapters in priority order, minus anything listed in DISABLE_SOURCES. */
export function buildSources(cfg: Config): DataSource[] {
  const all: DataSource[] = [
    new DexScreenerSource({ baseUrl: cfg.DEX_BASE_URL, chainId: cfg.DEX_CHAIN_ID }),
    new RpcSource({ ...(cfg.RPC_URL ? { url: cfg.RPC_URL } : {}), logRange: BigInt(cfg.RPC_LOG_RANGE) }),
    new BasedBotSource({ ...(cfg.BASEDBOT_BASE_URL ? { baseUrl: cfg.BASEDBOT_BASE_URL } : {}), ...(cfg.BASEDBOT_LAUNCH_PATH ? { launchPath: cfg.BASEDBOT_LAUNCH_PATH } : {}), schemaVerified: cfg.BASEDBOT_SCHEMA_VERIFIED === '1' }),
  ];
  if (cfg.USE_MOCK_SOURCE === '1') all.unshift(fixtureSource());
  return all.filter((s) => !cfg.DISABLE_SOURCES.includes(s.name));
}
