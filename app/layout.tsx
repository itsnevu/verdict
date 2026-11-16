import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Mono, IBM_Plex_Sans, Space_Grotesk } from 'next/font/google';
import './globals.css';

const display = Space_Grotesk({ subsets: ['latin'], weight: ['500', '700'], variable: '--font-display', display: 'swap' });
const body = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600'], style: ['normal', 'italic'], variable: '--font-body', display: 'swap' });
const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500', '700'], variable: '--font-mono', display: 'swap' });

export const metadata: Metadata = {
  title: 'VERDICT · Onchain powers for your agent',
  description: 'VERDICT plugs into Claude Code and Codex over MCP: read Robinhood Chain, judge tokens and wallets, prepare transactions. Every onchain action gets a verdict before you approve it.',
  metadataBase: new URL('https://verdictagent.xyz'),
  openGraph: { title: 'VERDICT · Onchain powers for your agent', description: 'MCP for Claude Code and Codex. Every onchain action gets a verdict before you approve it.', type: 'website' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [{ media: '(prefers-color-scheme: light)', color: '#F1ECE3' }, { media: '(prefers-color-scheme: dark)', color: '#0E0C0A' }],
};

const themeScript = `try{var t=localStorage.getItem('verdict-theme');if(t)document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light" className={`${display.variable} ${body.variable} ${mono.variable}`} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body>{children}</body>
    </html>
  );
}
