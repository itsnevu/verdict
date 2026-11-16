/** Shapes an alert for the receiving service: Discord and Telegram get readable messages, anything else raw JSON. */
export interface AlertBody { kind: string; address: string; detail: string; verdict: { score: number | null; label: string | null; flags: string[] }; brief: string; ts: string }

export function formatAlert(url: string, a: AlertBody): { url: string; body: unknown } {
  const text = `VERDICT alert · ${a.kind}\n${a.address}\n${a.detail}\nnow: ${a.verdict.score ?? '–'} ${a.verdict.label ?? ''}${a.verdict.flags.length ? ` · ${a.verdict.flags.join(', ')}` : ''}\n${a.brief}`;
  let u: URL;
  try { u = new URL(url); } catch { return { url, body: a }; }
  if (/(^|\.)discord(app)?\.com$/.test(u.hostname) && u.pathname.startsWith('/api/webhooks/')) return { url, body: { content: text.slice(0, 1900), allowed_mentions: { parse: [] } } };
  if (u.hostname === 'api.telegram.org' && /^\/bot[^/]+\/sendMessage$/.test(u.pathname)) {
    const chat = u.searchParams.get('chat_id');
    return { url, body: { ...(chat ? { chat_id: chat } : {}), text: text.slice(0, 4000), disable_web_page_preview: true } };
  }
  return { url, body: a };
}
