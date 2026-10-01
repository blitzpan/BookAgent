import React from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  maxWidth?: string;
}

/** 通用弹窗：点击遮罩或右上角 × 关闭；内容区可滚动。 */
const Modal: React.FC<Props> = ({ open, onClose, title, children, maxWidth = "max-w-2xl" }) => {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className={`w-full ${maxWidth} bg-white rounded-2xl shadow-soft border border-line max-h-[90vh] overflow-y-auto`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-6 border-b border-line">
          <h2 className="font-display text-xl font-bold text-ink">{title}</h2>
          <button
            onClick={onClose}
            className="text-muted hover:text-ink text-2xl leading-none px-2"
            aria-label="关闭"
          >
            ×
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
};

export default Modal;
