'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { gsap } from 'gsap';
import { Lock, Volume2, VolumeX } from 'lucide-react';
import Split from '../fx/Split';
import { Kicker, SectionNum, Segmented } from '../fx/Ui';
import { badges, brand, missions, type Mission, type Step } from '@/lib/content';
import { fakeHash, save, store, useBlock } from '@/lib/runtime';

type Mode = 'ask' | 'edits' | 'auto';
type Line = { k: string; t: string; cls?: string; diff?: string[]; struck?: boolean };
const MODES: readonly Mode[] = ['ask', 'edits', 'auto'];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let actx: AudioContext | null = null;
function tone(freq: number, dur = 0.07, type: OscillatorType = 'square') {
  try {
    actx ??= new AudioContext();
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0.06, actx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur);
    o.connect(g).connect(actx.destination); o.start(); o.stop(actx.currentTime + dur);
  } catch { /* audio unavailable */ }
}

const needsGate = (s: Step, mode: Mode, always: boolean) =>
  !always && mode !== 'auto' && ((s.t === 'edit' && mode === 'ask') || s.t === 'run');

export default function Arcade() {
  const [mode, setMode] = useState<Mode>('ask');
  const [lines, setLines] = useState<Line[]>([{ k: 'sys', t: `${brand.slug} ready · mode ask · pick a mission or type an intent` }]);
  const [gate, setGate] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [unlocked, setUnlocked] = useState<string[]>([]);
  const [done, setDone] = useState<string[]>([]);
  const [fresh, setFresh] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const block = useBlock();

  const resolver = useRef<((v: 'y' | 'n' | 'a') => void) | null>(null);
  const token = useRef(0);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const body = useRef<HTMLDivElement>(null);
  const section = useRef<HTMLElement>(null);
  const termRef = useRef<HTMLDivElement>(null);
  const [sound, setSound] = useState(false);
  const soundRef = useRef(false);
  soundRef.current = sound;
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => { setSound(store<boolean>('verdict-sound', false)); }, []);
  useEffect(() => {
    if (startedAt === null) return;
    const id = setInterval(() => setElapsed((performance.now() - startedAt) / 1000), 100);
    return () => clearInterval(id);
  }, [startedAt]);
  const beep = (f: number, d?: number) => { if (soundRef.current) tone(f, d); };
  const shake = () => { if (termRef.current) gsap.fromTo(termRef.current, { x: -10 }, { x: 0, duration: 0.6, ease: 'elastic.out(1.2, 0.25)' }); };
  const confetti = () => {
    const host = termRef.current;
    if (!host || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const colors = ['var(--vermilion)', 'var(--ink)', 'var(--acid)', 'var(--cobalt)'];
    for (let i = 0; i < 36; i++) {
      const b = document.createElement('span');
      b.className = 'confetti';
      b.style.background = colors[i % colors.length];
      host.appendChild(b);
      gsap.fromTo(b, { x: host.clientWidth / 2, y: host.clientHeight - 60, rotate: 0, opacity: 1 },
        { x: `+=${(Math.random() - 0.5) * host.clientWidth * 0.9}`, y: `-=${200 + Math.random() * 260}`, rotate: Math.random() * 540, duration: 0.9 + Math.random() * 0.5, ease: 'power3.out',
          onComplete: () => { gsap.to(b, { y: '+=120', opacity: 0, duration: 0.6, ease: 'power2.in', onComplete: () => b.remove() }); } });
    }
  };

  useEffect(() => { setUnlocked(store<string[]>('verdict-badges', [])); setDone(store<string[]>('verdict-missions', [])); }, []);
  useEffect(() => { body.current?.scrollTo({ top: body.current.scrollHeight, behavior: 'smooth' }); }, [lines]);

  const unlock = useCallback((id: string) => {
    setUnlocked((u) => {
      if (u.includes(id)) return u;
      const n = [...u, id]; save('verdict-badges', n); setFresh(id); setTimeout(() => setFresh(null), 2200);
      return n;
    });
  }, []);

  const push = (l: Line) => setLines((ls) => [...ls.slice(-80), l]);
  const patchLast = (f: (l: Line) => Line) => setLines((ls) => [...ls.slice(0, -1), f(ls[ls.length - 1])]);

  const run = useCallback(async (m: Mission) => {
    const my = ++token.current;
    const alive = () => token.current === my;
    setRunning(m.id); setGate(false); setElapsed(0); setStartedAt(performance.now()); beep(440, 0.05);
    setLines([{ k: '›', t: m.title, cls: 'intent' }]);
    const t0 = performance.now();
    let always = false, approved = 0, declined = 0;
    await sleep(400); if (!alive()) return;
    push({ k: 'plan', t: m.steps.map((s) => s.t).join(' → '), cls: 'dim' });

    for (const s of m.steps) {
      await sleep(520); if (!alive()) return;
      push({ k: s.t, t: `${s.label}`, cls: `st-${s.t}` }); beep(880, 0.025);
      if (needsGate(s, modeRef.current, always)) {
        if (s.diff) push({ k: '', t: '', diff: s.diff });
        push({ k: 'gate', t: '[Y] approve   [N] decline   [A] always', cls: 'gate' });
        setGate(true);
        const v = await new Promise<'y' | 'n' | 'a'>((res) => { resolver.current = res; });
        setGate(false); resolver.current = null;
        if (!alive()) return;
        patchLast((l) => ({ ...l, t: v === 'n' ? 'N · declined' : v === 'a' ? 'A · always for this run' : 'Y · approved', cls: v === 'n' ? 'bad' : 'ok' }));
        if (v === 'n') {
          declined++; unlock('guardian'); shake(); beep(120, 0.18);
          setLines((ls) => ls.map((l, i) => (i === ls.length - 2 && l.diff ? { ...l, struck: true } : l)));
          push({ k: '↩', t: 'reverted · step skipped', cls: 'bad' });
          continue;
        }
        approved++; unlock('first'); beep(660, 0.08);
        if (v === 'a') always = true;
      } else if (s.diff) {
        push({ k: '', t: '', diff: s.diff });
      }
      await sleep(360); if (!alive()) return;
      push({ k: '✓', t: s.out, cls: 'ok' });
    }
    const secs = (performance.now() - t0) / 1000;
    setStartedAt(null); setElapsed(secs);
    if (approved || !declined) { confetti(); beep(523, 0.08); setTimeout(() => beep(784, 0.12), 90); }
    push({ k: '■', t: approved || !declined ? `commit ready · ${secs.toFixed(1)} s` : `nothing committed · ${secs.toFixed(1)} s`, cls: approved || !declined ? 'done' : 'bad' });
    if (!declined) unlock('clean');
    if (secs < 20) unlock('speed');
    setDone((d) => {
      const n = d.includes(m.id) ? d : [...d, m.id];
      save('verdict-missions', n);
      if (missions.every((x) => n.includes(x.id))) unlock('full');
      return n;
    });
    setRunning(null);
  }, [unlock]);

  const answer = useCallback((v: 'y' | 'n' | 'a') => resolver.current?.(v), []);

  // keyboard: 1/2/3 start, y/n/a answer — only while the arcade is on screen and not typing
  useEffect(() => {
    let inView = false;
    const io = new IntersectionObserver(([e]) => { inView = e.isIntersecting; }, { threshold: 0.25 });
    if (section.current) io.observe(section.current);
    const onKey = (e: KeyboardEvent) => {
      if (!inView || e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const k = e.key.toLowerCase();
      if (resolver.current && (k === 'y' || k === 'n' || k === 'a')) { e.preventDefault(); answer(k); return; }
      const m = missions.find((x) => x.key === k);
      if (m) { e.preventDefault(); run(m); }
    };
    addEventListener('keydown', onKey);
    return () => { io.disconnect(); removeEventListener('keydown', onKey); };
  }, [answer, run]);

  const custom = (e: React.FormEvent) => {
    e.preventDefault();
    const t = input.trim();
    if (!t) return;
    setInput('');
    const slug = t.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24).replace(/-$/, '') || 'task';
    run({
      id: `custom-${slug}`, key: '', title: t, brief: '',
      steps: [
        { t: 'read', label: `verdict_scan_token for "${t.split(' ').slice(-1)[0]}"`, out: 'score 64 · WATCH · confidence 0.7' },
        { t: 'search', label: 'holders, liquidity, deployer', out: 'no red flags · deployer has 2 healthy tokens' },
        { t: 'edit', label: 'prepare the transaction', out: 'simulated ok', diff: [`- intent  ${t}`, '+ tx      ready for your wallet'] },
        { t: 'run', label: 'send to your wallet for signature', out: 'signed by you' },
        { t: 'verify', label: 'verdict_attest_token', out: 'verdict recorded onchain ✓' },
      ],
    });
  };

  return (
    <section id="execute" ref={section} className="sec arcade">
      <SectionNum n="03" />
      <div className="sec-head">
        <Kicker n="03">execution arcade</Kicker>
        <Split as="h2" text="Give it an intent. You hold the keys." className="h2 display" em="keys" />
        <p className="lede" data-reveal>Pick a mission or type your own. Your agent reads the chain, VERDICT judges it, and every transaction stops at your key. Change the mode to move the gate.</p>
      </div>

      <div className="arcade-grid">
        <div className="term panel" data-reveal ref={termRef}>
          <div className="term-feed mono" aria-hidden>
            <span>#{block.toLocaleString('en-US')}</span><span>0x{fakeHash(block, 8)}…{fakeHash(block + 7, 4)}</span><span className="ok">demo feed</span>
          </div>
          <div className="term-bar">
            <span className="mono term-path">claude code · verdict mcp</span>
            <span className={`mono timer ${startedAt !== null ? 'is-run' : ''} ${elapsed > 0 && elapsed < 20 && startedAt === null ? 'is-fast' : ''}`} aria-label={`elapsed ${elapsed.toFixed(1)} seconds`}>
              {elapsed.toFixed(1)}s <span className="dim">/ 20.0</span>
            </span>
            <Segmented options={MODES} value={mode} onChange={setMode} label="Approval mode" />
            <button type="button" className="icon-btn sm" aria-pressed={sound} aria-label={sound ? 'Sound on' : 'Sound off'} onClick={() => { const n = !sound; setSound(n); save('verdict-sound', n); if (n) tone(660, 0.06); }}>
              {sound ? <Volume2 size={13} aria-hidden /> : <VolumeX size={13} aria-hidden />}
            </button>
          </div>
          <div className="term-body mono" ref={body} aria-live="polite" data-lenis-prevent>
            {lines.map((l, i) =>
              l.diff ? (
                <div key={i} className={`diff ${l.struck ? 'is-struck' : ''}`}>
                  {l.diff.map((d, j) => <div key={j} className={d.startsWith('+') ? 'add' : 'del'}>{d}</div>)}
                </div>
              ) : (
                <div key={i} className={`tl ${l.cls ?? ''}`}><span className="tl-k">{l.k}</span><span>{l.t}</span></div>
              ),
            )}
            {gate && (
              <div className="gate-btns">
                <button type="button" className="kc kc-y" data-cursor="approve" onClick={() => answer('y')}>Y<span>approve</span></button>
                <button type="button" className="kc" onClick={() => answer('n')}>N<span>decline</span></button>
                <button type="button" className="kc" onClick={() => answer('a')}>A<span>always</span></button>
              </div>
            )}
          </div>
          <form className="term-in" onSubmit={custom}>
            <label htmlFor="intent" className="mono" aria-hidden>›</label>
            <input id="intent" className="mono" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Type your own intent" aria-label="Type your own intent" autoComplete="off" />
            <button type="submit" className="mono run-btn">run ↵</button>
          </form>
        </div>

        <div className="arcade-side">
          <div className="card" data-reveal>
            <p className="card-h mono">Missions</p>
            <ul className="missions">
              {missions.map((m) => (
                <li key={m.id}>
                  <button type="button" className={`mission ${running === m.id ? 'is-run' : ''}`} data-cursor="play" onClick={() => run(m)} aria-pressed={running === m.id}>
                    <span className="kc kc-sm" aria-hidden>{m.key}</span>
                    <span className="mission-t"><b>{m.title}</b><span className="mono">{m.brief}</span></span>
                    {done.includes(m.id) && <span className="mono ok mission-d">done</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div className="card" data-reveal>
            <p className="card-h mono">Run</p>
            <ul className="legend mono">
              <li><span className="kc kc-sm kc-y">Y</span> approve this change</li>
              <li><span className="kc kc-sm">N</span> decline and revert</li>
              <li><span className="kc kc-sm">A</span> always, for this run</li>
            </ul>
          </div>
          <div className="card" data-reveal>
            <p className="card-h mono">Badges <span className="dim">{unlocked.length}/{badges.length}</span></p>
            <ul className="badges">
              {badges.map((b) => {
                const on = unlocked.includes(b.id);
                return (
                  <motion.li key={b.id} className={`badge ${on ? 'is-on' : ''}`} title={b.hint}
                    animate={fresh === b.id ? { scale: [1, 1.25, 1], rotate: [0, -6, 0] } : {}} transition={{ duration: 0.6 }}>
                    <span className="badge-i" aria-hidden>{on ? '◆' : <Lock size={12} />}</span>
                    <span className="mono">{b.name}</span>
                    <span className="sr-only">{on ? 'unlocked' : `locked: ${b.hint}`}</span>
                  </motion.li>
                );
              })}
            </ul>
            <AnimatePresence>
              {fresh && (
                <motion.p className="badge-toast mono" role="status" initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -12, opacity: 0 }}>
                  unlocked · {badges.find((b) => b.id === fresh)?.name}
                </motion.p>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </section>
  );
}
