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
| 9 | Fase 9: halaman server-rendered, Dockerfile multi-stage non-root + healthcheck, docker-compose (api, worker, postgres, redis), `.env.example`, README + Asumsi, `scripts/smoke.mjs` (14 cek end-to-end termasuk 1 scan DexScreener nyata), REPORT.md | selesai | 62/62 hijau, coverage score 99.2% / mcp 100%, smoke lulus |

## Blokir

- `TODO(blocked)`: `docker compose up -d && curl /v1/health && docker compose down` (bagian 21/22) belum bisa dijalankan — Docker Desktop terpasang tapi daemon tidak jalan di mesin build. Yang sudah diverifikasi: `docker compose config` valid; server hasil build lulus smoke test end-to-end dengan store in-memory. Jalankan perintah di atas di mesin dengan Docker aktif.
- `TODO(blocked)`: `PgStore` (Drizzle) dan migrasi `0000`/`0001` belum dijalankan ke Postgres sungguhan karena alasan yang sama. Semua test memakai `MemoryStore` dengan antarmuka `Store` yang sama.
