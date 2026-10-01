import React, { useState } from "react";
import { api } from "../api/client";
import { MagicWandIcon } from "./icons/MagicWandIcon";

const DEFAULT_STYLE = "whimsical, cute, soft-color children's picture-book style";

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onloadend = () => resolve(r.result as string);
    r.onerror = () => reject(new Error("读取图片失败"));
    r.readAsDataURL(file);
  });
}

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

/** 新建故事：点击「新建故事」按钮弹出的提交弹窗。 */
const NewStoryModal: React.FC<Props> = ({ open, onClose, onCreated }) => {
  const [text, setText] = useState("");
  const [style, setStyle] = useState(DEFAULT_STYLE);
  const [pageCount, setPageCount] = useState(6);
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);

  if (!open) return null;

  const handleCreate = async () => {
    if (!text.trim()) {
      setFormErr("请先输入故事原文");
      return;
    }
    setBusy(true);
    setFormErr(null);
    try {
      let inspiration: string | undefined;
      if (file) inspiration = await readAsDataUrl(file);
      await api.createStory({
        original_text: text,
        style: style || undefined,
        target_page_count: pageCount,
        user_title: title || undefined,
        inspiration_image: inspiration,
      });
      setText("");
      setFile(null);
      setTitle("");
      onCreated();
      onClose();
    } catch (e: any) {
      setFormErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl bg-white rounded-2xl shadow-soft border border-line max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-6 border-b border-line">
          <h2 className="font-display text-xl font-bold text-ink">新建故事</h2>
          <button
            onClick={onClose}
            className="text-muted hover:text-ink text-2xl leading-none px-2"
            aria-label="关闭"
          >
            ×
          </button>
        </div>
        <div className="p-6 space-y-4">
          <textarea
            rows={6}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Once upon a time..."
            className="w-full px-4 py-3 border border-line rounded-xl bg-paper-2 text-ink placeholder:text-muted/70 focus-warm resize-none"
          />
          <div className="flex flex-wrap gap-4">
            <label className="text-sm text-muted flex flex-col gap-1">
              页数 (1–20)
              <input
                type="number"
                min={1}
                max={20}
                value={pageCount}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  setPageCount(Number.isNaN(v) ? 1 : Math.min(Math.max(v, 1), 20));
                }}
                className="w-24 px-2 py-1 border border-line rounded-lg bg-white text-ink focus-warm"
              />
            </label>
            <label className="text-sm text-muted flex flex-col gap-1">
              标题 (可选)
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="px-2 py-1 border border-line rounded-lg bg-white text-ink focus-warm"
              />
            </label>
          </div>
          <input
            value={style}
            onChange={(e) => setStyle(e.target.value)}
            placeholder="画风 / 语气"
            className="w-full px-4 py-2 border border-line rounded-xl bg-paper-2 text-ink focus-warm"
          />
          <div>
            <label className="block text-sm text-muted mb-1">灵感图 (可选)</label>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block text-sm text-muted"
            />
          </div>
          {formErr && <p className="text-red-500 text-sm">{formErr}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-paper-3 hover:bg-line text-ink text-sm transition"
            >
              取消
            </button>
            <button
              disabled={busy}
              onClick={handleCreate}
              className="flex items-center justify-center gap-2 px-6 py-2.5 font-semibold text-white bg-brand rounded-xl hover:bg-brand-strong disabled:opacity-50 transition"
            >
              <MagicWandIcon className="w-5 h-5" /> 创建故事
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default NewStoryModal;
