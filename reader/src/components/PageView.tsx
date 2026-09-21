import type { LangMode, ReaderPage } from "../types";

interface Caption {
  lang: string;
  text: string;
}

/** 按语言模式抽取旁白（缺语言时降级） */
export function captions(page: ReaderPage, lang: LangMode): Caption[] {
  const out: Caption[] = [];
  if (lang === "zh" || lang === "both") {
    if (page.textZh) out.push({ lang: "中文", text: page.textZh });
  }
  if (lang === "en" || lang === "both") {
    if (page.textEn) out.push({ lang: "EN", text: page.textEn });
  }
  if (out.length === 0) {
    if (page.textEn) out.push({ lang: "EN", text: page.textEn });
    else if (page.textZh) out.push({ lang: "中文", text: page.textZh });
    else out.push({ lang: "", text: "（暂无旁白）" });
  }
  return out;
}

interface Props {
  page: ReaderPage;
  lang: LangMode;
  fontSize: number;
}

export default function PageView({ page, lang, fontSize }: Props) {
  const caps = captions(page, lang);
  return (
    <div className="page-view">
      <div className="page-image-wrap">
        {page.imageUrl ? (
          <img className="page-image" src={page.imageUrl} alt={`第 ${page.pageNumber} 页`} />
        ) : (
          <div className="page-image-empty">本页暂无图</div>
        )}

        {page.hotspots?.map((h, i) => (
          <button
            key={i}
            className="hotspot"
            style={{
              left: `${h.x * 100}%`,
              top: `${h.y * 100}%`,
              width: `${h.w * 100}%`,
              height: `${h.h * 100}%`,
            }}
            aria-label={h.type}
          />
        ))}

        {page.audioUrl ? (
          <button
            className="audio-btn"
            onClick={() => new Audio(page.audioUrl).play()}
            aria-label="播放音频"
          >
            ▶
          </button>
        ) : (
          <button className="audio-btn audio-btn-disabled" disabled aria-label="暂无音频">
            ▶
          </button>
        )}
      </div>

      <div className="page-caption" style={{ fontSize: `${fontSize}px` }}>
        {caps.map((c, i) => (
          <p key={i} className="caption-line">
            {c.lang && <span className="caption-lang">{c.lang}</span>}
            {c.text}
          </p>
        ))}
      </div>
    </div>
  );
}
