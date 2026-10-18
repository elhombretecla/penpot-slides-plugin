// Phase 0 · Probe 1 — environment & libraries (READ-ONLY).
// Body of an async function: run it through the Penpot MCP `execute_code`
// tool, or wrap it in `(async () => { ... })()` in the plugin console.
// Returns a JSON report; mutates nothing.

const SLIDE_RATIOS = [16 / 9, 4 / 3];
const isSlideSized = (w, h) =>
  w >= 800 && SLIDE_RATIOS.some((r) => Math.abs(w / h - r) < 0.02);

const describeLib = (lib) => {
  const comps = lib.components.map((c) => {
    let main = null;
    let mainError = null;
    try {
      const m = c.mainInstance();
      main = m ? { id: m.id, type: m.type, w: m.width, h: m.height, children: m.children?.length ?? 0 } : null;
    } catch (e) {
      mainError = String(e?.message ?? e);
    }
    return {
      id: c.id,
      name: c.name,
      path: c.path,
      isVariant: typeof c.isVariant === 'function' ? c.isVariant() : 'n/a',
      variantProps: c.variantProps ?? null,
      main,
      mainError,
      slideSized: main ? isSlideSized(main.w, main.h) : false,
    };
  });
  return {
    id: lib.id,
    name: lib.name,
    colors: lib.colors.length,
    typographies: lib.typographies.length,
    tokenSets: lib.tokens?.sets?.length ?? 'n/a',
    components: comps.length,
    slideCandidates: comps.filter((c) => c.slideSized).map((c) => ({ id: c.id, name: c.name, path: c.path, ...c.main })),
    mainInstanceUnavailable: comps.filter((c) => !c.main).length,
    mainErrors: [...new Set(comps.map((c) => c.mainError).filter(Boolean))].slice(0, 3),
  };
};

let available = null;
try {
  available = (await penpot.library.availableLibraries()).map((l) => ({ id: l.id, name: l.name }));
} catch (e) {
  available = `error: ${e?.message ?? e}`;
}

const page = penpot.currentPage;
return {
  apiVersion: penpot.version ?? 'n/a',
  file: penpot.currentFile?.name,
  page: page?.name,
  pageFlows: page?.flows?.map((f) => f.name) ?? 'n/a',
  hasCreateFlow: typeof page?.createFlow === 'function',
  hasFonts: !!penpot.fonts,
  local: describeLib(penpot.library.local),
  connected: penpot.library.connected.map(describeLib),
  availableToConnect: available,
};
