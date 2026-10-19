import { useEffect, useMemo, useState } from 'react';
import { useSlideStore } from '../store';
import { penpotApi } from '../api';
import { getFilteredComponents } from '../utils';
import { applyTemplates, itemFromComponent } from '../templateActions';
import type { ComponentInfo } from '../types';

export default function LibraryPicker() {
  const libraries = useSlideStore((s) => s.libraries);
  const librariesLoading = useSlideStore((s) => s.librariesLoading);
  const setLibrariesLoading = useSlideStore((s) => s.setLibrariesLoading);
  const catalogs = useSlideStore((s) => s.catalogs);
  const catalogLoading = useSlideStore((s) => s.catalogLoading);
  const requestCatalog = useSlideStore((s) => s.requestCatalog);
  const requestThumbnails = useSlideStore((s) => s.requestThumbnails);
  const thumbnailsPending = useSlideStore((s) => s.thumbnailsPending);
  const selectedComponentIds = useSlideStore((s) => s.selectedComponentIds);
  const toggleComponentSelection = useSlideStore((s) => s.toggleComponentSelection);
  const searchQuery = useSlideStore((s) => s.searchQuery);
  const setSearchQuery = useSlideStore((s) => s.setSearchQuery);
  const activeLibraryId = useSlideStore((s) => s.activeLibraryId);
  const setActiveLibraryId = useSlideStore((s) => s.setActiveLibraryId);
  const intent = useSlideStore((s) => s.pickerIntent);
  const deck = useSlideStore((s) => s.deck);
  const setScreen = useSlideStore((s) => s.setScreen);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (libraries.length === 0) {
      setLibrariesLoading(true);
      penpotApi.getLibraries();
    }
  }, [libraries.length, setLibrariesLoading]);

  useEffect(() => {
    if (!activeLibraryId && libraries.length > 0) {
      setActiveLibraryId((libraries.find((l) => l.numSlides > 0) ?? libraries[0]).id);
    }
  }, [activeLibraryId, libraries, setActiveLibraryId]);

  // (Re)load the catalog whenever the library changes: the list is cheap and
  // the thumbnail pass only re-renders components that changed.
  useEffect(() => {
    if (activeLibraryId) requestCatalog(activeLibraryId);
  }, [activeLibraryId, requestCatalog]);

  const catalog = activeLibraryId ? catalogs[activeLibraryId] : undefined;
  const all = useMemo(() => catalog?.components ?? [], [catalog]);
  const slideCount = all.filter((c) => c.kind === 'slide').length;
  // Libraries without recognisable layouts show everything.
  const pool = showAll || slideCount === 0 ? all : all.filter((c) => c.kind === 'slide');
  const filtered = getFilteredComponents(pool, searchQuery);
  const grouped = groupBySection(filtered);
  const selected = selectedComponentIds
    .map((id) => all.find((c) => c.id === id))
    .filter((c): c is ComponentInfo => !!c);

  const title =
    intent.kind === 'change-layout'
      ? 'Change layout'
      : intent.kind === 'add-slides'
        ? 'Add slides from a library'
        : 'New presentation from a library';

  function goBack() {
    setScreen(deck ? 'slide-manager' : 'home');
  }

  function confirm(components: ComponentInfo[]) {
    if (components.length === 0) return;
    const items = components.map(itemFromComponent);
    const state = useSlideStore.getState();
    if (intent.kind === 'change-layout') {
      applyTemplates(items.slice(0, 1), { kind: 'change-layout', slideId: intent.slideId });
      return;
    }
    if (intent.kind === 'new-deck' || !state.deck) {
      const lib = libraries.find((l) => l.id === activeLibraryId);
      state.newDeck('Untitled presentation', lib ? { id: lib.id, name: lib.name.replace(/ \(this file\)$/, '') } : undefined);
      applyTemplates(items, { kind: 'add-slides', insertAfterSlideId: null });
      return;
    }
    applyTemplates(items, { kind: 'add-slides', insertAfterSlideId: intent.afterSlideId });
  }

  const ctaLabel =
    intent.kind === 'change-layout'
      ? 'Apply layout'
      : intent.kind === 'add-slides' && deck
        ? `Add ${selected.length} slide${selected.length !== 1 ? 's' : ''}`
        : `Create with ${selected.length} slide${selected.length !== 1 ? 's' : ''}`;

  return (
    <div className="library-picker">
      <div className="picker-topbar">
        <button className="btn-icon" onClick={goBack} title="Back">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 5l-7 7 7 7"/>
          </svg>
        </button>
        <span className="title-s picker-title">{title}</span>
      </div>

      <div className="picker-body">
        <div className="picker-sidebar">
          <select
            className="select"
            value={activeLibraryId ?? ''}
            onChange={(e) => setActiveLibraryId(e.target.value)}
            disabled={librariesLoading}
          >
            {libraries.length === 0 && <option value="">No libraries found</option>}
            {libraries.map((lib) => (
              <option key={lib.id} value={lib.id}>{lib.name}</option>
            ))}
          </select>

          <div className="picker-search-wrap">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="picker-search-icon">
              <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
            </svg>
            <input
              className="input picker-search"
              type="text"
              placeholder="Search layouts…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {slideCount > 0 && slideCount < all.length && (
            <label className="picker-check body-xs">
              <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
              Show all components ({all.length})
            </label>
          )}

          <p className="body-xs picker-hint">
            {intent.kind === 'change-layout'
              ? 'Your edited texts and images move to the matching places of the new layout.'
              : 'Click to select, double-click to add one right away. Logos and icons are in the editor’s Insert tab.'}
          </p>

          {activeLibraryId && (
            <button
              className="btn-link picker-refresh"
              onClick={() => void requestThumbnails(activeLibraryId, true)}
              disabled={thumbnailsPending.size > 0}
            >
              {thumbnailsPending.size > 0 ? `Rendering previews (${thumbnailsPending.size})…` : 'Refresh previews'}
            </button>
          )}

          {selected.length > 0 && (
            <button data-appearance="primary" className="picker-add-btn" onClick={() => confirm(selected)}>
              {ctaLabel}
            </button>
          )}
        </div>

        <div className="picker-content">
          {catalogLoading && !catalog ? (
            <div className="picker-loading">
              <div className="spinner" />
              <span className="body-s">Loading components…</span>
            </div>
          ) : libraries.length === 0 ? (
            <div className="picker-empty">
              <p className="body-s">No libraries with components.</p>
              <p className="body-xs picker-empty-hint">Connect a shared library from the home screen.</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="picker-empty">
              <p className="body-s">No components match your search.</p>
              <button className="btn-link" onClick={() => setSearchQuery('')}>Clear search</button>
            </div>
          ) : (
            <div className="component-sections">
              {Object.entries(grouped).map(([section, comps]) => (
                <div key={section} className="component-section">
                  <div className="component-section-header">
                    <span className="headline-s" style={{ color: 'var(--foreground-secondary)' }}>{section}</span>
                    <span className="body-xs component-section-count">{comps.length}</span>
                  </div>
                  <div className="component-grid">
                    {comps.map((comp) => (
                      <ComponentCard
                        key={comp.id}
                        component={comp}
                        selected={selectedComponentIds.includes(comp.id)}
                        order={selectedComponentIds.indexOf(comp.id)}
                        showOrder={intent.kind !== 'change-layout' && selectedComponentIds.length > 1}
                        onToggle={() => toggleComponentSelection(comp.id)}
                        onQuickAdd={() => confirm([comp])}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Component Card ───────────────────────────────────────────────────────────

interface ComponentCardProps {
  component: ComponentInfo;
  selected: boolean;
  order: number;
  showOrder: boolean;
  onToggle: () => void;
  onQuickAdd: () => void;
}

function ComponentCard({ component, selected, order, showOrder, onToggle, onQuickAdd }: ComponentCardProps) {
  const thumbnail = useSlideStore((s) => s.thumbnailsMap[component.id]);
  const isPending = useSlideStore((s) => s.thumbnailsPending.has(component.id));
  const initials = component.name
    .split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const ratio = component.width && component.height ? component.width / component.height : 16 / 9;

  return (
    <button
      className={`component-card ${selected ? 'selected' : ''}`}
      onClick={onToggle}
      onDoubleClick={onQuickAdd}
      title={`${component.name}${component.width ? ` — ${Math.round(component.width)}×${Math.round(component.height ?? 0)}` : ''}`}
    >
      <div className="component-thumbnail" style={{ aspectRatio: String(Math.min(2.4, Math.max(0.6, ratio))) }}>
        {selected && (
          <span className="component-check">
            {showOrder ? (
              <span className="component-order">{order + 1}</span>
            ) : (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            )}
          </span>
        )}
        {thumbnail ? (
          <img className="component-preview-img" src={thumbnail} alt={component.name} draggable={false} />
        ) : isPending ? (
          <div className="component-preview-loading">
            <div className="spinner spinner--sm" />
          </div>
        ) : (
          <div className="component-preview-placeholder">
            <span className="component-initials">{initials}</span>
          </div>
        )}
      </div>
      <span className="component-name">{component.name}</span>
    </button>
  );
}

// Natural collator so "Slide 2" sorts before "Slide 10" instead of after it.
const NAME_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function groupBySection(components: ComponentInfo[]): Record<string, ComponentInfo[]> {
  const groups: Record<string, ComponentInfo[]> = {};
  for (const comp of components) {
    const section = comp.path || 'Components';
    (groups[section] ??= []).push(comp);
  }
  for (const key of Object.keys(groups)) {
    groups[key].sort((a, b) => NAME_COLLATOR.compare(a.name, b.name));
  }
  return groups;
}
