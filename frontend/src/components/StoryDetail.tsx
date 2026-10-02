import React, { useState, useEffect, useCallback } from 'react';
import { useTaskPolling } from '../hooks/useTaskPolling';
import { api, assetUrl } from '../api/client';
import type {
  Story,
  Page,
  GenerationRun,
  GenerationTask,
  RunDetail,
  AudioSet,
  PublishReadiness,
} from '../types';
import { storyStatusColor, runStatusColor } from '../status';
import StoryConfigPanel from './StoryConfigPanel';
import Modal from './Modal';
import { AudioPlanModal } from './AudioPlanModal';
import { DEFAULT_GENERATION_CONFIG } from '../constants';
import PageCard from './PageCard';
import AnchorGallery from './AnchorGallery';
import SpeakerVoicePanel from './SpeakerVoicePanel';

interface Props {
  storyId: number;
  onBack: () => void;
  onChanged: () => void;
  onOpenHotspots: (id: number) => void;
}

const ACTIVE = new Set(['queued', 'running']);

// 操作按钮：统一 44px 触控高度、光标、焦点态（与绘本库列表页同一套）
const ACTION_BASE =
  'inline-flex items-center justify-center gap-2 h-11 px-4 rounded-xl text-sm font-medium cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-warm transition-colors duration-200';
const ACTION_PRIMARY = `${ACTION_BASE} bg-brand text-white hover:bg-brand-strong`;
const ACTION_GHOST = `${ACTION_BASE} bg-paper-3 text-ink hover:bg-line`;
const ACTION_SAGE = `${ACTION_BASE} bg-sage text-white hover:bg-sage/90`;
const ACTION_GOLD = `${ACTION_BASE} bg-gold-soft text-[#8a5a1e] hover:bg-[#efd9ad]`;
const ACTION_DANGER = `${ACTION_BASE} bg-[#b3453a] text-white hover:bg-[#97382f]`;
// 卡片内小按钮：36px（密度优先），仍保留光标与焦点态
const SMALL_BASE =
  'inline-flex items-center justify-center h-9 px-3 rounded-lg text-xs font-medium cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed focus-warm transition-colors duration-200';
const SMALL_SAGE = `${SMALL_BASE} bg-sage text-white hover:bg-sage/90`;
const SMALL_GOLD = `${SMALL_BASE} bg-gold text-ink hover:bg-gold/90`;
const SMALL_DANGER = `${SMALL_BASE} bg-[#b3453a] text-white hover:bg-[#97382f]`;

// 区块卡片外壳：统一圆角/描边/阴影；scroll-mt 给锚点跳转留出余量
const SECTION = 'rounded-xl2 border border-line bg-white p-5 shadow-card scroll-mt-24';

/** 区块标题行：左侧标题 + 说明，右侧该区块的主操作（按生产流水线分组）。 */
function SectionHead({
  title,
  desc,
  children,
}: {
  title: string;
  desc?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
      <div className="min-w-0">
        <h3 className="font-display text-lg font-bold text-ink">{title}</h3>
        {desc && <p className="text-sm text-muted-strong mt-0.5 leading-relaxed">{desc}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

// 锚点导航（顺序与页面区块顺序一致）
const SECTION_NAV: { id: string; label: string }[] = [
  { id: 'sec-text', label: '文本' },
  { id: 'sec-image', label: '图像' },
  { id: 'sec-audio', label: '配音' },
  { id: 'sec-hotspot', label: '热区' },
  { id: 'sec-publish', label: '发布检查' },
];

/** 平滑滚动到区块，尊重 prefers-reduced-motion。 */
function scrollToSection(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
}

// ---- 图标（统一 24x24 线性 SVG，不用 emoji） ----
const Icon = ({ d, className = 'w-4 h-4' }: { d: string; className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <path d={d} />
  </svg>
);
const CheckIcon = (p: { className?: string }) => <Icon className={p.className} d="M20 6 9 17l-5-5" />;
const CrossIcon = (p: { className?: string }) => (
  <Icon className={p.className} d="M18 6 6 18M6 6l12 12" />
);
const WarnIcon = (p: { className?: string }) => (
  <Icon className={p.className} d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
);
const PlusIcon = (p: { className?: string }) => <Icon className={p.className} d="M12 5v14M5 12h14" />;
const SparkIcon = (p: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={p.className ?? 'w-4 h-4'} aria-hidden="true">
    <path d="M12 2l1.8 5.4L19 9.2l-5.2 1.8L12 16.4l-1.8-5.4L5 9.2l5.2-1.8Z" />
    <path d="M18.5 15l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9Z" />
  </svg>
);
const ResumeIcon = (p: { className?: string }) => (
  <Icon className={p.className} d="M3 12a9 9 0 1 0 2.64-6.36M3 3v6h6" />
);

const AUDIO_SET_BADGE: Record<string, { label: string; cls: string }> = {
  pending: { label: '待生成', cls: 'bg-paper-3 text-ink' },
  generating: { label: '配音中', cls: 'bg-brand-soft text-brand-strong' },
  completed: { label: '已配音', cls: 'bg-sage-soft text-[#3f5a35]' },
  interrupted: { label: '中断', cls: 'bg-gold-soft text-[#8a5a1e]' },
  failed: { label: '失败', cls: 'bg-[#f3d9d3] text-[#8f3327]' },
};

/** 发布检查清单的一行：hard=true 表示缺了会拒绝发布。 */
function CheckRow({
  ok,
  hard,
  label,
  value,
  hint,
  actionText,
  onAction,
}: {
  ok: boolean;
  hard: boolean;
  label: string;
  value: string;
  hint?: string;
  actionText?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span
        className={`grid h-5 w-5 shrink-0 place-items-center rounded-full ${
          ok
            ? 'bg-sage-soft text-[#3f5a35]'
            : hard
              ? 'bg-[#f3d9d3] text-[#8f3327]'
              : 'bg-gold-soft text-[#8a5a1e]'
        }`}
        title={ok ? '已就绪' : hard ? '缺此项不可发布' : '建议补齐'}
      >
        {ok ? <CheckIcon className="w-3.5 h-3.5" /> : hard ? <CrossIcon className="w-3.5 h-3.5" /> : <WarnIcon className="w-3.5 h-3.5" />}
      </span>
      <span className="font-medium w-12 text-ink">{label}</span>
      <span className="text-muted-strong">{value}</span>
      {!ok && hint && <span className="text-muted-strong">· {hint}</span>}
      {!ok && actionText && onAction && (
        <button
          onClick={onAction}
          className="ml-auto inline-flex items-center h-8 px-2.5 rounded-lg text-xs font-medium bg-brand text-white hover:bg-brand-strong cursor-pointer focus-warm transition-colors duration-200"
        >
          {actionText}
        </button>
      )}
    </div>
  );
}

function AudioSetBadge({ status }: { status: string }) {
  const b = AUDIO_SET_BADGE[status] ?? AUDIO_SET_BADGE.pending;
  return <span className={`text-xs px-2 py-0.5 rounded-full ${b.cls}`}>{b.label}</span>;
}

const StoryDetail: React.FC<Props> = ({ storyId, onBack, onChanged, onOpenHotspots }) => {
  const [detail, setDetail] = useState<{
    story: Story;
    pages: Page[];
    audioSets: AudioSet[];
    selectedAudioSetId: number | null;
    readiness: PublishReadiness;
    segment_count: number;
  } | null>(null);
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
  // ===== 配音（TTS）状态：独立任务，与生图互不干扰 =====
  const [audioSets, setAudioSets] = useState<AudioSet[]>(detail?.audioSets ?? []);
  const [selectedAudioSetId, setSelectedAudioSetId] = useState<number | null>(
    detail?.selectedAudioSetId ?? null
  );
  const [ttsTask, setTtsTask] = useState<GenerationTask | null>(null);
  const [ttsMessage, setTtsMessage] = useState<string | null>(null);
  const [ttsError, setTtsError] = useState<string | null>(null);
  const [busyTts, setBusyTts] = useState(false);
  // 角色音色面板在每次新建配音后重新加载（后端可能刚跑过一次 AI 选角）
  const [voicePanelKey, setVoicePanelKey] = useState(0);
  // S17：新建配音前的成本预估确认框
  const [confirmTtsOpen, setConfirmTtsOpen] = useState(false);
  // ===== 热区（AI 一键生成，异步任务）状态 =====
  const [busyAi, setBusyAi] = useState(false);
  const [aiTask, setAiTask] = useState<GenerationTask | null>(null);
  // ===== 单页补画任务状态（替代原先最长锁按钮 5 分钟的 for 轮询） =====
  const [patchTask, setPatchTask] = useState<GenerationTask | null>(null);
  // 试听弹窗：当前正在试听的配音方案
  const [listen, setListen] = useState<{ id: number; name: string } | null>(null);
  // 当前选用方案的逐页音频（用于 PageCard 徽标试听）：pageNumber -> {zh[], en[]}
  const [audioByPage, setAudioByPage] = useState<Record<number, { zh: string[]; en: string[] }>>({});
  // 标题旁刷新图标按钮的加载态
  const [refreshing, setRefreshing] = useState(false);
  // 二次确认弹窗：替代原生 confirm，保持暖色视觉语言与键盘可达
  const [confirming, setConfirming] = useState<{
    title: string;
    body: string;
    okText: string;
    danger?: boolean;
    onOk: () => void;
  } | null>(null);

  // Esc 关闭确认弹窗
  useEffect(() => {
    if (!confirming) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setConfirming(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirming]);

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

  const loadAudio = useCallback(async () => {
    try {
      const r = await api.listAudioSets(storyId);
      setAudioSets(r.audioSets);
      const sel = r.audioSets.find((a) => a.is_selected)?.id ?? null;
      setSelectedAudioSetId(sel);
    } catch (e: any) {
      setTtsError(e?.message ?? String(e));
    }
  }, [storyId]);

  const refresh = useCallback(async () => {
    setError(null);
    setRefreshing(true);
    try {
      await Promise.all([loadDetail(), loadRuns(), loadAudio()]);
      if (activeRunId != null) await loadRunDetail(activeRunId);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setRefreshing(false);
    }
  }, [loadDetail, loadRuns, loadRunDetail, loadAudio, activeRunId]);

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
        `改写评价: ${r.feedback}${r.safetyNote ? '\n安全提示: ' + r.safetyNote : ''}` +
          (r.hotspotsRemoved > 0
            ? `\n改写已重排分页脚本，${r.hotspotsRemoved} 个热区已清除，请重新生成热区。`
            : '')
      );
      await Promise.all([loadDetail(), loadRuns()]);
      onChanged();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  // 生图是「纯动作」：参数取图像配置，不在这里临时填写
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

  // 当前选用方案变化 → 拉取逐页音频 URL（用于 PageCard 试听徽标）
  useEffect(() => {
    if (!selectedAudioSetId) {
      setAudioByPage({});
      return;
    }
    let cancelled = false;
    api
      .getBookAudio(storyId, selectedAudioSetId)
      .then((data) => {
        if (cancelled) return;
        const m: Record<number, { zh: string[]; en: string[] }> = {};
        for (const p of data.pages) {
          const zh: string[] = [];
          const en: string[] = [];
          for (const seg of p.segments) {
            if (seg.audioUrls.zh) zh.push(assetUrl(seg.audioUrls.zh)!);
            if (seg.audioUrls.en) en.push(assetUrl(seg.audioUrls.en)!);
          }
          m[p.pageNumber] = { zh, en };
        }
        setAudioByPage(m);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [storyId, selectedAudioSetId]);

  // 配音中：选用方案处于 generating，或本组件正在轮询的 tts 任务进行中
  const isGeneratingTts =
    audioSets.some((a) => a.status === 'generating') ||
    (!!ttsTask && ['queued', 'running'].includes(ttsTask.status));

  const startTts = async (forceNew: boolean) => {
    setBusyTts(true);
    setTtsError(null);
    setTtsMessage(null);
    try {
      const { taskId, audioSetId } = await api.generateTts(storyId, { forceNew });
      const { task } = await api.getTask(taskId);
      setTtsTask(task);
      setTtsMessage(`已创建配音任务 #${taskId}（方案 #${audioSetId}），后台合成中…`);
      await loadAudio();
      setVoicePanelKey((k) => k + 1);
      onChanged();
    } catch (e: any) {
      setTtsError(e?.message ?? String(e));
    } finally {
      setBusyTts(false);
    }
  };

  const handleSelectSet = async (setId: number) => {
    try {
      await api.selectAudioSet(setId);
      setSelectedAudioSetId(setId);
      await loadAudio();
    } catch (e: any) {
      setTtsError(e?.message ?? String(e));
    }
  };

  // AI 生成热区：异步任务。这里只负责建任务，执行由后端 taskRunner 跑，进度靠轮询
  const startAiHotspots = async () => {
    setBusyAi(true);
    setError(null);
    try {
      const { taskId } = await api.autoGenerateHotspots(storyId);
      const { task } = await api.getTask(taskId);
      setAiTask(task);
      setMessage(`已创建热区任务 #${taskId}，后台逐页生成中…`);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusyAi(false);
    }
  };

  // 继续生成：崩溃 / 部分失败后只补跑缺失页（保留已生成的 AI 热区）
  const resumeAiHotspots = async () => {
    setBusyAi(true);
    setError(null);
    try {
      const { taskId } = await api.resumeHotspots(storyId);
      const { task } = await api.getTask(taskId);
      setAiTask(task);
      setMessage(`已继续生成热区任务 #${taskId}（只补缺失页）…`);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusyAi(false);
    }
  };

  // 单按钮状态机：idle 未生成 / running 生成中 / resumable 可继续 / done 已完成。
  // 状态来自服务端的「最近一次热区任务」，刷新页面后依然正确。
  const aiState: 'idle' | 'running' | 'resumable' | 'done' = !aiTask
    ? 'idle'
    : ['queued', 'running'].includes(aiTask.status)
      ? 'running'
      : aiTask.status === 'failed' || !!aiTask.last_error
        ? 'resumable'
        : 'done';
  // 后端 auto-generate 默认为「续跑」：只补还没有 AI 热区的页，已有结果与人工微调全部保留。
  // 推倒重来走独立的「全部重新生成」按钮（显式 regenerate=true + 二次确认）。
  const aiButtonText =
    aiState === 'running'
      ? 'AI 生成热区中…'
      : aiState === 'resumable'
        ? '继续生成热区'
        : aiState === 'done'
          ? '生成热区（只补缺失页）'
          : 'AI 生成热区';
  const aiButtonTitle =
    aiState === 'running'
      ? '后台正在逐页生成，可先做别的'
      : aiState === 'resumable'
        ? '上次生成中断或有页失败，点击只补跑缺失的页'
        : aiState === 'done'
          ? '在已有基础上继续：只补还没有热区的页，已生成与人工微调都保留'
          : '调用 AI 为每页各分段自动定位热区';

  // 轮询热区任务进度（统一用 useTaskPolling）
  useTaskPolling(
    aiTask,
    (t) => setAiTask(t),
    (t) => {
      setAiTask(t);
      if (t.status === 'completed') {
        setMessage(
          t.last_error
            ? `热区生成完成（${t.last_error}）`
            : '热区生成完成，可进入「热区设置」微调。'
        );
      } else {
        setError(`热区任务 #${t.id} 失败：${t.last_error ?? '未知原因'}`);
      }
    }
  );

  // 刷新 / 重新进入故事后，从服务端一次拉取该故事所有进行中的任务并恢复轮询
  //（生图、补画、配音、热区均覆盖），避免刷新即丢失「正在生成」状态。
  useEffect(() => {
    let cancelled = false;
    api
      .listActiveTasks(storyId)
      .then(({ tasks }) => {
        if (cancelled) return;
        for (const t of tasks) {
          const mapped: GenerationTask = {
            id: t.id,
            story_id: storyId,
            run_id: null,
            page_id: t.pageId,
            kind: t.kind as GenerationTask['kind'],
            status: t.status as GenerationTask['status'],
            progress: JSON.stringify(t.progress),
            last_error: null,
            created_at: null,
            finished_at: null,
          };
          if (t.kind === 'tts') setTtsTask(mapped);
          else if (t.kind === 'hotspot') setAiTask(mapped);
          else if (t.kind === 'single_page') setPatchTask(mapped);
          else setTask(mapped); // full
        }
      })
      .catch(() => {
        /* 恢复失败按「无任务」处理 */
      });
    return () => {
      cancelled = true;
    };
  }, [storyId]);

  const handleResumeSet = async (setId: number) => {
    setBusyTts(true);
    setTtsError(null);
    try {
      const { taskId } = await api.resumeAudioSet(setId);
      const { task } = await api.getTask(taskId);
      setTtsTask(task);
      setTtsMessage(`已继续生成配音任务 #${taskId}（方案 #${setId}）…`);
      await loadAudio();
    } catch (e: any) {
      setTtsError(e?.message ?? String(e));
    } finally {
      setBusyTts(false);
    }
  };

  const askDeleteSet = (setId: number) =>
    setConfirming({
      title: `删除配音方案 #${setId}？`,
      body: '该方案及其配音记录会被移除（音频文件不会自动删除）。删除后不可恢复。',
      okText: '确认删除',
      danger: true,
      onOk: () => handleDeleteSet(setId),
    });

  const handleDeleteSet = async (setId: number) => {
    try {
      await api.deleteAudioSet(setId);
      await loadAudio();
    } catch (e: any) {
      setTtsError(e?.message ?? String(e));
    }
  };

  // 轮询配音任务进度（统一用 useTaskPolling）
  useTaskPolling(
    ttsTask,
    (t) => setTtsTask(t),
    (t) => {
      setTtsTask(t);
      const pr = t.progress ? JSON.parse(t.progress) : null;
      setTtsMessage(`配音完成：成功 ${pr?.done ?? '?'} / 失败 ${pr?.failed ?? 0}`);
      void loadAudio();
      void loadDetail();
      onChanged();
    }
  );

  // 轮询当前整书生图任务进度（统一用 useTaskPolling）
  useTaskPolling(
    task,
    (t) => setTask(t),
    (t) => {
      setTask(t);
      void Promise.all([loadDetail(), loadRuns()]);
      if (activeRunId != null) void loadRunDetail(activeRunId);
    }
  );

  // 资产完整时直接发布；缺图/缺文时先二次确认，人工确认后带 force 发布（避免程序把人困住）
  const askPublish = () => {
    if (blockedReasons.length === 0) {
      void handlePublish(false);
      return;
    }
    setConfirming({
      title: '仍缺资产，确认发布？',
      body: `${blockedReasons.join('；')}\n发布后不可再修改，缺失页会以占位形式出现在阅读端。`,
      okText: '仍要发布',
      onOk: () => handlePublish(true),
    });
  };

  const handlePublish = async (force: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await api.publish(storyId, force);
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

  // 人工上传本地图片作为某页插图（S15：同步落盘，不触发图像模型）
  const handleUploadImage = async (pageId: number, dataUrl: string) => {
    try {
      await api.addPageImage(pageId, { image: dataUrl });
      setMessage('已上传本地图片并设为该页默认插图。');
      if (activeRunId != null) await loadRunDetail(activeRunId);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  };

  // 任务取消（S16，页级）：置标记后服务端在当前页跑完即停，已完成部分保留
  const handleCancelTask = async (taskId: number) => {
    try {
      await api.cancelTask(taskId);
      setMessage(`已请求取消任务 #${taskId}，进行中的页跑完即停，已完成部分保留。`);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  };

  // 单页补画：只是给当前版本追加候选图，不产生新版本
  const handleGenerateNew = async (pageId: number) => {
    setBusyPageId(pageId);
    setError(null);
    try {
      const { taskId } = await api.addPageImage(pageId, { kind: 'manual_new' });
      const { task } = await api.getTask(taskId);
      setPatchTask(task); // 交由 useTaskPolling 统一轮询，按钮立即释放
      setMessage(`已提交单页补画任务 #${taskId}，生成中…`);
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setBusyPageId(null);
    }
  };

  // 单页补画轮询（替代原先锁按钮最长 5 分钟的 for 循环）
  useTaskPolling(
    patchTask,
    (t) => setPatchTask(t),
    (t) => {
      setPatchTask(t);
      setMessage(
        t.status === 'completed'
          ? '补画完成，已在候选区追加新图（可点击选为默认）。'
          : `补画失败：${t.last_error ?? '未知原因'}`
      );
      setBusyPageId(null);
      if (activeRunId != null) void loadRunDetail(activeRunId);
    }
  );

  const askDelete = () =>
    setConfirming({
      title: `删除《${detail?.story.user_title || `故事 #${storyId}`}》？`,
      body: '删除后该绘本及其分页、图片、配音记录都会移入回收状态，无法在本页恢复。',
      okText: '确认删除',
      danger: true,
      onOk: handleDelete,
    });

  const handleDelete = async () => {
    try {
      await api.deleteStory(storyId);
      onBack();
      onChanged();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  };

  // 载入骨架：与真实内容等高，避免加载完成时内容跳动
  if (!detail) {
    return (
      <div className="space-y-6 animate-pulse motion-reduce:animate-none">
        <div className="h-8 w-64 rounded-lg bg-paper-3" />
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-11 w-28 rounded-xl bg-paper-3" />
          ))}
        </div>
        <div className="h-44 rounded-2xl bg-paper-3" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-64 rounded-xl2 bg-paper-3" />
          ))}
        </div>
      </div>
    );
  }
  const { story, pages } = detail;
  // 发布前可任意操作：按钮由「是否做过该操作 + 是否发布」驱动，不按精确状态卡死（人工可越级）。
  const published = story.status === '审批通过的作品';
  const hasGenerated = story.current_run_id != null; // 是否生过图（层快照）
  const hasPages = (pages?.length ?? 0) > 0;
  const isGenerating =
    story.status === '生图中' || (task != null && ['queued', 'running'].includes(task.status));
  const canRewrite = !published && !isGenerating; // 改写：发布前、非生图中
  const canGenerate = !published && hasPages && !isGenerating; // 生图：首次建版本 / 之后均为续跑（复用当前版本，只补缺失页）
  const generateLabel = !hasGenerated ? '开始生图' : '续跑生图';
  const canRepaint = !published && hasGenerated && !isGenerating; // 单页补画
  const canTts = !published; // 配音：发布前即可（非必须）
  const canHotspot = !published && hasGenerated; // 热区：需默认图
  const genCfg = story.generation_config ?? DEFAULT_GENERATION_CONFIG;
  const taskProgress = task?.progress ? JSON.parse(task.progress) : null;

  // 发布检查：图与文本是硬门禁（缺则后端 409 拒绝），配音与热区是软提示
  const readiness = detail?.readiness ?? null;
  const missingImages = readiness?.images ?? [];
  const missingTexts = readiness?.texts ?? [];
  const missingHotspots = readiness?.hotspots ?? [];
  // 续跑只补缺失页：预估调用量按缺失图页数估算（首跑按全本页数）
  const genPageCount = !hasGenerated ? (pages.length || 0) : missingImages.length;
  const estimateCalls =
    genPageCount * genCfg.initial_retry_budget * (1 + genCfg.max_sequence_retry);
  const blockedReasons: string[] = [];
  if (missingImages.length > 0)
    blockedReasons.push(`第 ${missingImages.join('、')} 页缺插图`);
  if (missingTexts.length > 0)
    blockedReasons.push(`第 ${missingTexts.join('、')} 页缺中英文本`);
  const publishBlocked = blockedReasons.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={onBack}
          aria-label="返回首页"
          title="返回绘本库首页"
          className="inline-flex items-center gap-1.5 h-11 px-3 rounded-xl border border-line bg-white text-muted-strong hover:bg-paper-2 hover:text-ink cursor-pointer focus-warm transition-colors duration-200"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-4 h-4"
          >
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          <span className="text-sm">返回首页</span>
        </button>
        <h2 className="font-display text-2xl font-bold text-ink">
          {story.user_title || `故事 #${story.id}`}
        </h2>
        <button
          onClick={refresh}
          disabled={refreshing}
          aria-label="刷新本故事状态"
          title="刷新：重新从服务端拉取本故事最新状态"
          className="grid h-11 w-11 place-items-center rounded-xl text-muted-strong hover:bg-paper-3 hover:text-ink cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-warm transition-colors duration-200"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`}
          >
            <path d="M21 12a9 9 0 1 1-2.64-6.36" />
            <polyline points="21 3 21 9 15 9" />
          </svg>
        </button>
        <span
          className={`text-sm px-2 py-1 rounded-full ${storyStatusColor(story.status)}`}
        >
          {story.status}
        </span>
        {/* 层快照徽标：一眼看出是否配音 / 是否配置过热区（不区分次数，至少一次） */}
        {story.has_audio ? (
          <span className="text-xs px-2 py-0.5 rounded-full bg-gold-soft text-[#8a5a1e]">已配音</span>
        ) : null}
        {story.has_hotspots ? (
          <span className="text-xs px-2 py-0.5 rounded-full bg-brand-soft text-brand-strong">已配热区</span>
        ) : null}
        {/* 删除是破坏性操作：不抢主视觉，用中性图标按钮，悬停才转危险色 */}
        <button
          disabled={isGenerating}
          onClick={askDelete}
          aria-label="删除该故事"
          title={isGenerating ? '生图进行中，暂不可删除' : '删除该故事（移入回收状态）'}
          className="ml-auto grid h-11 w-11 place-items-center rounded-xl border border-line bg-white text-muted-strong hover:border-[#b3453a] hover:text-[#b3453a] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-warm transition-colors duration-200"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-5 h-5"
          >
            <path d="M3 6h18" />
            <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            <line x1="10" y1="11" x2="10" y2="17" />
            <line x1="14" y1="11" x2="14" y2="17" />
          </svg>
        </button>
      </div>

      {/* 区块锚点导航：长页面快速跳转（顺序与区块一致） */}
      <nav aria-label="区块导航" className="flex flex-wrap gap-2">
        {SECTION_NAV.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            onClick={(e) => {
              e.preventDefault();
              scrollToSection(s.id);
            }}
            className="inline-flex items-center h-9 px-3 rounded-full text-sm bg-white border border-line text-muted-strong hover:bg-paper-2 hover:text-ink cursor-pointer focus-warm transition-colors duration-200"
          >
            {s.label}
          </a>
        ))}
      </nav>

      {message && (
        <div className="p-3 rounded-lg border-l-4 border-[#9bb38a] bg-sage-soft text-sm whitespace-pre-line">
          {message}
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="p-3 rounded-lg border-l-4 border-[#b3453a] bg-[#f9ecea] text-sm text-[#8f3327] whitespace-pre-line"
        >
          {error}
        </div>
      )}

      {listen && (
        <AudioPlanModal
          storyId={storyId}
          setId={listen.id}
          name={listen.name}
          onClose={() => setListen(null)}
        />
      )}

      <section id="sec-text" className={SECTION}>
        <SectionHead
          title="故事文本"
          desc="原文为录入文本；改写后是 AI 扩写/压缩结果，也是分页与配音的源文本。"
        >
          <button
            disabled={busy || !canRewrite}
            title={
              published
                ? '已发布，冻结不可改写'
                : isGenerating
                  ? '生图进行中，暂不可改写'
                  : undefined
            }
            onClick={handleRewrite}
            className={ACTION_PRIMARY}
          >
            改写
          </button>
        </SectionHead>
        <div className="flex items-center gap-2 mb-3">
          <div className="flex rounded-lg overflow-hidden border border-line">
            <button
              onClick={() => setTextTab('original')}
              aria-pressed={textTab === 'original'}
              className={`inline-flex items-center h-9 px-3 text-sm cursor-pointer focus-warm transition-colors duration-200 ${
                textTab === 'original'
                  ? 'bg-brand text-white'
                  : 'bg-white text-muted-strong hover:bg-paper-2'
              }`}
            >
              原文
            </button>
            <button
              onClick={() => setTextTab('refined')}
              aria-pressed={textTab === 'refined'}
              className={`inline-flex items-center h-9 px-3 text-sm cursor-pointer focus-warm transition-colors duration-200 ${
                textTab === 'refined'
                  ? 'bg-brand text-white'
                  : 'bg-white text-muted-strong hover:bg-paper-2'
              }`}
            >
              改写后
            </button>
          </div>
        </div>
        <div className="bg-white border border-line rounded-xl shadow-card p-4">
          {textTab === 'original' ? (
            <p className="text-sm whitespace-pre-wrap text-ink leading-relaxed">
              {story.original_text}
            </p>
          ) : story.refined_text ? (
            <p className="text-sm whitespace-pre-wrap text-ink leading-relaxed">
              {story.refined_text}
            </p>
          ) : (
            <p className="text-sm text-muted-strong">
              尚未改写（改写后此处显示 AI 扩写/压缩后的全文）。
            </p>
          )}
        </div>
      </section>

      <Modal open={showCfg} onClose={() => setShowCfg(false)} title="图像配置">
        <StoryConfigPanel
          story={story}
          onSaved={async () => {
            await loadDetail();
            onChanged();
          }}
        />
      </Modal>

      {/* 生图确认：原为追加在页面末尾的内联卡片（容易被忽略），改为居中弹窗 */}
      <Modal
        open={confirmGen}
        onClose={() => setConfirmGen(false)}
        title={!hasGenerated ? '确认开始生图' : '确认续跑生图'}
        maxWidth="max-w-lg"
      >
        <div className="space-y-3 text-sm text-muted-strong">
          <p className="leading-relaxed">
            将使用「图像配置」中的生图参数：帧阈值 {genCfg.frame_threshold} · 序列阈值{' '}
            {genCfg.sequence_threshold} · 首跑每页 {genCfg.initial_retry_budget} 次 · 单页上限{' '}
            {genCfg.max_frame_retry} 次 · {genCfg.aspect_ratio} / {genCfg.image_size}
          </p>
          <p className="text-[#8a5a1e] leading-relaxed">
            共 {pages.length} 页，最多约 {estimateCalls} 次生图调用
            {!hasGenerated ? '' : '（续跑：已有图页跳过，仅补齐缺失页）'}。
          </p>
          <div className="flex justify-end gap-3 pt-1">
            <button onClick={() => setConfirmGen(false)} className={ACTION_GHOST}>
              取消
            </button>
            <button disabled={busy} onClick={handleGenerate} className={ACTION_PRIMARY}>
              确认生图
            </button>
          </div>
        </div>
      </Modal>

      <section id="sec-image" className={SECTION}>
        <SectionHead title="图像" desc="先配置后生图：生图按版本留存，续跑只补缺失页，已有图页不会重画。">
          <button
            disabled={busy}
            onClick={() => setShowCfg(true)}
            title="出图比例与尺寸、生图质量阈值与重试次数、灵感图"
            className={ACTION_GHOST}
          >
            图像配置
          </button>
          {!published ? (
            <button
              disabled={busy || !canGenerate}
              title={
                !hasPages
                  ? '请先改写生成分页'
                  : isGenerating
                    ? '生图进行中'
                    : undefined
              }
              onClick={() => setConfirmGen(true)}
              className={ACTION_PRIMARY}
            >
              {generateLabel}
            </button>
          ) : (
            <button
              disabled
              title="已发布，冻结不可重做"
              className={`${ACTION_GHOST} opacity-50`}
            >
              生图（已发布冻结）
            </button>
          )}
        </SectionHead>
        <h4 className="font-display font-bold text-ink mb-3">生图版本（当前生效高亮）</h4>
        {task && ['queued', 'running'].includes(task.status) && (
          <div className="mb-3 text-sm text-muted-strong flex items-center gap-3">
            <span>
              任务 #{task.id} 进行中
              {taskProgress
                ? ` · 进度 ${taskProgress.done}/${taskProgress.total}${
                    taskProgress.failed ? ` · 失败 ${taskProgress.failed}` : ''
                  }`
                : ''}
            </span>
            <button
              onClick={() => handleCancelTask(task.id)}
              className="inline-flex items-center h-8 px-2.5 rounded-lg text-xs bg-white border border-line text-ink hover:bg-paper-2 cursor-pointer focus-warm transition-colors duration-200"
            >
              取消
            </button>
          </div>
        )}
        {task?.status === 'failed' && (
          <div className="mb-3 text-sm text-[#8f3327]">
            任务 #{task.id} 失败：{task.last_error ?? '未知原因'}
          </div>
        )}
        {runs.length === 0 ? (
          <p className="text-muted-strong text-sm">尚无生图记录。</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {runs.map((r) => (
              <button
                key={r.id}
                onClick={() => {
                  setActiveRunId(r.id);
                  loadRunDetail(r.id);
                }}
                aria-pressed={r.id === story.current_run_id}
                className={`inline-flex items-center h-9 px-3 rounded-lg text-sm border cursor-pointer focus-warm transition-colors duration-200 ${
                  r.id === story.current_run_id
                    ? 'border-brand bg-gold-soft text-ink'
                    : 'border-line bg-white text-muted-strong hover:bg-paper-2'
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

        {runDetail && (
          <div className="space-y-4">
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
                <div className="p-3 rounded-lg border-l-4 border-gold bg-gold-soft text-sm text-ink">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span>一致性评估:</span>
                    <span className="inline-flex items-center gap-1 font-medium">
                      {sc.is_consistent ? (
                        <CheckIcon className="w-4 h-4 text-[#3f5a35]" />
                      ) : (
                        <WarnIcon className="w-4 h-4 text-[#8a5a1e]" />
                      )}
                      {sc.is_consistent ? '一致' : '存在不一致'}
                    </span>
                    <span>（评分 {sc.score?.toFixed(2)}）</span>
                  </div>
                  {issues.length > 0 && (
                    <div className="mt-1 text-muted-strong">问题: {issues.join('; ')}</div>
                  )}
                </div>
              );
            })()}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {runDetail.pages.map((pd) => (
              <PageCard
                key={pd.page.id}
                page={pd}
                audio={audioByPage[pd.page.page_number] ?? null}
                onSetDefault={handleSetDefault}
                onGenerateNew={handleGenerateNew}
                onUploadImage={handleUploadImage}
                busyImageId={busyImageId}
                busyPageId={busyPageId}
              />
            ))}
          </div>
        </div>
      )}

      {!runDetail && pages.length > 0 && (
        <div>
          <h4 className="font-display font-bold text-ink mb-3">分页脚本（尚未生图）</h4>
          <div className="space-y-2">
            {pages.map((p) => (
              <div
                key={p.id}
                className="p-3 bg-white border border-line rounded-lg shadow-card text-sm"
              >
                <div className="font-semibold text-ink mb-1">第 {p.page_number} 页</div>
                <p className="text-muted-strong whitespace-pre-wrap leading-relaxed">
                  {p.text_en || p.text_zh || '(无文本)'}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
      </section>

      {/* ===== 配音（TTS）独立区块：进度/方案管理，与生图互不干扰 ===== */}
      <section id="sec-audio" className={`${SECTION} border-gold/40 bg-gold-soft space-y-4`}>
        <SectionHead
          title={`配音方案（${audioSets.length}）`}
          desc="可多次生成不同音色组对比，逐组试听后选用一组。"
        >
          <button
            disabled={busyTts || isGeneratingTts || !canTts}
            onClick={() => setConfirmTtsOpen(true)}
            title="始终新建一组配音方案（用于多组对比试听）"
            className={ACTION_GOLD}
          >
            <PlusIcon />
            新建配音
          </button>
        </SectionHead>
        {/* 状态性的附加信息（选用/进行中）单独一行；方案数已并入标题 */}
        {(() => {
          const bits: string[] = [];
          if (selectedAudioSetId != null) bits.push(`当前选用 #${selectedAudioSetId}`);
          if (isGeneratingTts) bits.push('配音中…');
          if (bits.length === 0) return null;
          return <p className="text-sm text-muted-strong -mt-2">{bits.join(' · ')}</p>;
        })()}

        {/* 角色音色：AI 推荐 + 手动改写；新建配音时按这里的配置合成 */}
        <SpeakerVoicePanel storyId={storyId} key={voicePanelKey} />

        {ttsMessage && (
          <div className="text-sm p-2 rounded-lg border-l-4 border-[#d9b46a] bg-gold-soft whitespace-pre-line">
            {ttsMessage}
          </div>
        )}
        {ttsError && (
          <div
            role="alert"
            className="text-sm p-2 rounded-lg border-l-4 border-[#b3453a] bg-[#f9ecea] text-[#8f3327]"
          >
            {ttsError}
          </div>
        )}

        {ttsTask && ['queued', 'running'].includes(ttsTask.status) && (
          <div className="text-sm text-muted-strong flex items-center gap-3">
            <span>
              配音任务 #{ttsTask.id} 进行中
              {(() => {
                const p = ttsTask.progress ? JSON.parse(ttsTask.progress) : null;
                return p ? ` · 进度 ${p.done}/${p.total}${p.failed ? ` · 失败 ${p.failed}` : ''}` : '';
              })()}
            </span>
            <button
              onClick={() => handleCancelTask(ttsTask.id)}
              className="inline-flex items-center h-8 px-2.5 rounded-lg text-xs bg-white border border-line text-ink hover:bg-paper-2 cursor-pointer focus-warm transition-colors duration-200"
            >
              取消
            </button>
          </div>
        )}
        {ttsTask?.status === 'failed' && (
          <div className="text-sm text-[#8f3327]">配音任务 #{ttsTask.id} 失败：{ttsTask.last_error ?? '未知原因'}</div>
        )}

        {audioSets.length === 0 ? (
          <p className="text-sm text-muted-strong">尚无配音方案，点击「新建配音」开始（可多次生成不同音色组对比，逐组试听后选用）。</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {audioSets.map((s) => {
              const sel = s.id === selectedAudioSetId;
              return (
                <div
                  key={s.id}
                  className={`rounded-xl border p-3 shadow-card transition-colors duration-200 ${
                    sel ? 'border-gold bg-gold-soft' : 'border-line bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-ink">#{s.id} {s.name}</span>
                    <AudioSetBadge status={s.status} />
                  </div>
                  <div className="text-xs text-muted-strong mt-1">
                    进度 {s.done}/{s.total}
                    {sel && ' · 当前选用'}
                  </div>
                  <div className="flex flex-wrap gap-2 mt-2">
                    <button
                      disabled={sel}
                      onClick={() => handleSelectSet(s.id)}
                      className={SMALL_SAGE}
                    >
                      {sel ? '已选用' : '设为选用'}
                    </button>
                    <button
                      onClick={() => setListen({ id: s.id, name: `#${s.id} ${s.name}` })}
                      className={SMALL_GOLD}
                    >
                      试听
                    </button>
                    {(s.status === 'interrupted' || s.status === 'failed') && (
                      <button
                        disabled={busyTts || isGeneratingTts || !canTts}
                        onClick={() => handleResumeSet(s.id)}
                        className={SMALL_GOLD}
                      >
                        继续生成
                      </button>
                    )}
                    <button
                      disabled={sel}
                      onClick={() => askDeleteSet(s.id)}
                      className={SMALL_DANGER}
                    >
                      删除
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 热区：生图完成后的独立环节，单按钮按任务状态切换文案与动作 */}
      <section id="sec-hotspot" className={SECTION}>
        <SectionHead
          title="热区"
          desc={
            readiness && readiness.pages > 0
              ? `已覆盖 ${readiness.pages - missingHotspots.length}/${readiness.pages} 页；AI 生成只补缺失页，人工微调会保留。`
              : '生图完成后，可为每页各分段自动定位可点击热区。'
          }
        >
          <button
            disabled={busyAi || aiState === 'running' || !canHotspot}
            onClick={aiState === 'resumable' ? resumeAiHotspots : startAiHotspots}
            title={aiButtonTitle}
            className={`${ACTION_BASE} ${
              aiState === 'resumable'
                ? 'bg-gold-soft text-[#8a5a1e] hover:bg-[#efd9ad]'
                : 'bg-brand-soft text-brand-strong hover:bg-brand/20'
            }`}
          >
            {aiState === 'resumable' ? <ResumeIcon /> : <SparkIcon />}
            {aiButtonText}
          </button>
          <button
            onClick={() => onOpenHotspots(storyId)}
            title="打开热区设置，逐页微调热区位置与文案"
            className={ACTION_PRIMARY}
          >
            热区设置
            {readiness && readiness.pages > 0
              ? ` (${readiness.pages - missingHotspots.length}/${readiness.pages})`
              : ''}
          </button>
        </SectionHead>
        {readiness && missingHotspots.length > 0 && (
          <p className="text-sm text-muted-strong">
            第 {missingHotspots.join('、')} 页尚无热区，可先「{aiButtonText}」再进设置微调。
          </p>
        )}
      </section>

      {/* 发布与预览：流水线最后一环，发布前先看门禁清单 */}
      <section id="sec-publish" className={SECTION}>
        <SectionHead
          title="发布与预览"
          desc={
            readiness && readiness.pages > 0
              ? '插图与文本是硬门禁，缺项会被后端拒绝；配音与热区是软提示，允许发布为纯图文绘本。'
              : '尚无分页，先完成「改写」生成分页脚本，再回来发布。'
          }
        >
          <button
            onClick={() => {
              const base =
                (import.meta.env.VITE_READER_BASE as string | undefined) ||
                'http://localhost:5173';
              window.open(`${base.replace(/\/$/, '')}/book/${storyId}`, '_blank');
            }}
            title="在阅读端打开这本书，用于验证热区与音频效果"
            className={ACTION_GHOST}
          >
            预览
          </button>
          {hasGenerated && !published && (
            <button
              disabled={busy || isGenerating}
              title={
                publishBlocked ? `仍缺：${blockedReasons.join('；')}（点击将确认带缺图发布）` : undefined
              }
              onClick={askPublish}
              className={ACTION_SAGE}
            >
              发布
            </button>
          )}
        </SectionHead>
        {readiness && readiness.pages > 0 ? (
          <>
            {publishBlocked && (
              <p className="mb-3 text-xs text-[#8f3327]">
                不可发布：{blockedReasons.join('；')}
              </p>
            )}
            <div className="space-y-2 text-sm">
              <CheckRow
                ok={missingImages.length === 0}
                hard
                label="插图"
                value={`${readiness.pages - missingImages.length}/${readiness.pages} 页`}
                hint={
                  missingImages.length > 0
                    ? `缺第 ${missingImages.join('、')} 页`
                    : undefined
                }
                actionText={canRepaint ? '去补画' : undefined}
                onAction={canRepaint ? () => setConfirmGen(true) : undefined}
              />
              <CheckRow
                ok={missingTexts.length === 0}
                hard
                label="文本"
                value={`${readiness.pages - missingTexts.length}/${readiness.pages} 页`}
                hint={
                  missingTexts.length > 0
                    ? `第 ${missingTexts.join('、')} 页缺中英文本，可点「改写」重排`
                    : undefined
                }
              />
              <CheckRow
                ok={!readiness.audio}
                hard={false}
                label="配音"
                value={
                  readiness.audio
                    ? '未选用已完成的配音方案'
                    : selectedAudioSetId != null
                      ? `已选用 #${selectedAudioSetId}`
                      : '已就绪'
                }
                hint={readiness.audio ? '允许发布为纯图文绘本' : undefined}
                actionText={readiness.audio ? '新建配音' : undefined}
                onAction={readiness.audio ? () => startTts(true) : undefined}
              />
              <CheckRow
                ok={missingHotspots.length === 0}
                hard={false}
                label="热区"
                value={`${readiness.pages - missingHotspots.length}/${readiness.pages} 页`}
                hint={
                  missingHotspots.length > 0
                    ? `第 ${missingHotspots.join('、')} 页尚无热区`
                    : undefined
                }
                actionText={missingHotspots.length > 0 ? '去配热区' : undefined}
                onAction={
                  missingHotspots.length > 0
                    ? () => onOpenHotspots(storyId)
                    : undefined
                }
              />
            </div>
          </>
        ) : null}
      </section>

      {/* S17：新建配音前的成本预估二次确认 */}
      {confirmTtsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-sm p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-tts-title"
            className="w-full max-w-sm rounded-2xl bg-white border border-line shadow-soft p-6"
          >
            <h3 id="confirm-tts-title" className="font-display text-lg font-bold text-ink mb-3">
              确认生成配音？
            </h3>
            <p className="text-sm text-muted-strong leading-relaxed mb-5">
              将为 <b className="text-ink">{pages.length}</b> 页 ·{' '}
              <b className="text-ink">{detail?.segment_count ?? 0}</b> 个分段 ×{' '}
              <b className="text-ink">2</b> 种语言（中/英）合成，约{' '}
              <b className="text-ink">{(detail?.segment_count ?? 0) * 2}</b> 条音频。
              <br />
              生成会立即消耗 TTS 调用额度，请确认。
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setConfirmTtsOpen(false)} className={ACTION_GHOST}>
                取消
              </button>
              <button
                autoFocus
                onClick={() => {
                  setConfirmTtsOpen(false);
                  startTts(true);
                }}
                className={ACTION_PRIMARY}
              >
                确认生成
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 删除 / 带缺资产发布 的二次确认：替代原生 confirm，保持暖色视觉语言与键盘可达 */}
      {confirming && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-sm p-4"
          onClick={() => setConfirming(null)}
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
              <p className="mt-2 text-sm text-muted-strong leading-relaxed whitespace-pre-line">
                {confirming.body}
              </p>
            </div>
            <div className="flex justify-end gap-3 px-6 py-5">
              <button onClick={() => setConfirming(null)} className={ACTION_GHOST}>
                取消
              </button>
              <button
                autoFocus
                onClick={() => {
                  const ok = confirming.onOk;
                  setConfirming(null);
                  ok();
                }}
                className={confirming.danger ? ACTION_DANGER : ACTION_PRIMARY}
              >
                {confirming.okText}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StoryDetail;
