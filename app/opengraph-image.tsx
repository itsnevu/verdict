import { ImageResponse } from 'next/og';

export const alt = 'VERDICT: onchain powers for your agent';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
// rendered on request: prerendering next/og at build time fails on Windows (font URL resolution)
export const runtime = 'edge';

async function spaceGrotesk(): Promise<ArrayBuffer | null> {
  try {
    const css = await (await fetch('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@700', { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 6.1) AppleWebKit/533.21 (KHTML, like Gecko) Version/5.0 Safari/533.21' } })).text();
    const url = css.match(/src: url\((.+?)\) format\('(?:truetype|opentype)'\)/)?.[1];
    return url ? await (await fetch(url)).arrayBuffer() : null;
  } catch {
    return null;
  }
}

export default async function OgImage() {
  const font = await spaceGrotesk();
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', background: '#F1ECE3', color: '#0E0C0A', padding: 72, fontFamily: 'Space Grotesk' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, fontSize: 40, fontWeight: 800 }}>
          <svg width="64" height="64" viewBox="0 0 100 100">
            <defs>
              <linearGradient id="l" x1="0" y1="0" x2="0.55" y2="1"><stop offset="0" stopColor="#F4EFE8" /><stop offset="0.6" stopColor="#F1E4DA" /><stop offset="1" stopColor="#FF3B12" /></linearGradient>
            </defs>
            <rect width="100" height="100" rx="18" fill="#0E0C0A" />
            <path d="M65.7 21.7 H86 L57.8 78.3 L50 59.5 Z" fill="#FF3B12" />
            <path d="M14 21.7 H31.7 L57.8 78.3 H41.8 Z" fill="url(#l)" />
          </svg>
          VERDICT
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', fontSize: 112, fontWeight: 800, letterSpacing: -4, lineHeight: 0.95 }}>
          <span>Onchain powers</span>
          <span style={{ display: 'flex' }}>for your agent<span style={{ color: '#FF3B12' }}>.</span></span>
        </div>
        <div style={{ display: 'flex', fontSize: 28, color: '#57503F' }}>MCP for Claude Code and Codex · every onchain action gets a verdict first</div>
      </div>
    ),
    { ...size, ...(font ? { fonts: [{ name: 'Space Grotesk', data: font, weight: 700 as const, style: 'normal' as const }] } : {}) },
  );
}
