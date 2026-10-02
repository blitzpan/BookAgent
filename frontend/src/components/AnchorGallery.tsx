import React from 'react';
import type { Character } from '../types';
import { assetUrl } from '../api/client';
import Lightbox from './Lightbox';

const AnchorGallery: React.FC<{ characters: Character[] }> = ({ characters }) => {
  const [zoom, setZoom] = React.useState<string | null>(null);
  if (!characters.length) return null;
  return (
    <div className="mb-6">
      <h4 className="font-display font-bold text-ink mb-3">角色锚图</h4>
      <div className="flex gap-4 overflow-x-auto pb-3">
        {characters.map((c) => (
          <div
            key={c.id}
            className="flex-shrink-0 w-48 bg-white border border-line rounded-xl shadow-card overflow-hidden"
          >
            <div className="aspect-[4/3] bg-paper-2">
              {assetUrl(c.sheet_image_path) && (
                <button
                  type="button"
                  onClick={() => setZoom(assetUrl(c.sheet_image_path)!)}
                  aria-label={`放大查看角色锚图：${c.name || c.char_key}`}
                  title="点击放大查看"
                  className="block w-full h-full cursor-zoom-in"
                >
                  <img
                    src={assetUrl(c.sheet_image_path)!}
                    className="w-full h-full object-cover"
                    alt={c.name || c.char_key || '角色锚图'}
                    loading="lazy"
                    decoding="async"
                  />
                </button>
              )}
            </div>
            <div className="p-3">
              <div className="font-semibold text-sm text-ink">{c.name || c.char_key}</div>
              <div className="text-xs text-muted-strong truncate" title={c.visual_description}>
                {c.visual_description}
              </div>
            </div>
          </div>
        ))}
      </div>
      {zoom && <Lightbox src={zoom} onClose={() => setZoom(null)} />}
    </div>
  );
};

export default AnchorGallery;
