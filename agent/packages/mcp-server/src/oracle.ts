import { createPublicClient, createWalletClient, defineChain, http, type Chain, type Hex, type PublicClient, type WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { LABELS_BY_INDEX, VERDICT_ORACLE_ABI, maskToFlags, type OracleVerdict } from '@verdictagent/core';

export const robinhoodChain: Chain = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.mainnet.chain.robinhood.com'] } },
  blockExplorers: { default: { name: 'Blockscout', url: 'https://robinhoodchain.blockscout.com' } },
});

export interface OnchainVerdict {
  attested: boolean;
  score?: number;
  label?: string;
  confidence?: number;
  flags?: string[];
  evaluatedAt?: string;
  sourceBlock?: string;
  inputsHash?: Hex;
  attester?: Hex;
}

export interface OracleOpts {
  address: Hex;
  rpcUrl: string;
  chainId: number;
  /** server attester key; omit for read-only */
  privateKey?: Hex;
  explorerUrl?: string;
}

/** Reads and (optionally) writes VerdictOracle. Holds only the attester key, never the owner key. */
export class OracleClient {
  readonly address: Hex;
  readonly chainId: number;
  readonly explorerUrl: string;
  readonly attester: Hex | null;
  private pub: PublicClient;
  private wallet: WalletClient | null;

  constructor(o: OracleOpts) {
    const chain = o.chainId === robinhoodChain.id ? robinhoodChain : defineChain({ ...robinhoodChain, id: o.chainId, name: `chain ${o.chainId}` });
    this.address = o.address;
    this.chainId = o.chainId;
    this.explorerUrl = o.explorerUrl ?? robinhoodChain.blockExplorers!.default.url;
    this.pub = createPublicClient({ chain, transport: http(o.rpcUrl, { timeout: 8000 }) }) as PublicClient;
    if (o.privateKey) {
      const account = privateKeyToAccount(o.privateKey);
      this.attester = account.address;
      this.wallet = createWalletClient({ chain, account, transport: http(o.rpcUrl, { timeout: 15000 }) });
    } else {
      this.attester = null;
      this.wallet = null;
    }
  }

  get writable() { return this.wallet !== null; }

  async blockNumber() { return this.pub.getBlockNumber(); }

  async read(token: Hex): Promise<OnchainVerdict> {
    const v = await this.pub.readContract({ address: this.address, abi: VERDICT_ORACLE_ABI, functionName: 'verdictOf', args: [token] });
    if (v.evaluatedAt === 0n) return { attested: false };
    return {
      attested: true,
      score: v.score,
      label: LABELS_BY_INDEX[v.label] ?? `UNKNOWN_${v.label}`,
      confidence: v.confidenceBps / 10_000,
      flags: maskToFlags(v.flags),
      evaluatedAt: new Date(Number(v.evaluatedAt) * 1000).toISOString(),
      sourceBlock: v.sourceBlock.toString(),
      inputsHash: v.inputsHash,
      attester: v.attester,
    };
  }

  async status() {
    const [paused, canAttest] = await Promise.all([
      this.pub.readContract({ address: this.address, abi: VERDICT_ORACLE_ABI, functionName: 'paused' }),
      this.attester ? this.pub.readContract({ address: this.address, abi: VERDICT_ORACLE_ABI, functionName: 'isAttester', args: [this.attester] }) : Promise.resolve(false),
    ]);
    return { paused, canAttest };
  }

  /** Sends attest() and waits for one confirmation. Simulates first so reverts surface as errors, not burnt gas. */
  async attest(token: Hex, v: OracleVerdict): Promise<{ txHash: Hex; blockNumber: bigint }> {
    if (!this.wallet || !this.wallet.account) throw new Error('oracle is read-only (no ATTESTER_PRIVATE_KEY)');
    const { request } = await this.pub.simulateContract({
      address: this.address, abi: VERDICT_ORACLE_ABI, functionName: 'attest', args: [token, v], account: this.wallet.account,
    });
    const txHash = await this.wallet.writeContract(request);
    const receipt = await this.pub.waitForTransactionReceipt({ hash: txHash, timeout: 60_000 });
    if (receipt.status !== 'success') throw new Error(`attest reverted in tx ${txHash}`);
    return { txHash, blockNumber: receipt.blockNumber };
  }

  txUrl(h: Hex) { return `${this.explorerUrl.replace(/\/$/, '')}/tx/${h}`; }
}
