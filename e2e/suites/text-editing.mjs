// Typing on the canvas: native text selection inside the editor, nested
// slots, selection boxes over the Penpot render, click vs drag, Enter / Esc.

import { createDeck } from '../flows.mjs';

export const options = { nested: true };

export default async function textEditing(ctx) {
  const { page, f, step, shot } = ctx;
  await createDeck(ctx);
  await step('nested text: dblclick edits, selects all', async () => {
    await f.locator('.slide-item').first().locator('.slide-thumbnail-btn').click();
    const sub = f.locator('.canvas-slide [data-node-type="group"] [data-node-type="text"]').first();
    await sub.click(); await sub.dblclick();
    const ta = f.locator('.canvas-text-editor');
    await ta.waitFor({ timeout: 2000 });
    const sel = await ta.evaluate(el => [el.selectionStart, el.selectionEnd, el.value.length, document.activeElement === el]);
    if (sel[0] !== 0 || sel[1] !== sel[2] || !sel[3]) throw new Error('not all selected ' + sel);
  });
  await step('mouse drag selects characters, group does not move', async () => {
    const g = f.locator('.canvas-slide [data-node-type="group"]').first();
    const before = await g.boundingBox();
    const ta = f.locator('.canvas-text-editor');
    const b = await ta.boundingBox();
    await page.mouse.move(b.x + 10, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + 60, b.y + b.height / 2, { steps: 5 });
    await page.mouse.move(b.x + 120, b.y + b.height / 2, { steps: 5 });
    await page.mouse.up();
    const after = await g.boundingBox();
    if (Math.abs(after.x - before.x) > 0.5) throw new Error('group moved');
    if (!(await ta.isVisible())) throw new Error('edit ended');
    const sel = await ta.evaluate(el => [el.selectionStart, el.selectionEnd]);
    if (!(sel[1] - sel[0] > 0 && sel[0] > 0)) throw new Error('no partial selection ' + sel);
  });
  await step('dblclick inside editor selects a word', async () => {
    const ta = f.locator('.canvas-text-editor');
    const b = await ta.boundingBox();
    await page.mouse.dblclick(b.x + 70, b.y + b.height / 2);
    if (!(await ta.isVisible())) throw new Error('edit ended');
    const r = await ta.evaluate(el => el.value.slice(el.selectionStart, el.selectionEnd));
    if (!/^\w+\s?$/.test(r)) throw new Error('selection: ' + JSON.stringify(r));
    await page.keyboard.type('Nuevo ');
    const v = await ta.inputValue();
    if (!v.includes('Nuevo')) throw new Error('typed: ' + v);
  });
  await step('top-level text: drag selects, node stays', async () => {
    await page.keyboard.press('Escape');
    const t = f.locator('.canvas-slide > [data-node-type="text"]').first();
    await t.click(); await t.dblclick();
    const ta = f.locator('.canvas-text-editor'); await ta.waitFor();
    const before = await t.boundingBox(); const b = await ta.boundingBox();
    await page.mouse.move(b.x + 20, b.y + 12); await page.mouse.down();
    await page.mouse.move(b.x + 200, b.y + 12, { steps: 6 }); await page.mouse.up();
    const after = await t.boundingBox();
    if (Math.abs(after.x - before.x) > 0.5) throw new Error('moved');
    const sel = await ta.evaluate(el => el.selectionEnd - el.selectionStart);
    if (!sel) throw new Error('no selection');
  });
  await step('click outside ends edit', async () => {
    await f.locator('.canvas-slide .canvas-bg').click({ position: { x: 5, y: 5 } });
    if (await f.locator('.canvas-text-editor').count()) throw new Error('still editing');
  });

  const near = (a, b) => Math.abs(a.x - b.x) < 3 && Math.abs(a.y - b.y) < 3 && Math.abs(a.width - b.width) < 4 && Math.abs(a.height - b.height) < 4;
  await step('nested node selected: box drawn over render', async () => {
    const sub = f.locator('.canvas-slide [data-node-type="group"] [data-node-type="text"]').first();
    await sub.click();
    const box = f.locator('.canvas-selection-box');
    await box.waitFor({ timeout: 2000 });
    const a = await box.boundingBox(), b = await sub.boundingBox();
    if (!near(a, b)) throw new Error('box ' + JSON.stringify(a) + ' node ' + JSON.stringify(b));
    if ((await box.locator('div').count()) !== 8) throw new Error('handles missing');
  });
  await step('every node shows its box', async () => {
    const nodes = f.locator('.canvas-slide [data-node-id]');
    const n = await nodes.count();
    for (let k = 0; k < n; k++) {
      const el = nodes.nth(k);
      if ((await el.getAttribute('data-node-type')) === 'group') continue;
      await el.click({ force: true });
      const box = f.locator('.canvas-selection-box');
      if ((await box.count()) !== 1) throw new Error('no box for node ' + k);
    }
  });
  await shot('11-selection');
  await step('jitter click does not move or re-render node', async () => {
    const t = f.locator('.canvas-slide > [data-node-type="text"]').first();
    await f.locator('.canvas-slide .canvas-bg').click({ position: { x: 5, y: 5 } });
    await page.waitForTimeout(800);
    const ghostBefore = await t.locator('.canvas-node-ghost').count();
    const b = await t.boundingBox();
    await page.mouse.move(b.x + 30, b.y + 10); await page.mouse.down();
    await page.mouse.move(b.x + 31, b.y + 11); await page.mouse.up();
    const a = await t.boundingBox();
    if (a.x !== b.x || a.y !== b.y) throw new Error('moved');
    if ((await t.locator('.canvas-node-ghost').count()) !== ghostBefore) throw new Error('render swapped');
    if ((await f.locator('.canvas-selection-box').count()) !== 1) throw new Error('not selected');
  });
  await step('real drag moves node and box follows', async () => {
    const t = f.locator('.canvas-slide > [data-node-type="text"]').first();
    const b = await t.boundingBox();
    await page.mouse.move(b.x + 30, b.y + 10); await page.mouse.down();
    await page.mouse.move(b.x + 60, b.y + 30, { steps: 5 }); await page.mouse.up();
    const a = await t.boundingBox();
    if (Math.abs(a.x - b.x - 30) > 1) throw new Error('not moved ' + (a.x - b.x));
    if (!near(await f.locator('.canvas-selection-box').boundingBox(), a)) throw new Error('box not following');
    await page.keyboard.press('Control+z');
  });
  await step('hover box and Escape / Enter', async () => {
    const sub = f.locator('.canvas-slide [data-node-type="group"] [data-node-type="text"]').first();
    const b = await sub.boundingBox();
    await page.mouse.move(b.x + 5, b.y + 5);
    await f.locator('.canvas-hover-box').waitFor({ timeout: 1000 });
    await page.mouse.click(b.x + 5, b.y + 5);
    await page.keyboard.press('Enter');
    await f.locator('.canvas-text-editor').waitFor({ timeout: 1000 });
    await page.keyboard.press('Escape');
    if (await f.locator('.canvas-text-editor').count()) throw new Error('still editing');
    await page.keyboard.press('Escape');
    if (await f.locator('.canvas-selection-box').count()) throw new Error('still selected');
  });
  await step('text tool opens editor on create', async () => {
    await page.keyboard.press('t');
    const s = await f.locator('.canvas-slide').boundingBox();
    await page.mouse.click(s.x + 40, s.y + s.height - 40);
    await f.locator('.canvas-text-editor').waitFor({ timeout: 1000 });
    await page.keyboard.type('Hola');
    if (!(await f.locator('.canvas-text-editor').inputValue()).includes('Hola')) throw new Error('not typed');
  });
}
