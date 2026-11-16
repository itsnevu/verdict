'use client';
import { useEffect, useRef, useState } from 'react';
import { Star } from 'lucide-react';
import Split from '../fx/Split';
import Odometer from '../fx/Odometer';
import { CmdBlock, CopyBtn, Kicker, SectionNum, Tabs } from '../fx/Ui';
import { brand, devTabs, jobSteps, nexusStats, services, trials } from '@/lib/content';
import { rove } from '@/lib/runtime';

function Stats() {
  const ref = useRef<HTMLUListElement>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setOn(true); io.disconnect(); } }, { threshold: 0.3 });
    if (ref.current) io.observe(ref.current);
    return () => io.disconnect();
  }, []);
  return (
    <>
      <ul className="stats" ref={ref}>
        {nexusStats.map((s) => (
          <li key={s.k} className="stat" data-reveal>
            <span className="stat-v display"><Odometer value={on ? s.v : 0} />{s.suffix && <span>{s.suffix}</span>}</span>
            <span className="mono dim">{s.k}</span>
          </li>
        ))}
      </ul>
      <p className="mono dim note">illustrative numbers from a simulation · live figures from ServiceMarket, Escrow and AgentRegistry appear after launch</p>
    </>
  );
}

function Market() {
  const [i, setI] = useState(0);
  const s = services[i];
  return (
    <div className="pane card" data-reveal>
      <p className="card-h mono">Live market</p>
      <div role="listbox" aria-label="Nexus services" className="mkt">
        {services.map((x, j) => (
          <div key={x.id} role="option" aria-selected={j === i} tabIndex={j === i ? 0 : -1} className="mkt-i"
            onClick={() => setI(j)} onKeyDown={(e) => rove(e, i, services.length, setI)}>
            <span className="mono dim">#{x.id}</span>
            <b>{x.name}</b>
            <span className="stars" aria-label="rated 5.0">{[0, 1, 2, 3, 4].map((k) => <Star key={k} size={11} aria-hidden fill="currentColor" />)} <span className="mono">5.0</span></span>
            <span className="mono dim">{x.jobs.toLocaleString('en-US')} jobs</span>
            {x.paused && <span className="tag tag-ask mono">paused</span>}
            <span className="mono price">{x.eth} ETH · {x.vdct} VDCT</span>
          </div>
        ))}
      </div>
      <div className="mkt-d" aria-live="polite">
        <p>{s.desc}</p>
        <CmdBlock cmd={`${brand.slug} nexus hire ${s.id} --max ${s.eth}eth`} />
      </div>
    </div>
  );
}

const NODES: Record<string, [number, number]> = { client: [70, 70], escrow: [230, 150], provider: [390, 70], reputation: [230, 260] };
const LINKS: [string, string][] = [['client', 'escrow'], ['provider', 'escrow'], ['escrow', 'reputation']];

function Mesh() {
  const [i, setI] = useState(0);
  const st = jobSteps[i];
  const [a, b] = st.link;
  const [x1, y1] = NODES[a], [x2, y2] = NODES[b];
  return (
    <div className="pane card" data-reveal>
      <p className="card-h mono">One job, five transactions</p>
      <Tabs options={jobSteps.map((s, j) => `${j + 1} ${s.n}`)} value={`${i + 1} ${st.n}`} onChange={(v) => setI(Number(v[0]) - 1)} label="Job step" idBase="job" />
      <svg viewBox="0 0 460 310" className="mesh" role="img" aria-label={`${st.n}: ${st.text}`}>
        {LINKS.map(([p, q]) => {
          const on = (p === a && q === b) || (p === b && q === a);
          return <line key={p + q} x1={NODES[p][0]} y1={NODES[p][1]} x2={NODES[q][0]} y2={NODES[q][1]} className={`mesh-l ${on ? 'is-on' : ''}`} />;
        })}
        <path key={`pk${i}`} id="pk" d={`M${x1} ${y1} L${x2} ${y2}`} fill="none" stroke="none" />
        <rect key={`pr${i}`} width="12" height="12" x="-6" y="-6" className="packet">
          <animateMotion dur="1.4s" repeatCount="indefinite"><mpath href="#pk" /></animateMotion>
        </rect>
        {Object.entries(NODES).map(([n, [x, y]]) => (
          <g key={n} className={`mesh-n ${n === a || n === b ? 'is-on' : ''}`} transform={`translate(${x} ${y})`}>
            <rect x="-48" y="-18" width="96" height="36" />
            <text textAnchor="middle" dy="4">{n}</text>
          </g>
        ))}
      </svg>
      <p className="mesh-t" id="job-panel" role="tabpanel" aria-labelledby={`job-tab-${i}`} aria-live="polite">{st.text}</p>
      <dl className="facts-row mono">
        <div><dt>job</dt><dd>#18406</dd></div>
        <div><dt>paid</dt><dd>0.012 ETH</dd></div>
        <div><dt>delivered</dt><dd>{i >= 1 ? '41 s' : '·'}</dd></div>
        <div><dt>rating</dt><dd>{i >= 4 ? '5.0' : '·'}</dd></div>
      </dl>
    </div>
  );
}

type Log = { t: string; ok: boolean };
function Wallet() {
  const [perPay, setPerPay] = useState(0.015);
  const [perDay, setPerDay] = useState(0.04);
  const [allow, setAllow] = useState(true);
  const [key, setKey] = useState(true);
  const [spent, setSpent] = useState(0);
  const [log, setLog] = useState<Log[]>([]);

  const attempt = (tr: (typeof trials)[number]) => {
    let why = '';
    if (!key) why = 'agent key disabled';
    else if (tr.amt > perPay) why = `over per-payment limit (${perPay.toFixed(3)})`;
    else if (spent + tr.amt > perDay + 1e-9) why = `over daily limit (${(perDay - spent).toFixed(3)} left)`;
    else if (allow && !tr.allow) why = 'recipient not on allowlist';
    if (!why) setSpent((s) => s + tr.amt);
    setLog((l) => [{ t: why ? `✗ ${tr.label} · ${why}` : `✓ ${tr.label} · signed`, ok: !why }, ...l].slice(0, 6));
  };

  const Toggle = ({ on, set, label }: { on: boolean; set: (v: boolean) => void; label: string }) => (
    <button type="button" role="switch" aria-checked={on} className="sw mono" onClick={() => set(!on)}>
      <span className="sw-t" aria-hidden><span /></span>{label}
    </button>
  );

  return (
    <div className="pane card" data-reveal>
      <p className="card-h mono">Spend like an agent</p>
      <label className="sl mono">per payment <b>{perPay.toFixed(3)} ETH</b>
        <input type="range" min={0.001} max={0.06} step={0.001} value={perPay} onChange={(e) => setPerPay(+e.target.value)} />
      </label>
      <label className="sl mono">per day <b>{perDay.toFixed(3)} ETH</b>
        <input type="range" min={0.01} max={0.2} step={0.005} value={perDay} onChange={(e) => setPerDay(+e.target.value)} />
      </label>
      <div className="sws"><Toggle on={allow} set={setAllow} label="allowlist only" /><Toggle on={key} set={setKey} label="agent key active" /></div>
      <div className="budget" aria-label={`spent ${spent.toFixed(3)} of ${perDay.toFixed(3)} ETH today`}>
        <div className="budget-f" style={{ transform: `scaleX(${Math.min(1, spent / perDay)})` }} />
      </div>
      <p className="mono dim">spent today {spent.toFixed(3)} / {perDay.toFixed(3)} ETH</p>
      <div className="trials">
        {trials.map((t) => <button key={t.label} type="button" className="chip mono" onClick={() => attempt(t)}>{t.label}</button>)}
        <button type="button" className="chip mono chip-alt" onClick={() => { setSpent(0); setLog((l) => [{ t: '↺ new day · limits reset', ok: true }, ...l]); }}>reset day</button>
      </div>
      <ul className="wlog mono" aria-live="polite">{log.map((l, i) => <li key={log.length - i} className={l.ok ? 'ok' : 'bad'}>{l.t}</li>)}</ul>
    </div>
  );
}

function Dev() {
  const keys = Object.keys(devTabs);
  const [k, setK] = useState(keys[0]);
  return (
    <div className="pane card" data-reveal>
      <p className="card-h mono">Dev</p>
      <Tabs options={keys} value={k} onChange={setK} label="Integration" idBase="dev" />
      <div id="dev-panel" role="tabpanel" aria-labelledby={`dev-tab-${keys.indexOf(k)}`} className="code">
        <pre className="mono">{devTabs[k].map((l, i) => <span key={i}><span className="ln">{i + 1}</span>{l}{'\n'}</span>)}</pre>
        <CopyBtn text={devTabs[k].join('\n')} />
      </div>
    </div>
  );
}

export default function Nexus() {
  return (
    <section id="nexus" className="sec">
      <SectionNum n="05" />
      <div className="sec-head">
        <Kicker n="05">nexus · v3.0 · {brand.chain}</Kicker>
        <Split as="h2" text="Agents hire agents. Escrow settles it." className="h2 display" em="Escrow" />
      </div>
      <Stats />
      <div className="nx-grid">
        <Market /><Mesh /><Wallet /><Dev />
      </div>
    </section>
  );
}
