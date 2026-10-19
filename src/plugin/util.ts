import type { PluginMessage } from '../types';

// ─── Serialisation helpers ────────────────────────────────────────────────────

// Plain deep-clone for serialisable payloads (fills, strokes…) so snapshots
// are decoupled from the live Penpot shape and survive postMessage.
export function clonePlain<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value)) as T;
  }
}

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunkSize)));
  }
  return btoa(binary);
}

export function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function stringifyErr(err: unknown): string {
  if (err instanceof Error) return err.message || err.toString();
  try {
    return typeof err === 'string' ? err : JSON.stringify(err);
  } catch {
    return String(err);
  }
}


// ─── Helpers ──────────────────────────────────────────────────────────────────

export function send(message: PluginMessage) {
  penpot.ui.sendMessage(message);
}

export function sendError(message: string) {
  send({ type: 'error', message });
}

export function dedupe(items: string[]): string[] {
  return [...new Set(items)];
}

// FNV-1a, 32 bit, plus length (same as the UI's render keys). Kept here: the
// plugin bundle must not share code with the UI (see eslint.config.js).
export function hashString(value: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36) + value.length.toString(36);
}
