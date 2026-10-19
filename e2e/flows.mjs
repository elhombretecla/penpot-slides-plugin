// Shared opening of the suites: home → library gallery → a deck with the
// "Title slide" and "Image + text" layouts, rendered by the mock Penpot.

export async function createDeck({ page, f, step, shot }) {
  await page.waitForTimeout(1500);
  await step('home renders', async () => { await f.getByText('Presentations in this file').waitFor({ timeout: 5000 }); await f.getByText('Brand templates').first().waitFor(); });
  await shot('01-home');

  await step('open gallery from library', async () => { await f.getByText('From a template library').click(); await f.getByText('New presentation from a library').waitFor(); });
  await page.waitForTimeout(600);
  await step('gallery shows only slide layouts', async () => {
    const names = await f.locator('.component-name').allTextContents();
    if (names.includes('logo')) throw new Error('asset shown in layouts: ' + names.join(','));
    if (names.length !== 3) throw new Error('expected 3 layouts, got ' + names.join(','));
  });
  await step('thumbnails arrive', async () => { await f.locator('.component-preview-img').nth(2).waitFor({ timeout: 4000 }); });
  await shot('02-gallery');
  await step('select 2 and create deck', async () => {
    await f.locator('.component-card', { hasText: 'Title slide' }).click();
    await f.locator('.component-card', { hasText: 'Image + text' }).click();
    await f.getByRole('button', { name: /Create with 2 slides/ }).click();
    await f.locator('.slide-item').nth(1).waitFor({ timeout: 5000 });
  });
  await page.waitForTimeout(800);
  await shot('03-editor');

  await step('penpot render replaces html layer', async () => {
    await f.locator('.canvas-slide .canvas-render svg').waitFor({ timeout: 4000 });
    await f.locator('.render-dot--idle').waitFor({ timeout: 3000 });
    const ghosts = await f.locator('.canvas-slide .canvas-node-ghost').count();
    if (ghosts < 2) throw new Error('ghost nodes ' + ghosts);
    if (await page.evaluate(() => window.__xss)) throw new Error('script executed');
    const scripts = await f.locator('.canvas-render script').count();
    if (scripts) throw new Error('script kept in markup');
  });
  await step('background slides are rendered too', async () => {
    await page.waitForFunction(() => new Set(window.__renders).size >= 2, null, { timeout: 5000 });
    await f.locator('.slide-list .canvas-render svg').nth(1).waitFor({ timeout: 3000 });
  });
  await shot('03b-rendered');
}
