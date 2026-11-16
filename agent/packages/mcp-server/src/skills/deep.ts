import { erc20Abi, getContractAddress, parseAbi, parseAbiItem, type Hex } from 'viem';
import type { ChainClient } from './chains.js';

const TRANSFER = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');
const ZERO = '0x0000000000000000000000000000000000000000';
const BURN = new Set([ZERO, '0x000000000000000000000000000000000000dead']);

/* ───────── DexScreener (all chains in one call) ───────── */
export interface DexPair { chainId: string; dexId: string; pairAddress: string; baseToken: { address: string; symbol: string }; quoteToken: { address: string; symbol: string }; priceUsd?: string; liquidity?: { usd?: number }; volume?: { h1?: number; h6?: number; h24?: number }; txns?: { h1?: { buys: number; sells: number }; h24?: { buys: number; sells: number } }; priceChange?: { h1?: number; h6?: number; h24?: number }; marketCap?: number; fdv?: number; pairCreatedAt?: number; labels?: string[] }
export type DexFetch = (address: string) => Promise<DexPair[]>;
export const dexPairs: DexFetch = async (address) => {
  try {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${address}`, { signal: AbortSignal.timeout(8000), headers: { accept: 'application/json' } });
    const b = (await r.json()) as { pairs?: DexPair[] };
    return Array.isArray(b.pairs) ? b.pairs : [];
  } catch { return []; }
};
const deepest = (ps: DexPair[], chain: string, token: string) =>
  ps.filter((p) => p.chainId === chain && p.baseToken.address.toLowerCase() === token.toLowerCase()).sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0] ?? null;

async function recentLogs(c: ChainClient, range: bigint, args: Record<string, unknown>, address?: Hex) {
  const latest = await c.getBlockNumber();
  const start = latest > range ? latest - range : 0n;
  const chunk = 50_000n;
  const ranges: [bigint, bigint][] = [];
  for (let b = start; b <= latest; b += chunk) ranges.push([b, b + chunk - 1n > latest ? latest : b + chunk - 1n]);
  const out: { address: string; args: { from?: string; to?: string; value?: bigint }; blockNumber: bigint | null; transactionHash: string | null }[] = [];
  for (let i = 0; i < ranges.length; i += 4) {
    const got = await Promise.all(ranges.slice(i, i + 4).map(([f, t]) => c.getLogs({ ...(address ? { address } : {}), event: TRANSFER, args, fromBlock: f, toBlock: t } as never) as unknown as Promise<typeof out>));
    for (const g of got) out.push(...g);
  }
  return out.map((l) => ({ ...l, from: String(l.args.from).toLowerCase(), to: String(l.args.to).toLowerCase(), value: l.args.value ?? 0n }));
}

/* ───────── wash trading ───────── */
export async function washCheck(c: ChainClient, token: Hex, chain: string, o: { range: bigint; dex?: DexFetch }) {
  const pair = deepest(await (o.dex ?? dexPairs)(token), chain, token);
  const signals: string[] = [];
  let points = 0;
  if (pair) {
    const vol = pair.volume?.h24 ?? 0, liq = pair.liquidity?.usd ?? 0;
    const b = pair.txns?.h24?.buys ?? 0, s = pair.txns?.h24?.sells ?? 0, tx = b + s;
    const turnover = liq > 0 ? vol / liq : 0;
    const balance = tx ? Math.min(b, s) / Math.max(b, s, 1) : 0;
    const move = Math.abs(pair.priceChange?.h24 ?? 0);
    if (turnover > 20) { points += 30; signals.push(`24h volume is ${turnover.toFixed(0)}× liquidity`); }
    if (balance > 0.92 && tx > 200) { points += 20; signals.push(`buys and sells are almost exactly balanced (${b}/${s})`); }
    if (turnover > 5 && move < 3) { points += 20; signals.push(`heavy volume but price moved only ${move.toFixed(1)}%`); }
    if (tx > 0 && vol / tx > 0 && vol / tx < 15 && tx > 1000) { points += 10; signals.push(`average trade is $${(vol / tx).toFixed(2)}, typical of bots`); }
  } else signals.push('no market on this chain');
  // onchain: wallets trading the same token back and forth within the window
  let circular = 0, transfers = 0;
  try {
    const logs = await recentLogs(c, o.range, {}, token);
    transfers = logs.length;
    const pairs = new Set(logs.map((l) => `${l.from}>${l.to}`));
    circular = logs.filter((l) => pairs.has(`${l.to}>${l.from}`) && !BURN.has(l.from) && !BURN.has(l.to)).length;
    const share = transfers ? circular / transfers : 0;
    if (share > 0.3 && transfers > 50) { points += 25; signals.push(`${Math.round(share * 100)}% of recent transfers bounce between the same wallets`); }
  } catch { signals.push('onchain transfer history unavailable'); }
  const verdict = points >= 50 ? 'likely' : points >= 25 ? 'possible' : 'unlikely';
  return { washTrading: verdict, score: Math.min(100, points), signals, market: pair ? { dex: pair.dexId, pair: pair.pairAddress, volume24h: pair.volume?.h24 ?? null, liquidity: pair.liquidity?.usd ?? null, buys24h: pair.txns?.h24?.buys ?? null, sells24h: pair.txns?.h24?.sells ?? null, priceChange24h: pair.priceChange?.h24 ?? null } : null, transfersChecked: transfers, circularTransfers: circular };
}

/* ───────── LP lock status ───────── */
const PAIR_ABI = parseAbi(['function token0() view returns (address)', 'function token1() view returns (address)', 'function totalSupply() view returns (uint256)']);
export async function lpStatus(c: ChainClient, token: Hex, chain: string, o: { range: bigint; dex?: DexFetch }) {
  const pair = deepest(await (o.dex ?? dexPairs)(token), chain, token);
  if (!pair) return { status: 'no market', detail: 'no pool for this token on this chain', pool: null };
  if (!/^0x[0-9a-fA-F]{40}$/.test(pair.pairAddress)) {
    return { status: 'position-based', pool: { dex: pair.dexId, id: pair.pairAddress, version: 'v4' }, detail: 'Uniswap v4 liquidity is held as NFT positions in the PoolManager; there is no LP token to lock, so whoever owns the positions can remove liquidity at any time.', risk: 'high' };
  }
  const lp = pair.pairAddress.toLowerCase() as Hex;
  const supply = await c.readContract({ address: lp, abi: PAIR_ABI, functionName: 'totalSupply' }).catch(() => null);
  if (supply === null || supply === 0n) return { status: 'concentrated', pool: { dex: pair.dexId, address: lp, version: 'v3' }, detail: 'concentrated-liquidity pool (positions are NFTs, not lockable LP tokens)', risk: 'high' };
  const logs = await recentLogs(c, o.range * 4n, {}, lp).catch(() => []);
  const holders = [...new Set(logs.map((l) => l.to))].filter((a) => a !== ZERO);
  const rows = await Promise.all(holders.slice(0, 40).map(async (h) => {
    const [bal, code] = await Promise.all([c.readContract({ address: lp, abi: erc20Abi, functionName: 'balanceOf', args: [h as Hex] }).catch(() => 0n), c.getCode({ address: h as Hex }).catch(() => '0x')]);
    return { holder: h, share: Number((bal * 10_000n) / supply) / 100, contract: !!code && code !== '0x', burned: BURN.has(h) };
  }));
  const held = rows.filter((r) => r.share > 0).sort((a, b) => b.share - a.share);
  const burned = held.filter((r) => r.burned).reduce((n, r) => n + r.share, 0) + Number((((await c.readContract({ address: lp, abi: erc20Abi, functionName: 'balanceOf', args: ['0x000000000000000000000000000000000000dEaD'] }).catch(() => 0n)) as bigint) * 10_000n) / supply) / 100;
  const inContracts = held.filter((r) => r.contract && !r.burned).reduce((n, r) => n + r.share, 0);
  const inWallets = held.filter((r) => !r.contract && !r.burned).reduce((n, r) => n + r.share, 0);
  const risk = inWallets > 50 ? 'high' : burned + inContracts > 80 ? 'low' : 'medium';
  return {
    status: risk === 'high' ? 'unlocked' : risk === 'low' ? 'burned or held by contracts' : 'partly unlocked', risk, pool: { dex: pair.dexId, address: lp, version: 'v2' },
    lpShare: { burnedPct: Math.round(burned * 10) / 10, inContractsPct: Math.round(inContracts * 10) / 10, inWalletsPct: Math.round(inWallets * 10) / 10 },
    topHolders: held.slice(0, 5),
    detail: inWallets > 50 ? `${inWallets.toFixed(0)}% of LP sits in plain wallets: liquidity can be pulled at any time` : 'contract holders may be lockers; their unlock dates are not readable generically',
  };
}

/* ───────── deployer history (CREATE addresses from the nonce) ───────── */
export async function deployerHistory(c: ChainClient, wallet: Hex, o: { maxNonce?: number } = {}) {
  const nonce = Number(await c.getTransactionCount({ address: wallet }));
  const n = Math.min(nonce, o.maxNonce ?? 300);
  const addrs = Array.from({ length: n }, (_, i) => getContractAddress({ from: wallet, nonce: BigInt(i) }).toLowerCase());
  const out: { address: string; nonce: number; symbol: string | null; isToken: boolean; codeSize: number }[] = [];
  for (let i = 0; i < addrs.length; i += 25) {
    const batch = await Promise.all(addrs.slice(i, i + 25).map(async (a, j) => {
      const code = await c.getCode({ address: a as Hex }).catch(() => '0x');
      if (!code || code === '0x') return null;
      const symbol = await c.readContract({ address: a as Hex, abi: erc20Abi, functionName: 'symbol' }).catch(() => null);
      return { address: a, nonce: i + j, symbol, isToken: symbol !== null, codeSize: (code.length - 2) / 2 };
    }));
    for (const b of batch) if (b) out.push(b);
  }
  return { wallet: wallet.toLowerCase(), transactions: nonce, scannedNonces: n, contracts: out, note: 'contracts deployed directly with CREATE; factory or CREATE2 deployments are not listed' };
}

/**
 * Finds who launched a token: the sender of the transaction that first minted it (Transfer from 0x0).
 * Logs are never pruned, so this works on public nodes; ranges of 10M blocks keep it to ~12 calls.
 */
export async function findDeployer(c: ChainClient, address: Hex, step = 9_999_999n) {
  const latest = await c.getBlockNumber();
  const ranges: [bigint, bigint][] = [];
  for (let b = 0n; b <= latest; b += step + 1n) ranges.push([b, b + step > latest ? latest : b + step]);
  for (let i = 0; i < ranges.length; i += 4) {
    const got = await Promise.all(ranges.slice(i, i + 4).map(([f, t]) =>
      (c.getLogs({ address, event: TRANSFER, args: { from: ZERO }, fromBlock: f, toBlock: t } as never) as unknown as Promise<{ transactionHash: Hex; blockNumber: bigint }[]>).catch(() => [])));
    const first = got.flat()[0];
    if (first) {
      const tx = await c.getTransaction({ hash: first.transactionHash });
      return { block: first.blockNumber.toString(), deployer: tx.from.toLowerCase(), tx: first.transactionHash, via: tx.to && tx.to.toLowerCase() !== address.toLowerCase() ? tx.to.toLowerCase() : null };
    }
  }
  return null;
}

/* ───────── funding trace / wallet moves / PnL ───────── */
export async function walletFlows(c: ChainClient, wallet: Hex, o: { range: bigint }) {
  const [incoming, outgoing] = await Promise.all([recentLogs(c, o.range, { to: wallet }), recentLogs(c, o.range, { from: wallet })]);
  return { incoming, outgoing };
}

export async function traceFunding(c: ChainClient, wallet: Hex, o: { range: bigint; label?: (a: string) => string | null }) {
  const { incoming } = await walletFlows(c, wallet, o);
  const by = new Map<string, { from: string; transfers: number; tokens: Set<string>; firstBlock: bigint }>();
  for (const l of incoming) {
    const e = by.get(l.from) ?? { from: l.from, transfers: 0, tokens: new Set<string>(), firstBlock: l.blockNumber ?? 0n };
    e.transfers++; e.tokens.add(l.address.toLowerCase());
    if ((l.blockNumber ?? 0n) < e.firstBlock) e.firstBlock = l.blockNumber ?? 0n;
    by.set(l.from, e);
  }
  const sources = [...by.values()].sort((a, b) => (a.firstBlock < b.firstBlock ? -1 : 1)).slice(0, 15)
    .map((s) => ({ from: s.from, label: o.label?.(s.from) ?? (BURN.has(s.from) ? 'mint' : null), transfers: s.transfers, tokens: s.tokens.size, firstBlock: s.firstBlock.toString() }));
  return { wallet: wallet.toLowerCase(), firstFunders: sources, note: 'token transfers only; native ETH funding needs a tracing node' };
}

export async function walletMoves(c: ChainClient, wallet: Hex, o: { range: bigint; token?: Hex; pools?: Set<string> }) {
  const { incoming, outgoing } = await walletFlows(c, wallet, o);
  const f = (l: { address: string }) => !o.token || l.address.toLowerCase() === o.token.toLowerCase();
  const moves = [
    ...outgoing.filter(f).map((l) => ({ dir: o.pools?.has(l.to) ? 'sold' : 'sent', token: l.address.toLowerCase(), counterparty: l.to, raw: l.value.toString(), block: (l.blockNumber ?? 0n).toString(), tx: l.transactionHash })),
    ...incoming.filter(f).map((l) => ({ dir: o.pools?.has(l.from) ? 'bought' : 'received', token: l.address.toLowerCase(), counterparty: l.from, raw: l.value.toString(), block: (l.blockNumber ?? 0n).toString(), tx: l.transactionHash })),
  ].sort((a, b) => (BigInt(b.block) > BigInt(a.block) ? 1 : -1)).slice(0, 50);
  return { wallet: wallet.toLowerCase(), moves, sold: moves.filter((m) => m.dir === 'sold').length, bought: moves.filter((m) => m.dir === 'bought').length };
}

export async function walletPnl(c: ChainClient, wallet: Hex, chain: string, o: { range: bigint; dex?: DexFetch }) {
  const { incoming, outgoing } = await walletFlows(c, wallet, o);
  const tokens = [...new Set([...incoming, ...outgoing].map((l) => l.address.toLowerCase()))].slice(0, 25);
  const rows = await Promise.all(tokens.map(async (t) => {
    const [pairs, dec, sym, bal] = await Promise.all([(o.dex ?? dexPairs)(t), c.readContract({ address: t as Hex, abi: erc20Abi, functionName: 'decimals' }).catch(() => 18), c.readContract({ address: t as Hex, abi: erc20Abi, functionName: 'symbol' }).catch(() => null), c.readContract({ address: t as Hex, abi: erc20Abi, functionName: 'balanceOf', args: [wallet] }).catch(() => 0n)]);
    const p = deepest(pairs, chain, t);
    const price = p?.priceUsd ? Number(p.priceUsd) : null;
    const pools = new Set(pairs.map((x) => x.pairAddress.toLowerCase()));
    const amt = (v: bigint) => Number(v) / 10 ** Number(dec);
    const boughtQty = incoming.filter((l) => l.address.toLowerCase() === t && pools.has(l.from)).reduce((n, l) => n + amt(l.value), 0);
    const soldQty = outgoing.filter((l) => l.address.toLowerCase() === t && pools.has(l.to)).reduce((n, l) => n + amt(l.value), 0);
    const held = amt(bal as bigint);
    return { token: t, symbol: sym, priceUsd: price, boughtQty, soldQty, heldQty: held, heldUsd: price === null ? null : Math.round(held * price * 100) / 100, netFlowUsd: price === null ? null : Math.round((soldQty - boughtQty) * price * 100) / 100 };
  }));
  const txCount = Number(await c.getTransactionCount({ address: wallet }).catch(() => 0));
  const trades = rows.reduce((n, r) => n + (r.boughtQty > 0 ? 1 : 0) + (r.soldQty > 0 ? 1 : 0), 0);
  const heldUsd = rows.reduce((n, r) => n + (r.heldUsd ?? 0), 0);
  const swaps = incoming.length + outgoing.length;
  return {
    wallet: wallet.toLowerCase(), tokens: rows.filter((r) => r.heldQty > 0 || r.boughtQty > 0 || r.soldQty > 0), heldUsd: Math.round(heldUsd * 100) / 100,
    profile: txCount > 2000 || swaps > 400 ? 'bot-like (very high activity)' : trades > 20 ? 'active trader' : 'occasional',
    note: 'flows in the recent window valued at current prices; true PnL needs historical prices', transactionsAllTime: txCount,
  };
}

/* ───────── address labels ───────── */
export const KNOWN_LABELS: Record<string, { label: string; kind: 'router' | 'cex' | 'mixer' | 'burn' | 'token' | 'bridge' }> = {
  '0x000000000022d473030f116ddee9f6b43ac78ba3': { label: 'Uniswap Permit2', kind: 'router' },
  '0x0000000000000000000000000000000000000000': { label: 'zero address (mint/burn)', kind: 'burn' },
  '0x000000000000000000000000000000000000dead': { label: 'burn address', kind: 'burn' },
  '0x28c6c06298d514db089934071355e5743bf21d60': { label: 'Binance hot wallet', kind: 'cex' },
  '0x71660c4005ba85c37ccec55d0c4493e66fe775d3': { label: 'Coinbase hot wallet', kind: 'cex' },
  '0x12d66f87a04a9e220743712ce6d9bb1b5616b8fc': { label: 'Tornado Cash 0.1 ETH', kind: 'mixer' },
  '0x47ce0c6ed5b0ce3d3a51fdb1c52dc66a7c3c2936': { label: 'Tornado Cash 1 ETH', kind: 'mixer' },
  '0x910cbd523d972eb0a6f4cae4618ad62622b39dbf': { label: 'Tornado Cash 10 ETH', kind: 'mixer' },
  '0xa160cdab225685da1d56aa342ad8841c3b53f291': { label: 'Tornado Cash 100 ETH', kind: 'mixer' },
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': { label: 'WETH (Ethereum)', kind: 'token' },
};
const SAFE_ABI = parseAbi(['function getThreshold() view returns (uint256)', 'function getOwners() view returns (address[])']);

export async function labelAddress(c: ChainClient, address: Hex) {
  const a = address.toLowerCase();
  const known = KNOWN_LABELS[a] ?? null;
  const [code, nonce] = await Promise.all([c.getCode({ address }).catch(() => '0x'), c.getTransactionCount({ address }).catch(() => 0)]);
  const isContract = !!code && code !== '0x';
  const traits: string[] = [];
  let kind: string = known?.kind ?? (isContract ? 'contract' : 'wallet');
  if (isContract) {
    const [sym, t0, thr] = await Promise.all([
      c.readContract({ address, abi: erc20Abi, functionName: 'symbol' }).catch(() => null),
      c.readContract({ address, abi: PAIR_ABI, functionName: 'token0' }).catch(() => null),
      c.readContract({ address, abi: SAFE_ABI, functionName: 'getThreshold' }).catch(() => null),
    ]);
    if (t0) { kind = known?.kind ?? 'liquidity pool'; traits.push('AMM pair (token0/token1)'); }
    else if (thr !== null) { kind = known?.kind ?? 'multisig'; traits.push(`Safe multisig, ${thr} signatures required`); }
    else if (sym) { kind = known?.kind ?? 'token'; traits.push(`ERC-20 ${sym}`); }
  } else {
    traits.push(Number(nonce) === 0 ? 'never sent a transaction' : `${nonce} transactions sent`);
  }
  if (known?.kind === 'mixer') traits.push('funds from mixers are a common rug and hack signal');
  return { address: a, label: known?.label ?? null, kind, isContract, traits, source: known ? 'public label list' : 'onchain heuristics' };
}

/* ───────── swap & bridge (prepared links, never signed) ───────── */
export function uniswapLink(chain: string, from: string, to: string, amount?: string) {
  const q = new URLSearchParams({ chain, inputCurrency: from, outputCurrency: to, ...(amount ? { exactAmount: amount, exactField: 'input' } : {}) });
  return `https://app.uniswap.org/swap?${q}`;
}

export async function bridgeSides(token: string, fromChain: string, toChain: string, toToken: string | undefined, dex: DexFetch = dexPairs) {
  const [a, b] = await Promise.all([dex(token), dex(toToken ?? token)]);
  const side = (p: DexPair | null) => (p ? { symbol: p.baseToken.symbol, liquidityUsd: p.liquidity?.usd ?? null, volume24h: p.volume?.h24 ?? null, priceUsd: p.priceUsd ? Number(p.priceUsd) : null, dex: p.dexId } : null);
  return { from: side(deepest(a, fromChain, token)), to: side(deepest(b, toChain, toToken ?? token)) };
}
export const BRIDGE_URL = 'https://docs.robinhood.com/chain/bridging/';
