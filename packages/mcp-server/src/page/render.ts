import type { Envelope, ErrorEnvelope, Verdict } from '@verdictagent/core';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const fmt = (v: number | null, dp = 3) => (v === null ? '<span class="na">n/a</span>' : esc(Math.round(v * 10 ** dp) / 10 ** dp));

const CSS = `
:root{--paper:#F1ECE3;--ink:#0E0C0A;--soft:#57503F;--red:#FF3B12;--blue:#1B32E8;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--paper:#0E0C0A;--ink:#F1ECE3;--soft:#A79E8B;--blue:#7C8CFF}}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.5 ui-sans-serif,system-ui,sans-serif}
main{max-width:980px;margin:0 auto;padding:32px 16px 64px}
h1{font-size:28px;letter-spacing:-.02em;margin:0 0 4px}.sub{color:var(--soft);margin:0 0 24px}
form{display:flex;gap:8px;margin-bottom:28px}input{flex:1;min-width:0;padding:10px 12px;border:1.5px solid var(--ink);background:transparent;color:inherit;font:14px ui-monospace,monospace}
button{padding:10px 16px;border:1.5px solid var(--ink);background:var(--ink);color:var(--paper);font:600 13px ui-monospace,monospace;cursor:pointer}
.verdict{display:grid;grid-template-columns:auto 1fr;gap:6px 24px;align-items:baseline;border:1.5px solid var(--ink);padding:18px;margin-bottom:20px}
.score{font-size:64px;font-weight:800;line-height:1;grid-row:span 3}.label{font:700 14px ui-monospace,monospace;letter-spacing:.12em}
.HEALTHY{color:var(--blue)}.WATCH{color:var(--ink)}.DECAYING,.COLLAPSING,.DEAD{color:var(--red)}
.mono{font-family:ui-monospace,monospace;font-size:13px}.na{color:var(--soft)}
.brief{border-left:4px solid var(--red);padding:10px 14px;margin:0 0 20px;background:color-mix(in srgb,var(--ink) 5%,transparent)}
.flags span{display:inline-block;border:1px solid var(--red);color:var(--red);padding:2px 6px;margin:0 6px 6px 0;font:12px ui-monospace,monospace}
.wrap{overflow-x:auto;margin-bottom:20px}table{width:100%;border-collapse:collapse;min-width:620px}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid color-mix(in srgb,var(--ink) 18%,transparent)}
th{font:600 11px ui-monospace,monospace;text-transform:uppercase;letter-spacing:.12em;color:var(--soft)}td.num{text-align:right;font-family:ui-monospace,monospace}
h2{font-size:14px;text-transform:uppercase;letter-spacing:.14em;margin:24px 0 8px}.err{border:1.5px solid var(--red);padding:14px}
footer{margin-top:40px;color:var(--soft);font-size:13px}a{color:inherit}`;

export function renderPage(o: { address?: string; result?: { ok: true; envelope: Envelope<unknown> } | { ok: false; envelope: ErrorEnvelope } }) {
  let body = '';
  if (o.result && !o.result.ok) {
    const e = o.result.envelope.error;
    body = `<div class="err"><b>${esc(e.code)}</b>: ${esc(e.message)}<br><span class="mono">fix: ${esc(e.fix)}</span></div>`;
  } else if (o.result?.ok) {
    const env = o.result.envelope;
    const v = env.data as Verdict;
    body = `
<section class="verdict" aria-label="verdict">
  <div class="score">${esc(v.score ?? '–')}</div>
  <div class="label ${esc(v.label)}">${esc(v.label ?? 'NO VERDICT')}</div>
  <div class="mono">confidence ${esc(v.confidence)} · engine ${esc(v.engineVersion)}${env._meta.degraded ? ' · <b>degraded</b>' : ''}</div>
  <div class="mono">${esc(v.symbol ?? '')} ${esc(v.address)}</div>
</section>
<p class="brief">${esc(env.brief)}</p>
<h2>Flags</h2>
<div class="flags">${v.flags.length ? v.flags.map((f) => `<span>${esc(f)}</span>`).join('') : '<span class="na" style="border:0">none</span>'}</div>
<h2>Breakdown</h2>
<div class="wrap"><table>
<thead><tr><th>signal</th><th>raw</th><th>signal score</th><th>weight</th><th>contribution</th></tr></thead>
<tbody>${v.breakdown.map((r) => `<tr><td class="mono">${esc(r.signal)}</td><td class="num">${fmt(r.raw, 4)}</td><td class="num">${fmt(r.score, 1)}</td><td class="num">${esc(r.weight)}${r.status === 'ok' && r.effectiveWeight !== r.weight ? ` <span class="na">→ ${esc(r.effectiveWeight)}</span>` : ''}</td><td class="num">${r.status === 'ok' ? esc(r.contribution) : '<span class="na">unavailable</span>'}</td></tr>`).join('')}</tbody>
</table></div>
${v.overrides.length ? `<h2>Overrides</h2><ul class="mono">${v.overrides.map((x) => `<li>${esc(x.rule)}: ${esc(x.effect)}</li>`).join('')}</ul>` : ''}
<h2>Sources</h2>
<div class="wrap"><table><thead><tr><th>source</th><th>method</th><th>fetched (UTC)</th><th>complete</th></tr></thead>
<tbody>${env._meta.sources.map((s) => `<tr><td class="mono">${esc(s.name)}</td><td class="mono">${esc(s.method)}</td><td class="mono">${esc(s.fetchedAt)}</td><td class="mono">${s.complete ? 'yes' : `no <span class="na">${esc(s.error ?? '')}</span>`}</td></tr>`).join('')}</tbody></table></div>`;
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>verdictagent</title><style>${CSS}</style></head><body><main>
<h1>verdictagent</h1><p class="sub">Is this token still alive? A deterministic verdict, explained signal by signal.</p>
<form method="get" action="/"><input name="address" placeholder="0x… token address" value="${esc(o.address ?? '')}" aria-label="token address" required pattern="0x[0-9a-fA-F]{40}"><button type="submit">Judge</button></form>
${body}
<footer>MCP: <span class="mono">POST /mcp</span> · HTTP: <span class="mono">GET /v1/scan/:address</span> · <a href="/v1/health">health</a></footer>
</main></body></html>`;
}
