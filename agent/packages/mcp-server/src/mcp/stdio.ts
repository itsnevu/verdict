import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import type { VerdictService } from '../service.js';
import { handleRpcPayload } from './protocol.js';

/** Newline-delimited JSON-RPC over stdio (MCP stdio transport). Logs never go to stdout. */
export function serveStdio(svc: VerdictService, o: { input: Readable; output: Writable; agentId?: string; apiKey?: string | null }) {
  const rl = createInterface({ input: o.input, crlfDelay: Infinity });
  const pending = new Set<Promise<void>>();
  rl.on('line', (line) => {
    const text = line.trim();
    if (!text) return;
    const p = (async () => {
      let msg: unknown;
      try { msg = JSON.parse(text); } catch {
        o.output.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })}\n`);
        return;
      }
      const res = await handleRpcPayload(svc, msg, { agentId: o.agentId ?? 'stdio', apiKey: o.apiKey ?? null });
      if (res) o.output.write(`${JSON.stringify(res)}\n`);
    })();
    pending.add(p);
    void p.finally(() => pending.delete(p));
  });
  return {
    closed: new Promise<void>((resolve) => rl.on('close', () => { void Promise.all(pending).then(() => resolve()); })),
    close: () => rl.close(),
  };
}
