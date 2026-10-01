import React, { useEffect, useMemo, useRef, useState } from "react";
import { api, assetUrl } from "../api/client";

// 试听弹窗：列出某配音方案下全部录音文件，逐条播放，支持顺序连播。

type BookAudio = Awaited<ReturnType<typeof api.getBookAudio>>;
type Track = {
  key: string;
  url: string;
  page: number;
  seq: number;
  lang: "中" | "EN";
  role: string;
  speaker: string | null;
  text: string;
};

const ROLE_BADGE: Record<string, string> = {
  narration: "bg-gold-soft text-ink",
  dialogue: "bg-sky-100 text-sky-700",
  background: "bg-amber-100 text-amber-700",
  sfx: "bg-pink-100 text-pink-700",
};
const ROLE_LABEL: Record<string, string> = {
  narration: "旁白",
  dialogue: "对话",
  background: "背景",
  sfx: "音效",
};

const PlayIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
    <path d="M8 5v14l11-7z" />
  </svg>
);
const PauseIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
    <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
  </svg>
);
const StopIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
    <path d="M6 6h12v12H6z" />
  </svg>
);
const CloseIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
    <path d="M6.4 5L5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12 19 6.4 17.6 5 12 10.6z" />
  </svg>
);

export const AudioPlanModal: React.FC<{
  storyId: number;
  setId: number;
  name: string;
  onClose: () => void;
}> = ({ storyId, setId, name, onClose }) => {
  const [data, setData] = useState<BookAudio | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [queueIndex, setQueueIndex] = useState(-1);
  const [sequential, setSequential] = useState(true);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getBookAudio(storyId, setId)
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setLoading(false);
        }
      })
      .catch((e: any) => {
        if (!cancelled) {
          setError(e?.message ?? String(e));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [storyId, setId]);

  const tracks = useMemo<Track[]>(() => {
    const arr: Track[] = [];
    for (const p of data?.pages ?? []) {
      for (const seg of p.segments) {
        if (seg.audioUrls?.zh && assetUrl(seg.audioUrls.zh)) {
          arr.push({
            key: `${p.pageNumber}-${seg.seq}-zh`,
            url: assetUrl(seg.audioUrls.zh)!,
            page: p.pageNumber,
            seq: seg.seq,
            lang: "中",
            role: seg.role,
            speaker: seg.speaker,
            text: seg.textZh,
          });
        }
        if (seg.audioUrls?.en && assetUrl(seg.audioUrls.en)) {
          arr.push({
            key: `${p.pageNumber}-${seg.seq}-en`,
            url: assetUrl(seg.audioUrls.en)!,
            page: p.pageNumber,
            seq: seg.seq,
            lang: "EN",
            role: seg.role,
            speaker: seg.speaker,
            text: seg.textEn,
          });
        }
      }
    }
    return arr;
  }, [data]);

  const playIndex = (i: number) => {
    const t = tracks[i];
    if (!t) return;
    const a = audioRef.current!;
    a.src = t.url;
    a.currentTime = 0;
    setQueueIndex(i);
    a.play().catch(() => {});
  };

  const handleEnded = () => {
    if (sequential && queueIndex >= 0 && queueIndex < tracks.length - 1) {
      playIndex(queueIndex + 1);
    } else {
      setQueueIndex(-1);
    }
  };

  const stop = () => {
    audioRef.current?.pause();
    setQueueIndex(-1);
  };

  useEffect(() => () => audioRef.current?.pause(), []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-2xl max-h-[85vh] flex-col rounded-2xl border border-violet-200 bg-white/85 dark:bg-gray-900/85 shadow-2xl backdrop-blur-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-violet-200/60 p-4">
          <div>
            <h3 className="text-lg font-bold text-ink">
              试听 · {name}
            </h3>
            <p className="text-xs text-gray-500">
              {tracks.length} 条录音 · 点击播放，可顺序连播对比
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            aria-label="关闭"
          >
            <CloseIcon />
          </button>
        </div>

        <div className="space-y-2 overflow-y-auto p-4">
          {loading && <p className="text-sm text-gray-500">加载录音列表…</p>}
          {error && <p className="text-sm text-red-500">{error}</p>}
          {!loading && !error && tracks.length === 0 && (
            <p className="text-sm text-gray-500">
              该方案暂无音频（可能尚未生成完成或生成失败）。可返回点击「继续生成」后重试。
            </p>
          )}
          {tracks.map((t, i) => (
            <div
              key={t.key}
              className="flex items-center gap-3 rounded-xl border border-gray-200 px-3 py-2 hover:bg-violet-50/60 dark:border-gray-700 dark:hover:bg-violet-900/20"
            >
              <button
                onClick={() => (queueIndex === i ? stop() : playIndex(i))}
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                  queueIndex === i
                    ? "bg-violet-600 text-white"
                    : "bg-gold-soft text-ink hover:bg-violet-200"
                }`}
                aria-label={queueIndex === i ? "停止" : "播放"}
              >
                {queueIndex === i ? <StopIcon /> : <PlayIcon />}
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <span>第 {t.page} 页</span>
                  <span>·</span>
                  <span
                    className={`rounded px-1.5 py-0.5 ${
                      ROLE_BADGE[t.role] ?? ROLE_BADGE.narration
                    }`}
                  >
                    {ROLE_LABEL[t.role] ?? t.role}
                  </span>
                  {t.speaker && <span>· {t.speaker}</span>}
                </div>
                <p className="truncate text-sm">{t.text}</p>
              </div>
              <span
                className={`rounded-full px-2 py-0.5 text-xs ${
                  t.lang === "中"
                    ? "bg-rose-100 text-rose-700"
                    : "bg-blue-100 text-blue-700"
                }`}
              >
                {t.lang}
              </span>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3 border-t border-violet-200/60 p-4">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
            <input
              type="checkbox"
              checked={sequential}
              onChange={(e) => setSequential(e.target.checked)}
            />
            顺序连播全部
          </label>
          <button
            onClick={() => playIndex(0)}
            disabled={tracks.length === 0}
            className="rounded-lg bg-violet-600 px-3 py-1.5 text-white disabled:opacity-40"
          >
            从头播放
          </button>
          <button
            onClick={stop}
            disabled={queueIndex < 0}
            className="rounded-lg bg-gray-200 px-3 py-1.5 text-gray-700 disabled:opacity-40 dark:bg-gray-700 dark:text-gray-200"
          >
            停止
          </button>
          <span className="ml-auto text-xs text-gray-400">
            {queueIndex >= 0 ? `${queueIndex + 1}/${tracks.length}` : ""}
          </span>
        </div>

        <audio ref={audioRef} onEnded={handleEnded} />
      </div>
    </div>
  );
};
