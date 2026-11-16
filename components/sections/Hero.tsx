'use client';
import { useEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ArrowDown } from 'lucide-react';
import Split from '../fx/Split';
import Odometer from '../fx/Odometer';
import Particles from '../fx/Particles';
import Drum from '../fx/Drum';
import { CmdBlock } from '../fx/Ui';
import TerminalDemo from '../TerminalDemo';
import dynamic from 'next/dynamic';
const ChainMark = dynamic(() => import('../ChainMark'), { ssr: false });
import { brand, chapters, drumLeft, drumRight, facts, hero, sha4, short, steps } from '@/lib/content';
import { heroState, scrollToId, scrollToY, useBlock } from '@/lib/runtime';

gsap.registerPlugin(ScrollTrigger);

const STEP_AT = [0.1, 0.16, 0.22, 0.28];

export default function Hero() {
  const root = useRef<HTMLElement>(null);
  const [isStatic, setStatic] = useState(false);
  const [presses, setPresses] = useState(0);
  const block = useBlock();

  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { setStatic(true); return; }
    const el = root.current!;
    const q = gsap.utils.selector(el);
    const stepEls = q('.stp');
    const chapEls = q('.rail-i');
    const fill = q('.rail-fill')[0] as HTMLElement;

    const ui = (p: number) => {
      heroState.p = p;
      stepEls.forEach((s, i) => s.toggleAttribute('data-on', p >= STEP_AT[i]));
      let c = 0;
      chapters.forEach((ch, i) => { if (p >= ch.p - 0.001) c = i; });
      chapEls.forEach((b, i) => {
        if (i === c) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
        b.toggleAttribute('data-past', i < c);
      });
      if (fill) fill.style.transform = `scaleY(${p})`;
    };

    const ctx = gsap.context(() => {
      const tl = gsap.timeline({
        defaults: { ease: 'power2.inOut' },
        scrollTrigger: {
          trigger: el, start: 'top top', end: '+=400%', pin: true, scrub: 1.4,
          invalidateOnRefresh: true, anticipatePin: 1,
          onUpdate: (s) => ui(s.progress),
        },
      });
      heroState.st = tl.scrollTrigger ?? null;
      tl.to({}, { duration: 1, ease: 'none' }, 0);

      // characters rise out of a per-word mask — no blur, no opacity flicker
      const charsIn = (sel: string, at: number, span = 0.035) =>
        tl.fromTo(q(`${sel} .ch`), { yPercent: 110 }, { yPercent: 0, duration: span, stagger: 0.0011, ease: 'power3.out', immediateRender: true }, at);
      const charsOut = (sel: string, at: number, span = 0.03) =>
        tl.to(q(`${sel} .ch`), { yPercent: -110, duration: span, stagger: 0.0006, ease: 'power3.in' }, at);
      const fadeIn = (sel: string, at: number, d = 0.04) =>
        tl.fromTo(q(sel), { autoAlpha: 0, y: 24 }, { autoAlpha: 1, y: 0, duration: d, ease: 'power3.out', immediateRender: true }, at);
      const fadeOut = (sel: string, at: number, d = 0.035) =>
        tl.to(q(sel), { autoAlpha: 0, y: -24, duration: d, ease: 'power2.in' }, at);
      const show = (sel: string, at: number) => tl.set(q(sel), { autoAlpha: 1 }, at);
      const hide = (sel: string, at: number) => tl.set(q(sel), { autoAlpha: 0 }, at);

      // backdrop
      tl.fromTo(q('.veil'), { opacity: 0 }, { opacity: 1, duration: 0.08, ease: 'power1.in' }, 0.92);
      tl.to(q('.chain-wrap'), { autoAlpha: 0, y: -60, duration: 0.05, ease: 'power3.in' }, 0.2);

      // A out: the period of "Execution." becomes a portal that swallows the screen
      const period = () => {
        const words = q('.h1b .w');
        const w = words[words.length - 1] as HTMLElement | undefined;
        if (!w) return { x: innerWidth / 2, y: innerHeight / 2 };
        const r = w.getBoundingClientRect();
        const st = el.getBoundingClientRect();
        const fs = parseFloat(getComputedStyle(w).fontSize);
        return { x: r.right - st.left - fs * 0.17, y: r.bottom - st.top - fs * 0.3 };
      };
      const cover = () => Math.hypot(innerWidth, innerHeight) / 10 + 4;
      tl.fromTo(q('.portal'), { x: () => period().x - 10, y: () => period().y - 10, scale: 0, autoAlpha: 1 },
        { scale: 1, duration: 0.01, ease: 'none', immediateRender: false }, 0.2);
      fadeOut('.a-sub, .a-act, .a-panel, .drum', 0.2, 0.04);
      charsOut('.h1a', 0.21, 0.04);
      tl.to(q('.h1b .ch:not(.is-dot)'), { yPercent: -110, duration: 0.04, stagger: 0.0008, ease: 'power3.in' }, 0.215);
      tl.to(q('.h1b .is-dot'), { autoAlpha: 0, duration: 0.005 }, 0.24);
      tl.to(q('.portal'), { scale: cover, duration: 0.07, ease: 'expo.in' }, 0.24);
      hide('.ph-a', 0.31);

      // B inside the red
      show('.ph-b', 0.31);
      charsIn('.b-h', 0.31);
      tl.fromTo(q('.ring'), { scale: 2.6, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.08, ease: 'power3.out', immediateRender: true }, 0.31);
      fadeIn('.b-sub', 0.34); fadeIn('.b-key', 0.355);
      charsOut('.b-h', 0.44); fadeOut('.b-sub, .b-key', 0.435);
      tl.to(q('.ring'), { scale: 0.4, autoAlpha: 0, duration: 0.04, ease: 'power2.in' }, 0.44);
      hide('.ph-b', 0.48);

      // C giant type slides through the red
      show('.ph-c', 0.47);
      tl.fromTo(q('.c-track'), { x: () => innerWidth }, { x: () => -(q('.c-track')[0] as HTMLElement).scrollWidth, duration: 0.17, ease: 'none', immediateRender: true }, 0.47);
      fadeIn('.c-sub', 0.5); fadeOut('.c-sub', 0.6);
      hide('.ph-c', 0.645);

      // red wipes away upward, paper returns
      tl.fromTo(q('.portal'), { clipPath: 'inset(0% 0% 0% 0%)' }, { clipPath: 'inset(0% 0% 100% 0%)', duration: 0.05, ease: 'power3.inOut', immediateRender: false }, 0.6);

      // D keys + facts fly in from depth
      show('.ph-d', 0.635);
      charsIn('.d-h', 0.635);
      tl.fromTo(q('.fact'), { autoAlpha: 0, z: -900, rotateX: -50, rotateY: (i: number) => (i % 2 ? 25 : -25), y: 120 },
        { autoAlpha: 1, z: 0, rotateX: 0, rotateY: 0, y: 0, duration: 0.06, stagger: 0.007, ease: 'power3.out', immediateRender: true }, 0.65);
      charsOut('.d-h', 0.77);
      tl.to(q('.fact'), { autoAlpha: 0, z: 400, y: -40, duration: 0.035, stagger: 0.003, ease: 'power2.in' }, 0.765);
      hide('.ph-d', 0.81);

      // E seen
      show('.ph-e', 0.815);
      charsIn('.e-h', 0.815); fadeIn('.e-sub', 0.85); fadeIn('.e-cue', 0.87);
    }, el);

    // intro: headline builds itself as soon as the splash lifts
    const dot = el.querySelectorAll('.h1b .ch');
    dot[dot.length - 1]?.classList.add('is-dot');
    const intro = () => {
      if (heroState.p > 0.02) return;
      const it = gsap.timeline({ defaults: { ease: 'power4.out' } });
      it.fromTo(el.querySelectorAll('.h1a .ch, .h1b .ch'), { yPercent: 115 }, { yPercent: 0, duration: 1.1, stagger: 0.028 }, 0.1)
        .fromTo(el.querySelector('.h1b .u'), { scaleX: 0 }, { scaleX: 1, duration: 0.9, ease: 'expo.inOut' }, 0.7)
        .fromTo(el.querySelectorAll('.a-sub, .a-act, .a-panel'), { autoAlpha: 0, y: 30 }, { autoAlpha: 1, y: 0, duration: 0.9, stagger: 0.09 }, 0.55)
        .fromTo(el.querySelectorAll('.drum'), { autoAlpha: 0 }, { autoAlpha: 1, duration: 1.2 }, 0.9)
        .fromTo(el.querySelector('.chain-wrap'), { autoAlpha: 0, y: -80 }, { autoAlpha: 1, y: 0, duration: 1.4, ease: 'expo.out' }, 0.5);
    };
    gsap.set(el.querySelectorAll('.h1a .ch, .h1b .ch'), { yPercent: 115 });
    gsap.set(el.querySelector('.h1b .u'), { scaleX: 0 });
    gsap.set(el.querySelectorAll('.a-sub, .a-act, .a-panel, .drum, .chain-wrap'), { autoAlpha: 0 });
    if ((window as unknown as { __splashDone?: boolean }).__splashDone) intro();
    else addEventListener('splash:done', intro, { once: true });

    // seen-text: the "watching" eye follows the cursor
    const eye = el.querySelector<HTMLElement>('.eye-pupil');
    const look = (e: PointerEvent) => {
      if (!eye) return;
      const r = eye.parentElement!.getBoundingClientRect();
      const a = Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2));
      eye.style.transform = `translate(${Math.cos(a) * 5}px, ${Math.sin(a) * 5}px)`;
    };
    addEventListener('pointermove', look);
    return () => { removeEventListener('splash:done', intro); ctx.revert(); heroState.st = null; removeEventListener('pointermove', look); };
  }, []);

  const jump = (p: number) => {
    const st = heroState.st;
    if (!st) return;
    scrollToY(st.start + p * (st.end - st.start) + 2);
  };
  const skip = () => {
    const st = heroState.st;
    if (st) scrollToY(st.end + 4); else scrollToId('execute');
  };

  const pressY = (e: React.MouseEvent<HTMLButtonElement> | React.KeyboardEvent<HTMLButtonElement>) => {
    setPresses((n) => n + 1);
    try { navigator.vibrate?.(18); } catch { /* unsupported */ }
    const b = e.currentTarget;
    const host = b.parentElement!;
    for (let i = 0; i < 14; i++) {
      const s = document.createElement('span');
      s.className = 'burst-bit';
      host.appendChild(s);
      const a = (i / 14) * Math.PI * 2;
      gsap.fromTo(s, { x: 0, y: 0, opacity: 1, scale: 1 }, { x: Math.cos(a) * 110, y: Math.sin(a) * 110, opacity: 0, scale: 0.3, duration: 0.7, ease: 'power3.out', onComplete: () => s.remove() });
    }
  };


  return (
    <section id="top" ref={root} className="hero" data-static={isStatic || undefined} aria-label="The VERDICT story">
      <a href="#execute" className="skip-link" onClick={(e) => { e.preventDefault(); skip(); }}>skip the story</a>
      <div className="sr-only">
        <p>{hero.waits} {hero.waitsSub}</p>
        <p>{hero.measured} {hero.measuredSub}</p>
        <p>{hero.keys} {facts.map((f) => `${f.live ? 'demo block counter' : f.k}: ${f.v}`).join('. ')}.</p>
        <p>{hero.seen} {hero.seenSub}</p>
      </div>
      <div className="hero-stage">
        <Particles className="hero-dust" />
        
        <div className="portal" aria-hidden />

        <Drum items={drumLeft} side="left" />
        <Drum items={drumRight} side="right" />

        {/* A — intent */}
        <div className="ph ph-a">
          <div className="ph-a-in">
            <h1 className="h1 display" aria-label={`${hero.h1a} ${hero.h1b}`}>
              <Split text={hero.h1a} className="h1a" mode="gsap" />
              <Split text={hero.h1b} className="h1b" mode="gsap" em="agent" />
            </h1>
            <p className="a-sub lede">{hero.sub}</p>
            <div className="a-act">
              <button type="button" className="cta-split" data-magnetic data-cursor="connect" onClick={() => scrollToId('connect')}>
                <span className="cta-l">{hero.cta}</span>
                <span className="cta-r" aria-hidden><ArrowDown size={16} /></span>
              </button>
              <CmdBlock cmd={hero.connectCmd} disabled={brand.launched ? undefined : 'at launch'} />
            </div>
          </div>
          <div className="a-right">
          <div className="chain-wrap"><ChainMark /></div>
          <div className="a-panel"><TerminalDemo /></div>
          </div>
        </div>

        {/* B — every edit waits */}
        <div className="ph ph-b">
          <div className="ring" aria-hidden />
          <Split as="h2" text={hero.waits} className="b-h h2 display" mode="gsap" em="key" />
          <p className="mono b-sub">{hero.waitsSub}</p>
          <div className="b-key">
            <div className="keycap-host">
              <button type="button" className="keycap" data-cursor="approve" onClick={pressY} aria-label={`Approve. Pressed ${presses} times`}>
                <span className="kc-top">Y</span><span className="kc-sub mono">approve</span>
              </button>
            </div>
            <span className="mono press">press it {presses > 0 && <b>· {presses}×</b>}</span>
          </div>
        </div>

        {/* C — measured */}
        <div className="ph ph-c" aria-hidden>
          <h2 className="c-track display" aria-label={hero.measured}><span aria-hidden>Built to be measured, <em>not promised.</em></span></h2>
          <p className="c-sub mono">{hero.measuredSub}</p>
        </div>

        {/* D — keys + facts */}
        <div className="ph ph-d" aria-hidden>
          <Split as="h2" text={hero.keys} className="d-h h2 display" mode="gsap" />
          <ul className="facts">
            {facts.map((f) => (
              <li key={f.v} className="fact">
                <span className="fact-k display">{f.live ? <Odometer value={block} /> : f.k}</span>
                <span className="fact-v mono">{f.v}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* E — seen */}
        <div className="ph ph-e" aria-hidden>
          <Split as="h2" text={hero.seen} className="e-h h2 display" mode="gsap" em="seen" />
          <p className="e-sub mono"><span className="eye" aria-hidden><span className="eye-pupil" /></span> {hero.seenSub}</p>
          <p className="e-cue mono">{hero.cue}</p>
        </div>

        <div className="veil" aria-hidden />

        <button type="button" className="skip mono" onClick={skip}>skip the story ↓</button>
      </div>
    </section>
  );
}

