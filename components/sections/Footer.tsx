import { Logo } from '../Header';
import GlitchWord from '../fx/GlitchWord';
import { brand, footer } from '@/lib/content';

export default function Footer() {
  return (
    <footer className="ftr">
      <div className="ftr-cols">
        <div className="ftr-brand">
          <p className="brand"><Logo /> <span className="brand-n">{brand.name}</span></p>
          <p className="dim">{footer.tagline}</p>
        </div>
        {footer.cols.map((c) => (
          <div key={c.h}>
            <h3 className="mono dim ftr-h">{c.h}</h3>
            <ul>{c.l.map((l) => <li key={l.t}>{l.href ? <a href={l.href} target="_blank" rel="noreferrer">{l.t}</a> : <span className="dim">{l.t} <span className="soon">soon</span></span>}</li>)}</ul>
          </div>
        ))}
      </div>
      <GlitchWord text={brand.name} />
      <p className="legal mono">{footer.legal}</p>
    </footer>
  );
}
