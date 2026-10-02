import React, { useEffect, useState } from "react";
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

const CloseIcon = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    className={className}
    aria-hidden="true"
  >
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

const PencilIcon = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
);

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

/**
 * 新建故事弹窗（宽屏双栏：左 AI 辅助、右故事原文）。
 * ① 主题与要求 →「AI 生成故事」写入 ②；② 修改要求 →「AI 优化」就地迭代 ②。
 * ② 故事原文是真正的提交内容，用户也可完全不用 AI、直接输入并提交。
 */
const NewStoryModal: React.FC<Props> = ({ open, onClose, onCreated }) => {
  const [text, setText] = useState("");
  const [theme, setTheme] = useState("");
  const [feedback, setFeedback] = useState("");
  // 每轮优化成功后累积，传给后端防止后续轮次把已确认的改动改回去
  const [appliedFeedbacks, setAppliedFeedbacks] = useState<string[]>([]);
  const [style, setStyle] = useState(DEFAULT_STYLE);
  const [pageCount, setPageCount] = useState(6);
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [showCfg, setShowCfg] = useState(false);
  const [busy, setBusy] = useState(false);
  const [genBusy, setGenBusy] = useState(false);
  const [optBusy, setOptBusy] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [genErr, setGenErr] = useState<string | null>(null);
  const [optErr, setOptErr] = useState<string | null>(null);

  // Esc 关闭（生成/优化/提交进行中不响应，避免误关丢失内容）
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy && !genBusy && !optBusy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, genBusy, optBusy, onClose]);

  if (!open) return null;

  // AI 入口只传主题本身：页数归「改写」、画风归「生图」，都不在生成阶段使用
  const handleGenerate = async () => {
    if (!theme.trim()) {
      setGenErr("请先输入主题与要求");
      return;
    }
    setGenBusy(true);
    setGenErr(null);
    try {
      const r = await api.generateStory({ theme });
      setText(r.story);
      // 换了一篇故事，之前累积的修改要求不再适用
      setAppliedFeedbacks([]);
    } catch (e: any) {
      setGenErr(e?.message ?? String(e));
    } finally {
      setGenBusy(false);
    }
  };

  const handleOptimize = async () => {
    if (!text.trim()) {
      setOptErr("请先输入或生成故事原文");
      return;
    }
    if (!feedback.trim()) {
      setOptErr("请填写修改要求");
      return;
    }
    setOptBusy(true);
    setOptErr(null);
    try {
      const r = await api.optimizeStory({
        story: text,
        feedback,
        applied_feedback: appliedFeedbacks,
      });
      setText(r.story);
      setAppliedFeedbacks([...appliedFeedbacks, feedback]);
      setFeedback("");
    } catch (e: any) {
      setOptErr(e?.message ?? String(e));
    } finally {
      setOptBusy(false);
    }
  };

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
      setTheme("");
      setFeedback("");
      setAppliedFeedbacks([]);
      setFile(null);
      setTitle("");
      setShowCfg(false);
      onCreated();
      onClose();
    } catch (e: any) {
      setFormErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const input =
    "w-full px-3 py-2 border border-line rounded-xl bg-white text-ink placeholder:text-muted/70 focus-warm transition";
  const primaryBtn =
    "inline-flex items-center justify-center gap-2 min-h-[44px] w-full rounded-xl font-semibold text-white bg-brand hover:bg-brand-strong cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200";
  const ghostBtn =
    "inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-xl text-sm text-ink bg-paper-3 hover:bg-line cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200";
  const card = "rounded-xl2 border border-line bg-paper-2 p-4 transition-colors duration-200";
  const err = (msg: string) => (
    <p role="alert" className="text-red-600 text-xs leading-relaxed">
      {msg}
    </p>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-ink/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-story-title"
        className="w-full max-w-full sm:max-w-3xl lg:max-w-5xl max-h-[90vh] flex flex-col bg-white rounded-2xl shadow-soft border border-line overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部固定 */}
        <header className="shrink-0 flex items-start justify-between gap-4 px-6 py-4 border-b border-line bg-paper">
          <div className="min-w-0">
            <h2 id="new-story-title" className="font-display text-lg font-bold text-ink">
              新建故事
            </h2>
            <p className="text-xs text-muted mt-0.5">
              可直接粘贴故事原文提交，也可以先用主题让 AI 起草、再提要求优化。
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="关闭"
            className="shrink-0 grid h-11 w-11 place-items-center rounded-lg text-muted hover:text-ink hover:bg-paper-2 cursor-pointer focus-warm transition-colors duration-200"
          >
            <CloseIcon className="w-5 h-5" />
          </button>
        </header>

        {/* 内容区滚动 */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            {/* 左栏：AI 辅助（主题生成 + 多轮优化） */}
            <div className="flex flex-col gap-4 min-w-0">
              <section className={`${card} flex flex-col gap-2`}>
                <div className="flex items-center gap-2">
                  <h3 className="font-display text-sm font-bold text-ink">① 主题与要求</h3>
                  <span className="text-[11px] px-1.5 py-0.5 rounded bg-brand-soft text-brand">
                    可选 · AI 起草
                  </span>
                </div>
                <label htmlFor="story-theme" className="sr-only">
                  主题与要求
                </label>
                <textarea
                  id="story-theme"
                  rows={4}
                  value={theme}
                  onChange={(e) => setTheme(e.target.value)}
                  placeholder="例如：写一个防止校园霸凌的故事，主角是转学来的小刺猬阿栗，结尾温暖有力量"
                  className={`${input} resize-y`}
                />
                <button
                  disabled={genBusy}
                  onClick={handleGenerate}
                  className={primaryBtn}
                >
                  <MagicWandIcon
                    className={`w-4 h-4 ${genBusy ? "animate-pulse motion-reduce:animate-none" : ""}`}
                  />
                  {genBusy ? "AI 生成中…" : "AI 生成故事"}
                </button>
                <p className="text-[11px] text-muted leading-relaxed">
                  生成结果会填入右侧「故事原文」，可继续编辑或直接提交。
                </p>
                {genErr && err(genErr)}
              </section>

              <section className={`${card} flex flex-col gap-2`}>
                <div className="flex items-center gap-2">
                  <h3 className="font-display text-sm font-bold text-ink">② 修改要求</h3>
                  <span className="text-[11px] px-1.5 py-0.5 rounded bg-brand-soft text-brand">
                    可选 · AI 优化
                  </span>
                </div>
                <label htmlFor="story-feedback" className="sr-only">
                  修改要求
                </label>
                <textarea
                  id="story-feedback"
                  rows={3}
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  placeholder="例如：结尾再欢乐一点 / 给主角加一个朋友 / 把说教语气改柔和"
                  className={`${input} resize-y`}
                />
                <button
                  disabled={optBusy}
                  onClick={handleOptimize}
                  className="inline-flex items-center justify-center gap-2 min-h-[44px] w-full rounded-xl font-semibold text-brand bg-brand-soft hover:bg-paper-3 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200"
                >
                  <PencilIcon className="w-4 h-4" />
                  {optBusy ? "AI 优化中…" : "AI 优化故事"}
                </button>
                {appliedFeedbacks.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-[11px] text-muted">
                      已应用 {appliedFeedbacks.length} 条优化，会一并传给 AI 保持不变：
                    </p>
                    <ul className="flex flex-wrap gap-1.5">
                      {appliedFeedbacks.map((f, i) => (
                        <li
                          key={i}
                          className="max-w-full truncate text-[11px] px-2 py-0.5 rounded-md bg-white border border-line text-ink"
                        >
                          {f}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {optErr && err(optErr)}
              </section>
            </div>

            {/* 右栏：故事原文（提交内容） */}
            <section className={`${card} flex flex-col gap-2 min-w-0`}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <h3 className="font-display text-sm font-bold text-ink">故事原文</h3>
                  <span className="text-[11px] px-1.5 py-0.5 rounded bg-sage-soft text-sage">
                    提交内容
                  </span>
                </div>
                <span className="text-[11px] text-muted shrink-0">
                  {text.trim() ? `${text.trim().length} 字` : "尚未输入"}
                </span>
              </div>
              <label htmlFor="story-text" className="sr-only">
                故事原文
              </label>
              <textarea
                id="story-text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Once upon a time...（也可直接粘贴你的故事原文）"
                className={`${input} resize-y flex-1 min-h-[260px] lg:min-h-[320px] leading-relaxed`}
              />
              <p className="text-[11px] text-muted leading-relaxed">
                不使用 AI 时，直接在这里写完点「创建故事」即可。
              </p>
            </section>
          </div>

          {/* 配置：默认收起，避免挤压正文高度 */}
          <div className="mt-4">
            <button
              onClick={() => setShowCfg((v) => !v)}
              aria-expanded={showCfg}
              className="inline-flex items-center gap-2 min-h-[44px] px-3 text-sm text-muted hover:text-ink cursor-pointer focus-warm rounded-lg transition-colors duration-200"
            >
              <span
                className={`transition-transform duration-200 ${showCfg ? "rotate-90" : ""}`}
                aria-hidden="true"
              >
                ›
              </span>
              更多配置（页数 / 标题 / 画风 / 灵感图）
            </button>
            {showCfg && (
              <div className="mt-2 grid gap-4 sm:grid-cols-2 p-4 rounded-xl2 border border-line bg-paper">
                <label className="text-xs text-muted flex flex-col gap-1">
                  页数（1–20，用于改写分页）
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={pageCount}
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10);
                      setPageCount(Number.isNaN(v) ? 1 : Math.min(Math.max(v, 1), 20));
                    }}
                    className={`${input} py-1.5`}
                  />
                </label>
                <label className="text-xs text-muted flex flex-col gap-1">
                  标题（可选）
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className={`${input} py-1.5`}
                  />
                </label>
                <label className="text-xs text-muted flex flex-col gap-1 sm:col-span-2">
                  画风 / 语气（用于生图）
                  <input
                    value={style}
                    onChange={(e) => setStyle(e.target.value)}
                    className={`${input} py-1.5`}
                  />
                </label>
                <label className="text-xs text-muted flex flex-col gap-1 sm:col-span-2">
                  灵感图（可选，用于分页阶段）
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    className="block w-full text-xs text-muted cursor-pointer"
                  />
                </label>
              </div>
            )}
          </div>
        </div>

        {/* 底部固定：操作始终可见 */}
        <footer className="shrink-0 flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-t border-line bg-paper">
          <div className="min-w-0 text-xs">{formErr ? err(formErr) : null}</div>
          <div className="flex items-center gap-3">
            <button onClick={onClose} className={ghostBtn}>
              取消
            </button>
            <button
              disabled={busy}
              onClick={handleCreate}
              className="inline-flex items-center justify-center gap-2 min-h-[44px] px-6 rounded-xl font-semibold text-white bg-brand hover:bg-brand-strong cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200"
            >
              <MagicWandIcon className="w-5 h-5" />
              {busy ? "创建中…" : "创建故事"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
};

export default NewStoryModal;
