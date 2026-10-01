import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import type { StorySummary, StoryListFilter } from "../types";
import NewStoryModal from "./NewStoryModal";

interface Props {
  onView: (id: number) => void;
}

const STATUS_OPTIONS = [
  "新建",
  "AI改写中",
  "改写完成待生图",
  "生图中",
  "生图完成待发布",
  "生图部分失败",
  "审批通过的作品",
];

// 状态列：短文案 + 按枚举上不同背景色（保留可读文字，非纯色块徽标）。
const STATUS_VIEW: Record<string, { label: string; cls: string }> = {
  新建: { label: "新建", cls: "bg-stone-100 text-stone-700" },
  AI改写中: { label: "改写中", cls: "bg-[#f6dccd] text-[#9c4a2c]" },
  改写完成待生图: { label: "待生图", cls: "bg-[#f6e6c8] text-[#8a5a1e]" },
  生图中: { label: "生图中", cls: "bg-[#f6dccd] text-[#9c4a2c]" },
  生图完成待发布: { label: "待发布", cls: "bg-[#f6e6c8] text-[#8a5a1e]" },
  生图部分失败: { label: "缺图", cls: "bg-[#f3d9d3] text-[#9c3b30]" },
  审批通过的作品: { label: "已发布", cls: "bg-[#dfe7d5] text-[#3f5a35]" },
};
function statusView(status: string): { label: string; cls: string } {
  return STATUS_VIEW[status] ?? { label: status, cls: "bg-stone-100 text-stone-700" };
}

// 改写 / 生图 / 配音 / 热区 四列：短文案 + 按枚举上不同背景色（与状态列同风格）。
function rewriteView(s: StorySummary): { label: string; cls: string } {
  const label = rewriteLabel(s);
  const cls =
    label === "改写完成"
      ? "bg-[#dfe7d5] text-[#3f5a35]"
      : label === "AI改写中"
        ? "bg-[#f6dccd] text-[#9c4a2c]"
        : "bg-stone-100 text-stone-700";
  return { label, cls };
}

function genView(s: StorySummary): { label: string; cls: string } {
  const g = genLabel(s);
  const cls = g.warn
    ? "bg-[#f3d9d3] text-[#9c3b30]"
    : g.text === "已生图"
      ? "bg-[#dfe7d5] text-[#3f5a35]"
      : "bg-stone-100 text-stone-700";
  return { label: g.text, cls };
}

function audioView(s: StorySummary): { label: string; cls: string } {
  const label = audioLabel(s);
  const cls = label === "配音中"
    ? "bg-[#f6dccd] text-[#9c4a2c]"
    : label.startsWith("已配音")
      ? "bg-[#dfe7d5] text-[#3f5a35]"
      : label === "中断"
        ? "bg-[#f6e6c8] text-[#8a5a1e]"
        : "bg-stone-100 text-stone-700";
  return { label, cls };
}

function hotspotView(s: StorySummary): { label: string; cls: string } {
  const label = hotspotLabel(s);
  const cls = label === "已配" ? "bg-[#dfe7d5] text-[#3f5a35]" : "bg-stone-100 text-stone-700";
  return { label, cls };
}

function rewriteLabel(s: StorySummary): string {
  if (s.status === "AI改写中") return "AI改写中";
  if (
    [
      "改写完成待生图",
      "生图中",
      "生图完成待发布",
      "生图部分失败",
      "审批通过的作品",
    ].includes(s.status)
  )
    return "改写完成";
  return "待改写";
}

function genLabel(s: StorySummary): { text: string; warn: boolean } {
  if (s.currentRunId == null) return { text: "未生图", warn: false };
  if (s.status === "生图部分失败") return { text: "缺图", warn: true };
  return { text: "已生图", warn: false };
}

function audioLabel(s: StorySummary): string {
  if (s.isGenerating) return "配音中";
  if (s.hasAudioDone) return `已配音·${s.audioSetCount}组`;
  if (s.audioSetCount > 0) return "中断";
  return "未配音";
}

function hotspotLabel(s: StorySummary): string {
  return s.hasHotspots ? "已配" : "未配";
}

function fmtDate(d: string | null): string {
  if (!d) return "—";
  return d.replace("T", " ").slice(0, 16);
}

const StoryList: React.FC<Props> = ({ onView }) => {
  const [stories, setStories] = useState<StorySummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);

  // 过滤条件：filter 为输入框当前值，applied 为「查询」按钮生效的值。
  const [filter, setFilter] = useState<StoryListFilter>({
    title: "",
    status: "",
    generated: "all",
    audio: "all",
    hotspots: "all",
  });
  const [applied, setApplied] = useState<StoryListFilter>({ ...filter });

  const EMPTY_FILTER: StoryListFilter = {
    title: "",
    status: "",
    generated: "all",
    audio: "all",
    hotspots: "all",
  };

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { stories } = await api.listStories(applied);
      setStories(stories);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [applied]);

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

  const handlePublish = async (s: StorySummary) => {
    if (s.status === "生图部分失败") {
      if (!confirm("仍有缺图页，确认发布？（发布后不可再修改）")) return;
    } else if (!confirm("确认发布该故事？发布后不可再修改。")) {
      return;
    }
    try {
      await api.publish(s.id, s.status === "生图部分失败");
      await load();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  };

  const onQuery = () => setApplied({ ...filter });

  // 清空条件：重置输入框与已生效条件，并回到第 1 页重新拉全量列表。
  const onClear = () => {
    setFilter({ ...EMPTY_FILTER });
    setApplied({ ...EMPTY_FILTER });
    setPage(1);
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

  const selCls =
    "px-2 py-1.5 border border-line rounded-lg bg-white text-ink text-sm focus-warm";
  const inputCls =
    "px-2 py-1.5 border border-line rounded-lg bg-white text-ink text-sm focus-warm";

  return (
    <div className="space-y-6">
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

        {/* 过滤条件 + 查询 */}
        <div className="flex flex-wrap items-end gap-3 mb-4 p-3 rounded-xl bg-paper-2 border border-line">
          <label className="flex flex-col gap-1 text-xs text-muted">
            标题
            <input
              className={inputCls}
              placeholder="按标题搜索"
              value={filter.title ?? ""}
              onChange={(e) => setFilter((f) => ({ ...f, title: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === "Enter") onQuery();
              }}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            状态
            <select
              className={selCls}
              value={filter.status ?? ""}
              onChange={(e) => setFilter((f) => ({ ...f, status: e.target.value }))}
            >
              <option value="">全部</option>
              {STATUS_OPTIONS.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            生图
            <select
              className={selCls}
              value={filter.generated ?? "all"}
              onChange={(e) =>
                setFilter((f) => ({ ...f, generated: e.target.value as any }))
              }
            >
              <option value="all">全部</option>
              <option value="done">已生图</option>
              <option value="none">未生图</option>
              <option value="partial">缺图</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            配音
            <select
              className={selCls}
              value={filter.audio ?? "all"}
              onChange={(e) =>
                setFilter((f) => ({ ...f, audio: e.target.value as any }))
              }
            >
              <option value="all">全部</option>
              <option value="done">已配音</option>
              <option value="none">未配音</option>
              <option value="generating">配音中</option>
              <option value="interrupted">中断</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            热区
            <select
              className={selCls}
              value={filter.hotspots ?? "all"}
              onChange={(e) =>
                setFilter((f) => ({ ...f, hotspots: e.target.value as any }))
              }
            >
              <option value="all">全部</option>
              <option value="done">已配</option>
              <option value="none">未配</option>
            </select>
          </label>
          <button
            onClick={onQuery}
            disabled={loading}
            className="px-5 py-2 rounded-lg bg-brand text-white text-sm font-medium hover:bg-brand-strong transition disabled:opacity-50"
          >
            查询
          </button>
          <button
            onClick={onClear}
            className="px-5 py-2 rounded-lg bg-paper-3 hover:bg-line text-ink text-sm transition"
          >
            清空
          </button>
        </div>

        {error && <p className="text-red-500 text-sm mb-4">{error}</p>}
        {total === 0 && !loading ? (
          <p className="text-muted">没有符合条件的故事。</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-paper-2 text-muted text-left">
                  <th className="px-3 py-2 font-medium">封面</th>
                  <th className="px-3 py-2 font-medium">标题</th>
                  <th className="px-3 py-2 font-medium">状态</th>
                  <th className="px-3 py-2 font-medium">改写</th>
                  <th className="px-3 py-2 font-medium">生图</th>
                  <th className="px-3 py-2 font-medium">配音</th>
                  <th className="px-3 py-2 font-medium">热区</th>
                  <th className="px-3 py-2 font-medium text-right">页数</th>
                  <th className="px-3 py-2 font-medium">更新时间</th>
                  <th className="px-3 py-2 font-medium text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => {
                  const canPublish = s.currentRunId != null && s.status !== "审批通过的作品";
                  return (
                    <tr
                      key={s.id}
                      className="border-t border-line hover:bg-paper-2/60"
                    >
                      <td className="px-3 py-2">
                        <div className="w-9 h-12 rounded overflow-hidden bg-paper-3 flex items-center justify-center">
                          {s.cover_url ? (
                            <img
                              src={s.cover_url}
                              alt={s.user_title || "绘本"}
                              loading="lazy"
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <span className="text-[10px] text-muted text-center px-1">
                              {s.user_title || `#${s.id}`}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => onView(s.id)}
                          className="text-left font-medium text-ink hover:text-brand hover:underline focus-warm"
                        >
                          {s.user_title || `故事 #${s.id}`}
                        </button>
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-xs ${statusView(s.status).cls}`}
                        >
                          {statusView(s.status).label}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs ${rewriteView(s).cls}`}>
                          {rewriteView(s).label}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs ${genView(s).cls}`}>
                          {genView(s).label}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs ${audioView(s).cls}`}>
                          {audioView(s).label}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs ${hotspotView(s).cls}`}>
                          {hotspotView(s).label}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right text-ink">
                        {s.page_count}
                      </td>
                      <td className="px-3 py-2 text-muted">{fmtDate(s.updated_at)}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => onView(s.id)}
                            className="px-3 py-1.5 rounded-lg bg-brand text-white text-xs font-medium hover:bg-brand-strong transition"
                          >
                            管理
                          </button>
                          <button
                            onClick={() => canPublish && handlePublish(s)}
                            disabled={!canPublish}
                            className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 transition disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-emerald-600"
                          >
                            发布
                          </button>
                          <button
                            onClick={() => handleDelete(s.id)}
                            className="px-3 py-1.5 rounded-lg bg-red-500 text-white text-xs font-medium hover:bg-red-600 transition"
                          >
                            删除
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
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
