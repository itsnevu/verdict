// Reads the token from the page URL and shows its verdict in a small, dismissible card.
(() => {
  const ADDR = /0x[0-9a-fA-F]{40}/;
  function target() {
    const u = new URL(location.href);
    if (u.hostname === 'dexscreener.com') {
      const [chain, pair] = u.pathname.split('/').filter(Boolean);
      return chain && pair ? { chain, pair } : null;
    }
    if (u.hostname === 'app.uniswap.org') {
      const parts = u.pathname.split('/').filter(Boolean);
      const i = parts.indexOf('tokens');
      if (i >= 0 && parts[i + 2]) return { chain: parts[i + 1], token: parts[i + 2] };
      const out = u.searchParams.get('outputCurrency');
      if (out && ADDR.test(out)) return { chain: u.searchParams.get('chain') || 'robinhood', token: out };
    }
    return null;
  }

  let last = '';
  function render(data) {
    document.getElementById('verdict-card')?.remove();
    const card = document.createElement('div');
    card.id = 'verdict-card';
    card.setAttribute('role', 'status');
    const v = data && data.data;
    const bad = v && (v.label === 'COLLAPSING' || v.label === 'DEAD' || v.label === 'DECAYING');
    card.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;max-width:320px;padding:14px 16px;background:#0E0C0A;color:#F1ECE3;font:13px/1.45 ui-monospace,monospace;border:2px solid ' + (bad ? '#FF3B12' : '#F1ECE3') + ';box-shadow:6px 6px 0 #FF3B12';
    const close = '<button aria-label="close" style="float:right;background:none;border:0;color:#F1ECE3;cursor:pointer;font-size:16px">×</button>';
    if (!v) {
      card.innerHTML = close + '<b>VERDICT</b><br><span style="opacity:.75"></span>';
      card.querySelector('span').textContent = (data && (data.error?.message || data.error)) || 'no verdict';
    } else {
      card.innerHTML = close + '<b>VERDICT</b> <span class="s"></span><div class="b" style="margin-top:6px;opacity:.85"></div>';
      card.querySelector('.s').textContent = `${v.symbol ?? ''} ${v.score} ${v.label} · conf ${v.confidence}`;
      card.querySelector('.b').textContent = data.brief || '';
    }
    card.querySelector('button').onclick = () => card.remove();
    document.body.appendChild(card);
  }

  function check() {
    const t = target();
    const key = JSON.stringify(t);
    if (!t || key === last) return;
    last = key;
    chrome.runtime.sendMessage({ type: 'verdict', ...t }, render);
  }
  check();
  // single-page apps change the URL without reloading
  setInterval(check, 1500);
})();
