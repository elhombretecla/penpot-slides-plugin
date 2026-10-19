import type { SlideNode, LibraryInfo, ComponentInfo, ComponentKind, LibraryColorInfo, LibraryTypographyInfo, FontInfo, ColorTokenInfo } from '../types';
import type { Library, LibraryComponent, LibraryColor, LibraryTypography, Token, Shape } from '@penpot/plugin-types';
import { typographyLineHeight, typographyTransform } from './import';
import { stringifyErr, send, sendError } from './util';

// ─── Library Handlers ─────────────────────────────────────────────────────────

export function allLibraries() {
  return [penpot.library.local, ...penpot.library.connected];
}

export function findLibrary(libraryId: string | undefined) {
  return allLibraries().find((l) => l.id === libraryId) ?? null;
}

export function findLibraryComponent(libraryId: string | undefined, componentId: string | undefined) {
  if (!componentId) return null;
  // Prefer the declared library, but fall back to any library holding the id:
  // a template opened from the library file itself reports it as "local".
  const libs = allLibraries();
  const preferred = libs.find((l) => l.id === libraryId);
  const ordered = preferred ? [preferred, ...libs.filter((l) => l !== preferred)] : libs;
  for (const lib of ordered) {
    const comp = lib.components.find((c) => c.id === componentId);
    if (comp) return { lib, comp };
  }
  return null;
}

// Slide layouts are big boards with a screen-like aspect ratio; everything
// else (logos, icons, bullets…) is offered as an insertable element.
function classifyComponent(comp: LibraryComponent): { kind: ComponentKind; width?: number; height?: number } {
  try {
    const main = comp.mainInstance();
    if (!main) return { kind: 'asset' };
    const { width, height } = main;
    const ratio = width / Math.max(1, height);
    const hinted = /slide|layout|cover|plantilla|diapositiva/i.test(`${comp.path}/${comp.name}`);
    const big = width >= 600 && height >= 300;
    const screenLike = ratio >= 1.2 && ratio <= 2.4;
    const isSlide = main.type === 'board' && big && (screenLike || hinted);
    return { kind: isSlide ? 'slide' : 'asset', width, height };
  } catch {
    // The main instance may be unavailable (e.g. not loaded yet).
    return { kind: 'asset' };
  }
}

export function handleGetLibraries() {
  try {
    const local = penpot.library.local;
    // `connected` can also list the file's own library — skip it, it is
    // already represented by `local`.
    const connected = penpot.library.connected.filter(
      (lib) => lib.id !== local.id && lib.components.length > 0
    );

    const describe = (lib: Library, isLocal: boolean): LibraryInfo => ({
      id: lib.id,
      name: isLocal ? `${lib.name} (this file)` : lib.name,
      numComponents: lib.components.length,
      numSlides: lib.components.filter((c) => classifyComponent(c).kind === 'slide').length,
      isLocal,
    });

    const libraries = [describe(local, true), ...connected.map((l) => describe(l, false))].filter(
      (lib) => lib.numComponents > 0
    );

    send({
      type: 'libraries',
      libraries,
      fileId: penpot.currentFile?.id ?? '',
      fileName: penpot.currentFile?.name ?? '',
      localLibraryId: local.id,
    });
  } catch (err) {
    sendError('Failed to load libraries: ' + stringifyErr(err));
  }
}

export async function handleGetAvailableLibraries() {
  try {
    const connected = new Set([penpot.library.local.id, ...penpot.library.connected.map((l) => l.id)]);
    const available = await penpot.library.availableLibraries();
    send({
      type: 'available-libraries',
      libraries: available
        .filter((l) => !connected.has(l.id) && l.numComponents > 0)
        .map((l) => ({ id: l.id, name: l.name, numComponents: l.numComponents })),
    });
  } catch (err) {
    send({ type: 'available-libraries', libraries: [] });
    sendError('Could not list the team libraries: ' + stringifyErr(err));
  }
}

export async function handleConnectLibrary(libraryId: string) {
  try {
    await penpot.library.connectLibrary(libraryId);
    send({ type: 'library-connected', libraryId });
    handleGetLibraries();
  } catch (err) {
    sendError('Could not connect the library: ' + stringifyErr(err));
  }
}

export function handleGetCatalog(requestId: string, libraryId: string) {
  try {
    const lib = findLibrary(libraryId);
    if (!lib) {
      sendError(`Library not found: ${libraryId}`);
      return;
    }

    const components: ComponentInfo[] = lib.components.map((comp) => ({
      id: comp.id,
      libraryId,
      name: comp.name,
      path: comp.path ?? '',
      ...classifyComponent(comp),
    }));

    const colors = lib.colors.map((c) => colorInfo(c, libraryId));
    const typographies = lib.typographies.map((t) => typographyInfo(t, libraryId));

    send({ type: 'catalog', requestId, catalog: { libraryId, components, colors, typographies } });
  } catch (err) {
    sendError('Failed to load components: ' + stringifyErr(err));
  }
}

function colorInfo(c: LibraryColor, libraryId: string): LibraryColorInfo {
  return {
    id: c.id,
    libraryId,
    name: c.name,
    path: c.path ?? '',
    color: c.color,
    opacity: c.opacity,
    isFlat: !!c.color && !c.gradient && !c.image,
  };
}

function typographyInfo(t: LibraryTypography, libraryId: string): LibraryTypographyInfo {
  return {
    id: t.id,
    libraryId,
    name: t.name,
    path: t.path ?? '',
    fontId: t.fontId,
    fontFamily: t.fontFamily,
    fontVariantId: t.fontVariantId,
    fontSize: parseFloat(t.fontSize) || 14,
    fontWeight: String(t.fontWeight ?? '400'),
    fontStyle: t.fontStyle === 'italic' ? 'italic' : 'normal',
    lineHeight: typographyLineHeight(t),
    letterSpacing: parseFloat(t.letterSpacing) || 0,
    textTransform: typographyTransform(t),
  };
}

// ─── Fonts, tokens, new library styles ───────────────────────────────────────

export function handleGetFonts() {
  try {
    const fonts: FontInfo[] = penpot.fonts.all.map((f) => ({
      id: f.fontId,
      name: f.name,
      custom: !String(f.fontId).startsWith('gfont-'),
      variants: f.variants.map((v) => ({
        id: v.fontVariantId,
        name: v.name,
        weight: String(v.fontWeight ?? '400'),
        style: v.fontStyle === 'italic' ? 'italic' : 'normal',
      })),
    }));
    send({ type: 'fonts', fonts });
  } catch (err) {
    send({ type: 'fonts', fonts: [] });
    sendError('Could not read the fonts: ' + stringifyErr(err));
  }
}

// Color tokens of the file's active sets (later sets win, as in Penpot).
function activeColorTokens(): { token: Token; setName: string }[] {
  const byName = new Map<string, { token: Token; setName: string }>();
  try {
    for (const set of penpot.library.local.tokens.sets) {
      if (!set.active) continue;
      for (const token of set.tokens) {
        if (token.type === 'color') byName.set(token.name, { token, setName: set.name });
      }
    }
  } catch {
    // No token catalog in this Penpot version.
  }
  return [...byName.values()];
}

export function handleGetTokens() {
  const tokens: ColorTokenInfo[] = activeColorTokens()
    .map(({ token, setName }) => ({
      id: token.id,
      name: token.name,
      value: String((token as { resolvedValue?: unknown }).resolvedValue ?? ''),
      setName,
    }))
    .filter((t) => /^#[0-9a-f]{3,8}$/i.test(t.value));
  send({ type: 'tokens', tokens });
}

function findColorToken(name: string): Token | null {
  return activeColorTokens().find((t) => t.token.name === name)?.token ?? null;
}

// Bind the shape's fill to a color token (values already match: this keeps
// the link so the token can be changed later in Penpot).
export function applyFillToken(shape: Shape, node: SlideNode, warnings: string[]) {
  if (!node.fillToken) return;
  try {
    if ((shape.tokens as Record<string, string> | undefined)?.fill === node.fillToken) return;
    const token = findColorToken(node.fillToken);
    if (!token) {
      warnings.push(`Color token "${node.fillToken}" is not active in this file — kept its color unlinked.`);
      return;
    }
    shape.applyToken(token, ['fill']);
  } catch (err) {
    warnings.push(`"${node.name}": could not apply token ${node.fillToken} (${stringifyErr(err)}).`);
  }
}

// "Group / Name" in the UI becomes path + name, as Penpot's assets panel does.
function splitAssetName(full: string): { path: string; name: string } {
  const parts = full.split('/').map((p) => p.trim()).filter(Boolean);
  const name = parts.pop() ?? 'Untitled';
  return { path: parts.join(' / '), name };
}

export function handleCreateTypography(requestId: string, fullName: string, style: Partial<SlideNode>) {
  try {
    const typography = penpot.library.local.createTypography();
    const { path, name } = splitAssetName(fullName);
    typography.name = name;
    if (path) typography.path = path;
    const font =
      (style.fontId ? penpot.fonts.findById(style.fontId) : null) ??
      (style.fontFamily ? penpot.fonts.findByName(style.fontFamily) : null);
    if (font) {
      const variant =
        font.variants.find((v) => v.fontVariantId === style.fontVariantId) ??
        font.variants.find((v) => v.fontWeight === (style.fontWeight ?? '400') && v.fontStyle === (style.fontStyle ?? 'normal')) ??
        undefined;
      typography.setFont(font, variant);
    }
    if (style.fontSize != null) typography.fontSize = String(style.fontSize);
    if (style.lineHeight != null) typography.lineHeight = String(style.lineHeight);
    if (style.letterSpacing != null) typography.letterSpacing = String(style.letterSpacing);
    typography.textTransform = style.textTransform ?? null;
    send({ type: 'typography-created', requestId, typography: typographyInfo(typography, penpot.library.local.id) });
  } catch (err) {
    send({ type: 'typography-created', requestId, typography: null, message: stringifyErr(err) });
  }
}

export function handleCreateColor(requestId: string, fullName: string, color: string, opacity: number) {
  try {
    const libraryColor = penpot.library.local.createColor();
    const { path, name } = splitAssetName(fullName);
    libraryColor.name = name;
    if (path) libraryColor.path = path;
    libraryColor.color = color.toUpperCase();
    libraryColor.opacity = opacity;
    send({ type: 'color-created', requestId, color: colorInfo(libraryColor, penpot.library.local.id) });
  } catch (err) {
    send({ type: 'color-created', requestId, color: null, message: stringifyErr(err) });
  }
}
