import { useEffect, useRef, useState } from 'react';
import { useSlideStore } from '../store';
import type { Slide, SlideNode } from '../types';
import { makeEllipseNode, makeImageNode, makeRectNode, makeTextNode, readImageFile } from '../utils';
import Thumbnail from './Thumbnail';

interface Props { slide: Slide | null; }

export default function InsertPanel({ slide }: Props) {
  const libraries = useSlideStore((s) => s.libraries);
  const deckLibraryId = useSlideStore((s) => s.deck?.libraryId ?? null);
  const catalogs = useSlideStore((s) => s.catalogs);
  const requestCatalog = useSlideStore((s) => s.requestCatalog);
  const thumbnails = useSlideStore((s) => s.thumbnailsMap);
  const pendingAssets = useSlideStore((s) => Object.keys(s.pendingAssets).length);
  const [libraryId, setLibraryId] = useState<string | null>(deckLibraryId ?? libraries[0]?.id ?? null);
  const [query, setQuery] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!libraryId && libraries.length > 0) setLibraryId(deckLibraryId ?? libraries[0].id);
  }, [libraryId, libraries, deckLibraryId]);

  useEffect(() => {
    if (libraryId && !catalogs[libraryId]) requestCatalog(libraryId);
  }, [libraryId, catalogs, requestCatalog]);

  if (!slide) {
    return (
      <div className="insert-panel empty">
        <p className="panel-empty-msg">No slide selected</p>
      </div>
    );
  }

  const w = slide.width;
  const h = slide.height;

  function add(node: SlideNode) {
    if (!slide) return;
    const store = useSlideStore.getState();
    store.commitHistory();
    store.addNode(slide.id, node);
    store.selectNode(node.id);
    store.setSidePanel('properties');
  }

  async function handleFile(file: File | undefined) {
    if (!file || !slide) return;
    try {
      const img = await readImageFile(file);
      add(makeImageNode(file.name.replace(/\.[^.]+$/, ''), img.dataUrl, img.width, img.height, w, h));
    } catch (err) {
      useSlideStore.getState().pushNotice('error', err instanceof Error ? err.message : String(err));
    }
  }

  const assets = (libraryId ? catalogs[libraryId]?.components ?? [] : [])
    .filter((c) => c.kind === 'asset')
    .filter((c) => !query.trim() || `${c.path}/${c.name}`.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <div className="insert-panel">
      <div className="prop-section">
        <div className="prop-section-header">BASIC</div>
        <div className="insert-basic-grid">
          <button className="insert-basic" onClick={() => add(makeTextNode(w * 0.1, h * 0.4, w * 0.5, h * 0.12, w))}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/>
            </svg>
            <span>Text</span>
          </button>
          <button className="insert-basic" onClick={() => add(makeRectNode('Rectangle', w * 0.4, h * 0.35, w * 0.2, h * 0.3))}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
            <span>Rectangle</span>
          </button>
          <button className="insert-basic" onClick={() => add(makeEllipseNode('Ellipse', w * 0.42, h * 0.36, h * 0.28))}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9"/></svg>
            <span>Ellipse</span>
          </button>
          <button className="insert-basic" onClick={() => fileRef.current?.click()}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
            </svg>
            <span>Image…</span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
            style={{ display: 'none' }}
            onChange={(e) => {
              void handleFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>
      </div>

      <div className="prop-section">
        <div className="prop-section-header">LIBRARY ELEMENTS</div>
        <select
          className="select"
          aria-label="Library"
          value={libraryId ?? ''}
          onChange={(e) => setLibraryId(e.target.value)}
          style={{ blockSize: '28px', fontSize: 'var(--font-size-xs)' }}
        >
          {libraries.map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>
        <input
          className="input input-sm insert-search"
          placeholder="Search elements…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {libraryId && !catalogs[libraryId] ? (
          <div className="home-loading"><div className="spinner spinner--sm" /></div>
        ) : assets.length === 0 ? (
          <p className="panel-empty-msg">No elements in this library.</p>
        ) : (
          <div className="insert-asset-grid">
            {assets.map((c) => (
              <button
                key={c.id}
                className="insert-asset"
                title={`${c.path ? `${c.path} / ` : ''}${c.name} — inserted as a linked component`}
                disabled={pendingAssets > 0}
                onClick={() => useSlideStore.getState().requestAsset(slide.id, c.libraryId, c.id)}
              >
                {thumbnails[c.id] ? (
                  <Thumbnail src={thumbnails[c.id]} />
                ) : (
                  <span className="insert-asset-placeholder">{c.name.slice(0, 2).toUpperCase()}</span>
                )}
                <span className="insert-asset-name">{c.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
