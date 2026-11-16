'use client';
import { useState } from 'react';
import { ShieldCheck, X } from 'lucide-react';
import Split from '../fx/Split';
import { CmdBlock, Kicker, SectionNum, Segmented } from '../fx/Ui';
import { rove } from '@/lib/runtime';

type Mode = 'ask' | 'reads' | 'auto';

function Card({ span, title, n, children }: { span: 7 | 5 | 12; title: string; n: string; children: React.ReactNode }) {
  return (
    <article className={`card tk s${span}`} data-tilt="4" data-reveal>
      <header className="tk-h"><span className="mono dim">{n}</span><h3>{title}</h3></header>
      {children}
    </article>
  );
}

const SAMPLES = [
  { sym: 'CRCL', score: 70, label: 'WATCH', conf: 0.7, why: 'liquidity 24% of mc · top 10 hold 21% · volume steady' },
  { sym: 'BONER', score: 61, label: 'WATCH', conf: 0.7, why: 'liquidity 14% of mc · volume trend 0.9× · no flags' },
  { sym: 'ROBOT', score: 22, label: 'COLLAPSING', conf: 0.8, why: 'dev holds 70% · liquidity $1,200 · INSIDER_HEAVY' },
];

function Scan() {
  const [i, setI] = useState(0);
  const s = SAMPLES[i]!;
  return (
    <Card span={7} n="01" title="Score any token">
      <div className="chips" role="radiogroup" aria-label="Example token">
        {SAMPLES.map((x, j) => (
          <button key={x.sym} type="button" role="radio" aria-checked={j === i} tabIndex={j === i ? 0 : -1} className="chip mono"
            onClick={() => setI(j)} onKeyDown={(e) => rove(e, i, SAMPLES.length, setI)}>{x.sym}</button>
        ))}
      </div>
      <div className="mini mono" aria-live="polite">
        <p><span className="dim">●</span> verdict_scan_token {s.sym}</p>
        <p className={s.score < 35 ? 'bad' : 'ok'}>{s.sym} · score {s.score} · {s.label} · confidence {s.conf}</p>
        <p className="dim">{s.why}</p>
      </div>
      <p className="mono dim note">example verdicts · deterministic, never from a language model</p>
    </Card>
  );
}

function Gate() {
  const [mode, setMode] = useState<Mode>('ask');
  const acts = [
    { a: 'scan a token', k: 'read' },
    { a: 'read a wallet', k: 'read' },
    { a: 'prepare a swap', k: 'prepare' },
    { a: 'revoke an approval', k: 'prepare' },
    { a: 'sign a transaction', k: 'sign' },
  ];
  // signing is always the user; reads run in every mode except "ask"; preparing runs only in "auto"
  const status = (k: string) => (k === 'sign' ? 'always you' : k === 'read' ? (mode === 'ask' ? 'asks' : 'runs') : mode === 'auto' ? 'runs' : 'asks');
  return (
    <Card span={5} n="02" title="You set the gate">
      <Segmented options={['ask', 'reads', 'auto'] as const} value={mode} onChange={setMode} label="Approval mode" />
      <ul className="acts mono" aria-live="polite">
        {acts.map((x) => {
          const st = status(x.k);
          return <li key={x.a}><span>{x.a}</span><span className={st === 'runs' ? 'tag' : 'tag tag-ask'}>{st}</span></li>;
        })}
      </ul>
    </Card>
  );
}

function Explain() {
  const rows = [
    { s: 'liq_ratio', v: 0.24, w: 18 }, { s: 'top10_share', v: 0.79, w: 18 }, { s: 'dev_share', v: 0.6, w: 14 },
    { s: 'vol_mc', v: 0.32, w: 14 }, { s: 'vol_trend', v: 0.55, w: 12 }, { s: 'holder_growth', v: 0.4, w: 8 },
  ];
  return (
    <Card span={5} n="03" title="See why, signal by signal">
      <ul className="bars mono">
        {rows.map((r) => (
          <li key={r.s}><span>{r.s}</span><span className="bar" aria-hidden><i style={{ transform: `scaleX(${r.v})` }} /></span><span className="dim">{r.w}%</span></li>
        ))}
      </ul>
      <p className="mono dim note">verdict_explain_score · weights and normalisation points in the open</p>
    </Card>
  );
}

function Rules() {
  const [items, setItems] = useState(['never buy below score 55', 'max 100 USDC per swap', 'only swap through uniswap', 'no unlimited approvals']);
  const [t, setT] = useState('');
  return (
    <Card span={7} n="04" title="Your rules, in VERDICT.md">
      <ul className="mem mono">
        {items.map((m, i) => (
          <li key={m + i}><span>{m}</span>
            <button type="button" className="icon-btn sm" aria-label={`Remove rule: ${m}`} onClick={() => setItems((x) => x.filter((_, j) => j !== i))}><X size={13} aria-hidden /></button>
          </li>
        ))}
        {!items.length && <li className="dim">no rules: every action still needs your key</li>}
      </ul>
      <form className="mem-f" onSubmit={(e) => { e.preventDefault(); if (t.trim()) { setItems((x) => [...x, t.trim()]); setT(''); } }}>
        <input className="mono" value={t} onChange={(e) => setT(e.target.value)} placeholder="never touch tokens younger than 1h" aria-label="Add a rule" />
        <button type="submit" className="btn-ink mono">add</button>
      </form>
      <p className="mono dim note">verdict_check_policy · every action is checked against these before anything is prepared</p>
    </Card>
  );
}

function Watch() {
  return (
    <Card span={7} n="05" title="Watch, instead of polling">
      <div className="mini mono">
        <p><span className="dim">●</span> verdict_watch_token CRCL --ttl 24h --webhook https://you.app/hook</p>
        <p className="dim">checks every 60 s · alerts when:</p>
        <p>score drops &gt; 20 in an hour · PUMP_EXHAUSTED appears</p>
        <p>dev share rises &gt; 10 points · liquidity falls &gt; 40%</p>
      </div>
    </Card>
  );
}

function Works() {
  return (
    <Card span={5} n="06" title="Works where you work">
      <div className="chips">
        {['Claude Code', 'Codex', 'Cursor', 'Droid', 'any MCP client', 'HTTP API', 'SDK'].map((x) => <span key={x} className="chip mono">{x}</span>)}
      </div>
      <CmdBlock cmd="claude mcp add --transport http verdict https://verdictagent.xyz/mcp" disabled="at launch" />
    </Card>
  );
}

const TOOLS = ['scan_token', 'agent_brief', 'list_runners', 'token_history', 'explain_score', 'compare_tokens', 'budget', 'watch_token', 'attest_token', 'register_mcp', 'registry_search', 'registry_check', 'read_contract', 'decode_tx', 'wallet_holdings', 'wallet_score', 'wallet_approvals', 'prepare_revoke', 'simulate_tx', 'lint_solidity', 'check_policy', 'track_record', 'wash_check', 'lp_status', 'deployer_history', 'trace_funding', 'label_address', 'wallet_moves', 'wallet_pnl', 'prepare_swap', 'bridge_check'];

export default function Toolkit() {
  return (
    <section id="toolkit" className="sec">
      <SectionNum n="04" />
      <div className="sec-head">
        <Kicker n="04">toolkit</Kicker>
        <Split as="h2" text="Everything your agent can ask VERDICT." className="h2 display" em="ask" />
      </div>
      <div className="tk-grid">
        <Scan /><Gate />
        <Explain /><Rules />
        <Watch /><Works />
        <article className="card tk s12 tk-tools" data-reveal>
          <header className="tk-h"><span className="mono dim">07</span><h3>31 MCP tools, built and tested</h3>
            <span className="verified mono"><ShieldCheck size={14} aria-hidden /> tested</span></header>
          <ul className="tools mono">{TOOLS.map((t, i) => <li key={t}><span className="dim">{String(i + 1).padStart(2, '0')}</span> verdict_{t}</li>)}</ul>
        </article>
      </div>
    </section>
  );
}
