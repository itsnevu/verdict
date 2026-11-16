'use client';
import { useEffect, useRef } from 'react';
import { marquee } from '@/lib/content';
import { lenisRef } from '@/lib/runtime';

/** Two counter-running tracks that speed up and skew with scroll velocity. */
export default function Marquee({ items = marquee, label = 'From intent to execution' }: { items?: string[]; label?: string }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const tracks = Array.from(host.current!.querySelectorAll<HTMLElement>('.mq-track'));
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const off = [0, 0];
    let skew = 0, last = performance.now(), raf = 0, visible = false;
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const v = lenisRef.current?.velocity ?? 0;
      const boost = 60 + Math.min(900, Math.abs(v) * 45);
      const dir = v < -0.5 ? -1 : 1;
      skew += (Math.max(-12, Math.min(12, v * 0.6)) - skew) * 0.12;
      tracks.forEach((t, i) => {
        const w = t.scrollWidth / 2;
        off[i] += (i ? -1 : 1) * dir * boost * dt;
        const m = ((off[i] % w) + w) % w; // 0..w
        t.style.transform = `translate3d(${(-m).toFixed(1)}px,0,0) skewX(${(-skew).toFixed(2)}deg)`;
      });
      if (visible) raf = requestAnimationFrame(loop);
    };
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible) { last = performance.now(); cancelAnimationFrame(raf); raf = requestAnimationFrame(loop); }
    });
    io.observe(host.current!);
    return () => { cancelAnimationFrame(raf); io.disconnect(); };
  }, []);

  const row = (outline: boolean) => (
    <div className={`mq-track ${outline ? 'mq-outline' : ''}`} aria-hidden>
      {[0, 1].map((k) => (
        <div key={k} className="mq-run">
          {items.map((t, i) => (
            <span key={i} className="mq-i display">{t}<span className="mq-g">◢◤</span></span>
          ))}
        </div>
      ))}
    </div>
  );
  return (
    <div ref={host} className="mq" role="marquee" aria-label={label}>
      {row(false)}
      {row(true)}
    </div>
  );
}
