# VERDICT — From Intent to Execution

Landing page untuk VERDICT, agent terminal onchain yang membaca, menulis, menjalankan perintah, lalu berhenti di tombol Y.
Halaman ini panjang dan dikendalikan scroll, dengan hero yang di-pin, satu mark WebGL, dan section-section yang bisa dimainkan.

Stack: Next.js 15 (App Router) · TypeScript · Tailwind v4 · GSAP 3 + ScrollTrigger · Lenis · three.js · Framer Motion · Lucide.

## Menjalankan

```bash
npm install
npm run dev          # http://localhost:3000
npm run build && npm run start   # production
```

Jangan menjalankan `next dev` dan `next start` dari folder `.next` yang sama secara bersamaan. Kalau halaman tiba-tiba tampil tanpa style, hapus `.next` lalu build ulang.

## Struktur

```
app/
  layout.tsx        fonts (Bricolage Grotesque, Inter Tight, JetBrains Mono), theme boot script
  page.tsx          section order
  globals.css       tokens, light/dark themes, every component style
lib/
  content.ts        ALL copy, addresses, hashes, data
  runtime.ts        live block store, hero progress, lenis ref, storage, arrow-key helper
components/
  Splash.tsx        boot log, sekali per session (sessionStorage), Esc untuk skip
  Header.tsx        progress bar, nav, theme toggle, Install + block odometer
  OrbMark.tsx       three.js: bola dari lima pita, drag untuk memutar, kamera masuk pada p≈0.6
  fx/
    SmoothScroll    Lenis ↔ ScrollTrigger sync
    GlobalFx        data-reveal / data-split / data-draw / data-magnetic / data-tilt + custom cursor
    Split           split per karakter, aria-label di parent
    Odometer        strip digit 0–9
    Particles       debu tinta di canvas, pause saat offscreen
    Ui              CopyBtn, CmdBlock, Segmented (radiogroup), Tabs, Kicker
  sections/
    Hero            pin 600vh, satu timeline scrub, 5 fase, drum, rail 7 bab, keycap Y
    Marquee         track solid + outline berlawanan arah
    Arcade          3 misi, gate Y/N/A, mode ask/edits/auto, intent bebas, 5 badge (localStorage)
    Toolkit         7 kartu interaktif + tool registry
    Nexus           stats, live market, mesh escrow 5 tx, simulator wallet, tab dev
    Onchain         chart TVL (hover + tombol panah + tabel sr-only), simulasi verifikasi, kontrak
    Roadmap         tab level, 12 fitur, kartu $VDCT + accordion
    Install         gembok parallax, tab platform, langkah
    Footer          kolom, wordmark raksasa, legal
```

## Atribut deklaratif

| atribut | efek |
|---|---|
| `data-reveal` | reveal 3D sekali jalan, stagger 50 ms antar elemen bersaudara |
| `data-split="io"` | karakter muncul saat masuk viewport |
| `data-magnetic` | mengikuti kursor maksimal 12 px, kembali dengan spring |
| `data-tilt="n"` | miring ke arah kursor maksimal n derajat |
| `data-cursor="label"` | ring kursor membesar dan menampilkan label |
| `data-lenis-prevent` | panel yang scroll sendiri |

## Aksesibilitas

- `prefers-reduced-motion`: hero tidak di-pin dan semua fase ditumpuk statis; marquee, odometer, tilt, magnetic, dan cursor dimatikan.
- Kontrol kustom memakai role ARIA yang sesuai dan bisa dioperasikan dengan tombol panah.
- Terminal arcade memakai `aria-live`. Chart punya tabel alternatif.

## Mengganti copy

Edit `lib/content.ts`. Tidak ada copy yang di-hardcode di komponen kecuali label UI kecil.
