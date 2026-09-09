(() => {
  const toggle = document.querySelector('.search-toggle');
  const panel = document.querySelector('.search-panel');
  toggle?.addEventListener('click', () => {
    const open = panel.classList.toggle('is-open');
    toggle.setAttribute('aria-expanded', String(open));
    if (open) panel.querySelector('input')?.focus();
  });
  const menuToggle = document.querySelector('.menu-toggle');
  const menu = document.querySelector('.main-nav');
  menuToggle?.addEventListener('click', () => {
    const open = menu.classList.toggle('is-open');
    menuToggle.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    panel?.classList.remove('is-open');
    toggle?.setAttribute('aria-expanded', 'false');
    menu?.classList.remove('is-open');
    menuToggle?.setAttribute('aria-expanded', 'false');
  });
})();
