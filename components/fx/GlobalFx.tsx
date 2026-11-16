'use client';
import { useEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

/**
 * Wires the declarative attributes used across the page:
 *  data-reveal        one-shot 3D reveal, 50 ms stagger among siblings
 *  data-split="io"    per-character reveal (data-s off → on)
 *  data-draw          adds .is-in when visible (svg line drawing etc.)
 *  data-magnetic      follows the cursor up to 12 px, springs back
 *  data-tilt="n"      rotates up to n degrees toward the cursor
 *  data-cursor="x"    custom cursor grows and shows label x
 */
export default function GlobalFx() {
  useEffect(() => {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

    // reveal + split + draw
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => {
        if (!e.isIntersecting) return;
        const el = e.target as HTMLElement;
        if (el.dataset.split === 'io') el.dataset.s = 'on';
        el.classList.add('is-in');
        io.unobserve(el);
      }),
      { rootMargin: '0px 0px -12% 0px', threshold: 0.05 },
    );
    const scan = () => {
      document.querySelectorAll<HTMLElement>('[data-reveal]:not(.is-in)').forEach((el) => {
        const sibs = Array.from(el.parentElement?.children ?? []).filter((c) => (c as HTMLElement).dataset.reveal !== undefined);
        el.style.transitionDelay = `${Math.max(0, sibs.indexOf(el)) * 50}ms`;
        if (reduced) el.classList.add('is-in'); else io.observe(el);
      });
      document.querySelectorAll<HTMLElement>('[data-split="io"][data-s="off"], [data-draw]:not(.is-in)').forEach((el) => {
        if (reduced) { el.dataset.s = 'on'; el.classList.add('is-in'); } else io.observe(el);
      });
    };
    scan();
    const mo = new MutationObserver(() => scan());
    mo.observe(document.body, { childList: true, subtree: true });

    if (reduced) return () => { io.disconnect(); mo.disconnect(); };

    // sections open like a sheet of paper being pulled up
    const wipes = Array.from(document.querySelectorAll<HTMLElement>('main > .sec:not(.install)')).map((sec) =>
      gsap.fromTo(sec, { clipPath: 'inset(9% 5% 0% 5%)' }, { clipPath: 'inset(0% 0% 0% 0%)', ease: 'none', scrollTrigger: { trigger: sec, start: 'top bottom', end: 'top 35%', scrub: true } }));
    // section heads: number + kicker slide in from the margin
    const heads = Array.from(document.querySelectorAll<HTMLElement>('.sec-num')).map((n) =>
      gsap.fromTo(n, { yPercent: 60, opacity: 0 }, { yPercent: 0, opacity: 1, ease: 'none', scrollTrigger: { trigger: n, start: 'top bottom', end: 'top 50%', scrub: true } }));

    // magnetic + tilt via delegation
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      const t = e.target as HTMLElement;
      const mag = t.closest<HTMLElement>('[data-magnetic]');
      if (mag) {
        const r = mag.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height / 2);
        const c = (v: number) => Math.max(-12, Math.min(12, v * 0.3));
        gsap.to(mag, { x: c(dx), y: c(dy), duration: 0.35, ease: 'power3.out' });
        mag.dataset.magOn = '1';
      }
      const tilt = t.closest<HTMLElement>('[data-tilt]');
      if (tilt) {
        const n = Number(tilt.dataset.tilt) || 6;
        const r = tilt.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - 0.5;
        const py = (e.clientY - r.top) / r.height - 0.5;
        gsap.to(tilt, { rotateY: px * n * 2, rotateX: -py * n * 2, transformPerspective: 1000, duration: 0.4, ease: 'power2.out' });
        tilt.style.setProperty('--sx', `${(5 - px * 14).toFixed(1)}px`);
        tilt.style.setProperty('--sy', `${(5 - py * 14).toFixed(1)}px`);
        tilt.dataset.tiltOn = '1';
      }
    };
    const onOut = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      const rel = e.relatedTarget as HTMLElement | null;
      const mag = t.closest<HTMLElement>('[data-magnetic]');
      if (mag && !(rel && mag.contains(rel))) gsap.to(mag, { x: 0, y: 0, duration: 0.9, ease: 'elastic.out(1, 0.35)' });
      const tilt = t.closest<HTMLElement>('[data-tilt]');
      if (tilt && !(rel && tilt.contains(rel))) { gsap.to(tilt, { rotateX: 0, rotateY: 0, duration: 0.6, ease: 'power3.out' }); tilt.style.removeProperty('--sx'); tilt.style.removeProperty('--sy'); }
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerout', onOut);
    return () => {
      io.disconnect(); mo.disconnect();
      wipes.forEach((t) => { t.scrollTrigger?.kill(); t.kill(); });
      heads.forEach((t) => { t.scrollTrigger?.kill(); t.kill(); });
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerout', onOut);
    };
  }, []);

  // the custom cursor was one effect too many; the native cursor stays
  return null;
}

export { Cursor };

function Cursor() {
  const dot = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const [label, setLabel] = useState('');
  const [on, setOn] = useState(false);

  useEffect(() => {
    if (matchMedia('(pointer: coarse)').matches || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    setOn(true);
    document.documentElement.classList.add('has-cursor');
    const pos = { x: innerWidth / 2, y: innerHeight / 2 };
    const ringPos = { ...pos };
    let raf = 0;
    let snap: HTMLElement | null = null;
    const move = (e: PointerEvent) => {
      pos.x = e.clientX; pos.y = e.clientY;
      const t = e.target as HTMLElement;
      const c = t.closest<HTMLElement>('[data-cursor], a, button, [role="tab"], [role="radio"], [role="option"], input');
      const l = c?.dataset.cursor ?? '';
      setLabel(l);
      snap = t.closest<HTMLElement>('[data-magnetic], .keycap, .kc');
      const r = ring.current;
      if (!r) return;
      r.classList.toggle('is-hover', !!c && !snap);
      r.classList.toggle('is-snap', !!snap && !l);
      r.classList.toggle('is-link', !!t.closest('a') && !l);
      r.classList.toggle('is-text', !c && !!t.closest('p, h1, h2, h3, li, code, pre, td'));
      if (snap && !l) {
        const b = snap.getBoundingClientRect();
        r.style.width = `${b.width + 14}px`; r.style.height = `${b.height + 14}px`;
        r.style.marginLeft = `${-(b.width + 14) / 2}px`; r.style.marginTop = `${-(b.height + 14) / 2}px`;
      } else { r.style.width = r.style.height = r.style.marginLeft = r.style.marginTop = ''; }
    };
    const loop = () => {
      let tx = pos.x, ty = pos.y;
      if (snap && snap.isConnected) { const b = snap.getBoundingClientRect(); tx = b.left + b.width / 2; ty = b.top + b.height / 2; }
      ringPos.x += (tx - ringPos.x) * 0.2;
      ringPos.y += (ty - ringPos.y) * 0.2;
      if (dot.current) dot.current.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0)`;
      if (ring.current) ring.current.style.transform = `translate3d(${ringPos.x}px, ${ringPos.y}px, 0)`;
      raf = requestAnimationFrame(loop);
    };
    loop();
    document.addEventListener('pointermove', move);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('pointermove', move);
      document.documentElement.classList.remove('has-cursor');
    };
  }, []);

  if (!on) return null;
  return (
    <>
      <div ref={ring} className={`cursor-ring ${label ? 'has-label' : ''}`} aria-hidden>
        <span>{label}</span>
      </div>
      <div ref={dot} className="cursor-dot" aria-hidden />
    </>
  );
}
