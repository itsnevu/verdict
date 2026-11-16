import { round } from './score/clamp.js';

export interface DeclaredTool {
  name: string;
  description?: string;
  readOnly?: boolean;
  /** contract addresses this tool may write to */
  contractTargets?: string[];
}

export interface ProbeResult {
  reachable: boolean;
  tlsValid: boolean;
  /** tool names the endpoint actually returned from tools/list (null when not reachable) */
  liveTools: string[] | null;
  checkedAt: string;
  error?: string;
}

export interface TrustInput {
  declaredTools: DeclaredTool[];
  contractTargets: string[];
  probe: ProbeResult | null;
  registeredAt: string;
  now: string;
}

/** Write tool = anything not declared readOnly. */
export const isWriteTool = (t: DeclaredTool) => t.readOnly !== true;

/**
 * trust = declaration completeness 40% + probe 40% + age 20%.
 * A write tool without contract targets caps trust at 40.
 */
export function trustScore(t: TrustInput): { trust: number; parts: { declaration: number; probe: number; age: number }; capped: boolean } {
  const tools = t.declaredTools;
  let decl = 0;
  if (tools.length) {
    const perTool = tools.map((x) => {
      let s = 0;
      if (x.name) s += 1;
      if (x.description && x.description.length >= 20) s += 1;
      if (typeof x.readOnly === 'boolean') s += 1;
      if (!isWriteTool(x) || (x.contractTargets?.length ?? 0) > 0 || t.contractTargets.length > 0) s += 1;
      return s / 4;
    });
    decl = perTool.reduce((a, b) => a + b, 0) / perTool.length;
  }
  let probe = 0;
  if (t.probe) {
    if (t.probe.reachable) probe += 0.4;
    if (t.probe.tlsValid) probe += 0.25;
    if (t.probe.liveTools) {
      const declared = new Set(tools.map((x) => x.name));
      const live = new Set(t.probe.liveTools);
      const match = declared.size === 0 ? 0 : [...declared].filter((n) => live.has(n)).length / declared.size;
      const undeclared = [...live].filter((n) => !declared.has(n)).length;
      probe += 0.35 * match * (undeclared ? 0.5 : 1);
    }
  }
  const days = Math.max(0, (Date.parse(t.now) - Date.parse(t.registeredAt)) / 86_400_000);
  const age = Math.min(1, days / 30);
  let trust = 100 * (0.4 * decl + 0.4 * probe + 0.2 * age);
  const writeWithoutTarget = tools.some((x) => isWriteTool(x) && !(x.contractTargets?.length) && t.contractTargets.length === 0);
  if (writeWithoutTarget) trust = Math.min(trust, 40);
  return { trust: round(trust), parts: { declaration: round(decl, 3), probe: round(probe, 3), age: round(age, 3) }, capped: writeWithoutTarget };
}

/** Probe a third-party MCP endpoint with a stateless tools/list call. */
export async function probeMcp(url: string, f: typeof fetch = fetch, timeoutMs = 4000): Promise<ProbeResult> {
  const checkedAt = new Date().toISOString();
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await f(url, {
      method: 'POST', signal: ac.signal,
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    const tlsValid = url.startsWith('https://');
    let liveTools: string[] | null = null;
    const text = await r.text();
    const json = text.startsWith('{') ? JSON.parse(text) : JSON.parse(text.split('\n').find((l) => l.startsWith('data:'))?.slice(5) ?? 'null');
    const tools = json?.result?.tools;
    if (Array.isArray(tools)) liveTools = tools.map((x: { name?: unknown }) => String(x?.name ?? '')).filter(Boolean);
    return { reachable: r.status < 500, tlsValid, liveTools, checkedAt };
  } catch (e) {
    const msg = (e as Error).message;
    return { reachable: false, tlsValid: false, liveTools: null, checkedAt, error: /certificate|tls|ssl/i.test(msg) ? `tls: ${msg}` : msg };
  } finally {
    clearTimeout(t);
  }
}
