'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Menu, Moon, Sun, X as Close } from 'lucide-react';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Odometer from './fx/Odometer';
import { brand, nav } from '@/lib/content';
import { scrollToId, useBlock } from '@/lib/runtime';

export function Logo({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className="logo">
      <rect x="1" y="1" width="22" height="22" fill="var(--ink)" />
      <path d="M6 6l6 12 6-12" fill="none" stroke="var(--paper)" strokeWidth="2.6" strokeLinejoin="miter" />
      <rect x="16.5" y="15.5" width="4" height="4" fill="var(--vermilion)" />
    </svg>
  );
}

function XLogo() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden><path fill="currentColor" d="M18.2 2h3.4l-7.4 8.5L23 22h-6.8l-5.3-7-6.1 7H1.4l7.9-9L1 2h7l4.8 6.4L18.2 2zm-1.2 18h1.9L7.1 4H5.1l11.9 16z" /></svg>
  );
}

export default function Header() {
  const bar = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const block = useBlock();

  useEffect(() => {
    const t = (document.documentElement.dataset.theme as 'light' | 'dark') || 'light';
    setTheme(t);
    const st = ScrollTrigger.create({
      start: 0, end: 'max',
      onUpdate: (self) => {
        if (bar.current) bar.current.style.transform = `scaleX(${self.progress})`;
        setScrolled(self.scroll() > 40);
        setHidden(self.direction === 1 && self.scroll() > 240);
      },
    });
    return () => st.kill();
  }, []);

  const toggleTheme = () => {
    const n = theme === 'light' ? 'dark' : 'light';
    setTheme(n);
    document.documentElement.dataset.theme = n;
    try { localStorage.setItem('verdict-theme', n); } catch { /* blocked */ }
  };

  const go = (id: string) => { setOpen(false); scrollToId(id); };

  return (
    <header className={`hdr ${scrolled ? 'is-scrolled' : ''} ${open ? 'is-open' : ''} ${hidden && !open ? 'is-hidden' : ''}`}>
      <div className="hdr-bar" ref={bar} aria-hidden />
      <div className="hdr-in">
        <a href="#top" className="brand" aria-label={`${brand.name} home`}>
          <Logo /> <span className="brand-n">{brand.name}</span>
        </a>
        <nav className="hdr-nav" aria-label="Primary">
          {nav.map((n) => (
            <a key={n.id} href={`#${n.id}`} onClick={(e) => { e.preventDefault(); go(n.id); }}>
              {n.label}<ArrowUpRight size={13} className="arr" aria-hidden />
            </a>
          ))}
        </nav>
        <div className="hdr-r">
          {brand.xUrl && <a className="icon-btn" href={brand.xUrl} target="_blank" rel="noreferrer" aria-label={`${brand.name} on X`}><XLogo /></a>}
          <button type="button" className="icon-btn" onClick={toggleTheme} aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`} aria-pressed={theme === 'dark'}>
            {theme === 'light' ? <Moon size={15} aria-hidden /> : <Sun size={15} aria-hidden />}
          </button>
          <button type="button" className="btn-install" data-cursor="install" data-magnetic onClick={() => go('install')}>
            Install {brand.launched
              ? <span className="badge-odo" aria-label={`block ending ${block % 1000}`}><Odometer value={block % 1000} pad={3} group={false} /></span>
              : <span className="badge-odo">soon</span>}
          </button>
          <button type="button" className="icon-btn hdr-menu" aria-expanded={open} aria-controls="mnav" aria-label="Menu" onClick={() => setOpen((o) => !o)}>
            {open ? <Close size={17} aria-hidden /> : <Menu size={17} aria-hidden />}
          </button>
        </div>
      </div>
      <nav id="mnav" className="mnav" aria-label="Mobile" hidden={!open}>
        {nav.map((n, i) => (
          <a key={n.id} href={`#${n.id}`} onClick={(e) => { e.preventDefault(); go(n.id); }}>
            <span className="mono">0{i + 1}</span> {n.label}
          </a>
        ))}
      </nav>
    </header>
  );
}
