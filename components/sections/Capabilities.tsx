import Split from '../fx/Split';
import { Kicker, SectionNum } from '../fx/Ui';
import { capabilities as c } from '@/lib/content';

export default function Capabilities() {
  return (
    <section id="does" className="sec caps">
      <SectionNum n="01" />
      <div className="sec-head">
        <Kicker n="01">{c.kicker}</Kicker>
        <Split as="h2" text={c.title} className="h2 display" em="agent" />
        <p className="lede" data-reveal>{c.sub}</p>
      </div>
      <div className="caps-grid">
        {c.groups.map((g) => (
          <div key={g.h} className="caps-col card" data-reveal>
            <h3 className="caps-h display">{g.h}</h3>
            <ul>
              {g.items.map((i) => (
                <li key={i.t}>
                  <span>{i.t}</span>
                  <span className={`caps-tag mono ${i.live ? 'is-live' : ''}`}>{i.live ? 'live' : 'soon'}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
