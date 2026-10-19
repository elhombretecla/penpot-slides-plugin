// Controls a screen reader could not name: buttons and fields without text,
// label, title or aria-label. Returns short descriptions of the offenders.
export function unnamedControls(f) {
  return f.locator('body').evaluate(() => {
    const named = (el) => {
      if (el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('aria-labelledby')) return true;
      if (el.tagName === 'BUTTON') return (el.textContent ?? '').trim().length > 0;
      if (el.id && document.querySelector(`label[for="${el.id}"]`)) return true;
      if (el.closest('label')) return true;
      if (el.getAttribute('placeholder')) return true;
      return false;
    };
    const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    return [...document.querySelectorAll('button, input:not([type=hidden]), select, textarea')]
      .filter((el) => visible(el) && !named(el))
      .map((el) => `${el.tagName.toLowerCase()}.${[...el.classList].join('.')} "${(el.outerHTML).slice(0, 80)}"`);
  });
}
