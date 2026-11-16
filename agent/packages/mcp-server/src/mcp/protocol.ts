import type { VerdictService } from '../service.js';
import { runTool, toolList, type CallCtx } from './tools.js';

export const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const;
export const SERVER_INFO = { name: 'verdictagent', title: 'verdictagent: on-chain token verdicts', version: '0.1.0' };

export type JsonRpcId = string | number | null;
export interface JsonRpcRequest { jsonrpc: '2.0'; id?: JsonRpcId; method: string; params?: Record<string, unknown> }
export interface JsonRpcResponse { jsonrpc: '2.0'; id: JsonRpcId; result?: unknown; error?: { code: number; message: string; data?: unknown } }

const INSTRUCTIONS =
  'verdictagent judges whether an on-chain token is still alive. Call verdict_scan_token once before acting on a token, ' +
  'verdict_agent_brief when you only need a sentence for a human, and verdict_watch_token instead of polling. ' +
  'Every result carries data, brief, _meta (sources, confidence, costUnits, degraded) and nextActions. Scores are deterministic, never from an LLM.';

const rpcError = (id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcResponse => ({ jsonrpc: '2.0', id, error: { code, message, ...(data ? { data } : {}) } });

/**
 * Stateless MCP handler. Returns null for notifications (no response expected).
 * Used by both the Streamable HTTP transport (POST /mcp) and stdio.
 */
export async function handleRpc(svc: VerdictService, msg: unknown, base: CallCtx): Promise<JsonRpcResponse | null> {
  if (!msg || typeof msg !== 'object' || (msg as JsonRpcRequest).jsonrpc !== '2.0' || typeof (msg as JsonRpcRequest).method !== 'string') {
    return rpcError((msg as { id?: JsonRpcId })?.id ?? null, -32600, 'Invalid Request: expected a JSON-RPC 2.0 object with a method');
  }
  const req = msg as JsonRpcRequest;
  const isNotification = req.id === undefined;
  const id = req.id ?? null;
  const params = req.params ?? {};

  switch (req.method) {
    case 'initialize': {
      const asked = String(params.protocolVersion ?? '');
      const protocolVersion = (PROTOCOL_VERSIONS as readonly string[]).includes(asked) ? asked : PROTOCOL_VERSIONS[0];
      return { jsonrpc: '2.0', id, result: { protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS } };
    }
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null;
    case 'ping':
      return isNotification ? null : { jsonrpc: '2.0', id, result: {} };
    case 'tools/list':
      return { jsonrpc: '2.0', id, result: { tools: toolList() } };
    case 'tools/call': {
      const name = params.name;
      if (typeof name !== 'string') return rpcError(id, -32602, 'Invalid params: "name" is required');
      const m = (params._meta ?? {}) as { agent_id?: unknown };
      const ctx: CallCtx = { ...base, agentId: typeof m.agent_id === 'string' && m.agent_id ? m.agent_id : base.agentId };
      const out = await runTool(svc, name, params.arguments ?? {}, ctx);
      if (!out.ok && out.envelope.error.code === 'UNKNOWN_TOOL') return rpcError(id, -32602, out.envelope.error.message, out.envelope.error);
      return {
        jsonrpc: '2.0', id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(out.envelope) }],
          structuredContent: out.envelope,
          isError: !out.ok,
        },
      };
    }
    default:
      if (isNotification) return null;
      return rpcError(id, -32601, `Method not found: ${req.method}`);
  }
}

/** Handles a single message or a batch. */
export async function handleRpcPayload(svc: VerdictService, payload: unknown, ctx: CallCtx): Promise<JsonRpcResponse | JsonRpcResponse[] | null> {
  if (Array.isArray(payload)) {
    if (!payload.length) return rpcError(null, -32600, 'Invalid Request: empty batch');
    const out = (await Promise.all(payload.map((m) => handleRpc(svc, m, ctx)))).filter((x): x is JsonRpcResponse => x !== null);
    return out.length ? out : null;
  }
  return handleRpc(svc, payload, ctx);
}
