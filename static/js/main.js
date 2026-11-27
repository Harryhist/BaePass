/* Main screen: verify button, result panel, cooldown, greeting rotation, heart burst. */
(() => {
  'use strict';
  const root = document.documentElement;
  const $ = (s) => document.querySelector(s);
  const csrf = $('meta[name="csrf-token"]').content;
  const card = $('#card');
  const cta = $('#cta');
  const result = $('#result');
  const res = $('#res');
  const again = $('#again');
  const chatLink = $('#chat-link');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const theme = () => root.dataset.theme;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const COPY = {
    romantic: {
      chip: { ok: 'Verified', none: 'Waiting for mail', error: 'Mailbox hiccup' },
      cta: {
        loading: ['Hang on Bae, working on it...', 'Checking the mailbox for your link'],
        success: ['Done, Boochoo!', 'Go talk to me 💕'],
      },
      res: {
        success: { kind: 'ok', icon: 'check', t: "You're in, Shona!", p: 'Your login is verified. Go open the chat and talk to me.' },
        none: { kind: 'none', icon: 'mail', t: 'Still waiting for that mail', p: "No new login email yet, Shona. Log in to the chat site again, then check back and I'll catch it." },
        error: { kind: 'error', icon: 'alert', t: "Couldn't reach the mailbox", p: 'Something went wrong on my side, Bae. Give it a minute and try again.' },
        rate: { kind: 'error', icon: 'alert', t: 'Easy, Boochoo', p: 'Too many taps in a row. Wait a minute, then try again.' },
        csrf: { kind: 'error', icon: 'alert', t: 'This page got sleepy', p: 'Refresh the page, Bae, then try again.' },
      },
      again: (n) => (n > 0 ? `Check again in ${n}s` : 'Check again'),
      chat: 'Open the chat',
      last: (a) => `Last verified: ${a}`,
      never: 'Not verified yet',
      greetings: ['Hey Shona', 'Hi Boochoo', 'Welcome back, Bae'],
    },
    minimal: {
      chip: { ok: 'Verified', none: 'No email yet', error: 'Error' },
      cta: {
        loading: ['Verifying...', 'Checking for your login email'],
        success: ["You're verified.", 'You can chat now.'],
      },
      res: {
        success: { kind: 'ok', icon: 'check', t: "You're verified", p: 'You can chat now.' },
        none: { kind: 'none', icon: 'mail', t: 'No new email yet', p: 'Log in to the chat site, then check again.' },
        error: { kind: 'error', icon: 'alert', t: "Couldn't verify", p: 'Something went wrong. Try again in a minute.' },
        rate: { kind: 'error', icon: 'alert', t: 'Too many attempts', p: 'Wait a minute, then try again.' },
        csrf: { kind: 'error', icon: 'alert', t: 'Page expired', p: 'Refresh the page, then try again.' },
      },
      again: (n) => (n > 0 ? `Check again in ${n}s` : 'Check again'),
      chat: 'Open chat',
      last: (a) => `Last verified: ${a}`,
      never: 'Not verified yet',
      greetings: ['Welcome back'],
    },
  };

  let busy = false;
  let resultKey = null;     // key into COPY[theme].res
  let cooldown = 0;
  let cdTimer = null;
  let successTimer = null;
  let lastISO = card.dataset.last || '';

  /* ---------- rendering (called on every state or theme change) ---------- */
  function pop(el) {
    if (reduce.matches) return;
    el.classList.remove('pop');
    void el.offsetWidth;
    el.classList.add('pop');
  }

  function render() {
    const c = COPY[theme()];
    const state = card.dataset.state;

    if (state === 'loading' || state === 'success') {
      $('#cta-l').textContent = c.cta[state][0];
      $('#cta-s').textContent = c.cta[state][1];
    }

    const rc = resultKey && c.res[resultKey];
    if (rc) {
      $('#chip-dyn').textContent = c.chip[rc.kind];
      $('#res-t').textContent = rc.t;
      $('#res-p').textContent = rc.p;
      $('#res-use').setAttribute('href', `#i-${rc.icon}`);
      res.dataset.kind = rc.kind;
      again.hidden = rc.kind === 'ok';
      if (chatLink) { chatLink.hidden = rc.kind !== 'ok'; $('#chat-t').textContent = c.chat; }
    }

    $('#again-t').textContent = c.again(cooldown);
    again.disabled = cooldown > 0;
    renderLast();
  }

  function setState(s) {
    card.dataset.state = s;
    cta.disabled = s === 'loading';
    cta.setAttribute('aria-busy', String(s === 'loading'));
    render();
    if (s !== 'idle') { pop($('#cta-l')); pop($('#cta-s')); }
  }

  function showResult(key) {
    resultKey = key;
    const kind = COPY[theme()].res[key].kind;
    card.dataset.result = kind;
    render();
    pop($('#chip-dyn'));
    result.classList.add('open');
  }

  function hideResult() {
    result.classList.remove('open');
    delete card.dataset.result;
    resultKey = null;
  }

  /* ---------- last verified ---------- */
  function ago(iso) {
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 45) return 'just now';
    if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return `${Math.round(s / 86400)} d ago`;
  }
  function renderLast() {
    const c = COPY[theme()];
    $('#last-t').textContent = lastISO ? c.last(ago(lastISO)) : c.never;
  }

  /* ---------- cooldown for "check again" ---------- */
  function startCooldown(n) {
    clearInterval(cdTimer);
    cooldown = n;
    render();
    cdTimer = setInterval(() => {
      cooldown -= 1;
      if (cooldown <= 0) { cooldown = 0; clearInterval(cdTimer); }
      render();
    }, 1000);
  }

  /* ---------- heart burst (romantic) ---------- */
  function burst() {
    if (reduce.matches || theme() !== 'romantic') return;
    const layer = $('#burst');
    const frag = document.createDocumentFragment();
    for (let i = 0; i < 16; i++) {
      const a = (Math.PI * 2 * i) / 16 + Math.random() * 0.4;
      const dist = 70 + Math.random() * 90;
      const wrap = document.createElement('span');
      wrap.innerHTML = '<svg class="bh"><use href="#i-heart"/></svg>';
      const h = wrap.firstChild;
      h.style.setProperty('--dx', `${Math.cos(a) * dist * 1.4}px`);
      h.style.setProperty('--dy', `${Math.sin(a) * dist - 20}px`);
      h.style.setProperty('--rot', `${(Math.random() - 0.5) * 80}deg`);
      h.style.setProperty('--s', `${0.7 + Math.random() * 0.9}`);
      frag.appendChild(h);
    }
    layer.appendChild(frag);
    setTimeout(() => { layer.textContent = ''; }, 1300);
  }

  /* ---------- verify ---------- */
  async function verify() {
    if (busy) return;
    busy = true;
    clearTimeout(successTimer);
    clearInterval(cdTimer);
    cooldown = 0;
    hideResult();
    setState('loading');

    const t0 = performance.now();
    let key = 'error';
    let data = {};
    try {
      const r = await fetch('/verify', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'X-CSRFToken': csrf, Accept: 'application/json' },
      });
      if (r.status === 401) { location.replace('/login'); return; }
      data = await r.json().catch(() => ({}));
      if (r.status === 429) key = 'rate';
      else if (r.status === 400 && data.status === 'csrf') key = 'csrf';
      else if (data.status === 'verified') key = 'success';
      else if (data.status === 'none') key = 'none';
    } catch (e) { /* network error -> 'error' */ }

    await sleep(Math.max(0, 750 - (performance.now() - t0))); // avoid a flash of "loading"

    if (key === 'success') {
      if (data.last_verified) lastISO = data.last_verified;
      setState('success');
      showResult('success');
      burst();
      successTimer = setTimeout(() => setState('idle'), 4500);
    } else {
      setState('idle');
      showResult(key);
      startCooldown(key === 'rate' ? 30 : 10);
    }
    busy = false;
  }

  cta.addEventListener('click', verify);
  again.addEventListener('click', verify);

  $('#logout').addEventListener('click', async () => {
    try {
      await fetch('/logout', { method: 'POST', credentials: 'same-origin', headers: { 'X-CSRFToken': csrf } });
    } finally { location.replace('/login'); }
  });

  /* ---------- greeting rotation (romantic, idle only) ---------- */
  const greet = $('#greet');
  let gi = 0;
  setInterval(() => {
    if (theme() !== 'romantic' || document.hidden || reduce.matches || card.dataset.state !== 'idle') return;
    greet.classList.add('out');
    setTimeout(() => {
      const list = COPY.romantic.greetings;
      gi = (gi + 1) % list.length;
      greet.textContent = list[gi];
      greet.classList.remove('out');
    }, 230);
  }, 4200);

  document.addEventListener('themechange', render);
  setInterval(() => { if (!document.hidden) renderLast(); }, 20000);
  renderLast();
})();
