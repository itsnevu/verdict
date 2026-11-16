'use client';
import { useState } from 'react';
import Split from '../fx/Split';
import { CopyBtn, Kicker, SectionNum } from '../fx/Ui';
import { brand, contracts, short } from '@/lib/content';

const SOLIDITY = `interface IVerdictOracle {
  function isHealthy(address token, uint8 minScore, uint64 maxAge)
    external view returns (bool);
}

// refuse to touch dying tokens
require(
  IVerdictOracle(ORACLE).isHealthy(token, 55, 1 hours),
  "verdict: not healthy"
);`;

const STEPS = [
  { n: 'Scan', d: 'verdict_scan_token returns the score and the exact inputs it used.' },
  { n: 'Hash', d: 'keccak256 of the canonical inputs: same data, same hash.' },
  { n: 'Read onchain', d: 'verdictOf(token) on VerdictOracle returns score, label and inputsHash.' },
  { n: 'Match', d: 'equal hashes mean the onchain verdict is this exact verdict.' },
];

function Verify() {
  const [s, setS] = useState(0);
  const done = s >= STEPS.length;
  return (
    <div className="pane card" data-reveal>
      <p className="card-h mono">Check any verdict yourself <span className="tag">walkthrough</span></p>
      <ol className="vsteps">
        {STEPS.map((v, i) => (
          <li key={v.n} className={i < s ? 'is-done' : i === s ? 'is-cur' : ''}>
            <span className="mono vs-n">{i + 1}</span>
            <div><b>{v.n}</b><span className="dim vs-d">{v.d}</span></div>
          </li>
        ))}
      </ol>
      {done && <p className="vres mono is-ok" role="status">✓ match · this verdict is the one onchain</p>}
      <div className="vctl">
        <button type="button" className="btn-ink mono" onClick={() => setS((v) => (done ? 0 : v + 1))}>{done ? 'restart' : `step ${s + 1}`}</button>
      </div>
    </div>
  );
}

export default function Onchain() {
  return (
    <section id="onchain" className="sec">
      <SectionNum n="06" />
      <div className="sec-head">
        <Kicker n="06">onchain · {brand.chain}</Kicker>
        <Split as="h2" text="Verdicts other contracts can read." className="h2 display" em="contracts" />
        <p className="lede" data-reveal>VerdictOracle records each verdict on {brand.chain} with a hash of the inputs behind it. It holds no funds and cannot be upgraded. Any contract can ask one question before it acts.</p>
      </div>
      <div className="oc-grid">
        <div className="pane card" data-reveal>
          <p className="card-h mono">One line in your contract</p>
          <div className="code"><pre className="mono">{SOLIDITY}</pre><CopyBtn text={SOLIDITY} /></div>
          <ul className="oc-facts mono">
            <li><b>0</b> funds held</li><li><b>no</b> upgrades</li><li><b>2</b> roles</li><li><b>~68k</b> gas per verdict</li>
          </ul>
        </div>
        <Verify />
      </div>
      {contracts.length ? (
        <div className="tbl-wrap card" data-reveal data-lenis-prevent>
          <table className="tbl">
            <thead><tr><th scope="col">contract</th><th scope="col">role</th><th scope="col">address</th></tr></thead>
            <tbody>{contracts.map((c) => (
              <tr key={c.name}><td><b>{c.name}</b></td><td className="dim">{c.desc}</td><td className="mono"><span className="cobalt">{short(c.addr, 4, 4)}</span> <CopyBtn text={c.addr} label="copy" /></td></tr>
            ))}</tbody>
          </table>
        </div>
      ) : (
        <div className="card notice" data-reveal>
          <p className="card-h mono">Contract address</p>
          <p>VerdictOracle is written and tested; it is not deployed yet. The address will be announced only on {brand.officialChannels}. Any address you see elsewhere is not ours.</p>
        </div>
      )}
    </section>
  );
}
