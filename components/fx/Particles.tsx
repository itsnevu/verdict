'use client';
import { useEffect, useRef } from 'react';

/** Fine ink dust drifting on paper. Pauses offscreen. */
export default function Particles({ density = 0.00012, className = '' }: { density?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current!;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let w = 0, h = 0, raf = 0, visible = true, color = '#0E0C0A', frame = 0;
    type P = { x: number; y: number; r: number; vx: number; vy: number; a: number };
    let ps: P[] = [];
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const resize = () => {
      w = cv.clientWidth; h = cv.clientHeight;
      cv.width = w * dpr; cv.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.min(420, Math.round(w * h * density));
      ps = Array.from({ length: n }, () => ({
        x: Math.random() * w, y: Math.random() * h,
        r: Math.random() * 1.3 + 0.3,
        vx: (Math.random() - 0.5) * 0.12, vy: -Math.random() * 0.18 - 0.02,
        a: Math.random() * 0.5 + 0.15,
      }));
    };
    const readColor = () => { color = getComputedStyle(cv).getPropertyValue('--ink').trim() || color; };
    const draw = () => {
      if (frame++ % 60 === 0) readColor();
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = color;
      for (const p of ps) {
        if (!reduced) {
          p.x += p.vx; p.y += p.vy;
          if (p.y < -4) { p.y = h + 4; p.x = Math.random() * w; }
          if (p.x < -4) p.x = w + 4; else if (p.x > w + 4) p.x = -4;
        }
        ctx.globalAlpha = p.a;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (visible && !reduced) raf = requestAnimationFrame(draw);
    };
    resize(); readColor(); draw();
    const ro = new ResizeObserver(() => { resize(); if (reduced) draw(); });
    ro.observe(cv);
    const io = new IntersectionObserver(([e]) => {
      const was = visible; visible = e.isIntersecting;
      if (visible && !was && !reduced) { cancelAnimationFrame(raf); raf = requestAnimationFrame(draw); }
    });
    io.observe(cv);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); };
  }, [density]);
  return <canvas ref={ref} className={`particles ${className}`} aria-hidden />;
}
