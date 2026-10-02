import React from 'react';
import type { PageDetail } from '../types';
import { assetUrl } from '../api/client';
import Lightbox from './Lightbox';

interface AudioByPage {
  zh: string[];
  en: string[];
}

interface Props {
  page: PageDetail;
  audio?: AudioByPage | null;
  onSetDefault: (imageId: number) => void;
  onGenerateNew: (pageId: number) => void;
  onUploadImage: (pageId: number, dataUrl: string) => void;
  busyImageId?: number | null;
  busyPageId?: number | null;
}

const PageCard: React.FC<Props> = ({
  page,
  audio,
  onSetDefault,
  onGenerateNew,
  onUploadImage,
  busyImageId,
  busyPageId,
}) => {
  const { page: p, default_image, candidates } = page;
  const defUrl = assetUrl(default_image?.image_path);
  const [uploading, setUploading] = React.useState(false);
  const [zoom, setZoom] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const handlePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // 允许重复选同一文件
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image')) {
        setUploading(true);
        try {
          onUploadImage(p.id, dataUrl);
        } finally {
          setUploading(false);
        }
      }
    };
    reader.readAsDataURL(file);
  };

  // 顺序播放该语言该页所有分段音频（文本-语音同源，串语言/串页构造上不可能）
  const playSeq = (urls: string[]) => {
    if (!urls.length) return;
    let i = 0;
    const playNext = () => {
      if (i >= urls.length) return;
      const a = new Audio(urls[i]);
      a.onended = () => {
        i += 1;
        playNext();
      };
      a.onerror = () => {
        i += 1;
        playNext();
      };
      a.play().catch(() => {
        i += 1;
        playNext();
      });
    };
    playNext();
  };

  return (
    <div className="bg-white border border-line rounded-xl shadow-card overflow-hidden flex flex-col">
      <div className="aspect-[4/3] bg-paper-2 flex items-center justify-center">
        {defUrl ? (
          <button
            type="button"
            onClick={() => setZoom(defUrl)}
            aria-label={`放大查看第 ${p.page_number} 页插图`}
            title="点击放大查看"
            className="block w-full h-full cursor-zoom-in"
          >
            <img
              src={defUrl}
              alt={`第 ${p.page_number} 页插图`}
              className="w-full h-full object-cover"
              loading="lazy"
              decoding="async"
            />
          </button>
        ) : (
          <div className="text-sm text-muted-strong p-4 text-center">暂无默认图</div>
        )}
      </div>
      <div className="p-4 flex-1 flex flex-col">
        <div className="flex items-center justify-between mb-1">
          <span className="font-semibold text-ink">第 {p.page_number} 页</span>
          {default_image?.combined_score != null && (
            <span className="text-xs text-muted-strong">
              评分 {default_image.combined_score.toFixed(2)}
            </span>
          )}
        </div>
        <p className="text-sm text-muted-strong mb-3 whitespace-pre-wrap leading-relaxed">
          {p.text_en || p.text_zh || ''}
        </p>

        {candidates.length > 1 && (
          <div className="flex gap-2 overflow-x-auto pb-2 mb-2">
            {candidates.map((c) => (
              <div
                key={c.id}
                className={`relative flex-shrink-0 w-24 ${
                  c.is_default ? 'ring-2 ring-brand rounded' : ''
                }`}
              >
                {assetUrl(c.image_path) && (
                  <button
                    type="button"
                    onClick={() => setZoom(assetUrl(c.image_path)!)}
                    aria-label={`放大查看第 ${p.page_number} 页候选图`}
                    title="点击放大查看"
                    className="block w-24 cursor-zoom-in"
                  >
                    <img
                      src={assetUrl(c.image_path)!}
                      className="w-24 h-20 object-cover rounded"
                      alt=""
                      loading="lazy"
                      decoding="async"
                    />
                  </button>
                )}
                <button
                  disabled={busyImageId === c.id}
                  onClick={() => onSetDefault(c.id)}
                  className="mt-1 w-full inline-flex items-center justify-center h-7 rounded text-xs bg-brand text-white hover:bg-brand-strong cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-warm transition-colors duration-200"
                >
                  {c.is_default ? '默认' : '设默认'}
                </button>
              </div>
            ))}
          </div>
        )}

        {/* 配音试听：中/EN 两个小徽标，已生成填充、未生成描边 */}
        {audio && (
          <div className="flex items-center gap-2 mt-3">
            <span className="text-xs text-muted-strong">配音</span>
            <button
              disabled={audio.zh.length === 0}
              onClick={() => playSeq(audio.zh)}
              className={`inline-flex items-center justify-center w-9 h-9 rounded-lg text-xs font-medium cursor-pointer focus-warm transition-colors duration-200 ${
                audio.zh.length
                  ? 'bg-gold text-ink hover:bg-gold/90'
                  : 'border border-dashed border-line text-muted cursor-not-allowed'
              }`}
              title={audio.zh.length ? '试听中文配音' : '该方案此页暂无中文配音'}
            >
              中
            </button>
            <button
              disabled={audio.en.length === 0}
              onClick={() => playSeq(audio.en)}
              className={`inline-flex items-center justify-center w-9 h-9 rounded-lg text-xs font-medium cursor-pointer focus-warm transition-colors duration-200 ${
                audio.en.length
                  ? 'bg-gold text-ink hover:bg-gold/90'
                  : 'border border-dashed border-line text-muted cursor-not-allowed'
              }`}
              title={audio.en.length ? '试听英文配音' : '该方案此页暂无英文配音'}
            >
              EN
            </button>
          </div>
        )}

        <div className="mt-auto grid grid-cols-2 gap-2">
          <button
            disabled={busyPageId === p.id}
            onClick={() => onGenerateNew(p.id)}
            className="inline-flex items-center justify-center h-9 px-2 rounded-lg text-sm font-medium bg-sage text-white hover:bg-sage/90 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-warm transition-colors duration-200"
          >
            {busyPageId === p.id ? '生成中…' : '生成新候选图'}
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            title="上传本地图片作为本页插图（不触发 AI 生图）"
            className="inline-flex items-center justify-center h-9 px-2 rounded-lg text-sm font-medium bg-gold-soft text-ink hover:bg-[#efd9ad] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-warm transition-colors duration-200"
          >
            {uploading ? '上传中…' : '上传图片'}
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handlePick}
        />
      </div>
      {zoom && <Lightbox src={zoom} onClose={() => setZoom(null)} />}
    </div>
  );
};

export default PageCard;
