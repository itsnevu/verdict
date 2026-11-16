import SmoothScroll from '@/components/fx/SmoothScroll';
import GlobalFx from '@/components/fx/GlobalFx';
import Splash from '@/components/Splash';
import Header from '@/components/Header';
import Hero from '@/components/sections/Hero';
import Marquee from '@/components/sections/Marquee';
import Capabilities from '@/components/sections/Capabilities';
import Connect from '@/components/sections/Connect';
import TryLive from '@/components/sections/TryLive';
import LiveStrip from '@/components/sections/LiveStrip';
import Arcade from '@/components/sections/Arcade';
import Toolkit from '@/components/sections/Toolkit';
import Onchain from '@/components/sections/Onchain';
import Roadmap from '@/components/sections/Roadmap';
import Install from '@/components/sections/Install';
import Footer from '@/components/sections/Footer';
import { brand } from '@/lib/content';

export default function Page() {
  return (
    <>
      <SmoothScroll />
      <GlobalFx />
      <Splash />
      <Header />
      <main>
        <Hero />
        <Marquee />
        <Capabilities />
        <Connect />
        <TryLive />
        <Arcade />
        <Toolkit />
        <LiveStrip fallback={['judge before you act', 'robinhood chain', 'claude code', 'codex', 'no custody', 'mcp']} />
        <Onchain />
        <Roadmap />
        <Install />
      </main>
      <Footer />
      <div className="noise" aria-hidden />
    </>
  );
}
