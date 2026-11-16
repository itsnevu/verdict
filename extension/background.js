// Fetches verdicts for the content script. Runs in the extension, so no CORS and no API key in pages.
const DEFAULT_API = 'https://verdictagent.xyz';
const ADDR = /^0x[0-9a-fA-F]{40}$/;

async function apiBase() {
  const { api } = await chrome.storage.sync.get('api');
  return (api || DEFAULT_API).replace(/\/$/, '');
}

/** DexScreener page URLs carry the pair, not the token: resolve the base token first. */
async function resolveToken({ chain, pair, token }) {
  if (token && ADDR.test(token)) return token.toLowerCase();
  if (!pair) return null;
  const r = await fetch(`https://api.dexscreener.com/latest/dex/pairs/${chain}/${pair}`);
  const b = await r.json();
  return b?.pairs?.[0]?.baseToken?.address?.toLowerCase() ?? b?.pair?.baseToken?.address?.toLowerCase() ?? null;
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type !== 'verdict') return false;
  (async () => {
    try {
      if (msg.chain && msg.chain !== 'robinhood') return reply({ error: 'VERDICT scores Robinhood Chain tokens for now' });
      const token = await resolveToken(msg);
      if (!token) return reply({ error: 'no token on this page' });
      const r = await fetch(`${await apiBase()}/v1/scan/${token}`, { headers: { 'x-agent-id': 'browser-extension' } });
      reply(await r.json());
    } catch (e) {
      reply({ error: 'VERDICT API not reachable' });
    }
  })();
  return true; // async reply
});
