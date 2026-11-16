/**
 * VERDICT.md rules: plain sentences the user writes once; every prepared action is checked against them.
 * Recognised forms (case-insensitive, one per line, bullets allowed):
 *   min score 55 | never buy below score 55
 *   max 100 usd per swap | max 100 usdc per tx
 *   no unlimited approvals
 *   only swap through uniswap | only trade via uniswap
 *   never touch tokens younger than 1h | ... younger than 2d
 *   block 0xabc… | never interact with 0xabc…
 */
export interface Policy { minScore: number | null; maxUsd: number | null; noUnlimited: boolean; venues: string[]; minAgeHours: number | null; blocked: string[]; unknown: string[] }

export function parsePolicy(text: string): Policy {
  const p: Policy = { minScore: null, maxUsd: null, noUnlimited: false, venues: [], minAgeHours: null, blocked: [], unknown: [] };
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.replace(/^\s*[-*#>]+\s*/, '').trim().toLowerCase();
    if (!l) continue;
    let m: RegExpMatchArray | null;
    if ((m = l.match(/(?:min(?:imum)?\s+score|below\s+score)\s+(\d{1,3})/))) p.minScore = Number(m[1]);
    else if ((m = l.match(/max(?:imum)?\s+\$?([\d,.]+)\s*(?:usd|usdc|\$|dollars?)?\s+per\s+(?:swap|tx|trade|transaction)/))) p.maxUsd = Number(m[1]!.replace(/,/g, ''));
    else if (/no\s+unlimited\s+approvals?/.test(l)) p.noUnlimited = true;
    else if ((m = l.match(/only\s+(?:swap|trade)\s+(?:through|via|on)\s+([a-z0-9 ,]+)/))) p.venues = m[1]!.split(/,|\s+and\s+|\s+or\s+/).map((v) => v.trim()).filter(Boolean);
    else if ((m = l.match(/younger\s+than\s+(\d+)\s*(h|hours?|d|days?)/))) p.minAgeHours = Number(m[1]) * (m[2]!.startsWith('d') ? 24 : 1);
    else if ((m = l.match(/(?:block|never\s+interact\s+with)\s+(0x[0-9a-f]{40})/))) p.blocked.push(m[1]!);
    else p.unknown.push(raw.trim());
  }
  return p;
}

export interface Action { kind: 'swap' | 'approve' | 'revoke' | 'transfer' | 'deploy'; token?: string; amountUsd?: number; venue?: string; unlimited?: boolean; to?: string; tokenScore?: number | null; tokenAgeHours?: number | null }

export function checkPolicy(p: Policy, a: Action): { allowed: boolean; violations: string[] } {
  const v: string[] = [];
  const addrs = [a.token, a.to].filter(Boolean).map((x) => x!.toLowerCase());
  for (const b of p.blocked) if (addrs.includes(b)) v.push(`address ${b} is blocked in VERDICT.md`);
  if (a.kind === 'revoke') return { allowed: v.length === 0, violations: v }; // revoking only ever reduces risk
  if (p.minScore !== null && (a.kind === 'swap' || a.kind === 'approve')) {
    if (a.tokenScore === null || a.tokenScore === undefined) v.push(`no verdict for the token; your minimum score is ${p.minScore}`);
    else if (a.tokenScore < p.minScore) v.push(`token scores ${a.tokenScore}, below your minimum of ${p.minScore}`);
  }
  if (p.maxUsd !== null && a.amountUsd !== undefined && a.amountUsd > p.maxUsd) v.push(`$${a.amountUsd} is above your limit of $${p.maxUsd} per transaction`);
  if (p.noUnlimited && a.kind === 'approve' && a.unlimited) v.push('unlimited approvals are not allowed');
  if (p.venues.length && a.kind === 'swap' && a.venue && !p.venues.some((x) => a.venue!.toLowerCase().includes(x))) v.push(`venue ${a.venue} is not in your allowed list (${p.venues.join(', ')})`);
  if (p.minAgeHours !== null && a.tokenAgeHours !== null && a.tokenAgeHours !== undefined && a.tokenAgeHours < p.minAgeHours) v.push(`token is ${Math.round(a.tokenAgeHours)}h old, younger than your ${p.minAgeHours}h minimum`);
  return { allowed: v.length === 0, violations: v };
}
