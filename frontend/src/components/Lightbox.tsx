import React, { useEffect } from 'react';

interface Props {
  src: string;
  alt?: string;
  onClose: () => void;
}

/**
 * 图片放大查看：Esc / 点击遮罩 / 关闭按钮退出。
 * 打开时锁定页面滚动，避免关闭后位置错乱。
 */
const Lightbox: React.FC<Props> = ({ src, alt, onClose }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt ? `放大查看：${alt}` : '放大查看图片'}
      onClick={onClose}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/70 backdrop-blur-sm p-4"
    >
      <button
        autoFocus
        onClick={onClose}
        aria-label="关闭放大预览"
        title="关闭（Esc）"
        className="absolute right-4 top-4 grid h-11 w-11 place-items-center rounded-full bg-white/90 text-ink hover:bg-white cursor-pointer focus-warm transition-colors duration-200"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-5 h-5"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
      <img
        src={src}
        alt={alt ?? ''}
        onClick={(e) => e.stopPropagation()}
        className="max-h-full max-w-full rounded-xl object-contain shadow-soft bg-white"
      />
    </div>
  );
};

export default Lightbox;
