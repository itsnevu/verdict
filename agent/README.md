# verdictagent

**Is this token still alive?** verdictagent gives AI agents a deterministic, explainable on-chain verdict before they act. It does not launch tokens, trade, or hold funds.

- MCP first (`POST /mcp`, or stdio via `verdict-mcp`), with an HTTP twin for every tool
- Scores come from fixed piecewise-linear rules, never from an LLM: same input, same output
- Every response: `data`, a one-paragraph `brief`, `_meta` (sources, confidence, cost, degraded) and valid `nextActions`

```
sources (DexScreener, RPC, BasedBot) ── DataSource interface
                 │
        deterministic score engine (packages/core)
                 │
   ┌─────────────┼──────────────┬─────────┐
 HTTP API    MCP server        SDK      worker
```

Packages: `@verdictagent/core` (engine, adapters, envelope), `@verdictagent/mcp-server` (HTTP, MCP, worker, DB), `@verdictagent/sdk` (HTTP client).

## Run it

Requirements: Node 22+, pnpm (`corepack enable`).

```bash
pnpm install
pnpm build
cp .env.example .env

# fully in memory, with the bundled synthetic tokens (0x…a001 to 0x…a005)
USE_MOCK_SOURCE=1 node packages/mcp-server/dist/server.js
open http://localhost:8080/?address=0x000000000000000000000000000000000000a002
```

With Postgres, Redis and the alert worker:

```bash
cp .env.example .env          # set POSTGRES_PASSWORD, API_KEYS, and RPC_URL for holder data
docker compose up -d --build
curl localhost:8080/v1/health
docker compose exec api node dist/seed.js   # optional: synthetic history, registry, leaderboard
docker compose down
```

## Use it over MCP

Remote (Streamable HTTP, stateless, JSON responses):

```bash
claude mcp add --transport http verdictagent https://verdictagent.xyz/mcp
```

Local (stdio):

```json
{ "mcpServers": { "verdictagent": { "command": "node", "args": ["packages/mcp-server/bin/verdict-mcp"], "env": { "USE_MOCK_SOURCE": "0", "VERDICT_AGENT_ID": "my-agent" } } } }
```

Identify your agent with the `X-Agent-Id` header or `params._meta.agent_id` on `tools/call`. Write tools need `Authorization: Bearer <key>` with the right scope.

| tool | cost | what it is for |
|---|---|---|
| `verdict_scan_token {address}` | 1 | full verdict before acting. Not for monitoring |
| `verdict_agent_brief {address}` | 0.2 | only the paragraph, for context-tight agents |
| `verdict_list_runners {label?, minScore?, limit?}` | 0.5 | ranked list of judged tokens |
| `verdict_token_history {address, hours}` | 0.5 | stored timeline, oldest first |
| `verdict_explain_score {address, signal?}` | 0.5 | per-signal raw, score, weight, contribution, points, overrides |
| `verdict_compare_tokens {addresses[2..5]}` | 1 each | rank candidates |
| `verdict_budget {}` | 0 | remaining daily units |
| `verdict_watch_token {address, webhookUrl?, ttlHours?, idempotencyKey}` | 1 | scope `watch`; alerts instead of polling |
| `verdict_register_mcp {url, declaredTools[], contractTargets[], idempotencyKey}` | 1 | scope `registry`; probe + trust score |
| `verdict_registry_search {query?, minTrust?, limit?}` | 0.2 | find third-party MCP servers by trust |
| `verdict_registry_check {idOrUrl}` | 1 | re-probe one endpoint |
| `verdict_attest_token {address, idempotencyKey}` | 2 | scope `attest`; write the verdict to VerdictOracle on Robinhood Chain |
| `verdict_read_contract {address, chain?}` | 0.5 | owner, renounced, pause, proxy, risky functions (mint, blacklist, fees), clones |
| `verdict_decode_tx {hash, chain?}` | 0.5 | explain any tx on robinhood, ethereum, base, arbitrum, optimism, bsc, polygon |
| `verdict_wallet_holdings {wallet, chain?}` | 1 | tokens held (recent window) with balances |
| `verdict_wallet_score {wallet}` | 3 | judge every held token + risky approvals |
| `verdict_wallet_approvals {wallet, chain?}` | 1 | live approvals rated high / medium / low |
| `verdict_prepare_revoke {wallet, all? \| pairs?}` | 1 | unsigned approve(spender, 0) txs, simulated; `all: true` is the kill switch |
| `verdict_simulate_tx {from, to, data?, value?}` | 0.5 | eth_call + gas, revert reason |
| `verdict_lint_solidity {source}` | 0.2 | fund-losing patterns before deploy (not an audit) |
| `verdict_check_policy {rules, action}` | 0.5 | check an action against VERDICT.md |
| `verdict_track_record {horizonDays?}` | 0 | how often past verdicts held |
| `verdict_wash_check {address}` | 1 | fake volume: turnover vs liquidity, balanced buys/sells, flat price, bot-sized trades, circular transfers |
| `verdict_lp_status {address}` | 1 | can liquidity be pulled: LP burned / in contracts / in wallets; v3/v4 positions explained |
| `verdict_deployer_history {address}` | 1 | launcher found from the first mint, every contract it deployed, serial-rugger flag |
| `verdict_trace_funding {wallet}` | 1 | first funders, labelled (CEX, mixer, mint) |
| `verdict_label_address {address}` | 0.2 | known labels + traits: pool, Safe multisig, token, wallet activity |
| `verdict_wallet_moves {wallet, token?}` | 1 | whale/dev tracking: recent buys and sells against the pools |
| `verdict_wallet_pnl {wallet}` | 2 | flows at current prices, holdings in USD, bot / trader profile |
| `verdict_prepare_swap {from, to, amount?, rules?}` | 1 | verdict + VERDICT.md check, then a prefilled Uniswap link you sign |
| `verdict_bridge_check {token, fromChain, toChain}` | 1 | market on both sides before bridging + official bridge |
| `verdict_watch_token {…, stopLossBelow}` | 1 | stop-loss alert with a prepared exit link |

## Use it over HTTP

| route | tool | limits |
|---|---|---|
| `GET /v1/scan/:addr` | scan | cache 45s, 30/min/IP |
| `GET /v1/brief/:addr` | agent_brief | cache 45s, 60/min/IP |
| `GET /v1/tokens?label&minScore&limit` | list_runners | 60/min |
| `GET /v1/tokens/:addr/history?hours` | token_history | 60/min |
| `GET /v1/explain/:addr?signal` | explain_score | 60/min |
| `GET /v1/compare?addresses=a,b` | compare_tokens | 60/min |
| `GET /v1/budget` | budget | 60/min |
| `POST /v1/watch` | watch_token | scope `watch` |
| `POST /v1/registry` · `GET /v1/registry` · `GET /v1/registry/check?id=` | registry | scope `registry` for POST |
| `POST /v1/attest` | attest_token | scope `attest`, costs gas |
| `GET /v1/agents` | leaderboard | active after 200 real calls |
| `GET /v1/contract/:addr` · `GET /v1/tx/:hash` · `GET /v1/wallet/:addr/{holdings,approvals,score}` | inspect | 60/min |
| `POST /v1/revoke/prepare` · `POST /v1/simulate` · `POST /v1/lint` · `POST /v1/policy/check` | act | 60/min |
| `GET /v1/track-record` · `GET /report/:addr` · `GET /badge/:addr.svg` | prove | 60/min |
| `GET /v1/health` | | |

Every response carries `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`.

```json
{
  "data": { "score": 48, "label": "DECAYING", "confidence": 1, "flags": ["PUMP_EXHAUSTED", "MC_COLLAPSED"], "breakdown": [ … ] },
  "brief": "ZOLVA skor 48 (DECAYING, confidence 1). Volume 6 jam 3.1× market cap tapi laju turun 71% dibanding 24 jam, pola pump yang kehabisan pembeli. Likuiditas 14% MC. 2 flag: PUMP_EXHAUSTED, MC_COLLAPSED.",
  "_meta": { "engineVersion": "1.0.0", "fetchedAt": "…", "sources": [ … ], "confidence": 1, "costUnits": 1, "degraded": false, "agentId": "my-agent" },
  "nextActions": [ { "tool": "verdict_explain_score", "reason": "see which signal drove the score", "args": { "address": "0x…" } } ]
}
```

Errors keep the same shape with `error: {code, message, retryable, fix}`, e.g. `SCOPE_REQUIRED`, `INVALID_ADDRESS`, `TOKEN_NOT_FOUND`, `BUDGET_EXHAUSTED`, `IDEMPOTENCY_CONFLICT`, `RATE_LIMITED`.

## Onchain: VerdictOracle on Robinhood Chain

verdictagent runs on **Robinhood Chain mainnet (chain id 4663)**: market data comes from DexScreener (`robinhood`), holders from the chain's RPC. Verdicts can be written to the `VerdictOracle` contract (`contracts/`), so other agents and smart contracts can read them without trusting this API:

- `verdict_scan_token` returns an `onchain` field: the recorded verdict and `matchesCurrent` (same `inputsHash` as the scan you just got).
- `verdict_attest_token` writes the current verdict; identical inputs already onchain send no transaction.
- Contracts can gate on `isHealthy(token, minScore, maxAge)`.

The contract holds no funds and is not upgradeable. Deploy runbook and checklist: [contracts/README.md](contracts/README.md).

## How the score works

Nine signals, each mapped through a piecewise-linear clamp, weighted: `liq_ratio` 0.18, `top10_share` 0.18, `dev_share` 0.14, `vol_mc` 0.14, `vol_trend` 0.12, `unique_ratio` 0.10, `holder_growth_24h` 0.08, `buy_sell_ratio` 0.04, `age_hours` 0.02. Missing signals are reported as `unavailable` and their weight is shared proportionally. Overrides then run in order: honeypot cap 25, dev > 50% cap 35, liquidity < $3000 cap 30, no volume after 24h → DEAD, bundled launch × 0.85, wash trading → confidence −0.2. Labels: ≥75 HEALTHY, 55–74 WATCH, 35–54 DECAYING, 20–34 COLLAPSING, < 20 DEAD. The point tables live in `packages/core/src/score/signals.ts`; `verdict_explain_score` returns them.

## Security notes

- Every server-side request to a caller-supplied URL (webhooks, MCP probes) goes through `src/net.ts`: https only, no credentials, no internal host names, every resolved IP must be public, redirects are not followed, bodies are capped. Set `ALLOW_INSECURE_URLS=1` only for local dev.
- API keys are stored as sha256 hashes. With `NODE_ENV=production` (compose sets it) keys shorter than 24 characters or starting with `dev`/`test`/`demo` are refused. Generate keys with `openssl rand -hex 24`.
- Watches and registry entries belong to the API key that created them. Idempotency keys are scoped per key.
- Daily quota is charged to the API key, or to the client IP when there is none. `X-Agent-Id` is for logs only. The leaderboard only counts authenticated calls.
- `X-Forwarded-For` is ignored unless `TRUST_PROXY_HOPS` is set to the number of proxies in front of the API.
- `seed.js` refuses to run with `NODE_ENV=production` unless `ALLOW_SEED=1`.

## Develop

```bash
pnpm test --coverage   # gates: ≥80% lines in core/src/score and mcp-server/src/mcp
pnpm typecheck
pnpm lint              # scripts/lint.mjs: reasoned TODOs, deterministic scoring, banned words, no console.log
pnpm build && pnpm smoke   # end-to-end: health, MCP HTTP + stdio, degraded scan, one live DexScreener scan
python scripts/make-fixtures.py   # regenerate test/fixtures (synthetic: true)
```

Switch an adapter off with `DISABLE_SOURCES=dexscreener` (or `rpc`, `basedbot`): scans still return, with `_meta.degraded: true` and lower confidence.

## Asumsi

- **Chain.** Target produk adalah Robinhood Chain mainnet (chain id 4663, live sejak 2026-07-01); DexScreener `chainId=robinhood`, RPC publik yang melayani `eth_getLogs` (globalstake, thirdweb, pocket, tatum).
- **BasedBot tidak punya skema publik.** Adapter dibangun dari env (`BASEDBOT_BASE_URL` + template path), parser menerima beberapa nama field umum, dan hasilnya selalu `complete:false` sampai `BASEDBOT_SCHEMA_VERIFIED=1`. Tidak ada skema yang dikarang.
- **Holder dari RPC biasa bersifat perkiraan.** Block Robinhood Chain ~0.1 detik, jadi jendela default 400.000 block ≈ 11 jam riwayat Transfer. Holder yang lama diam tidak terlihat; holder berupa kontrak (pool, PoolManager v4, router) dikecualikan dari top-10. Node JSON-RPC tidak punya method holder, jadi holder direkonstruksi dari log `Transfer` pada `RPC_LOG_RANGE` blok terakhir lalu dicek ulang dengan `balanceOf`. Hasilnya ditandai `approximate` dan confidence −0.3 (bagian 20). `holder_growth_24h` tidak tersedia dari RPC.
- **Unique wallets.** API publik DexScreener tidak menyediakan jumlah wallet unik, jadi `unique_ratio` tidak tersedia kecuali ada sumber lain.
- **Honeypot dan funding source** butuh simulasi jual dan trace transaksi (indexer / `debug_trace`); RPC biasa tidak bisa, jadi keduanya `complete:false` dan override honeypot/bundle hanya aktif bila sumber lain menyediakannya.
- **Pool/LP/burn** yang dikecualikan dari `top10_share`: alamat pair dari DexScreener, alamat nol, `0x…dEaD`, dan kontrak token itu sendiri.
- **Kuota** default 500 unit per agent per hari UTC; agent tanpa `X-Agent-Id` dihitung per IP.
- **Brief** berbahasa Indonesia mengikuti contoh di spesifikasi; klausa disambung koma, bukan em dash.
- **Fixture** di `test/fixtures/` sintetis (`synthetic: true`), dibuat oleh `scripts/make-fixtures.py`.

Keputusan lain beserta cara membaliknya ada di [DECISIONS.md](DECISIONS.md).
