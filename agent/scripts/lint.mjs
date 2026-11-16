// Project lint: enforces the brief's hard rules that a type checker cannot see.
// Kept dependency-free on purpose (see DECISIONS.md).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const files = [];
const walk = (d) => {
  for (const n of readdirSync(d)) {
    if (['node_modules', 'dist', 'coverage', '.git'].includes(n)) continue;
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|mjs|md)$/.test(n)) files.push(p);
  }
};
walk(join(root, 'packages'));
walk(join(root, 'scripts'));
for (const f of ['README.md', 'REPORT.md']) try { statSync(join(root, f)); files.push(join(root, f)); } catch {}

const problems = [];
const report = (f, line, msg) => problems.push(`${relative(root, f)}:${line}  ${msg}`);

for (const f of files) {
  const rel = relative(root, f).replace(/\\/g, '/');
  if (rel === 'scripts/lint.mjs') continue;
  const src = readFileSync(f, 'utf8');
  const isSrc = /packages\/[^/]+\/src\//.test(rel);
  const isScore = /packages\/core\/src\/score\//.test(rel);
  src.split('\n').forEach((l, i) => {
    const n = i + 1;
    if (/\bTODO\b/.test(l) && !/TODO\((simplified|blocked)\):\s*\S{3,}/.test(l)) report(f, n, 'TODO without a written reason; use // TODO(simplified): <why> or // TODO(blocked): <why>');
    if (/coroner/i.test(l)) report(f, n, 'the word "coroner" is not allowed');
    if (isScore && /\b(Date\.now|Math\.random|new Date\(\))/.test(l)) report(f, n, 'non-deterministic call in the scoring path');
    if (isSrc && /\bconsole\.log\(/.test(l)) report(f, n, 'use the JSON logger instead of console.log');
    if (isSrc && /\p{Extended_Pictographic}/u.test(l) && !/[✓●→←×…▮◢◤]/u.test(l)) report(f, n, 'emoji in source text');
  });
}

if (problems.length) {
  console.error(problems.join('\n'));
  console.error(`\nlint: ${problems.length} problem(s)`);
  process.exit(1);
}
console.log(`lint ok (${files.length} files)`);
