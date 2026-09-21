import React from 'react';
import type { Character } from '../types';
import { assetUrl } from '../api/client';

const AnchorGallery: React.FC<{ characters: Character[] }> = ({ characters }) => {
  if (!characters.length) return null;
  return (
    <section className="mb-6">
      <h3 className="text-lg font-bold mb-2">角色锚图</h3>
      <div className="flex gap-4 overflow-x-auto pb-3">
        {characters.map((c) => (
          <div
            key={c.id}
            className="flex-shrink-0 w-48 bg-white dark:bg-gray-800 rounded-xl shadow overflow-hidden"
          >
            <div className="aspect-[4/3] bg-gray-200 dark:bg-gray-700">
              {assetUrl(c.sheet_image_path) && (
                <img
                  src={assetUrl(c.sheet_image_path)!}
                  className="w-full h-full object-cover"
                  alt={c.name ?? ''}
                />
              )}
            </div>
            <div className="p-3">
              <div className="font-semibold text-sm">{c.name || c.char_key}</div>
              <div className="text-xs text-gray-500 truncate">
                {c.visual_description}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};

export default AnchorGallery;
