/* Theme toggle: romantic <-> minimal, cross-faded with the View Transitions API. */
(() => {
  'use strict';
  const root = document.documentElement;
  const meta = document.querySelector('meta[name="theme-color"]');
  const buttons = document.querySelectorAll('[data-theme-set]');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const COLORS = { romantic: '#fdf9f3', minimal: '#fafaf7' };

  if (!document.startViewTransition) root.classList.add('no-vt');

  function apply(theme) {
    root.dataset.theme = theme;
    buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.themeSet === theme)));
    if (meta) meta.content = COLORS[theme];
    document.dispatchEvent(new CustomEvent('themechange', { detail: theme }));
  }

  function set(theme) {
    if (theme === root.dataset.theme) return;
    // Cookie so the server renders the right theme next time (works in incognito until it's closed)
    document.cookie = `theme=${theme}; max-age=31536000; path=/; samesite=lax`;
    if (document.startViewTransition && !reduce.matches) document.startViewTransition(() => apply(theme));
    else apply(theme);
  }

  buttons.forEach((b) => b.addEventListener('click', () => set(b.dataset.themeSet)));
})();
