# DECISIONS

Format: `[waktu UTC] keputusan — alasan — cara balik`

- [2026-11-16 10:30] Repo `verdictagent` dibuat sebagai subfolder `verdict/agent/` dengan git sendiri — user minta landing page `verdict` tidak disentuh dan produk dibangun terpisah — pindahkan folder ke repo sendiri, git history ikut.
- [2026-11-16 10:31] Node 24 dipakai untuk build lokal, target runtime tetap Node 22 (Dockerfile `node:22-alpine`) — hanya Node 24 yang terpasang di mesin — tidak ada fitur khusus Node 24 yang dipakai.
- [2026-11-16 10:32] Docker daemon tidak jalan di mesin build — tidak bisa diperbaiki dari agent — `docker compose up` di bagian 21/22 dicatat sebagai TODO(blocked) di PROGRESS; store & cache punya implementasi in-memory sehingga test tidak butuh Postgres/Redis.
- [2026-11-16 10:35] `DataSource.supports?: SourceMethod[]` ditambahkan ke interface — tanpa ini setiap adapter yang memang tidak menyediakan suatu method (mis. DexScreener untuk holder) akan dihitung "sumber tidak lengkap" dan menurunkan confidence palsu — hapus field, collect akan memanggil semua adapter.
- [2026-11-16 10:36] `HolderData.approximate` + penalti −0.3 juga saat holder hasil rekonstruksi Transfer log — tabel keputusan bagian 20 ("RPC tidak punya method holder → fallback Transfer log, confidence −0.3") — hapus kondisi `approximate` di engine.
- [2026-11-16 10:37] Confidence −0.2 dihitung per **nama sumber** yang punya status `complete:false`, bukan per panggilan — satu adapter yang gagal di 2 method tidak boleh dihukum dua kali — ubah ke hitung per status.
- [2026-11-16 10:38] Chain default DexScreener `base` (env `DEX_CHAIN_ID`) — ekosistem BasedBot berada di Base — set env ke chain lain.
- [2026-11-16 10:39] `buy_sell_ratio` saat sells = 0 dan buys > 0 diberi nilai 10 (jatuh di ujung clamp → 75) — rasio tak hingga tidak bisa di-clamp; ujung tabel sudah mendefinisikan perilaku "sangat berat beli" — ganti ke `null` agar sinyal dianggap unavailable.
- [2026-11-16 10:40] `vol_trend` saat vol24h = 0: 0 bila vol6h juga 0, `null` bila vol6h > 0 (data tidak konsisten) — pembagian nol — ubah ke selalu null.
- [2026-11-16 10:41] Override DEAD: skor diset 0 (bukan null) dan `baseScore` tetap dilaporkan — "skor diabaikan" tapi konsumen mesin butuh angka yang bisa diurutkan — ubah ke null di `engine.ts`.
- [2026-11-16 10:42] Bundle hanya dievaluasi bila ≥10 buy awal tersedia — dengan sedikit data, 3 funder pasti >40% — turunkan ambang di `bundleShare`.
- [2026-11-16 10:43] Brief memakai koma, bukan em dash, untuk menyambung klausa (contoh di brief memakai "—") — user meminta em dash dihapus dari semua teks di sesi ini — ganti string template di `brief.ts`.
- [2026-11-16 10:44] Lint = `scripts/lint.mjs` buatan sendiri (TODO beralasan, determinisme skor, kata terlarang, emoji, console.log) + `tsc` strict dengan `noUnused*` — ESLint tidak ada di daftar bagian 18; aturan brief lebih tepat dicek langsung — tambah ESLint bila perlu aturan gaya.
- [2026-11-16 10:45] `@vitest/coverage-v8` ditambahkan — bagian 17/21 mewajibkan coverage, Vitest butuh provider — tidak ada alternatif tanpa dependensi.
- [2026-11-16 11:10] Protokol MCP ditulis sendiri (JSON-RPC 2.0: initialize, tools/list, tools/call, ping, notifikasi, batch) di `src/mcp/protocol.ts`, bukan `@modelcontextprotocol/sdk` — SDK tidak ada di daftar bagian 18; transport stateless cukup kecil untuk diuji penuh — ganti `handleRpc` dengan `McpServer` dari SDK, definisi tool tetap.
- [2026-11-16 11:11] JSON Schema tool dibuat dengan `z.toJSONSchema` bawaan Zod 4 — tidak perlu `zod-to-json-schema` — tidak ada.
- [2026-11-16 11:12] Error internal memakai status HTTP 503 + amplop `{code:"INTERNAL", retryable:true, fix}` — prinsip 5 "error bukan 500" — ubah status di `errors.internal`.
- [2026-11-16 11:13] Semua kapabilitas MCP punya route HTTP, termasuk yang tidak tercantum di bagian 13: `GET /v1/compare`, `GET /v1/budget`, `POST /v1/registry`, `GET /v1/registry`, `GET /v1/registry/check` — prinsip 9 — hapus route tambahan.
- [2026-11-16 11:14] Kolom `scores.liq_usd` lewat migrasi baru `0001_scores_liq_usd` — alert "likuiditas turun >40% dalam 1 jam" butuh likuiditas per titik waktu; migrasi 0000 tidak diubah (bagian 20) — drop kolom lewat migrasi 0002.
- [2026-11-16 11:15] Watch disimpan di kolom tabel `tokens` (watched_until, next_poll_at, webhook_url, watch_idem_key) — skema bagian 14 tidak punya tabel `watches` — tambah tabel `watches` lewat migrasi baru.
- [2026-11-16 11:16] Agent tanpa header `X-Agent-Id` dicatat sebagai `anon:<ip>`; panggilan dari halaman web sebagai `web:<ip>` — kuota dan log butuh identitas — wajibkan header.
- [2026-11-16 11:17] Kuota harian default 500 unit per agent (`QUOTA_UNITS_PER_DAY`), reset 00:00 UTC — brief tidak menyebut angka — ubah env.
- [2026-11-16 11:18] `coverage.all: false` — di Windows Vitest mencatat `c:` dan `C:` sebagai dua file sehingga coverage tampak 45%; semua file yang di-gate dimuat oleh test — kembalikan `all: true` di Linux/CI.
- [2026-11-16 11:19] Halaman `/` berbahasa Inggris, brief tetap bahasa Indonesia sesuai contoh bagian 9 — halaman dipakai developer internasional, brief mengikuti template — terjemahkan string di `page/render.ts`.
