import { formatUnits, type Hex } from 'viem';
import type { ChainClient, ChainInfo } from './chains.js';

const TOPIC_TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const TOPIC_APPROVAL = '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925';
const topicAddr = (t?: string) => (t ? `0x${t.slice(-40)}`.toLowerCase() : null);

/** Looks up 4-byte function / event signatures in the public openchain database. */
export type SigLookup = (kind: 'function' | 'event', hash: string) => Promise<string | null>;
export const openchainLookup: SigLookup = async (kind, hash) => {
  try {
    const r = await fetch(`https://api.openchain.xyz/signature-database/v1/lookup?${kind}=${hash}&filter=true`, { signal: AbortSignal.timeout(5000) });
    const b = (await r.json()) as { result?: Record<string, Record<string, { name: string }[] | null>> };
    return b.result?.[kind]?.[hash]?.[0]?.name ?? null;
  } catch { return null; }
};

export interface DecodedTx {
  chain: string; hash: string; status: 'success' | 'reverted' | 'pending'; block: string | null;
  from: string; to: string | null; valueEth: string; function: { selector: string | null; signature: string | null };
  gasUsed: string | null; events: { kind: string; contract: string; from?: string | null; to?: string | null; owner?: string | null; spender?: string | null; raw?: string }[];
  explorer: string;
}

export async function decodeTx(c: ChainClient, chain: ChainInfo, hash: Hex, lookup: SigLookup = openchainLookup): Promise<DecodedTx> {
  const tx = await c.getTransaction({ hash });
  const receipt = await c.getTransactionReceipt({ hash }).catch(() => null);
  const selector = tx.input && tx.input.length >= 10 ? tx.input.slice(0, 10) : null;
  const signature = selector ? await lookup('function', selector) : null;
  const events = await Promise.all((receipt?.logs ?? []).slice(0, 40).map(async (l) => {
    const t0 = l.topics[0];
    if (t0 === TOPIC_TRANSFER && l.topics.length === 3) return { kind: 'Transfer', contract: l.address.toLowerCase(), from: topicAddr(l.topics[1]), to: topicAddr(l.topics[2]), raw: BigInt(l.data === '0x' ? 0 : l.data).toString() };
    if (t0 === TOPIC_APPROVAL && l.topics.length === 3) return { kind: 'Approval', contract: l.address.toLowerCase(), owner: topicAddr(l.topics[1]), spender: topicAddr(l.topics[2]), raw: BigInt(l.data === '0x' ? 0 : l.data).toString() };
    return { kind: (t0 ? await lookup('event', t0) : null) ?? `event ${t0?.slice(0, 10) ?? '?'}`, contract: l.address.toLowerCase() };
  }));
  return {
    chain: chain.name, hash, status: receipt ? (receipt.status === 'success' ? 'success' : 'reverted') : 'pending',
    block: receipt ? receipt.blockNumber.toString() : null, from: tx.from.toLowerCase(), to: tx.to ? tx.to.toLowerCase() : null,
    valueEth: formatUnits(tx.value, 18), function: { selector, signature }, gasUsed: receipt ? receipt.gasUsed.toString() : null,
    events, explorer: `${chain.explorer}/tx/${hash}`,
  };
}

export async function simulateTx(c: ChainClient, t: { from: Hex; to: Hex; data?: Hex; value?: bigint }) {
  try {
    const r = await c.call({ account: t.from, to: t.to, data: t.data, value: t.value });
    const gas = await c.estimateGas({ account: t.from, to: t.to, data: t.data, value: t.value }).catch(() => null);
    return { ok: true as const, returnData: r.data ?? '0x', gas: gas?.toString() ?? null };
  } catch (e) {
    const msg = (e as Error).message;
    return { ok: false as const, error: msg.split('\n')[0], reason: /reverted with reason string '([^']+)'/.exec(msg)?.[1] ?? null };
  }
}
