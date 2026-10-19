// Large deck responsiveness: 40 slides, then time editing interactions that
// re-render the editor (nudging an element, typing speaker notes, switching
// slides). Budgets are generous; they catch regressions, not tune.

import { createDeck } from '../flows.mjs';

export const options = { nested: true };

const SLIDES = 40;

export default async function perf(ctx) {
  const { page, f, step } = ctx;
  await createDeck(ctx);
  const timed = async (fn) => {
    const t0 = Date.now();
    await fn();
    // Let React commit and the browser paint.
    await f.locator('body').evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    return Date.now() - t0;
  };
  const report = (label, ms, n) => console.log(`     ${label}: ${ms} ms total, ${(ms / n).toFixed(1)} ms each`);

  await step(`build a ${SLIDES}-slide deck`, async () => {
    await f.locator('.slide-item').first().locator('.slide-thumbnail-btn').click();
    for (let i = 2; i < SLIDES; i++) await page.keyboard.press('Control+d');
    const n = await f.locator('.slide-item').count();
    if (n !== SLIDES) throw new Error('slides ' + n);
  });

  await step('nudging an element stays fast', async () => {
    await f.locator('.slide-item').first().locator('.slide-thumbnail-btn').click();
    await f.locator('.canvas-slide > [data-node-type="text"]').first().click();
    const n = 30;
    const ms = await timed(async () => {
      for (let i = 0; i < n; i++) await page.keyboard.press('ArrowRight');
    });
    report('nudge', ms, n);
    if (ms / n > 60) throw new Error(`${(ms / n).toFixed(1)} ms per nudge`);
  });

  await step('typing speaker notes stays fast', async () => {
    const notes = f.locator('.speaker-notes');
    await notes.click();
    const text = 'Notas largas para medir el tecleo';
    const ms = await timed(() => notes.pressSequentially(text));
    report('notes', ms, text.length);
    if (ms / text.length > 60) throw new Error(`${(ms / text.length).toFixed(1)} ms per key`);
  });

  await step('walking the deck stays fast', async () => {
    await f.locator('.slide-item').first().locator('.slide-thumbnail-btn').click();
    const n = 20;
    const ms = await timed(async () => {
      for (let i = 0; i < n; i++) await page.keyboard.press('ArrowDown');
    });
    report('next slide', ms, n);
    if (ms / n > 120) throw new Error(`${(ms / n).toFixed(1)} ms per slide`);
  });
}
