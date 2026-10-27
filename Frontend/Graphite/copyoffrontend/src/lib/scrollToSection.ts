export function scrollToSection(id: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (window.location.hash !== `#${id}`) {
    window.history.replaceState(null, '', `#${id}`);
  }
  (el as HTMLElement).tabIndex = -1;
  (el as HTMLElement).focus({ preventScroll: true });
  el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
}