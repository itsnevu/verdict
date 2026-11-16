'use client';
import { useEffect, useRef, useState } from 'react';

const GLYPHS = '▮◢◤#%&@$01<>/\\|=+*';

/** Giant wordmark that glitches in short bursts: RGB split, sliced offsets, glyph scramble. */
export default function GlitchWord({ text, className = '' }: { text: string; className?: string }) {
  const host = useRef<HTMLParagraphElement>(null);
  const [chars, setChars] = useState(() => text.split(''));
  const [burst, setBurst] = useState(false);

  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const el = host.current!;
    let visible = false, hover = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const later = (f: () => void, ms: number) => { timers.push(setTimeout(f, ms)); };

    const fire = () => {
      setBurst(true);
      const frames = hover ? 9 : 5;
      for (let f = 0; f < frames; f++) {
        later(() => {
          setChars(text.split('').map((c) => (Math.random() < (hover ? 0.35 : 0.18) ? GLYPHS[(Math.random() * GLYPHS.length) | 0] : c)));
          el.style.setProperty('--gx', `${((Math.random() - 0.5) * 14).toFixed(1)}px`);
          el.style.setProperty('--s1', `${(Math.random() * 70).toFixed(0)}%`);
          el.style.setProperty('--s2', `${(Math.random() * 70).toFixed(0)}%`);
        }, f * 55);
      }
      later(() => { setChars(text.split('')); setBurst(false); el.style.setProperty('--gx', '0px'); }, frames * 55 + 40);
    };
    const schedule = () => later(() => { if (visible) fire(); schedule(); }, hover ? 380 : 1400 + Math.random() * 2600);
    schedule();

    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) fire(); }, { threshold: 0.3 });
    io.observe(el);
    const on = () => { hover = true; fire(); };
    const off = () => { hover = false; };
    el.addEventListener('pointerenter', on);
    el.addEventListener('pointerleave', off);
    return () => { timers.forEach(clearTimeout); io.disconnect(); el.removeEventListener('pointerenter', on); el.removeEventListener('pointerleave', off); };
  }, [text]);

  return (
    <p ref={host} className={`giant glitch display ${burst ? 'is-burst' : ''} ${className}`} aria-label={text} data-cursor="glitch">
      {chars.map((c, i) => (
        <span key={i} className="g-ch" data-c={c} aria-hidden>{c}</span>
      ))}
    </p>
  );
}
