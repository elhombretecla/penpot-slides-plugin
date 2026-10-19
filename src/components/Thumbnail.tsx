import SvgView from './SvgView';
import { isSvgMarkup } from '../render/svg';

// A component thumbnail: Penpot markup (rendered inline, with the document's
// fonts) or a raster data URL from the exporter fallback / older caches.
export default function Thumbnail({ src, alt = '' }: { src: string; alt?: string }) {
  if (isSvgMarkup(src)) return <SvgView svg={src} className="thumbnail-svg" />;
  return <img src={src} alt={alt} draggable={false} />;
}
