import { useRef, useState } from "react";
import type { TouchEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { useBook } from "../hooks/useBook";
import { useMediaQuery } from "../hooks/useMediaQuery";
import PageView from "../components/PageView";
import SpreadView from "../components/SpreadView";
import LangToggle from "../components/LangToggle";
import FontSizeControl from "../components/FontSizeControl";
import ModeToggle from "../components/ModeToggle";
import type { LangMode, ReadMode } from "../types";

const FONT_SIZES = [16, 20, 26];

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

  const fontSize = FONT_SIZES[fontIdx];

  return (
    <div className="reader">
      <div className="reader-toolbar">
        <Link to="/" className="btn-back">
          ‹ 书架
        </Link>
        <div className="toolbar-spacer" />
        <LangToggle value={lang} onChange={setLang} />
        <FontSizeControl idx={fontIdx} onChange={setFontIdx} />
        {isWide && <ModeToggle value={effectiveMode} onChange={setMode} />}
      </div>

      <div className="reader-stage" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        {loading && <div className="state">加载中…</div>}
        {error && <div className="state state-error">{error}</div>}
        {pages && pages.length === 0 && <div className="state">本书暂无页面</div>}
        {pages && pages.length > 0 && effectiveMode === "single" && (
          <PageView page={pages[view]} lang={lang} fontSize={fontSize} />
        )}
        {pages && pages.length > 0 && effectiveMode === "spread" && (
          <SpreadView
            left={pages[view * 2] ?? null}
            right={pages[view * 2 + 1] ?? null}
            lang={lang}
            fontSize={fontSize}
          />
        )}
      </div>

      <div className="reader-nav">
        <button onClick={goPrev} disabled={view <= 0}>
          上一页
        </button>
        <span className="page-indicator">
          {effectiveMode === "spread"
            ? `${view * 2 + 1}-${Math.min(view * 2 + 2, total)} / ${total}`
            : `${view + 1} / ${total}`}
        </span>
        <button onClick={goNext} disabled={view >= maxView}>
          下一页
        </button>
      </div>
    </div>
  );
}
