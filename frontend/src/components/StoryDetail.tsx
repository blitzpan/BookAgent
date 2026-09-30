import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';
import type {
  Story,
  Page,
  GenerationRun,
  GenerationTask,
  RunDetail,
} from '../types';
import { storyStatusColor, runStatusColor } from '../status';
import StoryConfigPanel from './StoryConfigPanel';
import { DEFAULT_GENERATION_CONFIG } from '../constants';
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
  const [showCfg, setShowCfg] = useState(false);
  const [confirmGen, setConfirmGen] = useState(false);
  const [task, setTask] = useState<GenerationTask | null>(null);
  const [textTab, setTextTab] = useState<'original' | 'refined'>('original');
  const [busyImageId, setBusyImageId] = useState<number | null>(null);
  const [busyPageId, setBusyPageId] = useState<number | null>(null);

  const loadDetail = useCallback(async () => {
    const d = await api.getStory(storyId);
    setDetail(d);
  }, [storyId]);

  const loadRuns = useCallback(async () => {
    const r = await api.listRuns(storyId);
    setRuns(r.runs);
    // run 现在只表示「整书版本」，取当前生效版本（列表按 id 倒序，即最新）
    const current = r.runs.find((x) => x.id === detail?.story.current_run_id) ?? r.runs[0];
    if (current && current.id !== activeRunId) setActiveRunId(current.id);
  }, [storyId, activeRunId, detail?.story.current_run_id]);

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

  // 生图是「纯动作」：参数取故事配置，不在这里临时填写
  const handleGenerate = async () => {
    setBusy(true);
    setError(null);
    setConfirmGen(false);
    try {
      const { taskId, runId } = await api.generate(storyId);
      setActiveRunId(runId);
      const { task: t } = await api.getTask(taskId);
      setTask(t);
      setMessage(`已创建生图任务 #${taskId}，正在后台生成（下方显示进度）。`);
      await Promise.all([loadDetail(), loadRuns()]);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  // 轮询当前整书任务进度（仅在 queued/running 时）
  useEffect(() => {
    if (!task || !['queued', 'running'].includes(task.status)) return;
    const timer = setInterval(async () => {
      try {
        const { task: t } = await api.getTask(task.id);
        setTask(t);
        if (!['queued', 'running'].includes(t.status)) {
          await Promise.all([loadDetail(), loadRuns()]);
          if (activeRunId != null) await loadRunDetail(activeRunId);
        }
      } catch {
        /* 忽略单次轮询失败 */
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [task, activeRunId, loadDetail, loadRuns, loadRunDetail]);

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

  // 单页补画：只是给当前版本追加候选图，不产生新版本
  const handleGenerateNew = async (pageId: number) => {
    setBusyPageId(pageId);
    setError(null);
    try {
      const { taskId } = await api.addPageImage(pageId, { kind: 'manual_new' });
      setMessage(`已提交单页补画任务 #${taskId}，生成中…`);
      for (let i = 0; i < 150; i++) {
        const { task: t } = await api.getTask(taskId);
        if (t.status === 'completed' || t.status === 'failed') {
          setMessage(
            t.status === 'completed'
              ? '补画完成，已在候选区追加新图（可点击选为默认）。'
              : `补画失败：${t.last_error ?? '未知原因'}`
          );
          break;
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
      if (activeRunId != null) await loadRunDetail(activeRunId);
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
  // 生图按钮可用性：只有「改写完成待生图」可首次生图；「生图部分失败」可续跑同一版本
  const canGenerate = story.status === '改写完成待生图';
  const canResume = story.status === '生图部分失败';
  const isGenerating =
    story.status === '生图中' || (task != null && ['queued', 'running'].includes(task.status));
  const genCfg = story.generation_config ?? DEFAULT_GENERATION_CONFIG;
  const taskProgress = task?.progress ? JSON.parse(task.progress) : null;
  const estimateCalls =
    (pages.length || 0) * genCfg.initial_retry_budget * (1 + genCfg.max_sequence_retry);

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
          disabled={busy || isGenerating}
          title={isGenerating ? '生图进行中，暂不可改写' : undefined}
          onClick={handleRewrite}
          className="px-4 py-2 rounded-lg bg-blue-600 text-white disabled:opacity-50"
        >
          改写
        </button>
        <button
          disabled={busy}
          onClick={() => setShowCfg((v) => !v)}
          className="px-4 py-2 rounded-lg bg-slate-600 text-white disabled:opacity-50"
        >
          {showCfg ? '收起故事配置' : '故事配置'}
        </button>
        {canGenerate ? (
          <button
            disabled={busy || isGenerating}
            onClick={() => setConfirmGen(true)}
            className="px-4 py-2 rounded-lg bg-indigo-600 text-white disabled:opacity-50"
          >
            开始生图
          </button>
        ) : canResume ? (
          <button
            disabled={busy || isGenerating}
            onClick={() => setConfirmGen(true)}
            className="px-4 py-2 rounded-lg bg-amber-600 text-white disabled:opacity-50"
          >
            继续生图（只补失败页）
          </button>
        ) : (
          <button
            disabled
            title="已完成生成即冻结；如需重做请删除该故事重建"
            className="px-4 py-2 rounded-lg bg-gray-300 dark:bg-gray-600 text-gray-600 dark:text-gray-300 cursor-not-allowed"
          >
            {isGenerating ? '生图中…' : '生图（已生成，不可重跑）'}
          </button>
        )}
        {story.status === '生图完成待审批' && (
          <button
            disabled={busy || isGenerating}
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
          disabled={isGenerating}
          onClick={handleDelete}
          className="px-4 py-2 rounded-lg bg-red-500 text-white disabled:opacity-50"
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

      <section>
        <div className="flex items-center gap-2 mb-2">
          <h3 className="text-lg font-bold">故事文本</h3>
          <div className="flex rounded-lg overflow-hidden border border-gray-300 dark:border-gray-600">
            <button
              onClick={() => setTextTab('original')}
              className={`px-3 py-1 text-sm ${
                textTab === 'original'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300'
              }`}
            >
              原文
            </button>
            <button
              onClick={() => setTextTab('refined')}
              className={`px-3 py-1 text-sm ${
                textTab === 'refined'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300'
              }`}
            >
              改写后
            </button>
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4">
          {textTab === 'original' ? (
            <p className="text-sm whitespace-pre-wrap text-gray-700 dark:text-gray-200">
              {story.original_text}
            </p>
          ) : story.refined_text ? (
            <p className="text-sm whitespace-pre-wrap text-gray-700 dark:text-gray-200">
              {story.refined_text}
            </p>
          ) : (
            <p className="text-sm text-gray-500">
              尚未改写（改写后此处显示 AI 扩写/压缩后的全文）。
            </p>
          )}
        </div>
      </section>

      {showCfg && (
        <StoryConfigPanel
          story={story}
          onSaved={async () => {
            await loadDetail();
            onChanged();
          }}
        />
      )}

      {confirmGen && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-5">
          <h3 className="font-bold mb-2">
            {canResume ? '确认继续生图' : '确认开始生图'}
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-300 mb-2">
            将使用「故事配置」中的生图参数：帧阈值 {genCfg.frame_threshold} · 序列阈值{' '}
            {genCfg.sequence_threshold} · 首跑每页 {genCfg.initial_retry_budget} 次 · 单页上限{' '}
            {genCfg.max_frame_retry} 次 · {genCfg.aspect_ratio} / {genCfg.image_size}
          </p>
          <p className="text-sm text-amber-600 mb-3">
            共 {pages.length} 页，最多约 {estimateCalls} 次生图调用
            {canResume ? '（本次只补未成功的页）' : ''}。
          </p>
          <div className="flex gap-2">
            <button
              disabled={busy}
              onClick={handleGenerate}
              className="px-6 py-2 rounded-lg bg-indigo-600 text-white disabled:opacity-50"
            >
              确认生图
            </button>
            <button
              onClick={() => setConfirmGen(false)}
              className="px-6 py-2 rounded-lg bg-gray-200 dark:bg-gray-700"
            >
              取消
            </button>
          </div>
        </div>
      )}

      <section>
        <h3 className="text-lg font-bold mb-2">生成版本</h3>
        {task && ['queued', 'running'].includes(task.status) && (
          <div className="mb-3 text-sm text-gray-600 dark:text-gray-300">
            任务 #{task.id} 进行中
            {taskProgress
              ? ` · 进度 ${taskProgress.done}/${taskProgress.total}${
                  taskProgress.failed ? ` · 失败 ${taskProgress.failed}` : ''
                }`
              : ''}
          </div>
        )}
        {task?.status === 'failed' && (
          <div className="mb-3 text-sm text-red-500">
            任务 #{task.id} 失败：{task.last_error ?? '未知原因'}
          </div>
        )}
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
              版本 #{runDetail.run.id} · {runDetail.run.status}
            </span>
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
