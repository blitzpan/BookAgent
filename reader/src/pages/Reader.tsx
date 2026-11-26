import { useRef, useState } from "react";
import type { TouchEvent, MouseEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { useBook } from "../hooks/useBook";
import { useMediaQuery } from "../hooks/useMediaQuery";
import PageView from "../components/PageView";
import SpreadView from "../components/SpreadView";
import LangToggle from "../components/LangToggle";
import FontSizeControl from "../components/FontSizeControl";
import ModeToggle from "../components/ModeToggle";
import ThemeToggle from "../components/ThemeToggle";
import { IconArrowLeft, IconArrowRight } from "../components/icons";
import type { LangMode, ReadMode } from "../types";

const FONT_SIZES = [18, 22, 28];

export default function Reader() {
  const { storyId } = useParams();
  const id = Number(storyId);
  const { pages, error, loading } = useBook(id);

  const isWide = useMediaQuery("(min-width: 768px)");
  const [lang, setLang] = useState<LangMode>("both");
  const [fontIdx, setFontIdx] = useState(1);
  const [mode, setMode] = useState<ReadMode>("single");
  const [view, setView] = useState(0); // single: 页码索引；spread: 对开索引

  const effectiveMode: ReadMode = isWide ? mode : "single";
  const total = pages?.length ?? 0;
  const maxView =
    effectiveMode === "spread"
      ? Math.max(0, Math.ceil(total / 2) - 1)
      : Math.max(0, total - 1);

  const goPrev = () => setView((v) => Math.max(0, v - 1));
  const goNext = () => setView((v) => Math.min(maxView, v + 1));
  const goTo = (v: number) => setView(Math.max(0, Math.min(maxView, v)));

  const touchX = useRef<number | null>(null);
  const onTouchStart = (e: TouchEvent) => {
    touchX.current = e.touches[0].clientX;
  };
  const onTouchEnd = (e: TouchEvent) => {
    if (touchX.current == null) return;
    const dx = e.changedTouches[0].clientX - touchX.current;
    if (Math.abs(dx) > 50) {
      if (dx < 0) goNext();
      else goPrev();
    }
    touchX.current = null;
  };

  // 点图片左右两侧翻页（中间区域不翻，避免误触字幕/热区）。
  // 命中按钮（热区/音频/字幕）或字幕卡/控制条时交由其自身处理，不翻页。
  const onStageClick = (e: MouseEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest("button")) return;
    if (t.closest(".page-caption") || t.closest(".audio-control")) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    if (ratio < 0.33) goPrev();
    else if (ratio > 0.67) goNext();
  };

  const fontSize = FONT_SIZES[fontIdx];

  return (
    <div className="reader">
      <div className="reader-toolbar">
        <Link to="/" className="btn-back">
          <IconArrowLeft size={18} />
          书架
        </Link>
        <div className="toolbar-spacer" />
        <LangToggle value={lang} onChange={setLang} />
        <FontSizeControl idx={fontIdx} onChange={setFontIdx} />
        {isWide && <ModeToggle value={effectiveMode} onChange={setMode} />}
        <ThemeToggle />
      </div>

      <div
        className="reader-stage"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        onClick={onStageClick}
      >
        {loading && (
          <div className="state">
            <div className="loading-dots">
              <span />
              <span />
              <span />
            </div>
            <p>正在翻开绘本…</p>
          </div>
        )}
        {error && (
          <div className="state state-error">
            <p>哎呀，这本书打不开了</p>
            <p style={{ fontSize: 13 }}>{error}</p>
          </div>
        )}
        {pages && pages.length === 0 && <div className="state">这本书还没有内容哦</div>}
        {pages && pages.length > 0 && effectiveMode === "single" && (
          <PageView
            key={view}
            page={pages[view]}
            lang={lang}
            fontSize={fontSize}
            onEnded={goNext}
          />
        )}
        {pages && pages.length > 0 && effectiveMode === "spread" && (
          <SpreadView
            key={view}
            left={pages[view * 2] ?? null}
            right={pages[view * 2 + 1] ?? null}
            lang={lang}
            fontSize={fontSize}
            onEnded={goNext}
          />
        )}
      </div>

      <div className="reader-nav">
        <button
          className="nav-arrow"
          onClick={goPrev}
          disabled={view <= 0}
          aria-label="上一页"
        >
          <IconArrowLeft />
          上一页
        </button>

        <div className="page-dots" role="tablist" aria-label="页码">
          {Array.from({ length: maxView + 1 }, (_, i) => (
            <button
              key={i}
              className={`page-dot ${i === view ? "active" : ""}`}
              onClick={() => goTo(i)}
              aria-label={`第 ${i + 1} 屏`}
              aria-selected={i === view}
            />
          ))}
        </div>

        <button
          className="nav-arrow"
          onClick={goNext}
          disabled={view >= maxView}
          aria-label="下一页"
        >
          下一页
          <IconArrowRight />
        </button>
      </div>
    </div>
  );
}
