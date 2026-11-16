import type { TokenInputs, Verdict } from '../types.js';
import { round } from './clamp.js';
import { rawSignals } from './engine.js';

const pct = (v: number) => `${round(v * 100)}%`;
const x = (v: number) => `${v > 0 && v < 0.1 ? round(v, 3) : round(v, 1)}×`;

/**
 * Deterministic one-paragraph summary assembled from templates.
 * Rules: numbers and direction, <= 60 words, no emoji, never the word "mungkin".
 */
export function buildBrief(v: Verdict, i: TokenInputs): string {
  const name = (v.symbol ?? `${v.address.slice(0, 6)}…${v.address.slice(-4)}`).toUpperCase();
  const r = rawSignals(i);
  const m = i.market;

  if (v.label === null || v.score === null) {
    return `${name} belum bisa diputus: data pasar dan holder tidak cukup (confidence ${v.confidence}). Sinyal hilang: ${v.missingSignals.join(', ')}.`;
  }

  const head = `${name} skor ${v.score} (${v.label}, confidence ${v.confidence}).`;
  const lines: string[] = [];
  const has = (f: string) => v.flags.includes(f as never);

  if (v.overrides.some((o) => o.rule === 'no_volume_24h_and_age_gt_24h')) {
    const age = m?.pairCreatedAt ? round((Date.parse(i.now) - Date.parse(m.pairCreatedAt)) / 3_600_000) : null;
    lines.push(`Tidak ada volume 24 jam${age !== null ? ` setelah ${age} jam beredar` : ''}, token berhenti diperdagangkan.`);
  } else if (has('PUMP_EXHAUSTED') && r.vol_mc != null && r.vol_trend != null) {
    lines.push(`Volume 6 jam ${x(r.vol_mc)} market cap tapi laju turun ${pct(1 - r.vol_trend)} dibanding 24 jam, pola pump yang kehabisan pembeli.`);
  } else if (has('MC_COLLAPSED') && m) {
    lines.push(`Volume 24 jam ${x(m.vol24hUsd / m.mcUsd)} market cap, nilai pasar sudah runtuh.`);
  } else if (v.overrides.some((o) => o.rule === 'honeypot_or_sell_fail')) {
    lines.push('Simulasi jual gagal, token berperilaku seperti honeypot.');
  } else if (has('INSIDER_HEAVY') && r.top10_share != null) {
    lines.push(`10 holder teratas memegang ${pct(r.top10_share)} suplai${r.dev_share != null ? `, dev ${pct(r.dev_share)}` : ''}.`);
  } else if (r.vol_mc != null && r.vol_trend != null) {
    const dir = r.vol_trend >= 1 ? 'naik' : 'turun';
    lines.push(`Volume 6 jam ${x(r.vol_mc)} market cap, laju ${dir} ${pct(Math.abs(r.vol_trend - 1))} dibanding rata-rata 24 jam.`);
  }

  if (r.liq_ratio != null) lines.push(`Likuiditas ${pct(r.liq_ratio)} MC.`);
  if (r.dev_share != null && r.dev_share > 0.5 && !has('INSIDER_HEAVY')) lines.push(`Dev memegang ${pct(r.dev_share)} suplai.`);

  const shown = v.flags.filter((f) => f !== 'LOW_CONFIDENCE');
  const flagLine = shown.length ? `${shown.length} flag: ${shown.join(', ')}.` : 'Tanpa flag.';
  const lowConf = v.confidence < 0.5 ? `Confidence rendah, sinyal hilang: ${v.missingSignals.join(', ') || 'data sumber tidak lengkap'}.` : '';

  // enforce the 60-word cap: drop optional middle sentences first
  const assemble = (mid: string[]) => [head, ...mid, flagLine, lowConf].filter(Boolean).join(' ');
  let mid = lines;
  let out = assemble(mid);
  while (wordCount(out) > 60 && mid.length) { mid = mid.slice(0, -1); out = assemble(mid); }
  if (wordCount(out) > 60) out = out.split(/\s+/).slice(0, 60).join(' ');
  return out;
}

export const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
