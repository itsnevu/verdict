# PROGRESS

| # | selesai | berikutnya | test |
|---|---|---|---|
| 1 | Fase 1: workspace pnpm (core, mcp-server, sdk), tsconfig strict, `DataSource` + `MockSource`, adapter DexScreener / RPC / BasedBot (env-driven, `complete:false` default), `collectInputs` | fase 2 | typecheck ok |
| 2 | Fase 2: clamp piecewise, 9 sinyal + bobot, engine (redistribusi bobot, override berurutan, flag, label, confidence), brief generator, 5 fixture golden (`synthetic: true`) | fase 3 | 27/27 hijau, lint ok |
| 3 | Fase 3: test adapter DexScreener (pilih pair, 429 → snapshot lama degraded), RPC (holder dari Transfer log + balanceOf, approximate), BasedBot (env-driven, parser defensif), collect (adapter mati tetap menghasilkan putusan), registry trust + probe | fase 4 | 42/42 hijau |
