import { useEffect, useRef, useState } from "react";
import type { LangMode, ReaderPage, ReaderSegment, Hotspot } from "../types";

interface Caption {
  lang: string;
  text: string;
}

interface PlayItem {
  url: string;
  label: string;
}

interface Props {
  page: ReaderPage;
  lang: LangMode;
  fontSize: number;
  /** 全部音频播放完毕且开启自动翻页时回调（用于翻页） */
  onEnded?: () => void;
}

/** 按语言模式抽取旁白（缺语言时降级） */
function captions(page: ReaderPage, lang: LangMode): Caption[] {
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

/** 当前语言下要顺序播放的音频清单（文本-语音同源，串语言/串页构造上不可能）。 */
function buildPlaylist(
  segments: ReaderSegment[] | undefined,
  lang: LangMode
): PlayItem[] {
  const langs: ("zh" | "en")[] =
    lang === "both" ? ["zh", "en"] : [lang];
  const items: PlayItem[] = [];
  if (segments && segments.length) {
    for (const l of langs) {
      for (const s of segments) {
        const u = s.audioUrls[l];
        if (u) items.push({ url: u, label: s.role });
      }
    }
  }
  return items;
}

function segmentStyle(role: ReaderSegment["role"], speaker?: string | null) {
  switch (role) {
    case "dialogue":
      return `rounded-2xl px-4 py-2 max-w-[85%] ${
        speaker
          ? "bg-sky-100 text-sky-900 self-start border border-sky-200"
          : "bg-violet-100 text-violet-900 self-end border border-violet-200"
      }`;
    case "background":
      return "italic text-gray-500 dark:text-gray-400 px-2";
    case "sfx":
      return "inline-flex items-center gap-1 text-amber-600 text-sm";
    default:
      return "text-gray-800 dark:text-gray-100";
  }
}

/**
 * 图外文案列表（S4）：可点击逐句播放，与图上热区复用同一播放路径（含 S8 互斥）。
 * 排序：仅图外组置顶、已标注组置后；组内按 seq 升序保叙事顺序，两组间加分隔标题。
 */
function SegmentList({
  segments,
  hotspots,
  lang,
  activeSeq,
  onPlay,
}: {
  segments: ReaderSegment[];
  hotspots?: Hotspot[];
  lang: LangMode;
  activeSeq: number | null;
  onPlay: (seq: number) => void;
}) {
  const onImageSeqs = new Set<number>(
    (hotspots ?? []).map((h) => h.segment_seq).filter((x): x is number => x != null)
  );
  const segs = segments ?? [];
  const offImage = segs.filter((s) => !onImageSeqs.has(s.seq)).sort((a, b) => a.seq - b.seq);
  const onImage = segs.filter((s) => onImageSeqs.has(s.seq)).sort((a, b) => a.seq - b.seq);

  const renderRow = (s: ReaderSegment) => {
    const onImg = onImageSeqs.has(s.seq);
    const active = activeSeq === s.seq;
    const hasAudio =
      (lang !== "en" && !!s.audioUrls.zh) || (lang !== "zh" && !!s.audioUrls.en);
    return (
      <li key={s.seq}>
        <button
          disabled={!hasAudio}
          onClick={() => onPlay(s.seq)}
          title={hasAudio ? "点击播放该句" : "该语言暂无音频"}
          className={`w-full text-left rounded-lg px-3 py-2 flex items-start gap-2 disabled:opacity-50 ${
            active
              ? "bg-sky-100 dark:bg-sky-900/40"
              : "hover:bg-gray-100 dark:hover:bg-gray-700"
          }`}
        >
          {onImg && (
            <span className="shrink-0" title="图上也有热区">
              📍
            </span>
          )}
          <span className="flex-1">
            {s.role === "sfx" ? (
              <span className={segmentStyle("sfx", s.speaker)}>🔊 {s.speaker ?? "音效"}</span>
            ) : (
              <>
                {lang !== "en" && (
                  <p className={`caption-line ${segmentStyle(s.role, s.speaker)}`}>
                    {s.role === "dialogue" && s.speaker && (
                      <span className="caption-lang">{s.speaker}：</span>
                    )}
                    {s.textZh}
                  </p>
                )}
                {lang !== "zh" && (
                  <p className={`caption-line ${segmentStyle(s.role, s.speaker)}`}>
                    {s.role === "dialogue" && s.speaker && (
                      <span className="caption-lang">{s.speaker}: </span>
                    )}
                    {s.textEn}
                  </p>
                )}
              </>
            )}
          </span>
        </button>
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      {offImage.length > 0 && (
        <>
          <p className="text-xs text-gray-400">图外文案（点击播放）</p>
          <ul className="flex flex-col gap-1">{offImage.map(renderRow)}</ul>
        </>
      )}
      {onImage.length > 0 && (
        <>
          <p className="text-xs text-gray-400">已标注在图上的文案</p>
          <ul className="flex flex-col gap-1">{onImage.map(renderRow)}</ul>
        </>
      )}
    </div>
  );
}

export default function PageView({ page, lang, fontSize, onEnded }: Props) {
  const caps = captions(page, lang);
  const playlist = buildPlaylist(page.segments, lang);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const hotspotAudioRef = useRef<HTMLAudioElement | null>(null);
  const bubbleTimer = useRef<number | null>(null);
  const [activeSeq, setActiveSeq] = useState<number | null>(null);
  const stopHotspotAudio = () => {
    hotspotAudioRef.current?.pause();
    hotspotAudioRef.current = null;
  };
  const [playing, setPlaying] = useState(false);
  const [idx, setIdx] = useState(0);
  const [autoFlip, setAutoFlip] = useState(false);
  const [bubble, setBubble] = useState<string | null>(null);

  // 语言/页面切换时重置播放状态
  useEffect(() => {
    setPlaying(false);
    setIdx(0);
    audioRef.current?.pause();
    stopHotspotAudio();
  }, [page.pageNumber, lang]);

  const playCurrent = (i: number) => {
    const item = playlist[i];
    if (!item) {
      setPlaying(false);
      if (autoFlip) onEnded?.();
      return;
    }
    const a = new Audio(item.url);
    audioRef.current = a;
    stopHotspotAudio();
    a.onended = () => {
      const next = i + 1;
      setIdx(next);
      if (next < playlist.length) playCurrent(next);
      else {
        setPlaying(false);
        if (autoFlip) onEnded?.();
      }
    };
    a.onerror = () => {
      // 单段失败跳过，继续下一段
      const next = i + 1;
      setIdx(next);
      if (next < playlist.length) playCurrent(next);
      else {
        setPlaying(false);
        if (autoFlip) onEnded?.();
      }
    };
    a.play().catch(() => {
      const next = i + 1;
      if (next < playlist.length) playCurrent(next);
    });
  };

  const togglePlay = () => {
    if (playing) {
      audioRef.current?.pause();
      setPlaying(false);
      return;
    }
    if (!playlist.length) return;
    stopHotspotAudio();
    const start = idx >= playlist.length ? 0 : idx;
    setIdx(start);
    setPlaying(true);
    playCurrent(start);
  };

  // 热区点击：audio 播放对应分段；text 弹气泡；link 新标签打开
  const showBubble = (text: string | null) => {
    if (!text) return;
    setBubble(text);
    if (bubbleTimer.current) window.clearTimeout(bubbleTimer.current);
    bubbleTimer.current = window.setTimeout(() => setBubble(null), 3200);
  };

  const playHotspotAudio = (seq: number | null) => {
    if (seq == null || !page.segments) return;
    const seg = page.segments.find((s) => s.seq === seq);
    if (!seg) return;
    const langOrder: ("zh" | "en")[] = lang === "both" ? ["zh", "en"] : [lang];
    const urls = langOrder
      .map((l) => seg.audioUrls[l])
      .filter(Boolean) as string[];
    if (!urls.length) return;
    // 与整页朗读互斥：点热区发音时，先停掉整页朗读
    audioRef.current?.pause();
    setPlaying(false);
    stopHotspotAudio();
    let i = 0;
    const playNext = () => {
      const a = new Audio(urls[i]);
      hotspotAudioRef.current = a;
      a.onended = () => {
        setActiveSeq(null);
        if (++i < urls.length) playNext();
        else hotspotAudioRef.current = null;
      };
      a.play().catch(() => {
        if (++i < urls.length) playNext();
        else hotspotAudioRef.current = null;
      });
    };
    playNext();
  };

  // 图外文案点击播放（S4）：与图上热区复用同一播放路径，套用 S8 互斥
  const playSegment = (seq: number) => {
    setActiveSeq(seq);
    playHotspotAudio(seq);
  };

  const onHotspotClick = (h: Hotspot) => {
    if (h.kind === "audio") playHotspotAudio(h.segment_seq);
    else if (h.kind === "text") showBubble(h.payload || h.label || null);
    else if (h.kind === "link" && h.payload) window.open(h.payload, "_blank");
  };

  const langLabel =
    lang === "zh" ? "中" : lang === "en" ? "EN" : "中英";
  const progress =
    playlist.length > 0 ? Math.min(idx, playlist.length) / playlist.length : 0;

  return (
    <div className="page-view flex flex-col h-full">
      <div className="page-image-wrap">
        {page.imageUrl ? (
          <img
            className="page-image"
            src={page.imageUrl}
            alt={`第 ${page.pageNumber} 页`}
          />
        ) : (
          <div className="page-image-empty">本页暂无图</div>
        )}

        {page.hotspots?.map((h, i) => {
          // label 快照为「中文\n英文」，按当前语言模式显示对应行（与页面语言一致）
          const parts = (h.label ?? "").split("\n");
          const text =
            lang === "zh"
              ? (parts[0] ?? "")
              : lang === "en"
                ? (parts[1] ?? parts[0] ?? "")
                : (h.label ?? "");
          return (
            <button
              key={i}
              className="hotspot"
              style={{
                left: `${h.x * 100}%`,
                top: `${h.y * 100}%`,
                maxWidth: "88%",
                transform: "translate(-50%, -50%)",
              }}
              onClick={() => onHotspotClick(h)}
              title={h.label ?? h.type}
              aria-label={h.type}
            >
              {text}
            </button>
          );
        })}

        {bubble && (
          <div className="hotspot-bubble">{bubble}</div>
        )}

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

      <div className="page-caption flex-1" style={{ fontSize: `${fontSize}px` }}>
        {/* 优先按分段渲染（角色/场景区分）；无分段时退回整页旁白 */}
        {page.segments && page.segments.length > 0 ? (
          <SegmentList
            segments={page.segments}
            hotspots={page.hotspots}
            lang={lang}
            activeSeq={activeSeq}
            onPlay={playSegment}
          />
        ) : (
          caps.map((c, i) => (
            <p key={i} className="caption-line">
              {c.lang && <span className="caption-lang">{c.lang}</span>}
              {c.text}
            </p>
          ))
        )}
      </div>

      {/* 玻璃拟态音频控制条 */}
      <div className="audio-control glass flex items-center gap-3 px-4 py-2">
        <button
          onClick={togglePlay}
          disabled={playlist.length === 0}
          className="w-10 h-10 rounded-full bg-violet-600 text-white flex items-center justify-center hover:scale-105 transition disabled:opacity-40 disabled:cursor-not-allowed"
          aria-label={playing ? "暂停" : "播放"}
        >
          {playing ? "⏸" : "▶"}
        </button>
        <div className="flex-1">
          <div className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-300">
            <span>配音 · {langLabel}</span>
            <span>
              {playlist.length ? `${Math.min(idx + (playing ? 1 : 0), playlist.length)}/${playlist.length}` : "无音频"}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden mt-1">
            <div
              className="h-full bg-violet-500 transition-all"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
        </div>
        <label className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-300 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={autoFlip}
            onChange={(e) => setAutoFlip(e.target.checked)}
            className="accent-violet-600"
          />
          自动翻页
        </label>
      </div>
    </div>
  );
}
