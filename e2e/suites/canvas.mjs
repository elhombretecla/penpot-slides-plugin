// Slides-like editing: smart guides, nudge, duplicate, context menu, align
// and distribute, proportional resize, slide strip keys, grid view and the
// presentation mode.

import { createDeck } from '../flows.mjs';
import { unnamedControls } from '../a11y.mjs';

export const options = { nested: true };

export default async function canvas(ctx) {
  const { page, f, step, shot } = ctx;
  await createDeck(ctx);
  await f.locator('.slide-item').first().locator('.slide-thumbnail-btn').click();
  await page.waitForTimeout(300);
  const canvas = f.locator('.canvas-slide');
  const cbox = async () => canvas.boundingBox();
  const sc = async () => (await cbox()).width / 1920;
  const nodeX = async (loc) => { const b = await loc.boundingBox(); const c = await cbox(); return (b.x - c.x) / (await sc()); };
  const nodeY = async (loc) => { const b = await loc.boundingBox(); const c = await cbox(); return (b.y - c.y) / (await sc()); };
  const title = f.locator('.canvas-slide > [data-node-type="text"]').first();
  const tops = f.locator('.canvas-slide > [data-node-id]');
  const drag = async (loc, dx, dy, opts = {}) => {
    const b = await loc.boundingBox();
    const x = b.x + 20, y = b.y + 10;
    await page.mouse.move(x, y);
    if (opts.alt) await page.keyboard.down('Alt');
    await page.mouse.down();
    await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 });
    await page.mouse.move(x + dx, y + dy, { steps: 4 });
    if (opts.check) await opts.check();
    await page.mouse.up();
    if (opts.alt) await page.keyboard.up('Alt');
  };

  await step('snap to slide centre with guide', async () => {
    // title: x=160 w=1200 -> centred x = 360. Drag by ~200 slide units minus a bit.
    const s = await sc();
    let sawGuide = false;
    await drag(title, (200 - 3) * s, 0, { check: async () => { sawGuide = (await f.locator('.canvas-guide').count()) > 0; } });
    const x = await nodeX(title);
    if (Math.abs(x - 360) > 1) throw new Error('x=' + x);
    if (!sawGuide) throw new Error('no guide while dragging');
    if (await f.locator('.canvas-guide').count()) throw new Error('guide left after drop');
  });
  await step('ctrl drag does not snap', async () => {
    await page.keyboard.press('Control+z');
    const s = await sc();
    await page.keyboard.down('Control');
    await drag(title, (200 - 3) * s, 0);
    await page.keyboard.up('Control');
    const x = await nodeX(title);
    if (Math.abs(x - 360) < 0.5 || Math.abs(x - 357) > 4) throw new Error('x=' + x);
    await page.keyboard.press('Control+z');
  });
  await step('arrow nudge 1 / shift 10, one undo step', async () => {
    await title.click();
    const x0 = await nodeX(title);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowDown');
    const x1 = await nodeX(title), y1 = await nodeY(title);
    if (Math.abs(x1 - x0 - 2) > 0.3) throw new Error('dx ' + (x1 - x0));
    await page.keyboard.press('Control+z');
    if (Math.abs((await nodeX(title)) - x0) > 0.3) throw new Error('undo not single step');
  });
  await step('alt drag duplicates', async () => {
    const n0 = await tops.count();
    const x0 = await nodeX(title);
    await drag(title, 0, 120, { alt: true });
    if ((await tops.count()) !== n0 + 1) throw new Error('count ' + (await tops.count()));
    if (Math.abs((await nodeX(title)) - x0) > 0.5) throw new Error('original moved');
    await page.keyboard.press('Control+z');
    if ((await tops.count()) !== n0) throw new Error('undo failed');
  });
  await step('ctrl+d duplicate, ctrl+a select all, delete', async () => {
    await title.click();
    const n0 = await tops.count();
    await page.keyboard.press('Control+d');
    if ((await tops.count()) !== n0 + 1) throw new Error('dup');
    await page.keyboard.press('Control+a');
    const boxes = await f.locator('.canvas-selection-box').count();
    if (boxes !== n0 + 1) throw new Error('select all ' + boxes);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+z');
    if ((await tops.count()) !== n0) throw new Error('undo dup');
  });
  await step('context menu: bring to front / delete', async () => {
    const n0 = await tops.count();
    await title.click({ button: 'right' });
    const menu = f.locator('.context-menu');
    await menu.waitFor({ timeout: 1000 });
    const bad = await unnamedControls(f); if (bad.length) throw new Error('unnamed controls: ' + bad.join(' | '));
    if (!(await menu.getByText('Edit text').count())) throw new Error('no edit text');
    await menu.getByText('Bring to front').click();
    if (await menu.count()) throw new Error('menu not closed');
    const lastId = await tops.last().getAttribute('data-node-type');
    if (lastId !== 'text') throw new Error('not front');
    await f.locator('.canvas-slide > [data-node-type="text"]').last().click({ button: 'right' });
    await f.locator('.context-menu').getByText('Delete').click();
    if ((await tops.count()) !== n0 - 1) throw new Error('not deleted');
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
  });
  await step('right-click empty: paste here / select all; escape closes', async () => {
    await f.locator('.canvas-slide .canvas-bg').click({ button: 'right', position: { x: 30, y: 30 } });
    const menu = f.locator('.context-menu');
    await menu.waitFor({ timeout: 1000 });
    if (!(await menu.getByText('Select all').count())) throw new Error('no select all');
    await page.keyboard.press('Escape');
    if (await menu.count()) throw new Error('not closed');
  });
  await step('align left two elements', async () => {
    const group = f.locator('.canvas-slide > [data-node-type="group"]').first();
    await title.click();
    await page.keyboard.press('ArrowRight'); await page.keyboard.press('Shift+ArrowRight');
    await group.click({ modifiers: ['Shift'], position: { x: 3, y: 3 } });
    await f.locator('.align-bar-btn[title="Align left"]').click();
    const a = await nodeX(title), b = await nodeX(group);
    if (Math.abs(a - b) > 0.5 || Math.abs(a - 160) > 0.5) throw new Error(a + ' vs ' + b);
  });
  await step('distribute needs 3, align single to slide', async () => {
    if (!(await f.locator('.align-bar-btn[title^="Distribute horizontal"]').isDisabled())) throw new Error('enabled with 2');
    await title.click();
    await f.locator('.align-bar-btn[title^="Align right"]').click();
    const b = await title.boundingBox(); const c = await cbox();
    if (Math.abs(b.x + b.width - (c.x + c.width)) > 1) throw new Error('not at right edge');
    await page.keyboard.press('Control+z');
  });
  await step('shift resize keeps ratio', async () => {
    await title.click();
    const b0 = await title.boundingBox();
    const h = f.locator('.canvas-selection-box > div').nth(4); // se
    const hb = await h.boundingBox();
    await page.mouse.move(hb.x + 4, hb.y + 4);
    await page.keyboard.down('Shift');
    await page.mouse.down();
    await page.mouse.move(hb.x + 80, hb.y + 10, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    const b1 = await title.boundingBox();
    const r0 = b0.width / b0.height, r1 = b1.width / b1.height;
    if (Math.abs(r0 - r1) > 0.05 || b1.width <= b0.width) throw new Error(r0 + ' ' + r1);
    await page.keyboard.press('Control+z');
  });
  await step('slide list keyboard: arrows and ctrl+arrow move', async () => {
    await page.keyboard.press('Escape');
    const items = f.locator('.slide-item');
    await items.nth(0).locator('.slide-thumbnail-btn').click();
    await page.keyboard.press('ArrowDown');
    if (!(await items.nth(1).getAttribute('class')).includes('active')) throw new Error('arrow');
    const name1 = await items.nth(1).locator('.slide-thumbnail-btn').getAttribute('title');
    await page.keyboard.press('Control+ArrowUp');
    if ((await items.nth(0).locator('.slide-thumbnail-btn').getAttribute('title')) !== name1) throw new Error('not moved');
    await page.keyboard.press('Control+z');
    if ((await items.nth(1).locator('.slide-thumbnail-btn').getAttribute('title')) !== name1) throw new Error('undo');
  });
  await step('grid view: cards, drag reorder, open', async () => {
    await f.locator('.view-switch-btn[title^="Grid"]').click();
    const cards = f.locator('.slide-grid-card');
    await cards.first().waitFor({ timeout: 2000 });
    const bad = await unnamedControls(f); if (bad.length) throw new Error('unnamed controls: ' + bad.join(' | '));
    if ((await cards.count()) !== 2) throw new Error('cards ' + (await cards.count()));
    const second = await cards.nth(1).locator('.slide-grid-name').innerText();
    await cards.nth(1).dragTo(cards.nth(0), { targetPosition: { x: 10, y: 40 } });
    if ((await cards.nth(0).locator('.slide-grid-name').innerText()) !== second) throw new Error('not reordered');
    await page.keyboard.press('Control+z');
    await cards.nth(1).locator('.slide-grid-thumb').dblclick();
    await f.locator('.canvas-slide').waitFor({ timeout: 2000 });
    if (await f.locator('.slide-grid').count()) throw new Error('grid still shown');
  });
  await shot('12-phase6-editor');
  await step('presenter: navigate, notes, keys do not edit, escape', async () => {
    await f.locator('.slide-item').first().locator('.slide-thumbnail-btn').click();
    await title.click();
    const n0 = await tops.count();
    await f.getByRole('button', { name: 'Present', exact: true }).click();
    const p = f.locator('.presenter');
    await p.waitFor({ timeout: 1000 });
    const bad = await unnamedControls(f); if (bad.length) throw new Error('unnamed controls: ' + bad.join(' | '));
    if (!(await f.locator('.presenter-count').innerText()).startsWith('1 /')) throw new Error('start');
    await page.keyboard.press('ArrowRight');
    if (!(await f.locator('.presenter-count').innerText()).startsWith('2 /')) throw new Error('next');
    await page.keyboard.press('ArrowRight');
    if (!(await f.locator('.presenter-count').innerText()).startsWith('2 /')) throw new Error('past end');
    await page.keyboard.press('s');
    await f.locator('.presenter-notes').waitFor({ timeout: 1000 });
    await page.keyboard.press('Delete');
    await page.keyboard.press('Control+z');
    await shot('13-presenter');
    await page.keyboard.press('Escape');
    if (await p.count()) throw new Error('not closed');
    if (!(await f.locator('.slide-item').nth(1).getAttribute('class')).includes('active')) throw new Error('editor not on presented slide');
    await f.locator('.slide-item').first().locator('.slide-thumbnail-btn').click();
    if ((await tops.count()) !== n0) throw new Error('keys leaked to editor');
  });
}
