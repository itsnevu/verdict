'use client';
import { useState } from 'react';
import Split from '../fx/Split';
import { Kicker } from '../fx/Ui';

type Row = { signal: string; raw: number | null; score: number | null; contribution: number; status: string };
type Verdict = { symbol: string | null; score: number | null; label: string | null; confidence: number; flags: string[]; breakdown: Row[]; missingSignals: string[] };
type Res = { data?: Verdict; brief?: string; error?: { code: string; message: string } };

const SAMPLES = [
  { sym: 'CRCL', addr: '0xdf0992e440dd0be65bd8439b609d6d4366bf1cb5' },
  { sym: 'BONER', addr: '0x98096d17e191b3da1d5f99a6d7b3584351b11e18' },
  { sym: 'AI', addr: '0x2e8c31162b855a2ffa90f6f8634643ad6f111e18' },
];

export default function TryLive() {
  const [addr, setAddr] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Res | null>(null);

  const run = async (a: string) => {
    const v = a.trim();
    setAddr(v);
    setBusy(true);
    setRes(null);
    try {
      const r = await fetch(`/api/verdict/scan/${encodeURIComponent(v)}`);
      setRes((await r.json()) as Res);
    } catch {
      setRes({ error: { code: 'NETWORK', message: 'could not reach the server' } });
    } finally {
      setBusy(false);
    }
  };

  const v = res?.data;
  const top = v ? [...v.breakdown].filter((r) => r.status === 'ok').sort((a, b) => b.contribution - a.contribution).slice(0, 5) : [];
  const tone = v?.label === 'HEALTHY' || v?.label === 'WATCH' ? 'ok' : 'bad';

  return (
    <section id="try" className="sec try">
      <div className="sec-head">
        <Kicker n="live">try it on Robinhood Chain</Kicker>
        <Split as="h2" text="Paste a token. Get a verdict." className="h2 display" em="verdict" />
        <p className="lede" data-reveal>Real data from Robinhood Chain, scored by the same engine your agent calls. Nothing to install.</p>
      </div>
      <div className="try-box card" data-reveal>
        <form className="try-form" onSubmit={(e) => { e.preventDefault(); if (addr.trim()) void run(addr); }}>
          <label htmlFor="try-addr" className="sr-only">Token address</label>
          <input id="try-addr" className="mono" value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="0x… token address on Robinhood Chain" spellCheck={false} autoComplete="off" />
          <button type="submit" className="btn-ink mono" disabled={busy}>{busy ? 'judging…' : 'judge'}</button>
        </form>
        <div className="try-samples mono">
          <span className="dim">try:</span>
          {SAMPLES.map((s) => <button key={s.sym} type="button" className="chip mono" onClick={() => void run(s.addr)} disabled={busy}>{s.sym}</button>)}
        </div>

        <div className="try-out" aria-live="polite">
          {busy && <p className="mono dim">reading Robinhood Chain: liquidity, holders, volume… the first scan of a token can take a few seconds</p>}
          {res?.error && (
            <p className="mono bad">{res.error.code === 'API_UNAVAILABLE' ? 'Live verdicts open at launch. The engine is ready; the public API is not online yet.' : res.error.message}</p>
          )}
          {v && (
            <div className="try-v">
              <div className="try-score">
                <span className={`try-num display ${tone}`}>{v.score ?? '–'}</span>
                <span className="mono">
                  <b>{v.symbol ?? 'token'}</b> · {v.label ?? 'no verdict'}<br />confidence {v.confidence}
                </span>
              </div>
              {res?.brief && <p className="try-brief">{res.brief}</p>}
              <ul className="bars mono">
                {top.map((r) => (
                  <li key={r.signal}><span>{r.signal}</span><span className="bar" aria-hidden><i style={{ transform: `scaleX(${(r.score ?? 0) / 100})` }} /></span><span className="dim">{r.score?.toFixed(0)}</span></li>
                ))}
              </ul>
              <p className="mono dim note">
                {v.flags.length ? `flags: ${v.flags.join(', ')} · ` : 'no flags · '}
                {v.missingSignals.length ? `not visible yet: ${v.missingSignals.join(', ')}` : 'all signals read'}
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
