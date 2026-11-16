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
