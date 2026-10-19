import type { Shape } from '@penpot/plugin-types';
import { DATA_NS } from './persistence';
import { readChildren } from './media';

// ─── Scratch jobs ────────────────────────────────────────────────────────────
// Work that builds temporary shapes (previews, imports) happens off-canvas,
// one job at a time and inside an undo block, so it never interleaves with an
// insert and leaves a single, empty entry in the user's history. Temporary
// shapes are tagged and swept if a job is interrupted.

export const SCRATCH_X = -200000;
export const SCRATCH_Y = -200000;

let scratchQueue: Promise<unknown> = Promise.resolve();

export function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = scratchQueue.then(() => {
    sweepScratch();
    return fn();
  });
  scratchQueue = run.catch(() => undefined);
  return run;
}

export async function withUndoBlock<T>(fn: () => Promise<T>): Promise<T> {
  let block: ReturnType<typeof penpot.history.undoBlockBegin> | null = null;
  try {
    block = penpot.history.undoBlockBegin();
  } catch {
    block = null;
  }
  try {
    return await fn();
  } finally {
    if (block) {
      try {
        penpot.history.undoBlockFinish(block);
      } catch {
        // History is best effort.
      }
    }
  }
}

export function removeQuietly(shape: Shape | null | undefined) {
  try {
    shape?.remove();
  } catch {
    // Already gone.
  }
}

// Temporary shapes are tagged so that, if the plugin is closed in the middle
// of a job, the next run finds and removes them.
const SCRATCH_KEY = 'scratch';

export function markScratch<T extends Shape>(shape: T): T {
  try {
    shape.setSharedPluginData(DATA_NS, SCRATCH_KEY, '1');
  } catch {
    // Untagged: still removed by the job itself.
  }
  return shape;
}

export function sweepScratch() {
  try {
    const root = penpot.root;
    if (!root) return;
    for (const shape of readChildren(root)) {
      if (shape.getSharedPluginData(DATA_NS, SCRATCH_KEY) === '1') removeQuietly(shape);
    }
  } catch {
    // Nothing to clean.
  }
}
