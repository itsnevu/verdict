import { z } from 'zod';
import { TOOLS, VerdictError, checkActions, errors, normAddress, type Envelope, type ToolName } from '@verdictagent/core';
import type { VerdictService } from '../service.js';
import { readContractReport } from '../skills/contract.js';
import { lintSolidity } from '../skills/lint.js';
import { checkPolicy, parsePolicy } from '../skills/policy.js';
import { trackRecord } from '../skills/report.js';
import { decodeTx, simulateTx } from '../skills/tx.js';
import { prepareRevokes, walletApprovals, walletHoldings } from '../skills/wallet.js';
import type { CallCtx } from './tools.js';

type Out = Omit<Envelope<unknown>, '_meta'> & { _meta?: Partial<Envelope<unknown>['_meta']> };
interface SkillDef<S extends z.ZodTypeAny> {
  name: ToolName; description: string; input: S; cost: (a: z.infer<S>) => number; scope?: string;
  run(a: z.infer<S>, c: CallCtx, svc: VerdictService): Promise<Out>;
}
const def = <S extends z.ZodTypeAny>(d: SkillDef<S>) => d;

const addr = z.string().describe('0x + 40 hex address');
const chain = z.string().default('robinhood').describe('robinhood (default), ethereum, base, arbitrum, optimism, bsc or polygon');
const hex = z.string().regex(/^0x[0-9a-fA-F]*$/);
const noMeta = { confidence: null } as const;

function client(svc: VerdictService, key: string) {
  const info = svc.chains.info(key);
  if (!info) throw new VerdictError('UNKNOWN_CHAIN', `unknown chain ${key}`, false, `use one of: ${Object.keys(svc.chains.chains).join(', ')}`, 400);
  return { info, c: svc.chains.client(info.key) };
}
const asHex = (a: string) => normAddress(a) as `0x${string}`;

export const SKILL_DEFS = [
  def({
    name: 'verdict_read_contract',
    description: 'Read a token or contract before trusting it: owner and whether ownership is renounced, pause state, upgradeable proxy, and risky functions found in the bytecode (mint, blacklist, adjustable fees/taxes, trading switches, limits). Also reports other scanned contracts with identical bytecode (clones). Heuristic: a function can exist without being reachable. Cost: 0.5 units.',
    input: z.object({ address: addr, chain }),
    cost: () => TOOLS.verdict_read_contract.cost,
    async run(a, _c, svc) {
      const { info, c } = client(svc, a.chain);
      const r = await readContractReport(c, asHex(a.address), svc.codeHashes);
      const brief = !r.isContract ? `${r.address} has no contract code on ${info.name}.`
        : `${r.token.symbol ?? 'Contract'} on ${info.name}: ${r.risks.length ? r.risks.length + ' risk' + (r.risks.length > 1 ? 's' : '') + ': ' + r.risks.slice(0, 2).join('; ') : 'no risky owner functions found'}${r.clones.length ? `; same bytecode as ${r.clones.length} other scanned contract(s)` : ''}.`;
      return { data: { chain: info.key, ...r }, brief, nextActions: checkActions(info.key === 'robinhood' && r.isContract ? [{ tool: 'verdict_scan_token', reason: 'combine with the market verdict', args: { address: r.address } }] : []), _meta: noMeta };
    },
  }),
  def({
    name: 'verdict_decode_tx',
    description: 'Explain any transaction hash on a supported EVM chain: status, function called (name looked up by selector), value, gas, and decoded Transfer/Approval events. Use when a user pastes a hash and asks what happened. Cost: 0.5 units.',
    input: z.object({ hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'a 0x + 64 hex transaction hash'), chain }),
    cost: () => TOOLS.verdict_decode_tx.cost,
    async run(a, _c, svc) {
      const { info, c } = client(svc, a.chain);
      let d;
      try { d = await decodeTx(c, info, a.hash as `0x${string}`, svc.sigLookup); } catch { throw new VerdictError('TX_NOT_FOUND', `no transaction ${a.hash} on ${info.name}`, false, 'check the hash and the chain argument', 404); }
      const transfers = d.events.filter((e) => e.kind === 'Transfer').length;
      const approvals = d.events.filter((e) => e.kind === 'Approval').length;
      return { data: d, brief: `${d.status === 'success' ? 'Succeeded' : d.status === 'reverted' ? 'Reverted' : 'Pending'} on ${info.name}: ${d.function.signature ?? d.function.selector ?? 'plain transfer'} from ${d.from.slice(0, 10)}…, ${transfers} token transfer(s), ${approvals} approval(s).`, nextActions: [], _meta: noMeta };
    },
  }),
  def({
    name: 'verdict_wallet_holdings',
    description: 'List the tokens a wallet received recently and still holds, with balances. Window-limited (recent blocks only), so very old holdings can be missing; the result says how far back it looked. Cost: 1 unit.',
    input: z.object({ wallet: addr, chain }),
    cost: () => TOOLS.verdict_wallet_holdings.cost,
    async run(a, _c, svc) {
      const { info, c } = client(svc, a.chain);
      const r = await walletHoldings(c, asHex(a.wallet), { range: svc.walletRange });
      return { data: { chain: info.key, wallet: a.wallet.toLowerCase(), ...r }, brief: `${r.holdings.length} token(s) held from transfers in the last ${r.scannedBlocks} blocks on ${info.name}.`, nextActions: checkActions(r.holdings.length ? [{ tool: 'verdict_wallet_score', reason: 'judge every token in this wallet', args: { wallet: a.wallet } }] : []), _meta: noMeta };
    },
  }),
  def({
    name: 'verdict_wallet_score',
    description: 'Judge a whole wallet on Robinhood Chain: scans up to 8 held tokens and counts risky approvals, then summarises how much of the wallet is in dying tokens. Cost: 3 units.',
    input: z.object({ wallet: addr, maxTokens: z.number().int().min(1).max(8).default(8) }),
    cost: () => TOOLS.verdict_wallet_score.cost,
    async run(a, _c, svc) {
      const wallet = asHex(a.wallet);
      const c = svc.chains.client('robinhood');
      const [h, approvals] = await Promise.all([walletHoldings(c, wallet, { range: svc.walletRange }), walletApprovals(c, wallet, { range: svc.walletRange }).catch(() => [])]);
      const scans = await Promise.all(h.holdings.slice(0, a.maxTokens).map(async (t) => {
        try { const r = await svc.scan(t.token); return { token: t.token, symbol: t.symbol, amount: t.amount, score: r.verdict.score, label: r.verdict.label }; } catch { return { token: t.token, symbol: t.symbol, amount: t.amount, score: null, label: null }; }
      }));
      const judged = scans.filter((s) => s.score !== null);
      const bad = judged.filter((s) => s.label === 'COLLAPSING' || s.label === 'DEAD');
      const risky = approvals.filter((x) => x.risk === 'high').length;
      const score = judged.length ? Math.round(judged.reduce((n, s) => n + (s.score ?? 0), 0) / judged.length) - risky * 5 : null;
      return { data: { wallet, walletScore: score === null ? null : Math.max(0, score), tokens: scans, riskyApprovals: risky, approvalsChecked: approvals.length, approximate: true }, brief: `${judged.length} token(s) judged: ${bad.length} collapsing or dead${risky ? `, ${risky} high-risk approval(s)` : ''}.`, nextActions: checkActions(risky ? [{ tool: 'verdict_prepare_revoke', reason: 'clean up the risky approvals', args: { wallet, all: true } }] : []), _meta: noMeta };
    },
  }),
  def({
    name: 'verdict_wallet_approvals',
    description: 'Find live token approvals a wallet has granted (recent window) and rate each spender: unlimited amount, plain wallet instead of contract, unknown router. Use before asking the user to revoke. Cost: 1 unit.',
    input: z.object({ wallet: addr, chain }),
    cost: () => TOOLS.verdict_wallet_approvals.cost,
    async run(a, _c, svc) {
      const { info, c } = client(svc, a.chain);
      const rows = await walletApprovals(c, asHex(a.wallet), { range: svc.walletRange });
      const high = rows.filter((r) => r.risk === 'high').length;
      return { data: { chain: info.key, wallet: a.wallet.toLowerCase(), approvals: rows, approximate: true }, brief: `${rows.length} live approval(s), ${high} high risk.`, nextActions: checkActions(rows.length ? [{ tool: 'verdict_prepare_revoke', reason: 'prepare revokes for the risky ones', args: { wallet: a.wallet, all: true } }] : []), _meta: noMeta };
    },
  }),
  def({
    name: 'verdict_prepare_revoke',
    description: 'Prepare unsigned approve(spender, 0) transactions, simulated from the wallet. Pass pairs, or all: true to revoke every live approval found (kill switch). Nothing is signed or sent: hand the transactions to the user\'s wallet. Cost: 1 unit.',
    input: z.object({ wallet: addr, chain, all: z.boolean().default(false), pairs: z.array(z.object({ token: addr, spender: addr })).max(50).optional(), onlyHighRisk: z.boolean().default(false) }),
    cost: () => TOOLS.verdict_prepare_revoke.cost,
    async run(a, _c, svc) {
      const { info, c } = client(svc, a.chain);
      const wallet = asHex(a.wallet);
      let pairs = (a.pairs ?? []).map((p) => ({ token: normAddress(p.token), spender: normAddress(p.spender), symbol: null as string | null }));
      if (a.all || !pairs.length) {
        const found = await walletApprovals(c, wallet, { range: svc.walletRange });
        pairs = found.filter((r) => !a.onlyHighRisk || r.risk === 'high').map((r) => ({ token: r.token, spender: r.spender, symbol: r.symbol }));
      }
      const txs = await prepareRevokes(c, info.id, wallet, pairs);
      return { data: { chain: info.key, wallet, transactions: txs, signedBy: 'you, in your own wallet' }, brief: txs.length ? `${txs.length} revoke transaction(s) ready to sign; ${txs.filter((t) => t.simulation.ok).length} simulate cleanly.` : 'No live approvals to revoke.', nextActions: [], _meta: noMeta };
    },
  }),
  def({
    name: 'verdict_simulate_tx',
    description: 'Simulate a transaction without sending it (eth_call + gas estimate): does it succeed, and if not, why. Use before asking the user to sign anything. Cost: 0.5 units.',
    input: z.object({ from: addr, to: addr, data: hex.optional(), value: z.string().regex(/^\d+$/).optional().describe('wei'), chain }),
    cost: () => TOOLS.verdict_simulate_tx.cost,
    async run(a, _c, svc) {
      const { info, c } = client(svc, a.chain);
      const r = await simulateTx(c, { from: asHex(a.from), to: asHex(a.to), data: a.data as `0x${string}` | undefined, value: a.value ? BigInt(a.value) : undefined });
      return { data: { chain: info.key, ...r }, brief: r.ok ? `Simulation succeeds on ${info.name}${r.gas ? `, about ${r.gas} gas` : ''}.` : `Simulation reverts: ${r.reason ?? r.error}.`, nextActions: [], _meta: noMeta };
    },
  }),
  def({
    name: 'verdict_lint_solidity',
    description: 'Check Solidity source for the mistakes that most often lose funds (tx.origin auth, unchecked calls, missing reentrancy guard, delegatecall, open initialize, uncapped mint, weak randomness…). Use before deploying a contract the agent wrote. Not an audit. Cost: 0.2 units.',
    input: z.object({ source: z.string().min(10).max(200_000) }),
    cost: () => TOOLS.verdict_lint_solidity.cost,
    async run(a) {
      const r = lintSolidity(a.source);
      return { data: r, brief: r.findings.length ? `${r.counts.high} high, ${r.counts.medium} medium, ${r.counts.low} low finding(s). First: line ${r.findings[0]!.line}, ${r.findings[0]!.message}.` : 'No known risky patterns found. This is not an audit.', nextActions: [], _meta: noMeta };
    },
  }),
  def({
    name: 'verdict_check_policy',
    description: 'Check an intended action against the user\'s VERDICT.md rules (min score, max USD per transaction, no unlimited approvals, allowed venues, minimum token age, blocked addresses). If a token is given its live verdict is used. Call before preparing any transaction. Cost: 0.5 units.',
    input: z.object({
      rules: z.string().max(20_000).describe('the contents of VERDICT.md'),
      action: z.object({ kind: z.enum(['swap', 'approve', 'revoke', 'transfer', 'deploy']), token: addr.optional(), amountUsd: z.number().nonnegative().optional(), venue: z.string().optional(), unlimited: z.boolean().optional(), to: addr.optional() }),
    }),
    cost: () => TOOLS.verdict_check_policy.cost,
    async run(a, _c, svc) {
      const p = parsePolicy(a.rules);
      let tokenScore: number | null | undefined, tokenAgeHours: number | null | undefined;
      if (a.action.token) {
        try {
          const r = await svc.scan(normAddress(a.action.token));
          tokenScore = r.verdict.score;
          const age = r.verdict.breakdown.find((b) => b.signal === 'age_hours')?.raw;
          tokenAgeHours = age ?? null;
        } catch { tokenScore = null; tokenAgeHours = null; }
      }
      const res = checkPolicy(p, { ...a.action, tokenScore, tokenAgeHours });
      return { data: { ...res, policy: p, tokenScore: tokenScore ?? null }, brief: res.allowed ? 'Allowed by your VERDICT.md rules.' : `Blocked by your rules: ${res.violations.join('; ')}.`, nextActions: [], _meta: noMeta };
    },
  }),
  def({
    name: 'verdict_track_record',
    description: 'Public accuracy of past verdicts: for verdicts at least N days old, how often a warning stayed bad and a pass stayed healthy. Use to decide how much to trust a label. Free.',
    input: z.object({ horizonDays: z.number().int().min(1).max(90).default(7) }),
    cost: () => TOOLS.verdict_track_record.cost,
    async run(a, _c, svc) {
      const r = await trackRecord(svc.store, svc.nowIso(), a.horizonDays);
      return { data: r, brief: r.verdictsChecked ? `${r.accuracy}% of ${r.verdictsChecked} verdicts held after ${a.horizonDays} days.` : `Not enough verdicts older than ${a.horizonDays} days yet.`, nextActions: [], _meta: noMeta };
    },
  }),
] as const;

export const _unused = errors; // keep the import shape stable for future skill errors
