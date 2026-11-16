'use client';
import { useEffect, useRef } from 'react';
import { lenisRef } from '@/lib/runtime';

/**
 * Endless curved column. Items ride an arc whose middle bows toward the
 * screen centre (side="left" bows right, side="right" bows left), loop forever,
 * and speed up with scroll velocity.
 */
export default function Drum({ items, side, speed = 22, className = '' }: { items: string[]; side: 'left' | 'right'; speed?: number; className?: string }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current!;
    const nodes = Array.from(el.children) as HTMLElement[];
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const dir = side === 'left' ? 1 : -1; // left column scrolls up, right scrolls down
    let gap = 34, H = 600, total = nodes.length * gap, offset = 0, last = performance.now(), raf = 0, visible = true;

    const measure = () => { H = el.clientHeight; gap = Math.max(30, H / 16); total = nodes.length * gap; };
    const place = () => {
      const bulge = Math.min(70, el.clientWidth * 0.4);
      for (let i = 0; i < nodes.length; i++) {
        let y = (i * gap + offset) % total;
        if (y < 0) y += total;
        y -= total / 2; // centre the loop on the column
        const t = Math.max(-1, Math.min(1, y / (H / 2)));
        const curve = Math.cos((t * Math.PI) / 2); // 1 at centre → 0 at edges
        const x = curve * bulge * (side === 'left' ? 1 : -1);
        const rot = t * 28 * (side === 'left' ? -1 : 1);
        const n = nodes[i];
        n.style.transform = `translate3d(${x}px, ${y}px, 0) rotate(${rot}deg) scale(${0.78 + curve * 0.32})`;
        n.style.opacity = String(Math.max(0, curve * curve));
        n.classList.toggle('is-mid', Math.abs(y) < gap / 2);
      }
    };
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const v = Math.min(40, Math.abs(lenisRef.current?.velocity ?? 0));
      offset -= dir * (speed + v * 14) * dt;
      place();
      if (visible) raf = requestAnimationFrame(loop);
    };
    measure(); place();
    const ro = new ResizeObserver(() => { measure(); place(); });
    ro.observe(el);
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible && !reduced) { last = performance.now(); cancelAnimationFrame(raf); raf = requestAnimationFrame(loop); }
    });
    io.observe(el);
    if (!reduced) raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); };
  }, [side, speed]);

  return (
    <div ref={host} className={`drum drum-${side === 'left' ? 'l' : 'r'} mono ${className}`} aria-hidden>
      {items.map((t, i) => <p key={i} className="drum-i">{t}</p>)}
    </div>
  );
}
