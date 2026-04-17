import { useEffect, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useSlideStore } from '../store';
import { penpotApi } from '../api';
import { isSlideLike, getFilteredComponents } from '../utils';
import type { Slide, ComponentInfo } from '../types';
import { SLIDE_SIZE_PRESETS } from '../types';

const FILTERS = ['All Slides', 'Title Slides', 'Content & Features', 'Charts & Data'];

export default function LibraryPicker() {
  const setScreen = useSlideStore((s) => s.setScreen);
  const libraries = useSlideStore((s) => s.libraries);
  const librariesLoading = useSlideStore((s) => s.librariesLoading);
  const setLibrariesLoading = useSlideStore((s) => s.setLibrariesLoading);
  const componentsMap = useSlideStore((s) => s.componentsMap);
  const componentsLoading = useSlideStore((s) => s.componentsLoading);
  const setComponentsLoading = useSlideStore((s) => s.setComponentsLoading);
  const selectedComponentIds = useSlideStore((s) => s.selectedComponentIds);
  const selectedComponentLibraryMap = useSlideStore((s) => s.selectedComponentLibraryMap);
  const toggleComponentSelection = useSlideStore((s) => s.toggleComponentSelection);
  const clearComponentSelection = useSlideStore((s) => s.clearComponentSelection);
  const addSlides = useSlideStore((s) => s.addSlides);
  const searchQuery = useSlideStore((s) => s.searchQuery);
  const setSearchQuery = useSlideStore((s) => s.setSearchQuery);
  const activeLibraryId = useSlideStore((s) => s.activeLibraryId);
  const setActiveLibraryId = useSlideStore((s) => s.setActiveLibraryId);
  const activeFilter = useSlideStore((s) => s.activeFilter);
  const setActiveFilter = useSlideStore((s) => s.setActiveFilter);

  useEffect(() => {
    if (libraries.length === 0) {
      setLibrariesLoading(true);
      penpotApi.getLibraries();
    }
  }, [libraries.length, setLibrariesLoading]);

  useEffect(() => {
    if (activeLibraryId && !componentsMap[activeLibraryId]) {
      setComponentsLoading(true);
      penpotApi.getComponents(activeLibraryId);
    }
  }, [activeLibraryId, componentsMap, setComponentsLoading]);

  useEffect(() => {
    if (!activeLibraryId && libraries.length > 0) {
      setActiveLibraryId(libraries[0].id);
    }
  }, [activeLibraryId, libraries, setActiveLibraryId]);

  const handleLibraryChange = useCallback(
    (libraryId: string) => {
      setActiveLibraryId(libraryId);
      if (!componentsMap[libraryId]) {
        setComponentsLoading(true);
        penpotApi.getComponents(libraryId);
      }
    },
    [componentsMap, setActiveLibraryId, setComponentsLoading]
  );

  const currentComponents: ComponentInfo[] = activeLibraryId
    ? (componentsMap[activeLibraryId] ?? [])
    : [];

  const filteredComponents = getFilteredComponents(currentComponents, searchQuery, activeFilter);
  const grouped = groupBySection(filteredComponents);

  function handleAddSelected() {
    const newSlides: Slide[] = Array.from(selectedComponentIds).map((componentId, idx) => {
      const libraryId = selectedComponentLibraryMap[componentId] ?? '';
      const comp = currentComponents.find((c) => c.id === componentId);
      const name = comp?.name ?? `Slide ${idx + 1}`;
      const size = SLIDE_SIZE_PRESETS['16:9'];
      return {
        id: uuidv4(),
        name,
        source: 'library-component' as const,
        width: comp?.width ?? size.width,
        height: comp?.height ?? size.height,
        background: '#18181a',
        nodes: [],
        libraryId,
        componentId,
        componentName: name,
      };
    });
    addSlides(newSlides);
    clearComponentSelection();
    setScreen('slide-manager');
  }

  return (
    <div className="library-picker">
      {/* Top bar */}
      <div className="picker-topbar">
        <button className="btn-icon" onClick={() => setScreen('home')} title="Back">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 5l-7 7 7 7"/>
          </svg>
        </button>
        <span className="title-s picker-title">Import from Library</span>
        <button className="btn-icon" onClick={() => setScreen('slide-manager')} title="Close">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>

      <div className="picker-body">
        {/* Left sidebar */}
        <div className="picker-sidebar">
          {/* Library dropdown */}
          <select
            className="select"
            value={activeLibraryId ?? ''}
            onChange={(e) => handleLibraryChange(e.target.value)}
            disabled={librariesLoading}
          >
            {libraries.length === 0 && <option value="">No libraries found</option>}
            {libraries.map((lib) => (
              <option key={lib.id} value={lib.id}>{lib.name}</option>
            ))}
          </select>

          {/* Search */}
          <div className="picker-search-wrap">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="picker-search-icon">
              <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
            </svg>
            <input
              className="input picker-search"
              type="text"
              placeholder="Search components..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {/* Filters */}
          <div className="picker-filters">
            <span className="picker-filters-label">FILTERS</span>
            {FILTERS.map((f) => (
              <button
                key={f}
                className={`picker-filter-btn ${activeFilter === f ? 'active' : ''}`}
                onClick={() => setActiveFilter(f)}
              >
                {f}
              </button>
            ))}
          </div>

          {/* Add CTA */}
          {selectedComponentIds.size > 0 && (
            <button
              data-appearance="primary"
              className="picker-add-btn"
              onClick={handleAddSelected}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              Add Selected ({selectedComponentIds.size})
            </button>
          )}
        </div>

        {/* Right content */}
        <div className="picker-content">
          {componentsLoading ? (
            <div className="picker-loading">
              <div className="spinner" />
              <span className="body-s">Loading components…</span>
            </div>
          ) : libraries.length === 0 ? (
            <div className="picker-empty">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.25">
                <rect x="3" y="3" width="8" height="8" rx="1"/>
                <rect x="13" y="3" width="8" height="8" rx="1"/>
                <rect x="3" y="13" width="8" height="8" rx="1"/>
                <rect x="13" y="13" width="8" height="8" rx="1"/>
              </svg>
              <p className="body-s">No connected libraries found.</p>
              <p className="body-xs picker-empty-hint">Connect a shared library in Penpot to use components as slide templates.</p>
            </div>
          ) : filteredComponents.length === 0 ? (
            <div className="picker-empty">
              <p className="body-s">No components match your search.</p>
              <button
                className="btn-link"
                onClick={() => { setSearchQuery(''); setActiveFilter('All Slides'); }}
              >
                Clear filters
              </button>
            </div>
          ) : (
            <div className="component-sections">
              {Object.entries(grouped).map(([section, comps]) => (
                <div key={section} className="component-section">
                  <div className="component-section-header">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="3" width="8" height="8" rx="1"/>
                      <rect x="13" y="3" width="8" height="8" rx="1"/>
                      <rect x="3" y="13" width="8" height="8" rx="1"/>
                    </svg>
                    <span className="headline-s" style={{ color: 'var(--foreground-secondary)' }}>{section}</span>
                  </div>
                  <div className="component-grid">
                    {comps.map((comp) => (
                      <ComponentCard
                        key={comp.id}
                        component={comp}
                        selected={selectedComponentIds.has(comp.id)}
                        onToggle={() => toggleComponentSelection(comp.id, comp.libraryId)}
                        isSuggested={isSlideLike(comp.name)}
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
  onToggle: () => void;
  isSuggested: boolean;
}

function ComponentCard({ component, selected, onToggle, isSuggested }: ComponentCardProps) {
  const initials = component.name
    .split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase();

  return (
    <button
      className={`component-card ${selected ? 'selected' : ''}`}
      onClick={onToggle}
      title={component.name}
    >
      <div className="component-thumbnail">
        {selected && (
          <span className="component-check">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </span>
        )}
        {isSuggested && !selected && (
          <span className="component-suggested" title="Looks like a slide template" />
        )}
        <div className="component-preview-placeholder">
          <span className="component-initials">{initials}</span>
          <div className="component-preview-lines">
            <div className="preview-line preview-line--wide" />
            <div className="preview-line preview-line--narrow" />
          </div>
        </div>
      </div>
      <span className="component-name">{component.name}</span>
    </button>
  );
}

function groupBySection(components: ComponentInfo[]): Record<string, ComponentInfo[]> {
  const groups: Record<string, ComponentInfo[]> = {};
  for (const comp of components) {
    const section = comp.path ? comp.path.split('/')[0] : 'Components';
    if (!groups[section]) groups[section] = [];
    groups[section].push(comp);
  }
  if (Object.keys(groups).length === 0 && components.length > 0) {
    groups['Components'] = components;
  }
  return groups;
}
