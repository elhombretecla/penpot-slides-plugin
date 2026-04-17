/**
 * API bridge between React UI and plugin.ts via postMessage.
 * All functions send typed messages to plugin.ts and return void;
 * responses are handled in App.tsx via a global message listener.
 */
import type { UIMessage, Slide, ExportSettings, ImportItemRequest } from './types';

function send(message: UIMessage) {
  parent.postMessage(message, '*');
}

export const penpotApi = {
  getLibraries: () => send({ type: 'get-libraries' }),
  getComponents: (libraryId: string) => send({ type: 'get-components', libraryId }),
  importComponents: (requestId: string, items: ImportItemRequest[]) =>
    send({ type: 'import-components', requestId, items }),
  insertIntoCanvas: (slides: Slide[], settings: ExportSettings) =>
    send({ type: 'insert-into-canvas', slides, settings }),
  resize: (width: number, height: number) =>
    send({ type: 'resize', width, height }),
};
