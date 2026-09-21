import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';
import type { Story, Page, GenerationRun, RunDetail, GenerateConfig } from '../types';
import { storyStatusColor, runStatusColor } from '../status';
import GeneratePanel from './GeneratePanel';
import PageCard from './PageCard';
import AnchorGallery from './AnchorGallery';

interface Props {
  storyId: number;
  onBack: () => void;
  onChanged: () => void;
}

const ACTIVE = new Set(['queued', 'running']);

const StoryDetail: React.FC<Props> = ({ storyId, onBack, onChanged }) => {
  const [detail, setDetail] = useState<{ story: Story; pages: Page[] } | null>(null);
  const [runs, setRuns] = useState<GenerationRun[]>([]);
  const [runDetail, setRunDetail] = useState<RunDetail | null>(null);
  const [activeRunId, setActiveRunId] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showGen, setShowGen] = useState(false);
  const [busyImageId, setBusyImageId] = useState<number | null>(null);
  const [busyPageId, setBusyPageId] = useState<number | null>(null);

  const loadDetail = useCallback(async () => {
    const d = await api.getStory(storyId);
    setDetail(d);
  }, [storyId]);

  const loadRuns = useCallback(async () => {
    const r = await api.listRuns(storyId);
    setRuns(r.runs);
    const full = r.runs.find((x) => x.scope === 'full');
    if (full && full.id !== activeRunId) setActiveRunId(full.id);
  }, [storyId, activeRunId]);

  const loadRunDetail = useCallback(async (id: number) => {
    const rd = await api.getRun(id);
    setRunDetail(rd);
  }, []);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      await Promise.all([loadDetail(), loadRuns()]);
      if (activeRunId != null) await loadRunDetail(activeRunId);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }, [loadDetail, loadRuns, loadRunDetail, activeRunId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // 仅当当前查看的 run 处于 queued/running 时温和自动刷新（设计主张前端不轮询；
  // 这里仅在活跃任务进行中做轻量轮询，便于观察进度）。
  useEffect(() => {
    if (!runDetail || !ACTIVE.has(runDetail.run.status)) return;
    const t = setInterval(() => {
      if (activeRunId != null) loadRunDetail(activeRunId).catch(() => {});
    }, 3000);
    return () => clearInterval(t);
  }, [runDetail, activeRunId, loadRunDetail]);

  const handleRewrite = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const r = await api.rewriteStory(storyId);
      setMessage(
        `改写评价: ${r.feedback}${r.safetyNote ? '\n安全提示: ' + r.safetyNote : ''}`
      );
      await Promise.all([loadDetail(), loadRuns()]);
      onChanged();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleGenerate = async (cfg: GenerateConfig) => {
    setBusy(true);
    setError(null);
    setShowGen(false);
    try {
      const { runId } = await api.generate(storyId, cfg);
      setActiveRunId(runId);
      setMessage(`已创建生图任务 #${runId}，正在后台生成（可刷新查看进度）。`);
      await Promise.all([loadDetail(), loadRuns(), loadRunDetail(runId)]);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const handlePublish = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.publish(storyId);
      setMessage('已审批通过并发布。');
      await loadDetail();
      onChanged();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleSetDefault = async (imageId: number) => {
    setBusyImageId(imageId);
    try {
      await api.setDefaultImage(imageId);
      if (activeRunId != null) await loadRunDetail(activeRunId);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusyImageId(null);
    }
  };

  const handleGenerateNew = async (pageId: number) => {
    setBusyPageId(pageId);
    try {
      const { runId } = await api.addPageImage(pageId, { kind: 'manual_new' });
      setMessage(`已提交单页补画 (#${runId})，完成后刷新可见新候选图。`);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusyPageId(null);
    }
  };

  const handleDelete = async () => {
    if (!confirm('确认删除该故事？')) return;
    try {
      await api.deleteStory(storyId);
      onBack();
      onChanged();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  };

  if (!detail) return <p className="text-gray-500">加载中…</p>;
  const { story, pages } = detail;
  const progress = runDetail?.run.progress ? JSON.parse(runDetail.run.progress) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-2xl font-bold">{story.user_title || `故事 #${story.id}`}</h2>
        <span
          className={`text-sm px-2 py-1 rounded-full ${storyStatusColor(story.status)}`}
        >
          {story.status}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          disabled={busy}
          onClick={handleRewrite}
          className="px-4 py-2 rounded-lg bg-blue-600 text-white disabled:opacity-50"
        >
          改写
        </button>
        <button
          disabled={busy}
          onClick={() => setShowGen((v) => !v)}
          className="px-4 py-2 rounded-lg bg-indigo-600 text-white disabled:opacity-50"
        >
          {showGen ? '收起配置' : '生图'}
        </button>
        {story.status === '生图完成待审批' && (
          <button
            disabled={busy}
            onClick={handlePublish}
            className="px-4 py-2 rounded-lg bg-green-600 text-white disabled:opacity-50"
          >
            审批发布
          </button>
        )}
        <button
          onClick={refresh}
          className="px-4 py-2 rounded-lg bg-gray-200 dark:bg-gray-700"
        >
          刷新
        </button>
        <button
          onClick={handleDelete}
          className="px-4 py-2 rounded-lg bg-red-500 text-white"
        >
          删除
        </button>
      </div>

      {message && (
        <div className="p-3 rounded-lg border-l-4 border-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 text-sm whitespace-pre-line">
          {message}
        </div>
      )}
      {error && (
        <div className="p-3 rounded-lg border-l-4 border-red-400 bg-red-50 dark:bg-red-900/30 text-sm text-red-700 dark:text-red-300 whitespace-pre-line">
          {error}
        </div>
      )}

      {showGen && <GeneratePanel onGenerate={handleGenerate} busy={busy} />}

      <section>
        <h3 className="text-lg font-bold mb-2">运行记录</h3>
        {runs.length === 0 ? (
          <p className="text-gray-500 text-sm">尚无生图记录。</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {runs.map((r) => (
              <button
                key={r.id}
                onClick={() => {
                  setActiveRunId(r.id);
                  loadRunDetail(r.id);
                }}
                className={`px-3 py-1.5 rounded-lg text-sm border ${
                  r.id === activeRunId
                    ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/40'
                    : 'border-gray-300 dark:border-gray-600'
                }`}
              >
                #{r.id}{' '}
                <span className={`ml-1 px-1.5 py-0.5 rounded-full text-xs ${runStatusColor(r.status)}`}>
                  {r.status}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      {runDetail && (
        <section className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <span
              className={`px-2 py-1 rounded-full text-sm ${runStatusColor(runDetail.run.status)}`}
            >
              run #{runDetail.run.id} · {runDetail.run.status}
            </span>
            {progress && (
              <span className="text-sm text-gray-500">
                进度 {progress.done}/{progress.total}
                {progress.failed ? ` · 失败 ${progress.failed}` : ''}
              </span>
            )}
            {runDetail.run.last_error && (
              <span className="text-sm text-red-500">错误: {runDetail.run.last_error}</span>
            )}
          </div>

          <AnchorGallery characters={runDetail.characters} />

          {runDetail.sequence_checks.length > 0 &&
            runDetail.sequence_checks[0] &&
            (() => {
              const sc = runDetail.sequence_checks[0];
              let issues: string[] = [];
              try {
                issues = sc.issues ? JSON.parse(sc.issues) : [];
              } catch {
                issues = [];
              }
              return (
                <div className="p-3 rounded-lg border-l-4 border-blue-400 bg-blue-50 dark:bg-blue-900/30 text-sm">
                  一致性评估: {sc.is_consistent ? '一致 ✅' : '存在不一致 ⚠️'}（评分{' '}
                  {sc.score?.toFixed(2)}）
                  {issues.length > 0 && (
                    <div className="mt-1 text-gray-600 dark:text-gray-300">
                      问题: {issues.join('; ')}
                    </div>
                  )}
                </div>
              );
            })()}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {runDetail.pages.map((pd) => (
              <PageCard
                key={pd.page.id}
                page={pd}
                onSetDefault={handleSetDefault}
                onGenerateNew={handleGenerateNew}
                busyImageId={busyImageId}
                busyPageId={busyPageId}
              />
            ))}
          </div>
        </section>
      )}

      {!runDetail && pages.length > 0 && (
        <section>
          <h3 className="text-lg font-bold mb-2">分页脚本（尚未生图）</h3>
          <div className="space-y-2">
            {pages.map((p) => (
              <div
                key={p.id}
                className="p-3 bg-white dark:bg-gray-800 rounded-lg shadow text-sm"
              >
                <div className="font-semibold mb-1">第 {p.page_number} 页</div>
                <p className="text-gray-600 dark:text-gray-300 whitespace-pre-wrap">
                  {p.text_en || p.text_zh || '(无文本)'}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};

export default StoryDetail;
