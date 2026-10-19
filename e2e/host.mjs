// Fake Penpot host for the browser suites: the built UI runs in an iframe
// and a mock plugin answers its messages with a small template library
// (three slide layouts, a logo, colors, text styles, fonts and a token).
// `nested` puts the title slide's subtitle inside a group, like most real
// templates.

const FLAT_SUBTITLE = "    text(id + '-s', 'A subtitle that explains it', 160, 540, 1200, 60, 42, '400'),";
const NESTED_SUBTITLE = `    { id: id + '-g', slotId: id + '-g', type: 'group', name: 'block', x: 160, y: 540, width: 1200, height: 200, visible: true, opacity: 1, rotation: 0, children: [
      text(id + '-s', 'A subtitle that explains it', 0, 0, 1200, 60, 42, '400') ] },`;

export function hostHtml({ url, nested = false }) {
  return `<html><body style="margin:0;background:#111">
<iframe id="ui" src="${url}?theme=dark" style="width:1040px;height:720px;border:0"></iframe>
<script>
const LIB = 'lib-1';
const comps = [
  { id: 'c-title', name: 'Title slide', path: 'Slides', kind: 'slide', width: 1920, height: 1080 },
  { id: 'c-content', name: 'Content', path: 'Slides', kind: 'slide', width: 1920, height: 1080 },
  { id: 'c-image', name: 'Image + text', path: 'Slides', kind: 'slide', width: 1920, height: 1080 },
  { id: 'a-logo', name: 'logo', path: 'Assets', kind: 'asset', width: 300, height: 90 },
];
const colors = [
  { id: 'col-1', libraryId: LIB, name: 'Primary', path: '', color: '#00d1b8', opacity: 1, isFlat: true },
  { id: 'col-2', libraryId: LIB, name: 'Pink', path: '', color: '#ff8cf4', opacity: 1, isFlat: true },
];
const typographies = [
  { id: 'ty-hero', libraryId: LIB, name: 'hero', path: '', fontId: 'gfont-work-sans', fontFamily: 'Work Sans', fontVariantId: '700', fontSize: 102, fontWeight: '700', fontStyle: 'normal', lineHeight: 1.2, letterSpacing: 0 },
  { id: 'ty-body', libraryId: LIB, name: 'paragraph', path: '', fontId: 'gfont-work-sans', fontFamily: 'Work Sans', fontVariantId: 'regular', fontSize: 32, fontWeight: '400', fontStyle: 'normal', lineHeight: 1.2, letterSpacing: 0 },
];
function canvasImg(color, label, w = 320, h = 180) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'); x.fillStyle = color; x.fillRect(0, 0, w, h);
  x.fillStyle = '#fff'; x.font = 'bold 28px sans-serif'; x.fillText(label, 16, h / 2); return c.toDataURL('image/png');
}
const logoSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="90"><rect width="300" height="90" rx="12" fill="#bf98ff"/><text x="20" y="58" font-size="40" fill="#fff">LOGO</text></svg>';
const svgUrl = (s) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s);
const text = (id, t, x, y, w, h, size, weight, typo) => ({ id, slotId: id, type: 'text', name: id, x, y, width: w, height: h, visible: true, opacity: 1, rotation: 0, text: t, fontSize: size, fontWeight: weight, fontFamily: 'Work Sans', fontId: 'gfont-work-sans', lineHeight: 1.2, letterSpacing: 0, textAlign: 'left', verticalAlign: 'top', fontColor: '#ffffff', typographyId: typo, typographyLibraryId: LIB, fills: [{ fillColor: '#ffffff', fillOpacity: 1 }] });
function payload(id) {
  const base = { componentId: id, libraryId: LIB, libraryName: 'Brand templates', componentName: comps.find(c => c.id === id).name, path: 'Slides', background: '#1c2022', backgroundFills: [{ fillColor: '#1c2022', fillOpacity: 1 }], width: 1920, height: 1080 };
  const logo = { id: id + '-logo', slotId: id + '-logo', type: 'component-instance', name: 'logo', x: 1560, y: 940, width: 300, height: 90, visible: true, opacity: 1, rotation: 0, libraryId: LIB, componentId: 'a-logo', componentName: 'logo', imageUrl: svgUrl(logoSvg), copyState: [], copyBase: { width: 300, height: 90 } };
  if (id === 'c-title') return { ...base, nodes: [
    text(id + '-t', 'Presentation title', 160, 380, 1200, 140, 102, '700', 'ty-hero'),
${nested ? NESTED_SUBTITLE : FLAT_SUBTITLE}
    logo ] };
  if (id === 'c-content') return { ...base, nodes: [
    text(id + '-t', 'Section title', 160, 120, 1600, 100, 72, '700'),
    text(id + '-b', 'Body copy for this content slide. Write your points here.', 160, 300, 1500, 400, 32, '400', 'ty-body'),
    logo ] };
  return { ...base, nodes: [
    { id: id + '-img', slotId: id + '-img', type: 'rect', name: 'photo', x: 960, y: 0, width: 960, height: 1080, visible: true, opacity: 1, rotation: 0, borderRadius: 0, fills: [{ fillOpacity: 1, fillImage: { id: 'media-1', width: 960, height: 1080, mtype: 'image/png' } }], imageUrl: canvasImg('#2e6', 'PHOTO', 480, 540) },
    text(id + '-t', 'Image slide', 120, 200, 760, 120, 72, '700'),
    text(id + '-c', 'Caption', 120, 900, 400, 40, 24, '400') ] };
}
window.__decks = {}; window.__index = []; window.__inserts = []; window.__renders = []; window.__created = []; window.__log = [];
const ui = () => document.getElementById('ui').contentWindow;
const send = (m) => ui().postMessage(m, '*');
window.addEventListener('message', async (e) => {
  const m = e.data; if (!m || !m.type) return; window.__log.push(m.type);
  switch (m.type) {
    case 'get-libraries': send({ type: 'libraries', fileId: 'f', fileName: 'Test file', localLibraryId: 'local-lib', libraries: [{ id: LIB, name: 'Brand templates', numComponents: 4, numSlides: 3, isLocal: false }] }); break;
    case 'list-decks': send({ type: 'decks', decks: window.__index }); break;
    case 'get-catalog': if (m.libraryId !== LIB) { send({ type: 'catalog', requestId: m.requestId, catalog: { libraryId: m.libraryId, components: [], colors: [], typographies: [] } }); break; } send({ type: 'catalog', requestId: m.requestId, catalog: { libraryId: LIB, components: comps.map(c => ({ ...c, libraryId: LIB })), colors, typographies } }); break;
    case 'get-thumbnails':
      for (const c of comps) { await new Promise(r => setTimeout(r, 30)); if (m.known[c.id] && !m.force) continue; send({ type: 'thumbnail', requestId: m.requestId, componentId: c.id, thumbnail: c.id === 'c-content' ? '<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080"><rect width="1920" height="1080" fill="#123"/><text x="100" y="500" style="font-family:Work Sans;font-size:200px;fill:#fff">Content</text></svg>' : canvasImg(c.kind === 'slide' ? '#334' : '#bf98ff', c.name), signature: 'sig-' + c.id }); }
      send({ type: 'thumbnails-complete', requestId: m.requestId }); break;
    case 'import-components':
      for (const it of m.items) { send({ type: 'import-progress', requestId: m.requestId, index: 0, total: m.items.length, componentId: it.componentId, componentName: it.componentName }); await new Promise(r => setTimeout(r, 50)); send({ type: 'import-item', requestId: m.requestId, payload: payload(it.componentId), warnings: [] }); }
      send({ type: 'import-complete', requestId: m.requestId, success: m.items.length, failed: 0 }); break;
    case 'get-asset': send({ type: 'asset', requestId: m.requestId, node: { id: 'x', type: 'component-instance', name: 'logo', x: 0, y: 0, width: 300, height: 90, visible: true, opacity: 1, rotation: 0, role: 'asset', libraryId: LIB, componentId: m.componentId, componentName: 'logo', svgMarkup: logoSvg, imageUrl: svgUrl(logoSvg) } }); break;
    case 'save-deck': window.__decks[m.summary.id] = m.deck; window.__index = [m.summary, ...window.__index.filter(d => d.id !== m.summary.id)]; send({ type: 'deck-saved', requestId: m.requestId, deckId: m.summary.id, ok: true }); break;
    case 'load-deck': send({ type: 'deck-loaded', deckId: m.deckId, deck: window.__decks[m.deckId] ?? null }); break;
    case 'delete-deck': delete window.__decks[m.deckId]; window.__index = window.__index.filter(d => d.id !== m.deckId); send({ type: 'decks', decks: window.__index }); break;
    case 'render-slide': {
      window.__renders.push(m.slide.id);
      await new Promise(r => setTimeout(r, 250));
      const sl = m.slide; const shapes = {}; let i = 0;
      const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
      const groups = sl.nodes.filter(n => n.visible).map(n => {
        const id = 'aaaaaaaa-0000-0000-0000-' + String(++i).padStart(12, '0');
        shapes[id] = n.id;
        const body = n.type === 'text'
          ? '<text x="' + n.x + '" y="' + (n.y + n.fontSize) + '" style="font-family:Work Sans;font-size:' + n.fontSize + 'px;fill:' + (n.fontColor || '#fff') + '">' + esc(n.text) + '</text>'
          : '<rect x="' + n.x + '" y="' + n.y + '" width="' + n.width + '" height="' + n.height + '" fill="url(#grad-' + i + ')"/><defs><linearGradient id="grad-' + i + '"><stop offset="0" stop-color="#f0f"/><stop offset="1" stop-color="#0ff"/></linearGradient></defs>';
        return '<g id="shape-' + id + '">' + body + '</g>';
      }).join('');
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + sl.width + '" height="' + sl.height + '" viewBox="0 0 ' + sl.width + ' ' + sl.height + '"><rect width="100%" height="100%" fill="' + sl.background + '"/>' + groups + '<scr' + 'ipt>window.__xss=1</scr' + 'ipt></svg>';
      send({ type: 'slide-render', requestId: m.requestId, slideId: sl.id, svg, shapes });
      break;
    }
    case 'get-fonts': send({ type: 'fonts', fonts: [
      { id: 'gfont-work-sans', name: 'Work Sans', custom: false, variants: ['100','200','300','400','500','600','700','800','900'].flatMap(w => [{ id: w === '400' ? 'regular' : w, name: w, weight: w, style: 'normal' }, { id: w + 'italic', name: w + ' Italic', weight: w, style: 'italic' }]) },
      { id: 'gfont-roboto', name: 'Roboto', custom: false, variants: [{ id: 'regular', name: 'Regular', weight: '400', style: 'normal' }, { id: '700', name: 'Bold', weight: '700', style: 'normal' }] },
      { id: 'custom-123', name: 'Brand Sans', custom: true, variants: [{ id: 'normal-400', name: 'Regular', weight: '400', style: 'normal' }, { id: 'normal-800', name: 'Extra Bold', weight: '800', style: 'normal' }] },
    ] }); break;
    case 'get-tokens': send({ type: 'tokens', tokens: [{ id: 't1', name: 'brand.accent', value: '#ff8800', setName: 'core' }] }); break;
    case 'create-typography': window.__created.push(m); send({ type: 'typography-created', requestId: m.requestId, typography: { id: 'ty-new', libraryId: 'local-lib', name: m.name.split('/').pop().trim(), path: '', fontId: m.style.fontId, fontFamily: m.style.fontFamily, fontVariantId: m.style.fontVariantId, fontSize: m.style.fontSize, fontWeight: m.style.fontWeight, fontStyle: 'normal', lineHeight: m.style.lineHeight, letterSpacing: m.style.letterSpacing } }); break;
    case 'create-color': window.__created.push(m); send({ type: 'color-created', requestId: m.requestId, color: { id: 'col-new', libraryId: 'local-lib', name: m.name, path: '', color: m.color, opacity: 1, isFlat: true } }); break;
    case 'find-deck': {
      const last = [...window.__inserts].reverse().find(i => i.deckId === m.deckId);
      send({ type: 'deck-placement', deckId: m.deckId, placement: last ? { deckId: m.deckId, pageId: 'p1', pageName: last.deckName, count: last.slides.length } : null });
      break;
    }
    case 'pull-deck': {
      const last = [...window.__inserts].reverse().find(i => i.deckId === m.deckId);
      const slides = (last?.slides ?? []).filter(s => s.id in m.templates).map((s, i) => {
        const nodes = JSON.parse(JSON.stringify(s.nodes));
        if (i === 0) { const t = nodes.find(n => n.type === 'text'); if (t) { t.text = 'Desde Penpot'; t.edited = true; } }
        return { slideId: s.id, nodes, background: s.background, backgroundFills: s.backgroundFills, notes: 'nota de Penpot' };
      });
      await new Promise(r => setTimeout(r, 100));
      send({ type: 'deck-pulled', requestId: m.requestId, deckId: m.deckId, slides, warnings: [] });
      break;
    }
    case 'set-maximized': window.__maximized = m.maximized; send({ type: 'window-state', maximized: m.maximized }); break;
    case 'get-window-state': send({ type: 'window-state', maximized: !!window.__maximized }); break;
    case 'insert-into-canvas': window.__inserts.push(m); if (m.settings.mode === 'update' && window.__inserts.length > 1) { send({ type: 'insert-complete', count: m.slides.length, warnings: [], updated: m.slides.length, added: 0, removed: 0, pageName: m.deckName }); break; } send({ type: 'insert-complete', count: m.slides.length, warnings: [] }); break;
  }
});
</script></body></html>`;
}
