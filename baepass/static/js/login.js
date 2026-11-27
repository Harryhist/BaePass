/* PIN screen: keypad, dots, auto-submit, shake on error, lockout countdown. */
(() => {
  'use strict';
  const root = document.documentElement;
  const csrf = document.querySelector('meta[name="csrf-token"]').content;
  const card = document.getElementById('card');
  const dotsEl = document.getElementById('dots');
  const dots = [...dotsEl.children];
  const hint = document.getElementById('hint');
  const hintDyn = document.getElementById('hint-dyn');
  const keypad = document.getElementById('keypad');
  const keys = [...keypad.querySelectorAll('button.key')];
  const lockbar = document.getElementById('lockbar');
  const lockTitle = document.getElementById('lock-title');
  const lockText = document.getElementById('lock-text');
  const theme = () => root.dataset.theme;

  const COPY = {
    romantic: {
      wrong: (n) => `Oops Shona, wrong PIN. ${n} ${n === 1 ? 'try' : 'tries'} left`,
      ok: 'Welcome in, Bae 💕',
      lockTitle: 'Passcode locked',
      lock: (t) => `Too many tries, Bae. Try again in ${t}`,
      rate: 'Slow down, Boochoo. Try again in a minute.',
      csrf: 'This page expired. Refresh and try again.',
      net: "Couldn't reach the server. Try again.",
    },
    minimal: {
      wrong: (n) => `Wrong PIN. ${n} attempt${n === 1 ? '' : 's'} left.`,
      ok: 'Unlocked',
      lockTitle: 'Passcode locked',
      lock: (t) => `Too many attempts. Try again in ${t}.`,
      rate: 'Too many requests. Try again in a minute.',
      csrf: 'This page expired. Refresh and try again.',
      net: "Couldn't reach the server. Try again.",
    },
  };

  let pin = '';
  let busy = false;
  let lockUntil = 0;
  let lockTimer = null;
  let hintState = null; // { key, arg, tone }

  const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  function paintDots() {
    dots.forEach((d, i) => d.classList.toggle('on', i < pin.length));
  }

  function setHint(state) {
    hintState = state;
    renderHint();
  }

  function renderHint() {
    const c = COPY[theme()];
    hint.classList.remove('bad', 'good');
    if (!hintState) { hint.classList.remove('has-dyn'); hintDyn.textContent = ''; return; }
    const { key, arg, tone } = hintState;
    hintDyn.textContent = typeof c[key] === 'function' ? c[key](arg) : c[key];
    hint.classList.add('has-dyn');
    if (tone) hint.classList.add(tone);
  }

  function setKeys(enabled) {
    keys.forEach((k) => { k.disabled = !enabled; });
  }

  function renderLock() {
    const left = Math.max(0, Math.ceil((lockUntil - Date.now()) / 1000));
    const c = COPY[theme()];
    lockTitle.textContent = c.lockTitle;
    lockText.textContent = c.lock(fmt(left));
    if (left <= 0) endLock();
  }

  function startLock(seconds) {
    lockUntil = Date.now() + seconds * 1000;
    lockbar.hidden = false;
    pin = ''; paintDots(); setKeys(false); setHint(null);
    clearInterval(lockTimer);
    renderLock();
    lockTimer = setInterval(renderLock, 1000);
  }

  function endLock() {
    clearInterval(lockTimer);
    lockbar.hidden = true;
    lockUntil = 0;
    setKeys(true);
  }

  function shake(message) {
    dotsEl.classList.remove('shake');
    void dotsEl.offsetWidth; // restart animation
    dotsEl.classList.add('shake', 'bad');
    if (navigator.vibrate) navigator.vibrate(60);
    setHint(message);
    setTimeout(() => {
      pin = ''; paintDots();
      dotsEl.classList.remove('shake', 'bad');
      setKeys(true); busy = false;
    }, 520);
  }

  async function submit() {
    busy = true;
    setKeys(false);
    try {
      const r = await fetch('/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
        body: JSON.stringify({ pin }),
      });
      const d = await r.json().catch(() => ({}));
      if (d.ok) {
        dotsEl.classList.add('good');
        setHint({ key: 'ok', tone: 'good' });
        setTimeout(() => location.replace('/'), 450);
        return;
      }
      if (d.status === 'locked') { busy = false; startLock(d.seconds || 900); return; }
      if (d.status === 'wrong') return shake({ key: 'wrong', arg: d.left, tone: 'bad' });
      if (d.status === 'rate') return shake({ key: 'rate', tone: 'bad' });
      if (d.status === 'csrf') return shake({ key: 'csrf', tone: 'bad' });
      shake({ key: 'net', tone: 'bad' });
    } catch (e) {
      shake({ key: 'net', tone: 'bad' });
    }
  }

  function press(k) {
    if (busy || lockUntil) return;
    if (k === 'del') { pin = pin.slice(0, -1); }
    else if (pin.length < 4) { pin += k; }
    if (hintState) setHint(null);
    paintDots();
    if (pin.length === 4) submit();
  }

  keypad.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-k]');
    if (b && !b.disabled) press(b.dataset.k);
  });

  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^\d$/.test(e.key)) press(e.key);
    else if (e.key === 'Backspace') press('del');
  });

  document.addEventListener('themechange', () => {
    renderHint();
    if (lockUntil) renderLock();
  });

  const initial = parseInt(card.dataset.locked, 10) || 0;
  if (initial > 0) startLock(initial);
})();
