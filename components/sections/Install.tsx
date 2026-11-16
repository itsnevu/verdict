'use client';
import { useState } from 'react';
import dynamic from 'next/dynamic';
import { ArrowUpRight } from 'lucide-react';
import Split from '../fx/Split';
import { CmdBlock, Kicker, Tabs } from '../fx/Ui';
import { brand, installSteps, installTabs } from '@/lib/content';

const LockMark = dynamic(() => import('../LockMark'), { ssr: false });

export default function Install() {
  const keys = Object.keys(installTabs);
  const [k, setK] = useState(keys[0]);

  return (
    <section id="install" className="sec install">
      <div className="ins-l">
        <div className="lock-wrap"><LockMark /></div>
        <Kicker n="08">install</Kicker>
        <Split as="h2" text="One line to connect your agent." className="h2 display" em="agent" />
        <p className="lede" data-reveal>Works in Claude Code, Codex, Cursor, Droid and any MCP client. Read-only tools need no key. Nothing is ever signed for you.</p>
        {brand.repo && (
        <a className="repo card" href={`https://${brand.repo}`} target="_blank" rel="noreferrer" data-reveal>
            <span className="mono dim">repository</span><b className="mono">{brand.repo}</b>
            <span className="mono dim">MIT · {brand.version} · {brand.launched ? 'signed releases' : 'pre-launch'}</span><ArrowUpRight size={18} aria-hidden className="repo-a" />
          </a>
        )}
      </div>
      <div className="ins-r card" data-reveal>
        <Tabs options={keys} value={k} onChange={setK} label="Platform" idBase="ins" />
        <div id="ins-panel" role="tabpanel" aria-labelledby={`ins-tab-${keys.indexOf(k)}`}>
          <CmdBlock cmd={installTabs[k]} disabled={brand.launched ? undefined : 'at launch'} />
          {!brand.launched && <p className="mono dim note">installer ships with the first signed release</p>}
        </div>
        <ol className="ins-steps">
          {installSteps.map((s, i) => <li key={s}><span className="display">{i + 1}</span><p>{s}</p></li>)}
        </ol>
      </div>
    </section>
  );
}
