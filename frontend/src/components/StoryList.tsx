import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import type { StorySummary } from "../types";
import { storyStatusColor } from "../status";
import NewStoryModal from "./NewStoryModal";

interface Props {
  onView: (id: number) => void;
}

function audioBadge(s: StorySummary): { label: string; cls: string } {
  if (s.isGenerating) return { label: "配音中…", cls: "bg-gold-soft text-ink" };
  if (s.hasAudio) return { label: `已配音 · ${s.audioSetCount}组`, cls: "bg-sage-soft text-sage" };
  return s.audioSetCount > 0
    ? { label: "中断", cls: "bg-gold-soft text-ink" }
    : { label: "未配音", cls: "bg-paper-3 text-muted" };
}

const StoryList: React.FC<Props> = ({ onView }) => {
  const [stories, setStories] = useState<StorySummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { stories } = await api.listStories();
      setStories(stories);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleDelete = async (id: number) => {
    if (!confirm(`确认删除故事 #${id}？`)) return;
    try {
      await api.deleteStory(id);
      await load();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  };

  // ---- 分页 ----
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);
  const total = stories.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const rows = useMemo(
    () => stories.slice((safePage - 1) * pageSize, safePage * pageSize),
    [stories, safePage, pageSize]
  );

  return (
    <div className="space-y-10">
      {/* 绘本库 */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-xl font-bold text-ink">绘本库</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowNew(true)}
              className="px-4 py-2 rounded-lg bg-brand text-white text-sm font-medium hover:bg-brand-strong transition"
            >
              ＋ 新建故事
            </button>
            <button
              onClick={load}
              disabled={loading}
              className="px-4 py-2 rounded-lg bg-paper-3 hover:bg-line text-ink text-sm disabled:opacity-50 transition"
            >
              刷新
            </button>
          </div>
        </div>

        {error && <p className="text-red-500 text-sm mb-4">{error}</p>}
        {total === 0 && !loading ? (
          <p className="text-muted">还没有故事，点击右上角「新建故事」开始吧。</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {rows.map((s) => (
              <article
                key={s.id}
                className="group bg-white rounded-2xl shadow-card overflow-hidden border border-line hover:shadow-soft transition flex flex-col"
              >
                <button
                  type="button"
                  onClick={() => onView(s.id)}
                  className="block w-full text-left bg-paper-2 overflow-hidden relative focus-warm"
                >
                  <div className="relative mx-auto aspect-[3/4] w-[80%] rounded-lg overflow-hidden bg-white/40">
                    {s.cover_url ? (
                      <img
                        src={s.cover_url}
                        alt={s.user_title || "绘本"}
                        loading="lazy"
                        className="w-full h-full object-cover transition group-hover:scale-[1.02]"
                      />
                    ) : (
                      <span className="absolute inset-0 flex items-center justify-center px-4 text-center font-display font-semibold text-ink/80">
                        {s.user_title || `故事 #${s.id}`}
                      </span>
                    )}
                  </div>
                </button>
                <div className="p-3 flex-1 flex flex-col">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold text-ink line-clamp-1">
                      {s.user_title || `故事 #${s.id}`}
                    </h3>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                    <span className={`px-2 py-0.5 rounded-full ${storyStatusColor(s.status)}`}>
                      {s.status}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full ${audioBadge(s).cls}`}>
                      {audioBadge(s).label}
                    </span>
                  </div>
                  <div className="mt-2 text-sm text-muted">{s.page_count} 页</div>
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => onView(s.id)}
                      className="flex-1 px-3 py-1.5 rounded-lg bg-brand text-white text-xs font-medium hover:bg-brand-strong transition"
                    >
                      管理
                    </button>
                    <button
                      onClick={() => handleDelete(s.id)}
                      className="px-3 py-1.5 rounded-lg bg-red-500 text-white text-xs font-medium hover:bg-red-600 transition"
                    >
                      删除
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}

        {total > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 mt-5 text-sm text-muted">
            <div>
              共 {total} 本 · 第 {safePage} / {totalPages} 页
            </div>
            <div className="flex items-center gap-2">
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
                className="px-2 py-1 border border-line rounded-lg bg-white text-ink focus-warm"
              >
                {[12, 24, 48].map((n) => (
                  <option key={n} value={n}>
                    {n} 本/页
                  </option>
                ))}
              </select>
              <button
                onClick={() => setPage(1)}
                disabled={safePage === 1}
                className="px-3 py-1 rounded-lg bg-paper-3 hover:bg-line text-ink disabled:opacity-40"
              >
                首页
              </button>
              <button
                onClick={() => setPage(safePage - 1)}
                disabled={safePage === 1}
                className="px-3 py-1 rounded-lg bg-paper-3 hover:bg-line text-ink disabled:opacity-40"
              >
                上一页
              </button>
              <button
                onClick={() => setPage(safePage + 1)}
                disabled={safePage === totalPages}
                className="px-3 py-1 rounded-lg bg-paper-3 hover:bg-line text-ink disabled:opacity-40"
              >
                下一页
              </button>
              <button
                onClick={() => setPage(totalPages)}
                disabled={safePage === totalPages}
                className="px-3 py-1 rounded-lg bg-paper-3 hover:bg-line text-ink disabled:opacity-40"
              >
                末页
              </button>
            </div>
          </div>
        )}
      </section>

      <NewStoryModal open={showNew} onClose={() => setShowNew(false)} onCreated={load} />
    </div>
  );
};

export default StoryList;
