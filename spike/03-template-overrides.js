// Phase 0 · Probe 3 — template instance, slot mapping, overrides, fonts,
// export latency/fidelity. Uses a temporary instance placed off-canvas and
// removes it in `finally`. The main component is never modified.
//
// Set COMPONENT_ID to force a template; otherwise the first slide-sized
// component of the first connected library (or the local one) is used.
const COMPONENT_ID = null;

const OFF = -100000;
const report = {};
let inst = null;
const t0 = () => Date.now();
const ms = (start) => Math.round(Date.now() - start);

const libs = [...penpot.library.connected, penpot.library.local];
const isSlideSized = (w, h) => w >= 800 && [16 / 9, 4 / 3].some((r) => Math.abs(w / h - r) < 0.02);

let comp = null;
let lib = null;
for (const l of libs) {
  for (const c of l.components) {
    if (COMPONENT_ID ? c.id === COMPONENT_ID : (() => {
      try { const m = c.mainInstance(); return m && isSlideSized(m.width, m.height); } catch { return false; }
    })()) { comp = c; lib = l; break; }
  }
  if (comp) break;
}
if (!comp) return { error: 'No slide-sized component found. Set COMPONENT_ID.' };
report.template = { lib: lib.name, libIsLocal: lib.id === penpot.library.local.id, id: comp.id, name: comp.name, path: comp.path };

const walk = (shape, fn, depth = 0) => {
  fn(shape, depth);
  for (const ch of shape.children ?? []) walk(ch, fn, depth + 1);
};

try {
  // ── Main instance access + export timings ──────────────────────────────
  let main = null;
  try { main = comp.mainInstance(); } catch (e) { report.mainInstanceError = String(e?.message ?? e); }
  report.mainInstance = main ? { type: main.type, w: main.width, h: main.height } : null;

  if (main) {
    for (const [label, cfg] of [['png@0.2', { type: 'png', scale: 0.2 }], ['png@1', { type: 'png', scale: 1 }], ['svg', { type: 'svg' }]]) {
      const s = t0();
      try {
        const bytes = await main.export(cfg);
        const entry = { ms: ms(s), bytes: bytes.length };
        if (cfg.type === 'svg') {
          const svg = typeof bytes === "string" ? bytes : (typeof TextDecoder !== "undefined" ? new TextDecoder().decode(bytes) : String.fromCharCode(...bytes.slice(0, 60000)));
          entry.hasFontFace = /@font-face/.test(svg);
          entry.fontFamilies = [...new Set([...svg.matchAll(/font-family:\s*([^;"]+)/g)].map((m) => m[1].trim()))].slice(0, 8);
          entry.textAsPaths = !/<text/.test(svg);
          entry.hasImages = /<image/.test(svg);
        }
        report[`exportMain_${label}`] = entry;
      } catch (e) {
        report[`exportMain_${label}`] = `error: ${e?.message ?? e}`;
      }
    }
  }

  // ── Temporary instance ─────────────────────────────────────────────────
  let s = t0();
  inst = comp.instance();
  report.instanceMs = ms(s);
  inst.x = OFF;
  inst.y = OFF;
  report.instance = {
    type: inst.type,
    parent: inst.parent?.type ?? null,
    isComponentInstance: inst.isComponentInstance(),
    isCopy: inst.isComponentCopyInstance(),
    componentId: inst.component()?.id,
    sameAsTemplate: inst.component()?.id === comp.id,
    oldDetectorWouldWork: typeof inst.component !== 'function',
  };

  // ── Slot mapping: copy shape → main shape via componentRefShape() ──────
  const slots = [];
  const nested = [];
  walk(inst, (sh, depth) => {
    if (sh === inst) return;
    let ref = null;
    try { ref = sh.componentRefShape(); } catch { /* ignore */ }
    const hasImageFill = Array.isArray(sh.fills) && sh.fills.some((f) => f.fillImage);
    if (sh.type === 'text' || hasImageFill) {
      slots.push({ kind: sh.type === 'text' ? 'text' : 'image', name: sh.name, depth, copyId: sh.id, refId: ref?.id ?? null });
    }
    if (sh.isComponentInstance() && sh.componentHead?.()?.id === sh.id) {
      nested.push({ name: sh.name, depth, component: sh.component()?.name, isVariant: sh.component()?.isVariant?.() ?? null });
    }
  });
  report.slots = { count: slots.length, withRefId: slots.filter((x) => x.refId).length, sample: slots.slice(0, 10) };
  report.nestedInstances = nested.slice(0, 10);
  report.refIdsStableAcrossInstances = null;

  // ── Text: fonts, style runs, override persistence ──────────────────────
  const texts = [];
  walk(inst, (sh) => { if (sh.type === 'text') texts.push(sh); });
  if (texts.length > 0) {
    const tx = texts[0];
    const before = {
      characters: tx.characters,
      fontId: tx.fontId, fontFamily: tx.fontFamily, fontVariantId: tx.fontVariantId,
      fontSize: tx.fontSize, fontWeight: tx.fontWeight, lineHeight: tx.lineHeight,
      growType: tx.growType, fills: tx.fills,
    };
    const font = tx.fontId && tx.fontId !== 'mixed' ? penpot.fonts.findById(tx.fontId) : null;
    report.font = font ? { name: font.name, fontId: font.fontId, variants: font.variants.map((v) => `${v.fontWeight}${v.fontStyle === 'italic' ? 'i' : ''}`) } : `not resolved (fontId=${tx.fontId})`;

    // Style runs: scan per character (cost measurement).
    s = t0();
    const runs = [];
    const n = Math.min(tx.characters.length, 400);
    for (let i = 0; i < n; i++) {
      const r = tx.getRange(i, i + 1);
      const key = `${r.fontId}|${r.fontWeight}|${r.fontSize}|${r.fontStyle}|${JSON.stringify(r.fills)}`;
      if (!runs.length || runs[runs.length - 1].key !== key) runs.push({ key, start: i });
    }
    report.styleRuns = { chars: n, runs: runs.length, scanMs: ms(s) };

    // Override characters and see what survives.
    tx.characters = 'Spike override ✓';
    await new Promise((r) => setTimeout(r, 150));
    report.textOverride = {
      before,
      after: { characters: tx.characters, fontId: tx.fontId, fontSize: tx.fontSize, fontWeight: tx.fontWeight, growType: tx.growType, fills: tx.fills },
      mainUnchanged: (() => { try { return tx.componentRefShape()?.characters === before.characters; } catch { return 'n/a'; } })(),
    };

    // Multi-style text: does setting characters collapse runs?
    const multi = texts.find((t) => {
      if (t.characters.length < 2) return false;
      return t.fontSize === 'mixed' || t.fontWeight === 'mixed' || t.fills === 'mixed' || t.fontId === 'mixed';
    });
    if (multi) {
      const prev = multi.characters;
      multi.characters = prev.toUpperCase();
      await new Promise((r) => setTimeout(r, 150));
      report.multiStyleText = { name: multi.name, stillMixed: multi.fontSize === 'mixed' || multi.fontWeight === 'mixed' || multi.fills === 'mixed' };
    } else {
      report.multiStyleText = 'none in template';
    }

    // Typography application from the library, if available.
    const typo = lib.typographies[0];
    if (typo && texts[1]) {
      try {
        texts[1].applyTypography(typo);
        await new Promise((r) => setTimeout(r, 150));
        report.applyTypography = { typo: typo.name, fontFamily: texts[1].fontFamily, fontSize: texts[1].fontSize };
      } catch (e) {
        report.applyTypography = `error: ${e?.message ?? e}`;
      }
    }
  }

  // ── Fill override with a library color (keeps link?) ───────────────────
  const colorTarget = (() => { let f = null; walk(inst, (sh) => { if (!f && sh !== inst && (sh.type === 'rectangle' || sh.type === 'ellipse')) f = sh; }); return f; })();
  const libColor = lib.colors[0];
  if (colorTarget && libColor) {
    try {
      colorTarget.fills = [libColor.asFill()];
      report.colorOverride = { color: libColor.name, fill: colorTarget.fills[0] };
    } catch (e) {
      report.colorOverride = `error: ${e?.message ?? e}`;
    }
  }

  // ── Render-engine latency: export instance after overrides ─────────────
  for (const scale of [0.25, 0.5]) {
    s = t0();
    try {
      const bytes = await inst.export({ type: 'png', scale });
      report[`exportInstance_png@${scale}`] = { ms: ms(s), bytes: bytes.length };
    } catch (e) {
      report[`exportInstance_png@${scale}`] = `error: ${e?.message ?? e}`;
    }
  }

  // ── Client-side render: generateMarkup SVG (text layout is async) ──────
  for (const wait of [0, 300, 1000]) {
    await new Promise((r) => setTimeout(r, wait));
    s = t0();
    const svg = penpot.generateMarkup([inst], { type: 'svg' });
    report[`markup_after_${wait}ms`] = {
      ms: ms(s),
      len: svg.length,
      hasOverride: svg.includes('Spike override'),
      remoteImages: (svg.match(/by-file-media-id/g) ?? []).length,
    };
  }

  // ── Still linked after overrides? ──────────────────────────────────────
  report.linkedAfterOverrides = inst.isComponentInstance() && inst.component()?.id === comp.id;

  // ── refIds stable across a second instance? ────────────────────────────
  const inst2 = comp.instance();
  try {
    const ids1 = []; const ids2 = [];
    walk(inst, (sh) => { if (sh !== inst) ids1.push(sh.componentRefShape()?.id); });
    walk(inst2, (sh) => { if (sh !== inst2) ids2.push(sh.componentRefShape()?.id); });
    report.refIdsStableAcrossInstances = ids1.length === ids2.length && ids1.every((id, i) => id === ids2[i]);
  } finally {
    inst2.remove();
  }
} catch (e) {
  report.fatal = String(e?.message ?? e);
} finally {
  if (inst) { try { inst.remove(); } catch { /* ignore */ } }
}

return report;
