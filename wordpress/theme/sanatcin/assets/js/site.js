(() => {
  const toggle = document.querySelector('.search-toggle');
  const panel = document.querySelector('.search-panel');
  toggle?.addEventListener('click', () => {
    const open = panel.classList.toggle('is-open');
    toggle.setAttribute('aria-expanded', String(open));
    if (open) panel.querySelector('input')?.focus();
  });

  const slides = [...document.querySelectorAll('.hero-slide')];
  const dots = [...document.querySelectorAll('.hero-dot')];
  if (!slides.length) return;
  let active = 0;
  let timer;

  const show = (index) => {
    active = (index + slides.length) % slides.length;
    slides.forEach((slide, i) => slide.classList.toggle('is-active', i === active));
    dots.forEach((dot, i) => dot.classList.toggle('is-active', i === active));
  };
  const restart = () => {
    clearInterval(timer);
    timer = setInterval(() => show(active + 1), 7000);
  };
  document.querySelector('[data-prev]')?.addEventListener('click', () => { show(active - 1); restart(); });
  document.querySelector('[data-next]')?.addEventListener('click', () => { show(active + 1); restart(); });
  dots.forEach((dot) => dot.addEventListener('click', () => { show(Number(dot.dataset.go)); restart(); }));
  restart();
})();

