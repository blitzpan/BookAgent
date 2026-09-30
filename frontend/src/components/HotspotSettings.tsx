import React, { useState, useEffect, useRef, useCallback } from 'react';
import { api, assetUrl } from '../api/client';
import type { HotspotKind } from '../types';

interface EditorSegment {
  seq: number;
  textZh: string;
  textEn: string;
  audioUrls: { zh?: string; en?: string };
}
interface EditorPage {
  pageNumber: number;
  imagePath: string | null;
  segments: EditorSegment[];
}
interface LocalHotspot {
  lid: string;
  id?: number;
  pageNumber: number;
  segment_seq: number | null;
  x: number;
  y: number;
  kind: HotspotKind;
  label: string | null;
  source: 'ai' | 'manual';
  confidence: number | null;
}

let lidCounter = 0;
const nextLid = () => `l${++lidCounter}`;

interface Props {
  storyId: number;
  onBack: () => void;
}

const HotspotSettings: React.FC<Props> = ({ storyId, onBack }) => {
  const [pages, setPages] = useState<EditorPage[]>([]);
  const [hotspots, setHotspots] = useState<LocalHotspot[]>([]);
  // 待删除项带 pageNumber：批量保存按页提交，删除必须落在对应页
  const [deleted, setDeleted] = useState<
    Array<{ id: number; pageNumber: number }>
  >([]);
  // 服务端原始快照（按 id），用于只提交真正变更的项
  const [savedById, setSavedById] = useState<Record<number, LocalHotspot>>({});
  const [pageIdx, setPageIdx] = useState(0);
  const [selectedLid, setSelectedLid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // 是否有未落库的改动（拖动/新增/删除只改本地状态，必须点保存才入库）
  const [dirty, setDirty] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<{ lid: string; moved: boolean } | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const [ed, hs] = await Promise.all([
        api.getHotspotEditorData(storyId),
        api.listHotspots(storyId),
      ]);
      setPages(ed.pages);
      const rows: LocalHotspot[] = hs.hotspots.map((h) => ({
        lid: nextLid(),
        id: h.id,
        pageNumber: h.page_number,
        segment_seq: h.segment_seq,
        x: h.x,
        y: h.y,
        kind: h.kind,
        label: h.label,
        source: h.source,
        confidence: h.confidence,
      }));
      setHotspots(rows);
      setDeleted([]);
      setSavedById(Object.fromEntries(rows.map((r) => [r.id as number, r])));
      setSelectedLid(null);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }, [storyId]);

  useEffect(() => {
    load();
  }, [load]);

  // 是否正在后台 AI 生成热区（这里只需知道「进行中与否」，不需要进度）
  const [aiRunning, setAiRunning] = useState(false);
  const checkAiTask = useCallback(async () => {
    try {
      const { task } = await api.getHotspotTask(storyId);
      setAiRunning(!!task && ['queued', 'running'].includes(task.status));
    } catch {
      /* 忽略：查不到就当作未生成 */
    }
  }, [storyId]);

  useEffect(() => {
    checkAiTask();
  }, [checkAiTask]);

  useEffect(() => {
    if (!aiRunning) return;
    const timer = setInterval(checkAiTask, 3000);
    return () => clearInterval(timer);
  }, [aiRunning, checkAiTask]);

  const page = pages[pageIdx];
  const pageHotspots = page ? hotspots.filter((h) => h.pageNumber === page.pageNumber) : [];

  const playUrl = (url?: string) => {
    const a = assetUrl(url);
    if (a) new Audio(a).play().catch(() => {});
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const raw =
      e.dataTransfer.getData('application/x-seg') ||
      e.dataTransfer.getData('text/plain');
    if (!raw || !imgRef.current || !page) return;
    let seg: EditorSegment;
    try {
      seg = JSON.parse(raw);
    } catch {
      return;
    }
    const rect = imgRef.current.getBoundingClientRect();
    const cx = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const cy = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    const label = `${seg.textZh}\n${seg.textEn}`;
    const nh: LocalHotspot = {
      lid: nextLid(),
      pageNumber: page.pageNumber,
      segment_seq: seg.seq,
      x: cx,
      y: cy,
      kind: 'audio',
      label,
      source: 'manual',
      confidence: null,
    };
    setHotspots((prev) => [...prev, nh]);
    setSelectedLid(nh.lid);
    setDirty(true); // 仅本地新增，需点保存才入库
  };

  const onHotspotMouseDown = (e: React.MouseEvent, h: LocalHotspot) => {
    if (!imgRef.current) return;
    e.preventDefault();
    const rect = imgRef.current.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    dragRef.current = { lid: h.lid, moved: false };
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      // 3px 阈值：点击试听时鼠标轻微抖动不应被判定为拖动，否则永远触发不了播放
      if (
        !dragRef.current.moved &&
        Math.hypot(ev.clientX - startX, ev.clientY - startY) < 3
      ) {
        return;
      }
      dragRef.current.moved = true;
      const cx = (ev.clientX - rect.left) / rect.width;
      const cy = (ev.clientY - rect.top) / rect.height;
      setDirty(true);
      setHotspots((prev) =>
        prev.map((it) =>
          it.lid === h.lid
            ? { ...it, x: Math.min(0.96, Math.max(0.04, cx)), y: Math.min(0.96, Math.max(0.04, cy)) }
            : it
        )
      );
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      const moved = dragRef.current?.moved;
      dragRef.current = null;
      // 管理端点击热区只做选中；播放统一走右侧文案的「播放中文/播放英文」
      if (!moved) setSelectedLid(h.lid);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const removeHotspot = (h: LocalHotspot) => {
    if (h.id != null)
      setDeleted((prev) => [...prev, { id: h.id as number, pageNumber: h.pageNumber }]);
    setHotspots((prev) => prev.filter((it) => it.lid !== h.lid));
    if (selectedLid === h.lid) setSelectedLid(null);
    setDirty(true);
  };

  // 只提交本页的变更项：新增（无 id）/ 与快照有差异 / 删除，后端一个事务完成
  const persist = useCallback(
    async (pageNumber: number) => {
      setBusy(true);
      setErr(null);
      setMsg(null);
      try {
        const create = hotspots
          .filter((h) => h.id == null && h.pageNumber === pageNumber)
          .map((h) => ({
            segment_seq: h.segment_seq,
            x: h.x,
            y: h.y,
            kind: h.kind,
            label: h.label,
          }));

        const update = hotspots
          .filter((h) => h.id != null && h.pageNumber === pageNumber)
          .filter((h) => {
            const o = savedById[h.id as number];
            if (!o) return false;
            return (
              o.x !== h.x ||
              o.y !== h.y ||
              o.segment_seq !== h.segment_seq ||
              o.kind !== h.kind ||
              o.label !== h.label
            );
          })
          .map((h) => ({
            id: h.id as number,
            segment_seq: h.segment_seq,
            x: h.x,
            y: h.y,
            kind: h.kind,
            label: h.label,
          }));

        const del = deleted
          .filter((d) => d.pageNumber === pageNumber)
          .map((d) => d.id);

        if (!create.length && !update.length && !del.length) {
          setMsg('本页无改动');
        } else {
          const r = await api.savePageHotspots(storyId, pageNumber, {
            create,
            update,
            delete: del,
          });
          setMsg(`已保存：新增 ${r.created} / 更新 ${r.updated} / 删除 ${r.deleted}`);
        }
        await load();
        setDirty(false);
      } catch (e: any) {
        setErr(e?.message ?? String(e));
      } finally {
        setBusy(false);
      }
    },
    [deleted, hotspots, savedById, storyId, load]
  );

  const handleBack = () => {
    if (dirty && !window.confirm('有未保存的修改，确定返回吗？改动会丢失。')) return;
    onBack();
  };

  const handleRefresh = async () => {
    if (dirty && !window.confirm('有未保存的修改，确定重新加载吗？改动会丢失。')) return;
    await load();
    setDirty(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <button
            onClick={handleBack}
            className="px-3 py-2 rounded-lg bg-gray-200 dark:bg-gray-700 hover:opacity-80"
          >
            ← 返回
          </button>
          <h2 className="text-xl font-bold text-purple-700 dark:text-purple-300">
            热区设置 · 故事 #{storyId}
          </h2>
          {dirty && (
            <span
              className="text-xs px-2 py-1 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-200"
              title="拖动/新增/删除只改本地，需点保存才入库"
            >
              ● 未保存
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => page && persist(page.pageNumber)}
            disabled={busy}
            className="px-4 py-2 rounded-lg bg-indigo-600 text-white disabled:opacity-50"
          >
            保存本页
          </button>
          <button
            onClick={handleRefresh}
            disabled={busy}
            className="px-3 py-2 rounded-lg bg-gray-200 dark:bg-gray-700 disabled:opacity-50"
          >
            刷新
          </button>
        </div>
      </div>

      {msg && (
        <div className="p-3 rounded-lg border-l-4 border-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 text-sm">
          {msg}
        </div>
      )}
      {err && (
        <div className="p-3 rounded-lg border-l-4 border-red-400 bg-red-50 dark:bg-red-900/30 text-sm text-red-700 dark:text-red-300">
          {err}
        </div>
      )}

      {aiRunning && (
        <div className="p-3 rounded-lg border-l-4 border-sky-400 bg-sky-50 dark:bg-sky-900/30 text-sm text-sky-800 dark:text-sky-200 flex items-center justify-between gap-2">
          <span>
            AI 正在后台生成热区…生成完成后点「刷新」查看最新结果（期间可照常微调已有热区）。
          </span>
          <button
            onClick={load}
            disabled={busy}
            className="px-3 py-1 rounded-md bg-sky-600 text-white text-xs disabled:opacity-50"
          >
            刷新
          </button>
        </div>
      )}

      {!page ? (
        <div className="p-8 text-center text-gray-500">加载中…</div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          {/* 图片 + 热区层 */}
          <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
            <div className="flex items-center justify-between mb-3">
              <button
                onClick={() => setPageIdx((i) => Math.max(0, i - 1))}
                disabled={pageIdx === 0}
                className="px-3 py-1.5 rounded-lg bg-gray-200 dark:bg-gray-700 disabled:opacity-40"
              >
                ← 上一页
              </button>
              <span className="text-sm font-semibold">
                第 {page.pageNumber} / {pages.length} 页
              </span>
              <button
                onClick={() => setPageIdx((i) => Math.min(pages.length - 1, i + 1))}
                disabled={pageIdx === pages.length - 1}
                className="px-3 py-1.5 rounded-lg bg-gray-200 dark:bg-gray-700 disabled:opacity-40"
              >
                下一页 →
              </button>
            </div>

            <div className="relative inline-block w-full">
              {page.imagePath ? (
                <img
                  ref={imgRef}
                  src={assetUrl(page.imagePath) ?? ''}
                  alt={`第 ${page.pageNumber} 页`}
                  className="block w-full rounded-lg select-none"
                  draggable={false}
                />
              ) : (
                <div className="w-full h-64 flex items-center justify-center bg-gray-100 dark:bg-gray-700 rounded-lg text-gray-400">
                  本页暂无图
                </div>
              )}

              <div
                className="absolute inset-0"
                onDragOver={(e) => e.preventDefault()}
                onDrop={onDrop}
              >
                {pageHotspots.map((h) => {
                  const lowConf = h.source === 'ai' && (h.confidence ?? 1) < 0.6;
                  const selected = h.lid === selectedLid;
                  return (
                    <div
                      key={h.lid}
                      onMouseDown={(e) => onHotspotMouseDown(e, h)}
                      className={`absolute cursor-move rounded-md border-2 flex items-center justify-center text-center text-[12px] leading-snug px-2 py-1 whitespace-pre-line break-words select-none transition
                        ${
                          lowConf
                            ? 'border-dashed border-gray-400 bg-gray-400/20 text-gray-700 dark:text-gray-200'
                            : 'border-purple-500 bg-purple-500/25 text-purple-900 dark:text-purple-100'
                        }
                        ${selected ? 'ring-2 ring-amber-400' : 'hover:border-purple-700'}`}
                      style={{
                        left: `${h.x * 100}%`,
                        top: `${h.y * 100}%`,
                        maxWidth: '88%',
                        transform: 'translate(-50%, -50%)',
                      }}
                      title={h.label ?? ''}
                    >
                      {h.label}
                      {selected && (
                        <button
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            removeHotspot(h);
                          }}
                          className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-red-500 text-white text-xs leading-none flex items-center justify-center"
                          title="删除热区"
                        >
                          ×
                        </button>
                      )}
                      {h.source === 'ai' && (
                        <span className="absolute bottom-0 left-0 text-[9px] px-1 bg-black/30 text-white rounded-tr">
                          AI
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            <p className="mt-2 text-xs text-gray-500">
              从右侧把文案拖到图上即可生成热区（落点为热区中心）；拖动热区可微调位置，点击可选中（× 删除）。改动需点「保存本页」才入库。
            </p>
          </div>

          {/* 侧栏：分段文案 + 试听 */}
          <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 space-y-3">
            <h3 className="font-bold text-violet-700 dark:text-violet-300">本页文案（拖到图上）</h3>
            {page.segments.length === 0 && (
              <p className="text-sm text-gray-500">本页暂无分段文案。</p>
            )}
            {page.segments.map((s) => (
              <div
                key={s.seq}
                draggable
                onDragStart={(e) => {
                  const data = JSON.stringify(s);
                  e.dataTransfer.setData('application/x-seg', data);
                  e.dataTransfer.setData('text/plain', data);
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                className="group rounded-lg border border-violet-200 dark:border-violet-800 bg-violet-50/60 dark:bg-violet-950/30 p-3 cursor-grab active:cursor-grabbing hover:border-violet-400"
              >
                <div className="text-sm">
                  <div className="text-gray-800 dark:text-gray-100">{s.textZh}</div>
                  <div className="text-gray-500">{s.textEn}</div>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <button
                    onClick={() => playUrl(s.audioUrls.zh)}
                    disabled={!s.audioUrls.zh}
                    className="px-2 py-1 rounded-md bg-purple-600 text-white text-xs disabled:opacity-40"
                  >
                    ▶ 播放中文
                  </button>
                  <button
                    onClick={() => playUrl(s.audioUrls.en)}
                    disabled={!s.audioUrls.en}
                    className="px-2 py-1 rounded-md bg-indigo-600 text-white text-xs disabled:opacity-40"
                  >
                    ▶ 播放英文
                  </button>
                  <span className="text-[11px] text-gray-400">seq #{s.seq}</span>
                </div>
              </div>
            ))}

            <h3 className="pt-2 font-bold text-gray-600">已放置热区</h3>
            {pageHotspots.length === 0 && (
              <p className="text-xs text-gray-400">尚未放置。</p>
            )}
            {pageHotspots.map((h) => (
              <div
                key={h.lid}
                className="flex items-center justify-between text-xs rounded-md bg-gray-50 dark:bg-gray-700 px-2 py-1"
              >
                <span className="truncate max-w-[200px]" title={h.label ?? ''}>
                  {h.label?.replace(/\n/g, ' / ')}
                </span>
                <button
                  onClick={() => removeHotspot(h)}
                  className="text-red-500 hover:underline"
                >
                  删除
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default HotspotSettings;
