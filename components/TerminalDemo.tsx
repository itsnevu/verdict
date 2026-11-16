'use client';
import { useEffect, useRef, useState } from 'react';
import { terminalDemo } from '@/lib/content';

type Line = { k: 'prompt' | 'tool' | 'out' | 'good' | 'bad' | 'ask' | 'yes' | 'no'; t: string };

/**
 * Looping terminal that shows what VERDICT adds to Claude Code: the agent wants to act
 * onchain, VERDICT scores the token and prepares the transaction, the user decides.
 * Purely illustrative; the scenarios live in lib/content.ts.
 */
export default function TerminalDemo() {
  const [shown, setShown] = useState<Line[]>([]);
  const [typing, setTyping] = useState('');
  const [scene, setScene] = useState(0);
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const s = terminalDemo[scene % terminalDemo.length]!;
    if (reduced) { setShown(s.lines as Line[]); return; }
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const wait = (ms: number) => new Promise<void>((r) => { timers.push(setTimeout(r, ms)); });
    let visible = true;
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; });
    if (host.current) io.observe(host.current);

    (async () => {
      setShown([]);
      for (const line of s.lines as Line[]) {
        while (!visible && !cancelled) await wait(400);
        if (cancelled) return;
        if (line.k === 'prompt') {
          for (let i = 1; i <= line.t.length; i++) { if (cancelled) return; setTyping(line.t.slice(0, i)); await wait(38); }
          setTyping('');
          setShown((x) => [...x, line]);
          await wait(450);
        } else {
          setShown((x) => [...x, line]);
          await wait(line.k === 'ask' ? 1300 : line.k === 'tool' ? 520 : 260);
        }
      }
      await wait(2600);
      if (!cancelled) setScene((n) => n + 1);
    })();
    return () => { cancelled = true; timers.forEach(clearTimeout); io.disconnect(); };
  }, [scene]);

  return (
    <div ref={host} className="tdemo" role="img" aria-label="Example: Claude Code asks VERDICT for a verdict before a swap, then waits for your approval.">
      <div className="tdemo-bar mono" aria-hidden>
        <span className="tdemo-dots"><i /><i /><i /></span>
        <span>claude code · verdict mcp</span>
      </div>
      <div className="tdemo-body mono" aria-hidden>
        {shown.map((l, i) => (
          <div key={`${scene}-${i}`} className={`tl-${l.k}`}>
            {l.k === 'prompt' && <span className="tdemo-ps">›</span>}
            {l.k === 'tool' && <span className="tdemo-dot">●</span>}
            {l.t}
          </div>
        ))}
        {typing && <div className="tl-prompt"><span className="tdemo-ps">›</span>{typing}<span className="tdemo-caret" /></div>}
        {!typing && <div className="tl-idle"><span className="tdemo-caret" /></div>}
      </div>
    </div>
  );
}
