import { v4 as uuidv4 } from 'uuid';
import { penpotApi } from './api';
import type { LibraryColorInfo, LibraryTypographyInfo, SlideNode } from './types';

// Text styles and colors saved from the editor into the file's own library.
// Requests are answered asynchronously by the plugin; callers get a promise.

type Pending = { resolve: (value: unknown) => void; reject: (err: Error) => void };
const pending = new Map<string, Pending>();

export function resolveCreated(requestId: string, value: unknown, message?: string) {
  const p = pending.get(requestId);
  if (!p) return;
  pending.delete(requestId);
  if (value) p.resolve(value);
  else p.reject(new Error(message ?? 'Penpot did not create it.'));
}

function request<T>(send: (requestId: string) => void): Promise<T> {
  const requestId = uuidv4();
  return new Promise<T>((resolve, reject) => {
    pending.set(requestId, { resolve: resolve as (v: unknown) => void, reject });
    send(requestId);
    window.setTimeout(() => {
      if (pending.delete(requestId)) reject(new Error('Penpot did not answer in time.'));
    }, 15_000);
  });
}

export function createTextStyle(name: string, node: SlideNode): Promise<LibraryTypographyInfo> {
  const style: Partial<SlideNode> = {
    fontId: node.fontId,
    fontFamily: node.fontFamily,
    fontVariantId: node.fontVariantId,
    fontSize: node.fontSize,
    fontWeight: node.fontWeight,
    fontStyle: node.fontStyle,
    lineHeight: node.lineHeight,
    letterSpacing: node.letterSpacing,
    textTransform: node.textTransform,
  };
  return request((id) => penpotApi.createTypography(id, name, style));
}

export function createLibraryColor(name: string, color: string, opacity = 1): Promise<LibraryColorInfo> {
  return request((id) => penpotApi.createColor(id, name, color, opacity));
}
