import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import type { StorySummary, StoryListFilter } from "../types";
import NewStoryModal from "./NewStoryModal";

interface Props {
  onView: (id: number) => void;
}

// 与后端 constants/status.ts 的 STORY_STATUS 对齐（不含「删除」：软删记录不进列表）。
// 历史状态「生图完成待审批」已随库内 4 条数据一并迁移为「生图完成待发布」，不再保留。
const STATUS_OPTIONS = [
  "新建",
  "AI改写中",
  "改写完成待生图",
  "生图中",
  "生图完成待发布",
  "生图部分失败",
  "审批通过的作品",
];

const EMPTY_FILTER: StoryListFilter = {
  title: "",
  status: "",
  generated: "all",
  audio: "all",
  hotspots: "all",
};

/** 一组筛选条件是否非默认（含只改了下拉、还没点「查询」的情况）。 */
function isFilterSet(f: StoryListFilter): boolean {
  return Boolean(
    f.title ||
      f.status ||
      (f.generated && f.generated !== "all") ||
      (f.audio && f.audio !== "all") ||
      (f.hotspots && f.hotspots !== "all")
  );
}

/** 徽标配色：沿用项目暖色大地色系（去 AI 味），五种语义全局复用。 */
const CHIP = {
  neutral: "bg-paper-3 text-ink",
  progress: "bg-brand-soft text-brand-strong",
  warn: "bg-gold-soft text-[#8a5a1e]",
  danger: "bg-[#f3d9d3] text-[#8f3327]",
  done: "bg-sage-soft text-[#3f5a35]",
} as const;

type Tone = keyof typeof CHIP;

function statusView(status: string): { label: string; tone: Tone } {
  const v: Record<string, { label: string; tone: Tone }> = {
    新建: { label: "新建", tone: "neutral" },
    AI改写中: { label: "改写中", tone: "progress" },
    改写完成待生图: { label: "待生图", tone: "warn" },
    生图中: { label: "生图中", tone: "progress" },
    生图完成待发布: { label: "待发布", tone: "warn" },
    生图部分失败: { label: "缺图", tone: "danger" },
    审批通过的作品: { label: "已发布", tone: "done" },
  };
  return v[status] ?? { label: status, tone: "neutral" };
}

// 只按「新建 / 改写中」判定未完成，其余（含库中历史状态）一律视为已改写，
// 避免硬编码状态清单漏掉值时把已改写的书标成「待改写」。
function rewriteView(s: StorySummary): { label: string; tone: Tone } {
  if (s.status === "AI改写中") return { label: "改写中", tone: "progress" };
  if (s.status === "新建") return { label: "待改写", tone: "neutral" };
  return { label: "改写完成", tone: "done" };
}

function genView(s: StorySummary): { label: string; tone: Tone } {
  if (s.status === "生图部分失败") return { label: "缺图", tone: "danger" };
  if (s.currentRunId != null) return { label: "已生图", tone: "done" };
  return { label: "未生图", tone: "neutral" };
}

function audioView(s: StorySummary): { label: string; tone: Tone } {
  if (s.isGenerating) return { label: "配音中", tone: "progress" };
  if (s.hasAudioDone) return { label: `已配音·${s.audioSetCount}组`, tone: "done" };
  if (s.audioSetCount > 0) return { label: "中断", tone: "warn" };
  return { label: "未配音", tone: "neutral" };
}

function hotspotView(s: StorySummary): { label: string; tone: Tone } {
  return s.hasHotspots ? { label: "已配", tone: "done" } : { label: "未配", tone: "neutral" };
}

function fmtDate(d: string | null): string {
  if (!d) return "—";
  return d.replace("T", " ").slice(0, 16);
}

// ---- 图标（统一 24x24 线性 SVG，不用 emoji） ----
const Icon = ({ d, className = "w-5 h-5" }: { d: string; className?: string }) => (
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
    <path d={d} />
  </svg>
);

const PlusIcon = (p: { className?: string }) => <Icon className={p.className} d="M12 5v14M5 12h14" />;
const RefreshIcon = (p: { className?: string }) => (
  <Icon className={p.className} d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" />
);
const SearchIcon = (p: { className?: string }) => (
  <Icon className={p.className} d="M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.35-4.35" />
);
const ListIcon = (p: { className?: string }) => (
  <Icon className={p.className} d="M4 6h16M4 12h16M4 18h16" />
);
const CheckIcon = (p: { className?: string }) => <Icon className={p.className} d="M20 6 9 17l-5-5" />;
const TrashIcon = (p: { className?: string }) => (
  <Icon className={p.className} d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v5M14 11v5" />
);
const ChevronIcon = ({
  dir = "right",
  className = "w-4 h-4",
}: {
  dir?: "left" | "right";
  className?: string;
}) => <Icon className={className} d={dir === "left" ? "M15 18l-6-6 6-6" : "M9 6l6 6-6 6"} />;
const DoubleChevronIcon = ({
  dir = "right",
  className = "w-4 h-4",
}: {
  dir?: "left" | "right";
  className?: string;
}) => (
  <Icon
    className={className}
    d={dir === "left" ? "M11 17l-5-5 5-5M18 17l-5-5 5-5" : "M13 7l5 5-5 5M6 7l5 5-5 5"}
  />
);

const StoryList: React.FC<Props> = ({ onView }) => {
  const [stories, setStories] = useState<StorySummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  // 行内异步操作的忙态：防止重复点击（删除/发布都是不可逆动作）
  const [busyId, setBusyId] = useState<number | null>(null);
  const [confirming, setConfirming] = useState<{
    title: string;
    body: string;
    okText: string;
    danger?: boolean;
    onOk: () => void;
  } | null>(null);

  // 过滤条件：filter 为输入框当前值，applied 为「查询」按钮生效的值。
  const [filter, setFilter] = useState<StoryListFilter>({ ...EMPTY_FILTER });
  const [applied, setApplied] = useState<StoryListFilter>({ ...EMPTY_FILTER });

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

  // Esc 关闭确认弹窗（操作进行中不响应，避免误关）
  useEffect(() => {
    if (!confirming || busyId !== null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setConfirming(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirming, busyId]);

  const handleDelete = async (id: number) => {
    setBusyId(id);
    setError(null);
    try {
      await api.deleteStory(id);
      await load();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusyId(null);
    }
  };

  const handlePublish = async (s: StorySummary) => {
    setBusyId(s.id);
    setError(null);
    try {
      await api.publish(s.id, s.status === "生图部分失败");
      await load();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusyId(null);
    }
  };

  const askDelete = (s: StorySummary) =>
    setConfirming({
      title: `删除《${s.user_title || `故事 #${s.id}`}》？`,
      body: "删除后该绘本及其分页、图片、配音记录都会移入回收状态，无法在本页恢复。",
      okText: "确认删除",
      danger: true,
      onOk: () => handleDelete(s.id),
    });

  const askPublish = (s: StorySummary) =>
    setConfirming({
      title: `发布《${s.user_title || `故事 #${s.id}`}》？`,
      body:
        s.status === "生图部分失败"
          ? "该绘本仍有缺图页，发布后不可再修改，缺图页会以占位形式出现在阅读端。"
          : "发布后内容不可再修改，阅读端将立即看到这本绘本。",
      okText: "确认发布",
      onOk: () => handlePublish(s),
    });

  const onQuery = () => {
    setApplied({ ...filter });
    setPage(1);
  };

  // 清空条件：重置输入框与已生效条件，并回到第 1 页重新拉全量列表。
  const onClear = () => {
    setFilter({ ...EMPTY_FILTER });
    setApplied({ ...EMPTY_FILTER });
    setPage(1);
  };

  // 已生效的筛选（决定列表是否被筛过、空状态文案）
  const filterActive = useMemo(() => isFilterSet(applied), [applied]);
  // 清空按钮：只要输入框里还有未生效的条件也应可点，否则改了下拉却清不掉
  const canClear = isFilterSet(filter) || filterActive;

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
    "h-11 min-w-[7.5rem] px-3 border border-line rounded-xl bg-white text-ink text-sm cursor-pointer focus-warm transition-colors duration-200";

  return (
    <div className="space-y-6">
      <section>
        {/* 页头：标题 + 结果计数 + 主操作 */}
        <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
          <div>
            <h2 className="font-display text-2xl font-bold text-ink">绘本库</h2>
            <p className="text-sm text-muted-strong mt-1" aria-live="polite">
              {loading && total === 0
                ? "正在载入…"
                : `共 ${total} 本${filterActive ? " · 已按条件筛选" : ""}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowNew(true)}
              className="inline-flex items-center justify-center gap-2 h-11 px-5 rounded-xl bg-brand text-white text-sm font-semibold hover:bg-brand-strong cursor-pointer focus-warm transition-colors duration-200 shadow-card"
            >
              <PlusIcon className="w-4 h-4" />
              新建故事
            </button>
            <button
              onClick={load}
              disabled={loading}
              aria-label="刷新列表"
              className="inline-flex items-center justify-center gap-2 h-11 px-4 rounded-xl bg-paper-3 text-ink text-sm font-medium hover:bg-line cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-warm transition-colors duration-200"
            >
              <RefreshIcon
                className={`w-4 h-4 ${loading ? "animate-spin motion-reduce:animate-none" : ""}`}
              />
              刷新
            </button>
          </div>
        </div>

        {/* 过滤条 */}
        <div className="rounded-xl2 border border-line bg-paper-2 p-4 mb-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
            <label className="flex flex-col gap-1 text-xs text-muted-strong lg:flex-1 lg:min-w-[16rem]">
              标题
              <span className="relative block">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">
                  <SearchIcon className="w-4 h-4" />
                </span>
                <input
                  className="h-11 w-full pl-9 pr-3 border border-line rounded-xl bg-white text-ink text-sm placeholder:text-muted focus-warm transition-colors duration-200"
                  placeholder="按标题搜索"
                  value={filter.title ?? ""}
                  onChange={(e) => setFilter((f) => ({ ...f, title: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") onQuery();
                  }}
                />
              </span>
            </label>

            <label className="flex flex-col gap-1 text-xs text-muted-strong">
              状态
              <select
                className={selCls}
                value={filter.status ?? ""}
                onChange={(e) => setFilter((f) => ({ ...f, status: e.target.value }))}
              >
                <option value="">全部</option>
                {/* 选项文案与表格「状态」列一致（短文案），value 仍是后端状态全名 */}
                {STATUS_OPTIONS.map((st) => (
                  <option key={st} value={st}>
                    {statusView(st).label}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-xs text-muted-strong">
              生图
              <select
                className={selCls}
                value={filter.generated ?? "all"}
                onChange={(e) => setFilter((f) => ({ ...f, generated: e.target.value as any }))}
              >
                <option value="all">全部</option>
                <option value="done">已生图</option>
                <option value="none">未生图</option>
                <option value="partial">缺图</option>
              </select>
            </label>

            <label className="flex flex-col gap-1 text-xs text-muted-strong">
              配音
              <select
                className={selCls}
                value={filter.audio ?? "all"}
                onChange={(e) => setFilter((f) => ({ ...f, audio: e.target.value as any }))}
              >
                <option value="all">全部</option>
                <option value="done">已配音</option>
                <option value="none">未配音</option>
                <option value="generating">配音中</option>
                <option value="interrupted">中断</option>
              </select>
            </label>

            <label className="flex flex-col gap-1 text-xs text-muted-strong">
              热区
              <select
                className={selCls}
                value={filter.hotspots ?? "all"}
                onChange={(e) => setFilter((f) => ({ ...f, hotspots: e.target.value as any }))}
              >
                <option value="all">全部</option>
                <option value="done">已配</option>
                <option value="none">未配</option>
              </select>
            </label>

            <div className="flex items-center gap-2 lg:ml-auto">
              <button
                onClick={onQuery}
                disabled={loading}
                className="h-11 px-5 rounded-xl bg-brand text-white text-sm font-semibold hover:bg-brand-strong cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-warm transition-colors duration-200"
              >
                查询
              </button>
              <button
                onClick={onClear}
                disabled={!canClear}
                className="h-11 px-4 rounded-xl bg-paper-3 text-ink text-sm font-medium hover:bg-line cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed focus-warm transition-colors duration-200"
              >
                清空
              </button>
            </div>
          </div>
        </div>

        {error && (
          <p role="alert" className="mb-4 px-3 py-2 rounded-xl bg-[#f3d9d3] text-[#8f3327] text-sm">
            {error}
          </p>
        )}

        {/* 空状态：区分「还没有绘本」与「筛选无结果」，各自给出下一步动作 */}
        {!loading && total === 0 && (
          <div className="flex flex-col items-center text-center gap-3 rounded-xl2 border border-dashed border-line bg-paper-2 px-6 py-14">
            <span className="grid h-14 w-14 place-items-center rounded-full bg-white text-brand shadow-card">
              <ListIcon className="w-7 h-7" />
            </span>
            <div>
              <p className="font-display text-lg font-bold text-ink">
                {filterActive ? "没有符合条件的故事" : "绘本库还是空的"}
              </p>
              <p className="text-sm text-muted-strong mt-1">
                {filterActive
                  ? "试着放宽状态、生图或配音条件再查一次。"
                  : "粘贴一段故事原文，或让 AI 先起草一个主题，即可开始生产绘本。"}
              </p>
            </div>
            {filterActive ? (
              <button
                onClick={onClear}
                className="inline-flex items-center justify-center gap-2 h-11 px-5 rounded-xl bg-brand text-white text-sm font-semibold hover:bg-brand-strong cursor-pointer focus-warm transition-colors duration-200"
              >
                清空筛选条件
              </button>
            ) : (
              <button
                onClick={() => setShowNew(true)}
                className="inline-flex items-center justify-center gap-2 h-11 px-5 rounded-xl bg-brand text-white text-sm font-semibold hover:bg-brand-strong cursor-pointer focus-warm transition-colors duration-200"
              >
                <PlusIcon className="w-4 h-4" />
                新建故事
              </button>
            )}
          </div>
        )}

        {/* 列表：载入时先出等高骨架行，避免内容跳动 */}
        {(loading || total > 0) && (
          <div className="overflow-x-auto rounded-xl2 border border-line bg-white shadow-card">
            <table className="w-full min-w-[64rem] text-sm border-collapse">
              <thead className="bg-paper-2 text-muted-strong">
                <tr className="text-left">
                  <th scope="col" className="px-3 py-3 font-medium whitespace-nowrap">封面</th>
                  <th scope="col" className="px-3 py-3 font-medium">标题</th>
                  <th scope="col" className="px-3 py-3 font-medium whitespace-nowrap">状态</th>
                  <th scope="col" className="px-3 py-3 font-medium whitespace-nowrap">改写</th>
                  <th scope="col" className="px-3 py-3 font-medium whitespace-nowrap">生图</th>
                  <th scope="col" className="px-3 py-3 font-medium whitespace-nowrap">配音</th>
                  <th scope="col" className="px-3 py-3 font-medium whitespace-nowrap">热区</th>
                  <th scope="col" className="px-3 py-3 font-medium text-right whitespace-nowrap">页数</th>
                  <th scope="col" className="px-3 py-3 font-medium whitespace-nowrap">更新时间</th>
                  <th scope="col" className="px-3 py-3 font-medium text-right whitespace-nowrap">操作</th>
                </tr>
              </thead>
              <tbody>
                {loading && total === 0
                  ? Array.from({ length: Math.min(pageSize, 10) }).map((_, i) => (
                      <tr key={i} className="border-t border-line">
                        {Array.from({ length: 10 }).map((__, j) => (
                          <td key={j} className="px-3 py-3">
                            <div className="h-5 rounded bg-paper-3 animate-pulse motion-reduce:animate-none" />
                          </td>
                        ))}
                      </tr>
                    ))
                  : rows.map((s) => {
                      const canPublish =
                        s.currentRunId != null && s.status !== "审批通过的作品";
                      const busy = busyId === s.id;
                      const title = s.user_title || `故事 #${s.id}`;
                      return (
                        <tr
                          key={s.id}
                          className={`border-t border-line transition-colors duration-200 hover:bg-paper-2/70 ${
                            busy ? "opacity-60" : ""
                          }`}
                        >
                          <td className="px-3 py-2.5">
                            <div className="w-12 h-16 rounded-md overflow-hidden bg-paper-3 flex items-center justify-center">
                              {s.cover_url ? (
                                <img
                                  src={s.cover_url}
                                  alt={`《${title}》封面`}
                                  loading="lazy"
                                  decoding="async"
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <span className="text-[10px] text-muted-strong text-center px-1 line-clamp-3">
                                  {title}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-2.5 max-w-[18rem]">
                            <button
                              type="button"
                              onClick={() => onView(s.id)}
                              className="text-left font-medium text-ink hover:text-brand hover:underline cursor-pointer focus-warm"
                            >
                              {title}
                            </button>
                          </td>
                          <td className="px-3 py-2.5">
                            <StatusChip view={statusView(s.status)} />
                          </td>
                          <td className="px-3 py-2.5">
                            <StatusChip view={rewriteView(s)} />
                          </td>
                          <td className="px-3 py-2.5">
                            <StatusChip view={genView(s)} />
                          </td>
                          <td className="px-3 py-2.5">
                            <StatusChip view={audioView(s)} />
                          </td>
                          <td className="px-3 py-2.5">
                            <StatusChip view={hotspotView(s)} />
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-ink">
                            {s.page_count}
                          </td>
                          <td className="px-3 py-2.5 text-muted-strong whitespace-nowrap">
                            {fmtDate(s.updated_at)}
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                onClick={() => onView(s.id)}
                                className="h-9 px-3 rounded-lg bg-brand text-white text-xs font-semibold hover:bg-brand-strong cursor-pointer focus-warm transition-colors duration-200"
                              >
                                管理
                              </button>
                              <button
                                onClick={() => canPublish && askPublish(s)}
                                disabled={!canPublish || busy}
                                aria-label={`发布《${title}》`}
                                title={canPublish ? "发布该绘本" : "需先生图，且已发布的不可重复发布"}
                                className="grid h-9 w-9 place-items-center rounded-lg bg-sage-soft text-[#3f5a35] hover:bg-sage hover:text-white cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-sage-soft disabled:hover:text-[#3f5a35] focus-warm transition-colors duration-200"
                              >
                                <CheckIcon className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => askDelete(s)}
                                disabled={busy}
                                aria-label={`删除《${title}》`}
                                title="删除该绘本"
                                className="grid h-9 w-9 place-items-center rounded-lg bg-paper-2 text-muted-strong hover:bg-[#f3d9d3] hover:text-[#8f3327] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed focus-warm transition-colors duration-200"
                              >
                                <TrashIcon className="w-4 h-4" />
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
          <div className="flex flex-wrap items-center justify-between gap-3 mt-5 text-sm text-muted-strong">
            <div>
              共 {total} 本 · 第 {safePage} / {totalPages} 页
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2">
                <span className="sr-only">每页显示本数</span>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setPage(1);
                  }}
                  className="h-11 px-3 border border-line rounded-xl bg-white text-ink text-sm cursor-pointer focus-warm transition-colors duration-200"
                >
                  {[12, 24, 48].map((n) => (
                    <option key={n} value={n}>
                      {n} 本/页
                    </option>
                  ))}
                </select>
              </label>
              <button
                onClick={() => setPage(1)}
                disabled={safePage === 1}
                aria-label="首页"
                className="grid h-11 w-11 place-items-center rounded-xl bg-paper-3 text-ink hover:bg-line cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed focus-warm transition-colors duration-200"
              >
                <DoubleChevronIcon dir="left" />
              </button>
              <button
                onClick={() => setPage(safePage - 1)}
                disabled={safePage === 1}
                aria-label="上一页"
                className="grid h-11 w-11 place-items-center rounded-xl bg-paper-3 text-ink hover:bg-line cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed focus-warm transition-colors duration-200"
              >
                <ChevronIcon dir="left" />
              </button>
              <button
                onClick={() => setPage(safePage + 1)}
                disabled={safePage === totalPages}
                aria-label="下一页"
                className="grid h-11 w-11 place-items-center rounded-xl bg-paper-3 text-ink hover:bg-line cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed focus-warm transition-colors duration-200"
              >
                <ChevronIcon dir="right" />
              </button>
              <button
                onClick={() => setPage(totalPages)}
                disabled={safePage === totalPages}
                aria-label="末页"
                className="grid h-11 w-11 place-items-center rounded-xl bg-paper-3 text-ink hover:bg-line cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed focus-warm transition-colors duration-200"
              >
                <DoubleChevronIcon dir="right" />
              </button>
            </div>
          </div>
        )}
      </section>

      {/* 删除/发布二次确认：替代原生 confirm，保持暖色视觉语言与键盘可达 */}
      {confirming && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/40 backdrop-blur-sm"
          onClick={() => !busyId && setConfirming(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            className="w-full max-w-md rounded-2xl bg-white border border-line shadow-soft overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 pt-6">
              <h3 id="confirm-title" className="font-display text-lg font-bold text-ink">
                {confirming.title}
              </h3>
              <p className="mt-2 text-sm text-muted-strong leading-relaxed">{confirming.body}</p>
            </div>
            <div className="flex justify-end gap-3 px-6 py-5">
              <button
                onClick={() => setConfirming(null)}
                className="h-11 px-5 rounded-xl bg-paper-3 text-ink text-sm font-medium hover:bg-line cursor-pointer focus-warm transition-colors duration-200"
              >
                取消
              </button>
              <button
                autoFocus
                onClick={() => {
                  const ok = confirming.onOk;
                  setConfirming(null);
                  ok();
                }}
                className={`h-11 px-5 rounded-xl text-white text-sm font-semibold cursor-pointer focus-warm transition-colors duration-200 ${
                  confirming.danger
                    ? "bg-[#b3453a] hover:bg-[#97382f]"
                    : "bg-brand hover:bg-brand-strong"
                }`}
              >
                {confirming.okText}
              </button>
            </div>
          </div>
        </div>
      )}

      <NewStoryModal open={showNew} onClose={() => setShowNew(false)} onCreated={load} />
    </div>
  );
};

/** 状态徽标：短文案 + 语义底色，列表内 5 列复用同一渲染。 */
function StatusChip({ view }: { view: { label: string; tone: Tone } }) {
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-md text-xs whitespace-nowrap ${CHIP[view.tone]}`}
    >
      {view.label}
    </span>
  );
}

export default StoryList;
