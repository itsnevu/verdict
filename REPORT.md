# REPORT: verdictagent

## Arsitektur

```
DexScreenerSource ─┐
RpcSource (viem) ──┼─ DataSource (supports[], {data, fetchedAt, source, complete}, timeout 4s, retry 2x + jitter)
BasedBotSource ────┤
MockSource ────────┘
        │ collectInputs: per method, jawaban complete pertama menang; setiap percobaan dicatat di _meta.sources
        ▼
engine (core/src/score): 9 sinyal piecewise → bobot (redistribusi saat unavailable) → override berurutan → flag → label → confidence
        ▼
brief (template, ≤60 kata) + nextActions (divalidasi terhadap daftar tool)
        ▼
VerdictService (cache scan 45s, dedupe in-flight, simpan snapshot/skor/funding, kuota harian)
   ├─ MCP: JSON-RPC stateless di POST /mcp + stdio (bin/verdict-mcp)
   ├─ HTTP: Fastify /v1/* (padanan untuk setiap tool), rate limit + X-RateLimit-*
   ├─ halaman `/` server-rendered (HTML + CSS)
   └─ worker: poll watch 60s ± jitter, idle → 10 menit, 4 aturan alert, dedupe {addr}:{kind}:{jam}, webhook
Store: MemoryStore | PgStore (Drizzle, migrasi 0000 + 0001) · Cache: MemoryCache | RedisCache
```

## Tool

| tool | biaya | scope |
|---|---|---|
| verdict_scan_token | 1 | |
| verdict_agent_brief | 0.2 | |
| verdict_list_runners | 0.5 | |
| verdict_token_history | 0.5 | |
| verdict_explain_score | 0.5 | |
| verdict_compare_tokens | 1 per address | |
| verdict_budget | 0 | |
| verdict_registry_search | 0.2 | |
| verdict_registry_check | 1 | |
| verdict_watch_token | 1 | watch |
| verdict_register_mcp | 1 | registry |

## Cara menjalankan

```bash
pnpm install && pnpm build
USE_MOCK_SOURCE=1 node packages/mcp-server/dist/server.js     # in-memory, token sintetis
docker compose up -d --build                                   # Postgres + Redis + worker
node packages/mcp-server/bin/verdict-mcp                       # MCP stdio
pnpm smoke                                                     # verifikasi end-to-end
```

## Hasil verifikasi

| cek | hasil |
|---|---|
| `pnpm test --coverage` | 62/62 test hijau (5 file) |
| coverage `core/src/score` | lines 99.2% · branches 93.8% · functions 100% |
| coverage `mcp-server/src/mcp` | lines 100% · branches 86.1% · functions 97.0% |
| `pnpm typecheck` | bersih (tsc strict, noUnused*, noUncheckedIndexedAccess) |
| `pnpm lint` | bersih |
| `pnpm build` | bersih |
| `pnpm smoke` | 14/14: health, MCP HTTP (initialize, tools/list = 11, tools/call), amplop valid, X-RateLimit-*, SCOPE_REQUIRED, halaman, adapter dimatikan lewat env, **scan nyata DEGEN di Base via DexScreener** (skor 45 DECAYING, confidence 0.5, `degraded: true`), MCP stdio |
| `docker compose config` | valid |
| `docker compose up` + `/v1/health` | **belum dijalankan**: daemon Docker tidak aktif di mesin build |

## Adapter yang masih `complete:false`

| adapter · method | sebab |
|---|---|
| BasedBot · getLaunchMeta | skema publik tidak terdokumentasi; tetap `complete:false` sampai `BASEDBOT_SCHEMA_VERIFIED=1`, dan tidak aktif tanpa `BASEDBOT_BASE_URL` |
| RPC · getHolders | node biasa tidak punya method holder; direkonstruksi dari log Transfer dalam jendela blok (approximate, confidence −0.3); tidak ada `holderCount24hAgo` |
| RPC · getEarlyBuyers | hanya dalam jendela `RPC_LOG_RANGE`; nilai USD per buy tidak tersedia |
| RPC · getContractFlags | simulasi jual (honeypot) butuh router + fork; tidak mungkin di RPC biasa |
| semua · getFundingSource | trace sumber dana butuh indexer / `debug_trace`; tanpa ini override BUNDLED tidak bisa aktif pada data nyata |
| DexScreener · uniqueWallets24h (field) | tidak ada di API publik; sinyal `unique_ratio` unavailable pada data nyata |

## TODO(simplified) dan TODO(blocked)

- TODO(simplified): tidak ada di kode.
- TODO(blocked): `docker compose up` dan `PgStore` + migrasi terhadap Postgres sungguhan belum dijalankan; daemon Docker tidak aktif. Detail di PROGRESS.md.

## 5 langkah lanjutan paling bernilai

1. **Jalankan compose dan PgStore sekali di mesin dengan Docker**, lalu tambahkan test integrasi Postgres (testcontainers atau service CI) supaya `PgStore` punya coverage yang sama dengan `MemoryStore`.
2. **Sumber holder dan funding yang lengkap**: indexer Base (mis. API explorer) untuk `holderCount24hAgo`, early buyers ber-USD, dan funding source. Ini menyalakan `holder_growth_24h`, `unique_ratio`, BUNDLED, dan WASH_SUSPECT pada data nyata, yang sekarang hanya aktif di fixture.
3. **Verifikasi skema BasedBot** terhadap respons asli, tulis fixture dari respons nyata, lalu set `BASEDBOT_SCHEMA_VERIFIED=1` agar confidence tidak terpotong 0.2 untuk token launchpad.
4. **Simulasi jual untuk honeypot**: `eth_call` swap kecil lewat router Uniswap/Aerodrome di Base dengan state override. Override honeypot cap 25 adalah sinyal paling berharga bagi agent yang akan membeli.
5. **Kalibrasi titik normalisasi** dengan riwayat nyata: simpan putusan 30 hari, ukur berapa token HEALTHY yang benar-benar masih hidup 24 jam kemudian, lalu sesuaikan titik clamp di versi engine berikutnya (`engine_version` sudah tersimpan per skor).
