'use client';
import { useEffect, useRef, useState } from 'react';
import Particles from './fx/Particles';
import { boot, brand } from '@/lib/content';
import { lenisRef } from '@/lib/runtime';

const KEY = 'verdict-splash';
const announce = () => { (window as unknown as { __splashDone?: boolean }).__splashDone = true; dispatchEvent(new Event('splash:done')); };

export default function Splash() {
  const [state, setState] = useState<'run' | 'exit' | 'done'>('run');
  const [lines, setLines] = useState(0);
  const [pct, setPct] = useState(0);
  const [opening, setOpening] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let seen = false;
    try { seen = sessionStorage.getItem(KEY) === '1'; } catch { /* blocked */ }
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (seen) { setState('done'); announce(); return; }
    try { sessionStorage.setItem(KEY, '1'); } catch { /* blocked */ }

    document.documentElement.classList.add('is-locked');
    lenisRef.current?.stop();
    ref.current?.focus();
    const total = reduced ? 600 : 2200;
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / total);
      setPct(Math.round(k * 99));
      setLines(Math.min(boot.length + 1, Math.floor(k * (boot.length + 1.4))));
      if (k < 1) raf = requestAnimationFrame(tick);
      else {
        setOpening(true);
        setTimeout(() => { setState('exit'); announce(); }, reduced ? 100 : 520);
        setTimeout(finish, reduced ? 150 : 1450);
      }
    };
    raf = requestAnimationFrame(tick);
    const finish = () => {
      setState('done');
      document.documentElement.classList.remove('is-locked');
      lenisRef.current?.start();
    };
    const skip = (e: KeyboardEvent) => { if (e.key === 'Escape') { cancelAnimationFrame(raf); finish(); announce(); } };
    addEventListener('keydown', skip);
    return () => { cancelAnimationFrame(raf); removeEventListener('keydown', skip); document.documentElement.classList.remove('is-locked'); };
  }, []);

  if (state === 'done') return null;
  return (
    <div ref={ref} tabIndex={-1} className={`splash ${state === 'exit' ? 'is-exit' : ''}`} role="dialog" aria-modal="true" aria-label={`${brand.name} is booting`}>
      <Particles density={0.00016} />
      <div className="splash-log mono" aria-live="polite">
        <p className="splash-cmd">› {brand.slug} --boot</p>
        {boot.slice(0, lines).map(([k, v]) => (
          <p key={k} className="splash-line">
            <span>{k}</span><span className="leader" aria-hidden /><span className="splash-v">{v}</span>
          </p>
        ))}
        {opening && <p className="splash-open">opening a session<span className="blink" aria-hidden>_</span></p>}
      </div>
      <div className="splash-pct display" aria-hidden>{String(pct).padStart(3, '0')}<span>%</span></div>
      <p className="splash-hint mono">esc to skip</p>
    </div>
  );
}
