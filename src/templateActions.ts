import { penpotApi } from './api';
import { applyLayout, resetToTemplate, slideFromImported } from './deck';
import { useSlideStore } from './store';
import type { ComponentInfo, ImportItemRequest, ImportPurpose, Slide } from './types';

// Templates already read in this session are applied instantly; the rest go
// through one import job. The full ordered list is remembered per job so the
// result keeps the order the user picked, cached or not.
const jobOrder = new Map<string, ImportItemRequest[]>();

export function itemFromComponent(comp: ComponentInfo): ImportItemRequest {
  return {
    componentId: comp.id,
    libraryId: comp.libraryId,
    componentName: comp.name,
    width: comp.width,
    height: comp.height,
  };
}

export function applyTemplates(items: ImportItemRequest[], purpose: ImportPurpose) {
  const store = useSlideStore.getState();
  const missing = items.filter((i) => !store.getCachedComponent(i.libraryId, i.componentId));
  if (missing.length === 0) {
    runTemplatePurpose(purpose, items);
    return;
  }
  const requestId = store.startImportJob(missing, purpose);
  jobOrder.set(requestId, items);
  penpotApi.importComponents(requestId, missing);
}

// Called by App when the plugin reports the import job as done.
export function finishTemplateJob(requestId: string) {
  const state = useSlideStore.getState();
  const job = state.importJob;
  if (!job || job.requestId !== requestId) return;
  const items = jobOrder.get(requestId) ?? job.items;
  jobOrder.delete(requestId);

  runTemplatePurpose(job.purpose, items);

  // The progress overlay closes after a moment, so failures must outlive it.
  if (job.errors.length > 0) {
    state.pushNotice(
      'error',
      `${job.errors.length} template${job.errors.length !== 1 ? 's' : ''} could not be imported.`,
      job.errors.map((e) => `${e.componentName}: ${e.message}`)
    );
  }
  if (job.warnings.length > 0) {
    state.pushNotice(
      'warning',
      `Imported with ${job.warnings.length} issue${job.warnings.length !== 1 ? 's' : ''}: some elements were simplified or skipped.`,
      [...new Set(job.warnings)]
    );
  }

  window.setTimeout(() => {
    const current = useSlideStore.getState().importJob;
    if (current && current.requestId === requestId) useSlideStore.getState().clearImportJob();
  }, 600);
}

function runTemplatePurpose(purpose: ImportPurpose, items: ImportItemRequest[]) {
  const state = useSlideStore.getState();
  const payloads = items
    .map((i) => state.getCachedComponent(i.libraryId, i.componentId))
    .filter((p): p is NonNullable<typeof p> => !!p);
  state.clearComponentSelection();
  if (payloads.length === 0) return;

  switch (purpose.kind) {
    case 'add-slides': {
      const slides: Slide[] = payloads.map((p) => slideFromImported(p, { name: p.componentName }));
      state.commitHistory();
      state.addSlides(slides, purpose.insertAfterSlideId);
      // The first template library used becomes the deck's theme.
      if (state.deck && !state.deck.libraryId) {
        state.updateDeck({ libraryId: payloads[0].libraryId, libraryName: payloads[0].libraryName });
      }
      state.setScreen('slide-manager');
      break;
    }
    case 'change-layout': {
      const old = state.slides.find((s) => s.id === purpose.slideId);
      if (!old) break;
      const { slide, keptAsElements } = applyLayout(old, payloads[0]);
      state.commitHistory();
      state.replaceSlide(slide);
      state.setActiveSlide(slide.id);
      state.setScreen('slide-manager');
      if (keptAsElements > 0) {
        state.pushNotice(
          'warning',
          `${keptAsElements} edited element${keptAsElements !== 1 ? 's' : ''} had no place in the new layout and ${keptAsElements !== 1 ? 'were' : 'was'} kept on top of it.`
        );
      } else {
        state.pushNotice('success', `Layout changed to “${payloads[0].componentName}”.`);
      }
      break;
    }
    case 'reset-slide': {
      const old = state.slides.find((s) => s.id === purpose.slideId);
      if (!old) break;
      state.commitHistory();
      state.replaceSlide(resetToTemplate(old, payloads[0]));
      state.pushNotice('success', 'Slide reset to its template.');
      break;
    }
    case 'cache-only':
      break;
  }
}
