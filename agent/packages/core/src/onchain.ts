import { keccak256, stringToHex, toHex, type Hex } from 'viem';
import type { Flag, Label, TokenInputs, Verdict } from './types.js';

/** Order must match `VerdictOracle.Label`. */
export const LABEL_INDEX: Record<Label, number> = { HEALTHY: 0, WATCH: 1, DECAYING: 2, COLLAPSING: 3, DEAD: 4 };
export const LABELS_BY_INDEX: Label[] = ['HEALTHY', 'WATCH', 'DECAYING', 'COLLAPSING', 'DEAD'];

/** Bit positions must match `VerdictOracle.FLAG_*`. */
export const FLAG_BITS: Record<Flag, number> = {
  PUMP_EXHAUSTED: 1 << 0, MC_COLLAPSED: 1 << 1, THIN: 1 << 2, INSIDER_HEAVY: 1 << 3,
  WASH_SUSPECT: 1 << 4, BUNDLED: 1 << 5, FRESH: 1 << 6, LOW_CONFIDENCE: 1 << 7,
};

export const flagsToMask = (flags: Flag[]) => flags.reduce((m, f) => m | FLAG_BITS[f], 0);
export const maskToFlags = (mask: number) => (Object.keys(FLAG_BITS) as Flag[]).filter((f) => (mask & FLAG_BITS[f]) !== 0);

/** JSON with object keys sorted at every level, so the same data always hashes the same. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
}

/**
 * keccak256 commitment to the scored inputs. Anyone holding the snapshot can recompute it
 * and re-run the engine to check an onchain verdict.
 */
export function inputsHash(i: TokenInputs): Hex {
  return keccak256(stringToHex(canonicalJson(i)));
}

export function bytes32Text(s: string): Hex {
  if (s.length > 31) throw new Error('bytes32 text must be at most 31 chars');
  return toHex(s, { size: 32 });
}

export interface OracleVerdict {
  score: number;
  label: number;
  confidenceBps: number;
  flags: number;
  evaluatedAt: bigint;
  sourceBlock: bigint;
  inputsHash: Hex;
  engineVersion: Hex;
  attester: Hex;
}

/** Maps an engine verdict to the contract struct. Returns null when there is no verdict to attest. */
export function toOracleVerdict(v: Verdict, i: TokenInputs, sourceBlock: bigint): OracleVerdict | null {
  if (v.score === null || v.label === null) return null;
  return {
    score: Math.max(0, Math.min(100, Math.round(v.score))),
    label: LABEL_INDEX[v.label],
    confidenceBps: Math.round(v.confidence * 10_000),
    flags: flagsToMask(v.flags),
    evaluatedAt: BigInt(Math.floor(Date.parse(v.evaluatedAt) / 1000)),
    sourceBlock,
    inputsHash: inputsHash(i),
    engineVersion: bytes32Text(v.engineVersion),
    attester: '0x0000000000000000000000000000000000000000',
  };
}

export const VERDICT_ORACLE_ABI = [
  {
    type: 'function', name: 'attest', stateMutability: 'nonpayable', outputs: [],
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'v', type: 'tuple', components: [
        { name: 'score', type: 'uint8' }, { name: 'label', type: 'uint8' }, { name: 'confidenceBps', type: 'uint16' }, { name: 'flags', type: 'uint32' },
        { name: 'evaluatedAt', type: 'uint64' }, { name: 'sourceBlock', type: 'uint64' }, { name: 'inputsHash', type: 'bytes32' }, { name: 'engineVersion', type: 'bytes32' }, { name: 'attester', type: 'address' },
      ] },
    ],
  },
  {
    type: 'function', name: 'verdictOf', stateMutability: 'view',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [{ name: '', type: 'tuple', components: [
      { name: 'score', type: 'uint8' }, { name: 'label', type: 'uint8' }, { name: 'confidenceBps', type: 'uint16' }, { name: 'flags', type: 'uint32' },
      { name: 'evaluatedAt', type: 'uint64' }, { name: 'sourceBlock', type: 'uint64' }, { name: 'inputsHash', type: 'bytes32' }, { name: 'engineVersion', type: 'bytes32' }, { name: 'attester', type: 'address' },
    ] }],
  },
  { type: 'function', name: 'isAttester', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'bool' }] },
  { type: 'function', name: 'paused', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'bool' }] },
] as const;
