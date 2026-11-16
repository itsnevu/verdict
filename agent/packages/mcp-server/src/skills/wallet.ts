import { encodeFunctionData, erc20Abi, parseAbiItem, type Hex } from 'viem';
import type { ChainClient } from './chains.js';

const TRANSFER = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');
const APPROVAL = parseAbiItem('event Approval(address indexed owner, address indexed spender, uint256 value)');
const UNLIMITED = 2n ** 255n;
/** Uniswap Permit2 has the same address on every chain it is deployed to. */
export const KNOWN_SPENDERS: Record<string, string> = { '0x000000000022d473030f116ddee9f6b43ac78ba3': 'Uniswap Permit2' };

async function logsBackwards<T>(c: ChainClient, range: bigint, chunk: bigint, fetch: (from: bigint, to: bigint) => Promise<T[]>): Promise<T[]> {
  const latest = await c.getBlockNumber();
  const start = latest > range ? latest - range : 0n;
  const ranges: [bigint, bigint][] = [];
  for (let b = start; b <= latest; b += chunk) ranges.push([b, b + chunk - 1n > latest ? latest : b + chunk - 1n]);
  const out: T[] = [];
  for (let i = 0; i < ranges.length; i += 4) {
    const got = await Promise.all(ranges.slice(i, i + 4).map(([f, t]) => fetch(f, t)));
    for (const g of got) out.push(...g);
  }
  return out;
}

export interface Holding { token: string; symbol: string | null; decimals: number | null; balance: string; amount: number | null }

/** Tokens the wallet received in the recent window, with current balances. Window-limited, so it can miss old holdings. */
export async function walletHoldings(c: ChainClient, wallet: Hex, o: { range: bigint; chunk?: bigint; max?: number }): Promise<{ holdings: Holding[]; scannedBlocks: string; approximate: true }> {
  const logs = await logsBackwards(c, o.range, o.chunk ?? 50_000n, (fromBlock, toBlock) =>
    c.getLogs({ event: TRANSFER, args: { to: wallet }, fromBlock, toBlock }) as Promise<{ address: string }[]>);
  const tokens = [...new Set(logs.map((l) => l.address.toLowerCase()))].slice(0, o.max ?? 40);
  const rows = await Promise.all(tokens.map(async (t) => {
    const token = t as Hex;
    const [bal, sym, dec] = await Promise.all([
      c.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [wallet] }).catch(() => 0n),
      c.readContract({ address: token, abi: erc20Abi, functionName: 'symbol' }).catch(() => null),
      c.readContract({ address: token, abi: erc20Abi, functionName: 'decimals' }).catch(() => null),
    ]);
    const decimals = dec === null ? null : Number(dec);
    return { token: t, symbol: sym, decimals, balance: bal.toString(), amount: decimals === null ? null : Number(bal) / 10 ** decimals };
  }));
  return { holdings: rows.filter((r) => r.balance !== '0'), scannedBlocks: o.range.toString(), approximate: true };
}

export interface ApprovalRow {
  token: string; symbol: string | null; spender: string; spenderLabel: string | null;
  allowance: string; unlimited: boolean; spenderIsContract: boolean; risk: 'high' | 'medium' | 'low'; reasons: string[];
}

/** Pure: how dangerous one live approval is. */
export function rateApproval(a: { allowance: bigint; spenderIsContract: boolean; spenderLabel: string | null }): { risk: ApprovalRow['risk']; reasons: string[] } {
  const reasons: string[] = [];
  const unlimited = a.allowance >= UNLIMITED;
  if (unlimited) reasons.push('unlimited allowance');
  if (!a.spenderIsContract) reasons.push('spender is a plain wallet, not a contract');
  if (!a.spenderLabel) reasons.push('spender is not a known router');
  const risk = !a.spenderIsContract || (unlimited && !a.spenderLabel) ? 'high' : unlimited || !a.spenderLabel ? 'medium' : 'low';
  return { risk, reasons };
}

/** Live (non-zero) approvals granted by the wallet in the recent window, with a risk rating per spender. */
export async function walletApprovals(c: ChainClient, wallet: Hex, o: { range: bigint; chunk?: bigint }): Promise<ApprovalRow[]> {
  const logs = await logsBackwards(c, o.range, o.chunk ?? 50_000n, (fromBlock, toBlock) =>
    c.getLogs({ event: APPROVAL, args: { owner: wallet }, fromBlock, toBlock }) as Promise<{ address: string; args: { spender?: string } }[]>);
  const pairs = [...new Map(logs.map((l) => [`${l.address.toLowerCase()}:${String(l.args.spender).toLowerCase()}`, { token: l.address.toLowerCase(), spender: String(l.args.spender).toLowerCase() }])).values()].slice(0, 60);
  const rows = await Promise.all(pairs.map(async ({ token, spender }) => {
    const [allowance, code, sym] = await Promise.all([
      c.readContract({ address: token as Hex, abi: erc20Abi, functionName: 'allowance', args: [wallet, spender as Hex] }).catch(() => 0n),
      c.getCode({ address: spender as Hex }).catch(() => '0x'),
      c.readContract({ address: token as Hex, abi: erc20Abi, functionName: 'symbol' }).catch(() => null),
    ]);
    if (allowance === 0n) return null;
    const spenderIsContract = !!code && code !== '0x';
    const spenderLabel = KNOWN_SPENDERS[spender] ?? null;
    const r = rateApproval({ allowance, spenderIsContract, spenderLabel });
    return { token, symbol: sym, spender, spenderLabel, allowance: allowance.toString(), unlimited: allowance >= UNLIMITED, spenderIsContract, ...r };
  }));
  const order = { high: 0, medium: 1, low: 2 };
  return rows.filter((r): r is ApprovalRow => r !== null).sort((a, b) => order[a.risk] - order[b.risk]);
}

export interface UnsignedTx { chainId: number; from: string; to: string; data: Hex; value: string; description: string; simulation: { ok: boolean; error?: string } }

/** approve(spender, 0) for each pair, each simulated from the wallet. Nothing is signed or sent. */
export async function prepareRevokes(c: ChainClient, chainId: number, wallet: Hex, pairs: { token: string; spender: string; symbol?: string | null }[]): Promise<UnsignedTx[]> {
  return Promise.all(pairs.map(async (p) => {
    const data = encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [p.spender as Hex, 0n] });
    let simulation: UnsignedTx['simulation'] = { ok: true };
    try { await c.call({ account: wallet, to: p.token as Hex, data }); } catch (e) { simulation = { ok: false, error: (e as Error).message.split('\n')[0] }; }
    return { chainId, from: wallet, to: p.token, data, value: '0', description: `revoke ${p.symbol ?? p.token.slice(0, 10)} approval for ${p.spender.slice(0, 10)}…`, simulation };
  }));
}
