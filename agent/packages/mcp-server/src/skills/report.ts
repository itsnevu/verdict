import type { Label, Verdict } from '@verdictagent/core';
import type { ScoreRow, Store } from '../store/types.js';

const BAD: Label[] = ['COLLAPSING', 'DEAD'];
const OK: Label[] = ['HEALTHY', 'WATCH'];

/**
 * Track record: for every stored verdict at least `horizonDays` old, what did the same token's
 * verdict look like `horizonDays` later? Calls are "right" when warnings stayed bad and passes stayed ok.
 */
export async function trackRecord(store: Store, nowIso: string, horizonDays = 7, limit = 500) {
  const horizon = horizonDays * 86_400_000;
  const tokens = await store.latestScores({ limit });
  const buckets: Record<string, { calls: number; held: number }> = {};
  let total = 0, right = 0;
  for (const t of tokens) {
    const hist = await store.history(t.address, '1970-01-01T00:00:00.000Z');
    for (const s of hist) {
      if (!s.label || Date.parse(nowIso) - Date.parse(s.ts) < horizon) continue;
      const later = hist.find((x) => Date.parse(x.ts) >= Date.parse(s.ts) + horizon);
      if (!later?.label) continue;
      const warned = BAD.includes(s.label) || s.label === 'DECAYING';
      const held = warned ? !OK.includes(later.label) : OK.includes(later.label);
      const b = (buckets[s.label] ??= { calls: 0, held: 0 });
      b.calls++; total++;
      if (held) { b.held++; right++; }
    }
  }
  return {
    horizonDays, verdictsChecked: total, accuracy: total ? Math.round((right / total) * 1000) / 10 : null,
    byLabel: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, { calls: v.calls, heldPct: Math.round((v.held / v.calls) * 1000) / 10 }])),
    method: `a verdict counts as right when, ${horizonDays} days later, a warning (DECAYING, COLLAPSING, DEAD) is still not HEALTHY/WATCH, or a pass (HEALTHY, WATCH) still is`,
  };
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const COLOR: Record<string, string> = { HEALTHY: '#1B32E8', WATCH: '#57503F', DECAYING: '#B8290A', COLLAPSING: '#B8290A', DEAD: '#0E0C0A' };

/** Shareable badge. It always shows the real label, so it cannot be used to fake a pass. */
export function badgeSvg(v: Pick<Verdict, 'score' | 'label'> | null, symbol: string | null): string {
  const left = 'VERDICT';
  const right = v?.label ? `${symbol ? `${symbol} ` : ''}${v.score} ${v.label}` : 'no verdict';
  const lw = 64, rw = Math.max(70, right.length * 7 + 16);
  const color = v?.label ? COLOR[v.label] ?? '#57503F' : '#57503F';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${lw + rw}" height="22" role="img" aria-label="${esc(left)}: ${esc(right)}"><title>${esc(left)}: ${esc(right)}</title><rect width="${lw}" height="22" fill="#0E0C0A"/><rect x="${lw}" width="${rw}" height="22" fill="${color}"/><g fill="#F1ECE3" font-family="ui-monospace,monospace" font-size="11" font-weight="700"><text x="10" y="15">${esc(left)}</text><text x="${lw + 8}" y="15">${esc(right)}</text></g></svg>`;
}

/** Printable audit report for one token: verdict, every signal, overrides, sources, contract read. */
export function reportHtml(r: { verdict: Verdict; brief: string; history: ScoreRow[]; contract: Record<string, unknown> | null; generatedAt: string; sources: { name: string; method: string; complete: boolean }[] }): string {
  const v = r.verdict;
  const rows = v.breakdown.map((b) => `<tr><td>${esc(b.signal)}</td><td>${b.raw ?? '–'}</td><td>${b.score ?? '–'}</td><td>${b.weight}</td><td>${b.status === 'ok' ? b.contribution : 'unavailable'}</td></tr>`).join('');
  const hist = r.history.slice(-12).map((h) => `<li>${esc(h.ts.slice(0, 16).replace('T', ' '))} · ${h.score ?? '–'} ${esc(h.label)}</li>`).join('');
  const risks = (r.contract?.risks as string[] | undefined) ?? [];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>VERDICT report · ${esc(v.symbol ?? v.address)}</title>
<meta name="description" content="VERDICT audit report for ${esc(v.symbol ?? v.address)}: score ${v.score}, ${esc(v.label)}.">
<style>body{margin:0;background:#F1ECE3;color:#0E0C0A;font:15px/1.5 ui-sans-serif,system-ui}main{max-width:860px;margin:0 auto;padding:32px 16px}h1{font-size:30px;margin:0}h2{font-size:13px;letter-spacing:.14em;text-transform:uppercase;margin:26px 0 8px}.big{font-size:64px;font-weight:800;line-height:1}.mono{font-family:ui-monospace,monospace;font-size:13px}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #0001}.brief{border-left:4px solid #FF3B12;padding:8px 12px;background:#E6DFD2}@media print{body{background:#fff}}</style></head><body><main>
<p class="mono">VERDICT REPORT · generated ${esc(r.generatedAt)} UTC · engine ${esc(v.engineVersion)}</p>
<h1>${esc(v.symbol ?? 'token')} <span class="mono">${esc(v.address)}</span></h1>
<p><span class="big">${v.score ?? '–'}</span> <b>${esc(v.label)}</b> · confidence ${v.confidence}</p>
<p class="brief">${esc(r.brief)}</p>
<h2>Flags</h2><p class="mono">${v.flags.length ? v.flags.map(esc).join(', ') : 'none'}</p>
<h2>Signals</h2><table><thead><tr><th scope="col">signal</th><th scope="col">raw</th><th scope="col">score</th><th scope="col">weight</th><th scope="col">contribution</th></tr></thead><tbody>${rows}</tbody></table>
${v.overrides.length ? `<h2>Overrides</h2><ul class="mono">${v.overrides.map((o) => `<li>${esc(o.rule)}: ${esc(o.effect)}</li>`).join('')}</ul>` : ''}
${r.contract ? `<h2>Contract</h2><ul class="mono"><li>proxy: ${r.contract.proxy && (r.contract.proxy as { isProxy: boolean }).isProxy ? 'yes' : 'no'}</li><li>owner: ${esc(r.contract.owner ?? 'none or unknown')}</li>${risks.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
${hist ? `<h2>History</h2><ul class="mono">${hist}</ul>` : ''}
<h2>Sources</h2><ul class="mono">${r.sources.map((s) => `<li>${esc(s.name)} ${esc(s.method)}: ${s.complete ? 'complete' : 'incomplete'}</li>`).join('')}</ul>
<p class="mono">Scores are deterministic and computed from chain data, never by a language model. This report is information, not financial advice.</p>
</main></body></html>`;
}
