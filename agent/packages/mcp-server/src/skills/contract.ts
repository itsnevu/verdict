import { keccak256, parseAbi, toFunctionSelector, type Hex } from 'viem';
import type { ChainClient } from './chains.js';

/** Functions whose presence changes what a token holder can lose. Matched against the dispatcher (PUSH4 selector). */
const RISKY: { sig: string; risk: 'mint' | 'blacklist' | 'fees' | 'pause' | 'limits' | 'control' }[] = [
  { sig: 'mint(address,uint256)', risk: 'mint' }, { sig: 'mint(uint256)', risk: 'mint' },
  { sig: 'blacklist(address)', risk: 'blacklist' }, { sig: 'addToBlacklist(address)', risk: 'blacklist' }, { sig: 'setBlacklist(address,bool)', risk: 'blacklist' },
  { sig: 'blockBots(address[])', risk: 'blacklist' }, { sig: 'setBots(address[],bool)', risk: 'blacklist' },
  { sig: 'setFee(uint256)', risk: 'fees' }, { sig: 'setFees(uint256,uint256)', risk: 'fees' }, { sig: 'setTaxes(uint256,uint256)', risk: 'fees' },
  { sig: 'setSellFee(uint256)', risk: 'fees' }, { sig: 'setBuyFee(uint256)', risk: 'fees' }, { sig: 'updateFees(uint256,uint256)', risk: 'fees' },
  { sig: 'pause()', risk: 'pause' }, { sig: 'setTradingEnabled(bool)', risk: 'pause' }, { sig: 'enableTrading()', risk: 'pause' },
  { sig: 'setMaxTxAmount(uint256)', risk: 'limits' }, { sig: 'setMaxWallet(uint256)', risk: 'limits' },
  { sig: 'upgradeTo(address)', risk: 'control' }, { sig: 'upgradeToAndCall(address,bytes)', risk: 'control' },
];
const RISKY_SEL = RISKY.map((r) => ({ ...r, sel: toFunctionSelector(r.sig).slice(2) }));

const EIP1967_IMPL = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc' as const;
const VIEW = parseAbi([
  'function owner() view returns (address)', 'function paused() view returns (bool)', 'function symbol() view returns (string)',
  'function name() view returns (string)', 'function decimals() view returns (uint8)', 'function totalSupply() view returns (uint256)',
]);
const ZERO = '0x0000000000000000000000000000000000000000';

export interface ContractReport {
  address: string;
  isContract: boolean;
  codeSize: number;
  codeHash: Hex | null;
  token: { symbol: string | null; name: string | null; decimals: number | null; totalSupply: string | null };
  owner: string | null;
  ownershipRenounced: boolean | null;
  paused: boolean | null;
  proxy: { isProxy: boolean; implementation: string | null };
  capabilities: { function: string; risk: string }[];
  risks: string[];
  clones: string[];
}

/** Pure: what the bytecode dispatcher exposes. Heuristic: a selector can exist without being reachable. */
export function scanSelectors(code: string): { function: string; risk: string }[] {
  const c = code.toLowerCase();
  return RISKY_SEL.filter((r) => c.includes(`63${r.sel}`)).map((r) => ({ function: r.sig, risk: r.risk }));
}

const tryRead = async <T>(f: () => Promise<T>): Promise<T | null> => { try { return await f(); } catch { return null; } };

export async function readContractReport(c: ChainClient, address: Hex, knownHashes: Map<string, Set<string>>): Promise<ContractReport> {
  const code = (await c.getCode({ address })) ?? '0x';
  const isContract = code !== '0x';
  const base: ContractReport = {
    address, isContract, codeSize: isContract ? (code.length - 2) / 2 : 0, codeHash: isContract ? keccak256(code as Hex) : null,
    token: { symbol: null, name: null, decimals: null, totalSupply: null }, owner: null, ownershipRenounced: null, paused: null,
    proxy: { isProxy: false, implementation: null }, capabilities: [], risks: [], clones: [],
  };
  if (!isContract) { base.risks.push('no contract code at this address (an EOA or a self-destructed contract)'); return base; }
  const rd = <T>(functionName: 'owner' | 'paused' | 'symbol' | 'name' | 'decimals' | 'totalSupply') => tryRead(() => c.readContract({ address, abi: VIEW, functionName }) as Promise<T>);
  const [owner, paused, symbol, name, decimals, supply, slot] = await Promise.all([
    rd<string>('owner'), rd<boolean>('paused'), rd<string>('symbol'), rd<string>('name'), rd<number>('decimals'), rd<bigint>('totalSupply'),
    tryRead(() => c.getStorageAt({ address, slot: EIP1967_IMPL })),
  ]);
  base.token = { symbol, name, decimals: decimals === null ? null : Number(decimals), totalSupply: supply === null ? null : supply.toString() };
  base.owner = owner ? owner.toLowerCase() : null;
  base.ownershipRenounced = owner === null ? null : owner.toLowerCase() === ZERO;
  base.paused = paused;
  const impl = slot && slot !== '0x' && BigInt(slot) !== 0n ? `0x${slot.slice(-40)}`.toLowerCase() : null;
  base.proxy = { isProxy: !!impl, implementation: impl };
  base.capabilities = scanSelectors(code);

  const kinds = new Set(base.capabilities.map((x) => x.risk));
  const ownerLive = base.owner !== null && !base.ownershipRenounced;
  if (base.proxy.isProxy) base.risks.push('upgradeable proxy: the logic can be replaced by whoever controls the proxy');
  if (kinds.has('mint') && ownerLive) base.risks.push('owner can mint new supply');
  if (kinds.has('blacklist')) base.risks.push('has blacklist functions: holders can be blocked from selling');
  if (kinds.has('fees')) base.risks.push('fees can be changed after launch (hidden or raised sell tax is possible)');
  if (kinds.has('pause') || paused === true) base.risks.push(paused ? 'trading is paused right now' : 'trading can be paused');
  if (kinds.has('limits')) base.risks.push('max transaction or wallet limits can be changed');
  if (ownerLive && !kinds.size && !base.proxy.isProxy) base.risks.push('has an owner, but no risky owner functions were found in the dispatcher');

  if (base.codeHash) {
    const seen = knownHashes.get(base.codeHash) ?? new Set<string>();
    base.clones = [...seen].filter((a) => a !== address.toLowerCase());
    seen.add(address.toLowerCase());
    knownHashes.set(base.codeHash, seen);
  }
  return base;
}
