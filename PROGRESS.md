# PROGRESS

| # | selesai | berikutnya | test |
|---|---|---|---|
| 1 | Fase 1: workspace pnpm (core, mcp-server, sdk), tsconfig strict, `DataSource` + `MockSource`, adapter DexScreener / RPC / BasedBot (env-driven, `complete:false` default), `collectInputs` | fase 2 | typecheck ok |
| 2 | Fase 2: clamp piecewise, 9 sinyal + bobot, engine (redistribusi bobot, override berurutan, flag, label, confidence), brief generator, 5 fixture golden (`synthetic: true`) | fase 3 | 27/27 hijau, lint ok |
| 3 | Fase 3: test adapter DexScreener (pilih pair, 429 → snapshot lama degraded), RPC (holder dari Transfer log + balanceOf, approximate), BasedBot (env-driven, parser defensif), collect (adapter mati tetap menghasilkan putusan), registry trust + probe | fase 4 | 42/42 hijau |
| 4 | Fase 4: HTTP API Fastify (semua route bagian 13 + padanan semua tool), cache scan 45s, rate limit fixed-window per IP + header `X-RateLimit-*`, amplop seragam | fase 5 | hijau |
| 5 | Fase 5: brief per tool, `nextActions` divalidasi `checkActions`, `verdict_explain_score` dengan titik normalisasi | fase 6 | hijau |
| 6 | Fase 6: MCP stateless `POST /mcp` + stdio (`bin/verdict-mcp`), 11 tool Zod-validated, deskripsi untuk LLM, scope gating, idempotensi, kuota | fase 7 | 60/60, coverage score 99% / mcp 100% |
| 7 | Fase 7: worker (60s ± jitter, staggered, idle → 10 menit), 4 aturan alert, dedupe `{addr}:{kind}:{jam}`, webhook | fase 8 | hijau |
| 8 | Fase 8: registry MCP (register/search/check, trust 40/40/20, cap 40 untuk write tanpa target), identitas agent (X-Agent-Id / _meta.agent_id), leaderboard hit_rate (aktif ≥200 panggilan, ≥20 scan), seed sintetis | fase 9 | 61/61 hijau |
| 9 | Fase 9: halaman server-rendered, Dockerfile multi-stage non-root + healthcheck, docker-compose (api, worker, postgres, redis), `.env.example`, README + Asumsi, `scripts/smoke.mjs` (14 cek end-to-end termasuk 1 scan DexScreener nyata), REPORT.md | selesai | 72/72 hijau, coverage score 99.2% / mcp 100%, smoke lulus |

| 10 | Verifikasi Docker: `docker compose up -d --build` bersih (api healthy, postgres, redis, worker), `/v1/health` ok, migrasi 0000+0001 terpasang di Postgres, seed → leaderboard aktif + registry dari Postgres, scan nyata DEGEN dengan `DISABLE_SOURCES=basedbot` → `degraded: true`, MCP tools/list 11 + tools/call, watch idempoten di Postgres, worker mem-poll watch tiap 60s, SIGTERM → shutdown rapi, `docker compose down` bersih | selesai | 72/72 hijau |
| 11 | Audit kesiapan mainnet: SSRF guard, watch & registry per pemilik (migrasi 0002), kuota/leaderboard per key/IP, API key di-hash + tolak key demo di produksi, TRUST_PROXY_HOPS, adapter tanpa konfigurasi tidak dipasang, seed menolak produksi, compare tidak menagih duplikat, nextActions tanpa alamat contoh, landing tanpa data palsu. Diverifikasi di compose produksi | sisa audit: poin 13-15 (performa) | 85/85 hijau, smoke lulus |

## Blokir

Tidak ada. Dua blokir sebelumnya (`docker compose up` dan `PgStore` ke Postgres sungguhan) selesai di baris 10.
