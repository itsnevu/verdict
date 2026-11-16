/** Fast, line-based Solidity checks for the mistakes that most often lose funds. Not a replacement for an audit. */
export interface LintFinding { rule: string; severity: 'high' | 'medium' | 'low'; line: number; message: string; fix: string }

const RULES: { rule: string; severity: LintFinding['severity']; test: (line: string, all: string) => boolean; message: string; fix: string }[] = [
  { rule: 'tx-origin-auth', severity: 'high', test: (l) => /\btx\.origin\b/.test(l) && /(require|if|==)/.test(l), message: 'authorisation with tx.origin can be bypassed by a malicious contract', fix: 'use msg.sender' },
  { rule: 'unchecked-call', severity: 'high', test: (l) => /\.call\{?[^;]*\}?\(/.test(l) && !/\(\s*bool\s+\w+\s*,?/.test(l) && !/=\s*[^;]*\.call/.test(l), message: 'low-level call result is not checked', fix: 'capture (bool ok, ) and require(ok)' },
  { rule: 'reentrancy', severity: 'high', test: (l, all) => /\.call\{\s*value\s*:/.test(l) && !/nonReentrant|ReentrancyGuard/.test(all), message: 'sends ETH with call and the contract has no reentrancy guard', fix: 'update state before the call and add nonReentrant' },
  { rule: 'delegatecall', severity: 'high', test: (l) => /\.delegatecall\(/.test(l), message: 'delegatecall runs foreign code with this contract\'s storage', fix: 'only delegatecall to fixed, trusted implementations' },
  { rule: 'selfdestruct', severity: 'medium', test: (l) => /\bselfdestruct\s*\(/.test(l), message: 'selfdestruct can remove the contract and send its ETH away', fix: 'remove it' },
  { rule: 'floating-pragma', severity: 'low', test: (l) => /pragma\s+solidity\s*\^/.test(l), message: 'floating pragma: the deployed compiler may differ from the tested one', fix: 'pin the version, e.g. pragma solidity 0.8.28;' },
  { rule: 'weak-randomness', severity: 'medium', test: (l) => /(block\.timestamp|block\.prevrandao|blockhash)\s*[%)]/.test(l) || /keccak256\([^)]*block\.(timestamp|prevrandao)/.test(l), message: 'block values are not a safe source of randomness', fix: 'use a VRF' },
  { rule: 'unbounded-mint', severity: 'medium', test: (l, all) => /function\s+mint\s*\(/.test(l) && !/(cap|maxSupply|MAX_SUPPLY)/.test(all), message: 'mint has no supply cap', fix: 'enforce a max supply' },
  { rule: 'public-init', severity: 'high', test: (l, all) => /function\s+initialize\s*\([^)]*\)\s*(public|external)/.test(l) && !/initializer\b/.test(all), message: 'initialize() can be called by anyone and more than once', fix: 'use the initializer modifier' },
  { rule: 'approve-max-in-code', severity: 'low', test: (l) => /approve\([^,]+,\s*(type\(uint256\)\.max|2\s*\*\*\s*256\s*-\s*1|uint256\(-1\))/.test(l), message: 'grants an unlimited approval', fix: 'approve only the amount needed' },
];

export function lintSolidity(source: string): { findings: LintFinding[]; counts: Record<LintFinding['severity'], number> } {
  const lines = source.split(/\r?\n/);
  const findings: LintFinding[] = [];
  const seen = new Set<string>();
  lines.forEach((raw, i) => {
    const line = raw.replace(/\/\/.*$/, '');
    for (const r of RULES) {
      const key = `${r.rule}:${i}`;
      if (!seen.has(key) && r.test(line, source)) { seen.add(key); findings.push({ rule: r.rule, severity: r.severity, line: i + 1, message: r.message, fix: r.fix }); }
    }
  });
  const order = { high: 0, medium: 1, low: 2 };
  findings.sort((a, b) => order[a.severity] - order[b.severity] || a.line - b.line);
  return { findings, counts: { high: findings.filter((f) => f.severity === 'high').length, medium: findings.filter((f) => f.severity === 'medium').length, low: findings.filter((f) => f.severity === 'low').length } };
}
