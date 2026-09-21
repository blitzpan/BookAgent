import React from 'react';
import type { PageDetail } from '../types';
import { assetUrl } from '../api/client';

interface Props {
  page: PageDetail;
  onSetDefault: (imageId: number) => void;
  onGenerateNew: (pageId: number) => void;
  busyImageId?: number | null;
  busyPageId?: number | null;
}

const PageCard: React.FC<Props> = ({
  page,
  onSetDefault,
  onGenerateNew,
  busyImageId,
  busyPageId,
}) => {
  const { page: p, default_image, candidates } = page;
  const defUrl = assetUrl(default_image?.image_path);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow overflow-hidden flex flex-col">
      <div className="aspect-[4/3] bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
        {defUrl ? (
          <img
            src={defUrl}
            alt={`page ${p.page_number}`}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="text-sm text-gray-500 p-4 text-center">暂无默认图</div>
        )}
      </div>
      <div className="p-4 flex-1 flex flex-col">
        <div className="flex items-center justify-between mb-1">
          <span className="font-semibold">第 {p.page_number} 页</span>
          {default_image?.combined_score != null && (
            <span className="text-xs text-gray-500">
              评分 {default_image.combined_score.toFixed(2)}
            </span>
          )}
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-300 mb-3 whitespace-pre-wrap">
          {p.text_en || p.text_zh || ''}
        </p>

        {candidates.length > 1 && (
          <div className="flex gap-2 overflow-x-auto pb-2 mb-2">
            {candidates.map((c) => (
              <div
                key={c.id}
                className={`relative flex-shrink-0 w-24 ${
                  c.is_default ? 'ring-2 ring-indigo-500 rounded' : ''
                }`}
              >
                {assetUrl(c.image_path) && (
                  <img
                    src={assetUrl(c.image_path)!}
                    className="w-24 h-20 object-cover rounded"
                    alt=""
                  />
                )}
                <button
                  disabled={busyImageId === c.id}
                  onClick={() => onSetDefault(c.id)}
                  className="mt-1 w-full text-xs px-1 py-0.5 rounded bg-indigo-600 text-white disabled:opacity-50"
                >
                  {c.is_default ? '默认' : '设默认'}
                </button>
              </div>
            ))}
          </div>
        )}

        <button
          disabled={busyPageId === p.id}
          onClick={() => onGenerateNew(p.id)}
          className="mt-auto text-sm px-3 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {busyPageId === p.id ? '生成中…' : '生成新候选图'}
        </button>
      </div>
    </div>
  );
};

export default PageCard;
