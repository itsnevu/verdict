'use client';
import { useState, type CSSProperties } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import Split from '../fx/Split';
import { CopyBtn, Kicker, SectionNum } from '../fx/Ui';
import { brand, levels, short, tokenStages } from '@/lib/content';
import { rove } from '@/lib/runtime';

export default function Roadmap() {
  const [i, setI] = useState(0);
  const [open, setOpen] = useState<number | null>(0);
  const L = levels[i];
  return (
    <section id="roadmap" className="sec">
      <SectionNum n="07" />
      <div className="sec-head">
        <Kicker n="07">roadmap</Kicker>
        <Split as="h2" text="Three phases. Judge is built." className="h2 display" em="Judge" />
      </div>

      <div className="lv-tabs" role="tablist" aria-label="Levels">
        {levels.map((l, j) => (
          <button key={l.id} id={`lv-tab-${j}`} type="button" role="tab" aria-selected={j === i} aria-controls="lv-panel" tabIndex={j === i ? 0 : -1}
            className="lv card" data-reveal onClick={() => setI(j)} onKeyDown={(e) => rove(e, i, levels.length, setI)}>
            <span className="mono dim">level {j + 1}</span>
            <b className="display">{l.name}</b>
            <span className="mono tags"><span className="tag">{l.status}</span>{j === 0 && <span className="tag tag-ask">current</span>}</span>
          </button>
        ))}
      </div>

      <div id="lv-panel" role="tabpanel" aria-labelledby={`lv-tab-${i}`} className="lv-panel card" key={L.id}>
        <div className="lv-head">
          <h3 className="display">{L.era}</h3>
          <ol className="track mono" aria-label="Network track">
            <li>testnet · {L.status}</li>
            <li className="track-l" aria-hidden />
            <li>mainnet · {L.status}</li>
          </ol>
        </div>
        <ul className="feat">
          {L.features.map((f, j) => (
            <li key={f} style={{ '--j': j } as CSSProperties}><span className="mono cobalt">{String(j + 1).padStart(2, '0')}</span>{f}</li>
          ))}
        </ul>
      </div>

      <div className="tok card" data-reveal>
        <div>
          <p className="card-h mono">{brand.ticker}</p>
          <p className="tok-d">{brand.ticker} is not launched. When it is, it will pay for jobs, raise spend caps and vote on the registry.</p>
          <p className="mono dim tok-w">{brand.tokenAddress ? <>The only contract is <span className="cobalt">{short(brand.tokenAddress, 4, 4)}</span> <CopyBtn text={brand.tokenAddress} />. </> : <>There is no contract yet. </>}The address will be published only on {brand.officialChannels}. Anything else is not us.</p>
        </div>
        <div className="acc">
          {tokenStages.map((s, j) => (
            <div key={s.t} className={`acc-i ${open === j ? 'is-open' : ''}`}>
              <button type="button" aria-expanded={open === j} aria-controls={`acc-${j}`} id={`acc-b-${j}`} onClick={() => setOpen(open === j ? null : j)}>
                <span>{s.t}</span><ChevronDown size={16} aria-hidden />
              </button>
              <div id={`acc-${j}`} role="region" aria-labelledby={`acc-b-${j}`} hidden={open !== j}><p>{s.d}</p></div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
