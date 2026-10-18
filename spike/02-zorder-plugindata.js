// Phase 0 · Probe 2 — z-order semantics, shared plugin data, flows.
// Creates throw-away shapes far off-canvas and removes them in `finally`.

const OFF = -100000;
const report = {};
const created = [];

try {
  const board = penpot.createBoard();
  created.push(board);
  board.name = '__spike_zorder';
  board.x = OFF;
  board.y = OFF;
  board.resize(200, 200);

  const a = penpot.createRectangle();
  a.name = 'A (appended first)';
  const b = penpot.createRectangle();
  b.name = 'B (appended second)';
  board.appendChild(a);
  board.appendChild(b);
  report.childrenAfterAppend = board.children.map((c) => c.name);

  // bringToFront moves A to the visual top → its index reveals whether
  // `children` is ordered bottom→top (A last) or top→bottom (A first).
  a.bringToFront();
  const order = board.children.map((c) => c.name);
  report.childrenAfterBringAToFront = order;
  report.childrenOrder = order[order.length - 1] === a.name ? 'bottom-to-top (last = front)' : 'top-to-bottom (first = front)';
  report.appendChildPutsNewOn =
    report.childrenOrder.startsWith('bottom')
      ? (report.childrenAfterAppend[1] === b.name ? 'top' : 'bottom')
      : (report.childrenAfterAppend[0] === b.name ? 'top' : 'bottom');

  // insertChild(0, …) semantics
  const c = penpot.createRectangle();
  c.name = 'C (insertChild 0)';
  board.insertChild(0, c);
  report.childrenAfterInsert0 = board.children.map((s) => s.name);

  // Absolute vs relative coords after appendChild
  a.x = OFF + 10;
  a.y = OFF + 20;
  report.coords = { x: a.x, y: a.y, parentX: a.parentX, parentY: a.parentY };

  // Shared plugin data round-trip
  board.setSharedPluginData('penpot-slides', 'slide', JSON.stringify({ deckId: 'd1', slideId: 's1' }));
  report.sharedPluginData = {
    value: board.getSharedPluginData('penpot-slides', 'slide'),
    keys: board.getSharedPluginDataKeys?.('penpot-slides') ?? 'n/a',
  };
  penpot.currentPage.setSharedPluginData('penpot-slides', 'deck:d1', '{"v":1}');
  report.pagePluginData = penpot.currentPage.getSharedPluginData('penpot-slides', 'deck:d1');
  penpot.currentPage.setSharedPluginData('penpot-slides', 'deck:d1', '');

  // Flow creation on a top-level board, then cleanup
  try {
    const flow = penpot.currentPage.createFlow('__spike_flow', board);
    report.flow = { created: true, name: flow.name, startingBoard: flow.startingBoard?.name };
    penpot.currentPage.removeFlow(flow);
    report.flow.removed = !penpot.currentPage.flows.some((f) => f.name === '__spike_flow');
  } catch (e) {
    report.flow = `error: ${e?.message ?? e}`;
  }

  // Rotation: does setting rotation after x/y move the bounding box?
  const r = penpot.createRectangle();
  created.push(r);
  r.x = OFF;
  r.y = OFF;
  r.resize(100, 40);
  r.rotation = 30;
  report.rotation = { afterRotateX: r.x, afterRotateY: r.y, expected: OFF, boundsW: r.bounds.width };
} catch (e) {
  report.fatal = String(e?.message ?? e);
} finally {
  for (const s of created.reverse()) {
    try { s.remove(); } catch { /* ignore */ }
  }
}

return report;
