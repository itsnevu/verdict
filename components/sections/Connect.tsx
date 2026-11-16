'use client';
import { useState } from 'react';
import Split from '../fx/Split';
import { CopyBtn, Kicker, SectionNum, Tabs } from '../fx/Ui';
import { brand, connect as c } from '@/lib/content';

export default function Connect() {
  const ids = c.clients.map((x) => x.id);
  const [id, setId] = useState(ids[0]!);
  const client = c.clients.find((x) => x.id === id)!;
  const live = brand.launched;

  return (
    <section id="connect" className="sec connect">
      <SectionNum n="02" />
      <div className="sec-head">
        <Kicker n="02">{c.kicker}</Kicker>
        <Split as="h2" text={c.title} className="h2 display" em="agent" />
        <p className="lede" data-reveal>{c.sub}</p>
        {!live && <p className="mono dim note">the endpoint opens at launch · commands below show exactly what you will run</p>}
      </div>

      <div className="cn-grid">
        <div className="cn-ask card" data-reveal>
          <p className="card-h mono">{c.askTitle}</p>
          <p className="dim cn-note">{c.askNote}</p>
          <pre className="cn-code mono">{c.askPrompt}</pre>
          {live ? <CopyBtn text={c.askPrompt} label="copy prompt" /> : <span className="cmd-soon mono">at launch</span>}
        </div>

        <div className="cn-manual card" data-reveal>
          <p className="card-h mono">or set it up yourself</p>
          <ol className="cn-steps">
            {c.steps.map((s, i) => (
              <li key={s.t}><span className="cn-n display">{i + 1}</span><div><b>{s.t}</b><p className="dim">{s.d}</p></div></li>
            ))}
          </ol>
          <Tabs options={ids} value={id} onChange={setId} label="Agent" idBase="cn" />
          <div id="cn-panel" role="tabpanel" aria-labelledby={`cn-tab-${ids.indexOf(id)}`} className="cn-cmd">
            <pre className="cn-code mono">{client.cmd}</pre>
            {live ? <CopyBtn text={client.cmd} /> : <span className="cmd-soon mono">at launch</span>}
          </div>
          <p className="dim cn-note">{client.note}</p>
          <p className="mono cn-ro">{c.readOnly}</p>
        </div>
      </div>
    </section>
  );
}
