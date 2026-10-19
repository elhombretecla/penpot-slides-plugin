// The whole flow: library gallery, deck creation, Penpot render, styles,
// fonts, colors, layouts, persistence, insert / update / pull, blank decks.

import { unnamedControls } from '../a11y.mjs';

export const options = { nested: false };

export default async function main({ page, f, step, shot }) {
  await page.waitForTimeout(1500);
  await step('home renders', async () => { await f.getByText('Presentations in this file').waitFor({ timeout: 5000 }); await f.getByText('Brand templates').first().waitFor(); });
  await shot('01-home');

  await step('window fills the tab and restores', async () => {
    const btn = f.getByTitle('Fill the browser tab');
    await btn.click();
    await f.getByTitle('Restore window size').waitFor({ timeout: 2000 });
    if (!(await page.evaluate(() => window.__maximized))) throw new Error('plugin not asked');
    await f.getByTitle('Restore window size').click();
    await f.getByTitle('Fill the browser tab').waitFor({ timeout: 2000 });
    if (await page.evaluate(() => window.__maximized)) throw new Error('not restored');
  });
  await step('open gallery from library', async () => { await f.getByText('From a template library').click(); await f.getByText('New presentation from a library').waitFor(); });
  await page.waitForTimeout(600);
  await step('gallery shows only slide layouts', async () => {
    const names = await f.locator('.component-name').allTextContents();
    if (names.includes('logo')) throw new Error('asset shown in layouts: ' + names.join(','));
    if (names.length !== 3) throw new Error('expected 3 layouts, got ' + names.join(','));
  });
  await step('thumbnails arrive', async () => { await f.locator('.component-preview-img').nth(2).waitFor({ timeout: 4000 }); });
  await step('gallery controls are named', async () => {
    const bad = await unnamedControls(f); if (bad.length) throw new Error('unnamed controls: ' + bad.join(' | '));
  });
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

  await step('autosave writes deck to file', async () => {
    await f.getByText('Saved in file').waitFor({ timeout: 5000 });
    const n = await page.evaluate(() => Object.keys(window.__decks).length);
    if (n !== 1) throw new Error('decks stored: ' + n);
  });

  await step('select title and edit text in panel', async () => {
    await f.locator('.slide-item').first().locator('.slide-thumbnail-btn').click();
    const title = f.locator('.canvas-slide [data-node-type="text"]').first();
    await title.click();
    const ta = f.locator('.properties-panel textarea').first();
    await ta.fill('Mi presentación');
    await page.waitForTimeout(100);
    const canvasText = await f.locator('.canvas-slide [data-node-type="text"]').first().innerText();
    if (!canvasText.includes('Mi presentación')) throw new Error('canvas not updated: ' + canvasText);
  });
  await step('edited node drawn live, svg copy hidden, then re-rendered', async () => {
    const hidden = await f.locator('.canvas-slide .canvas-render [data-node]').evaluateAll(els => els.filter(e => e.style.display === 'none').length);
    if (hidden !== 1) throw new Error('hidden svg nodes ' + hidden);
    const before = await page.evaluate(() => window.__renders.length);
    await page.waitForFunction((b) => window.__renders.length > b, before, { timeout: 4000 });
    await f.locator('.render-dot--idle').waitFor({ timeout: 3000 });
    const svgText = await f.locator('.canvas-slide .canvas-render').innerHTML();
    if (!svgText.includes('Mi presentación')) throw new Error('render not updated');
    const hiddenAfter = await f.locator('.canvas-slide .canvas-render [data-node]').evaluateAll(els => els.filter(e => e.style.display === 'none').length);
    if (hiddenAfter !== 0) throw new Error('still hidden ' + hiddenAfter);
  });
  await step('typography style shown and linked', async () => {
    const v = await f.locator('.properties-panel select').first().inputValue();
    if (v !== 'ty-hero') throw new Error('style select value ' + v);
  });
  await step('changing size unlinks the style', async () => {
    const size = f.locator('.prop-field', { hasText: 'Size' }).locator('input');
    await size.fill('90');
    await page.waitForTimeout(100);
    const v = await f.locator('.properties-panel select').first().inputValue();
    if (v !== '') throw new Error('still linked: ' + v);
  });
  await step('library swatch applies to text color', async () => {
    await f.locator('.prop-swatch').first().click();
    await f.locator('.prop-color-linked', { hasText: 'Primary' }).first().waitFor({ timeout: 2000 });
  });
  await shot('04-edited');

  await step('undo restores', async () => {
    await f.locator('.canvas-slide').click({ position: { x: 5, y: 5 } });
    await f.locator('.canvas-slide').press('Control+z');
    await f.locator('body').press('Control+z');
  });

  await step('font picker lists team fonts and applies one', async () => {
    await f.locator('.canvas-slide [data-node-type="text"]').first().click({ force: true });
    await f.locator('.font-picker-btn').click();
    await f.locator('.font-picker-group', { hasText: 'Team fonts' }).waitFor({ timeout: 3000 });
    await f.locator('.font-picker-pop input').fill('brand');
    await f.locator('.font-picker-item', { hasText: 'Brand Sans' }).click();
    await f.locator('.font-picker-btn', { hasText: 'Brand Sans' }).waitFor();
    await f.getByText('Team font: the quick preview').waitFor();
    const weights = await f.locator('.prop-field', { hasText: 'Weight' }).locator('option').allTextContents();
    if (weights.join() !== 'Regular,Extra Bold') throw new Error('weights ' + weights.join());
    const italicDisabled = await f.locator('.align-btn[title="This font has no italic"]').isDisabled();
    if (!italicDisabled) throw new Error('italic should be disabled');
  });
  await step('save text style and detach', async () => {
    await f.locator('.style-icon-btn[title^="Save these settings"]').click();
    await f.locator('.color-name-form input').fill('Deck / Title');
    await f.locator('.color-name-form button[type=submit]').click();
    await page.waitForFunction(() => window.__created.some(c => c.type === 'create-typography'), null, { timeout: 3000 });
    const v = await f.locator('.text-style-row select').inputValue();
    if (v !== 'ty-new') throw new Error('style select ' + v);
    const sent = await page.evaluate(() => window.__created.find(c => c.type === 'create-typography').style);
    if (sent.fontId !== 'custom-123') throw new Error('style font ' + sent.fontId);
    await f.locator('.style-icon-btn[title^="Detach"]').click();
    const after = await f.locator('.text-style-row select').inputValue();
    if (after !== '') throw new Error('still linked ' + after);
  });
  await step('color token, deck colors and save color to library', async () => {
    const color = f.locator('.prop-row', { hasText: 'Color' }).last();
    await color.locator('.prop-swatch--token').click();
    await color.locator('.prop-color-linked', { hasText: 'brand.accent' }).waitFor({ timeout: 2000 });
    const deckSwatches = await color.locator('.prop-swatches--plain .prop-swatch').count();
    if (deckSwatches < 1) throw new Error('no deck colors');
    await color.locator('.prop-swatches--plain .prop-swatch').first().click();
    await color.locator('.color-add-btn').click();
    await color.locator('.color-name-form input').fill('Brand / Ink');
    await color.locator('.color-name-form button[type=submit]').click();
    await color.locator('.prop-color-linked', { hasText: 'Brand / Ink' }).waitFor({ timeout: 3000 });
  });
  await shot('05b-type-color');

  await step('insert library element', async () => {
    await f.getByRole('button', { name: 'Insert', exact: true }).click();
    await f.locator('.insert-asset').first().waitFor({ timeout: 4000 });
    const before = await f.locator('.canvas-slide [data-node-type="component-instance"]').count();
    await f.locator('.insert-asset').first().click();
    await page.waitForTimeout(300);
    const after = await f.locator('.canvas-slide [data-node-type="component-instance"]').count();
    if (after !== before + 1) throw new Error(`instances ${before} -> ${after}`);
  });
  await shot('05-insert');

  await step('change layout keeps edited title', async () => {
    // Re-edit the title so it is surely edited after the undos.
    await f.getByRole('button', { name: 'Design' }).click();
    await f.locator('.canvas-slide [data-node-type="text"]').first().click();
    await f.locator('.properties-panel textarea').first().fill('Título editado');
    await f.locator('.canvas-slide').click({ position: { x: 3, y: 3 } });
    await f.getByRole('button', { name: 'Change layout…' }).click();
    await f.getByText('Change layout', { exact: true }).waitFor();
    await f.locator('.component-card', { hasText: 'Content' }).click();
    await f.getByRole('button', { name: 'Apply layout' }).click();
    await f.locator('.canvas-slide').waitFor();
    await page.waitForTimeout(400);
    const texts = await f.locator('.canvas-slide [data-node-type="text"]').allInnerTexts();
    if (!texts.some(t => t.includes('Título editado'))) throw new Error('texts: ' + texts.join(' | '));
    if (!texts.some(t => t.includes('Body copy'))) throw new Error('template body missing: ' + texts.join(' | '));
  });
  await shot('06-layout-changed');

  await step('new slide menu shows library layouts', async () => {
    await f.locator('.add-slide-btn').click();
    await f.locator('.add-slide-layout').first().waitFor();
    const n = await f.locator('.add-slide-layout').count();
    if (n !== 3) throw new Error('layouts in menu: ' + n);
    const svgThumbs = await f.locator('.add-slide-layout .thumbnail-svg svg').count();
    if (svgThumbs !== 1) throw new Error('svg thumbnails in menu: ' + svgThumbs);
    await shot('07-new-slide-menu');
    await f.locator('.add-slide-layout', { hasText: 'Content' }).click();
    await page.waitForTimeout(300);
    const slides = await f.locator('.slide-item').count();
    if (slides !== 3) throw new Error('slides: ' + slides);
  });

  await step('render toggle off shows html only', async () => {
    await f.locator('.manager-topbar .render-toggle').click();
    if (await f.locator('.canvas-slide .canvas-render').count()) throw new Error('render still shown');
    if (await f.locator('.canvas-slide .canvas-node-ghost').count()) throw new Error('ghosts remain');
    await f.locator('.manager-topbar .render-toggle').click();
    await f.locator('.canvas-slide .canvas-render svg').waitFor({ timeout: 4000 });
  });
  await step('speaker notes', async () => {
    await f.locator('.speaker-notes').fill('Recordar saludar');
  });

  await step('rename deck', async () => {
    const t = f.locator('.deck-title-input');
    await t.fill('Deck de prueba'); await t.press('Enter');
  });
  await page.waitForTimeout(1600);

  await step('back home lists deck', async () => {
    await f.getByTitle('All presentations').click();
    await f.getByText('Deck de prueba').waitFor({ timeout: 4000 });
  });
  await step('home shows rendered cover', async () => {
    await f.locator('.deck-row-cover svg').first().waitFor({ timeout: 4000 });
  });
  await shot('08-home-with-deck');

  await step('reopen deck restores content', async () => {
    await f.getByText('Deck de prueba').click();
    await f.locator('.slide-item').nth(2).waitFor({ timeout: 4000 });
    const texts = await f.locator('.canvas-slide [data-node-type="text"]').allInnerTexts();
    if (!texts.some(t => t.includes('Título editado'))) throw new Error('lost edit: ' + texts.join('|'));
    const imgs = await f.locator('.canvas-slide img').count();
    if (imgs < 1) throw new Error('images not restored');
  });

  await step('insert into penpot sends slides', async () => {
    await f.getByRole('button', { name: 'Insert into Penpot' }).click();
    const bad = await unnamedControls(f); if (bad.length) throw new Error('unnamed controls: ' + bad.join(' | '));
    await f.locator('.export-cta').click();
    await f.getByText('3 slides inserted!').waitFor({ timeout: 3000 });
    const ins = await page.evaluate(() => window.__inserts[0]);
    if (ins.deckName !== 'Deck de prueba') throw new Error('deckName ' + ins.deckName);
    if (ins.settings.mode !== 'update') throw new Error('mode ' + ins.settings.mode);
    if (!ins.slides.every((s) => s.template?.componentId)) throw new Error('slides without template');
    if (!ins.slides.some((s) => s.notes === 'Recordar saludar')) throw new Error('speaker notes not sent');
    if (!ins.slides.some((s) => s.nodes.some((n) => n.edited && n.text === 'Título editado'))) throw new Error('edited text not sent');
  });
  await shot('09-inserted');

  await step('panel offers updating the inserted deck', async () => {
    await f.locator('.export-placement').waitFor({ timeout: 3000 });
    await f.getByText('Already in Penpot: 3 slides').waitFor();
    await f.getByRole('button', { name: 'Update slides in Penpot' }).click();
    await f.getByText(/Updated 3 · added 0 · removed 0/).waitFor({ timeout: 3000 });
    const last = await page.evaluate(() => window.__inserts.at(-1).settings.mode);
    if (last !== 'update') throw new Error('mode ' + last);
  });
  await step('insert a new copy option', async () => {
    await f.getByText('Insert a new copy').click();
    await f.getByRole('button', { name: 'Insert into Canvas' }).waitFor();
    await f.getByText('Update those slides').click();
  });
  await step('bring changes from Penpot', async () => {
    await f.getByText('Bring changes from Penpot into the editor').click();
    await f.getByText(/updated with the changes made in Penpot/).waitFor({ timeout: 3000 });
    await f.locator('.export-overlay').click({ position: { x: 5, y: 5 } });
    await f.locator('.slide-item').first().locator('.slide-thumbnail-btn').click();
    const texts = await f.locator('.canvas-slide [data-node-type="text"]').allInnerTexts();
    if (!texts.some(t => t.includes('Desde Penpot'))) throw new Error('not pulled: ' + texts.join('|'));
    const notes = await f.locator('.speaker-notes').inputValue();
    if (notes !== 'nota de Penpot') throw new Error('notes ' + notes);
  });
  await step('undo reverts the pull', async () => {
    await f.locator('.canvas-wrapper').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);
    const texts = await f.locator('.canvas-slide [data-node-type="text"]').allInnerTexts();
    if (texts.some(t => t.includes('Desde Penpot'))) throw new Error('still pulled');
    await f.getByRole('button', { name: 'Insert into Penpot' }).click();
  });
  await shot('09b-update');

  await step('blank deck flow', async () => {
    await f.locator('.export-overlay').click({ position: { x: 5, y: 5 } });
    await f.getByTitle('All presentations').click();
    await f.getByText('Blank', { exact: true }).click();
    await f.getByText('New blank slide').waitFor();
    const bad = await unnamedControls(f); if (bad.length) throw new Error('unnamed controls: ' + bad.join(' | '));
    await f.getByText('Title + Text').click();
    await f.getByRole('button', { name: /Create Slide/ }).click();
    await f.locator('.slide-item').first().waitFor();
    const texts = await f.locator('.canvas-slide [data-node-type="text"]').count();
    if (texts !== 2) throw new Error('texts ' + texts);
  });
  await step('image from file', async () => {
    await f.getByRole('button', { name: 'Insert', exact: true }).click();
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR42mP8z8DwnwEJMDEgAUwBAGQqBAdd8GKcAAAAAElFTkSuQmCC', 'base64');
    await f.locator('.insert-panel input[type=file]').setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: png });
    await page.waitForTimeout(400);
    const n = await f.locator('.canvas-slide [data-node-type="image"]').count();
    if (n !== 1) throw new Error('image nodes ' + n);
  });
  await shot('10-blank');
}
