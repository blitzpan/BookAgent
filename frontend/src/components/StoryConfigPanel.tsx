import React, { useEffect, useState } from 'react';
import { api, assetUrl } from '../api/client';
import { DEFAULT_GENERATION_CONFIG } from '../constants';
import { joinStyle, parseStyle } from '../style';
import ConfigSection from './ConfigSection';
import StylePicker from './StylePicker';
import Lightbox from './Lightbox';
import type { GenerationConfig, Story } from '../types';

interface Props {
  story: Story;
  onSaved: () => void;
}

// 出图比例候选：兼顾绘本常用开本与图像模型支持的范围（Gemini 原生支持，seedream 会回退 4:3）。
const ASPECT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '3:4', label: '3:4 竖版（绘本最常用）' },
  { value: '1:1', label: '1:1 正方形（角色一致性最稳）' },
  { value: '4:3', label: '4:3 横版（经典跨页）' },
  { value: '2:3', label: '2:3 细长竖版' },
  { value: '3:2', label: '3:2 横版' },
  { value: '16:9', label: '16:9 宽幅跨页' },
  { value: '9:16', label: '9:16 手机竖屏' },
];

// 出图尺寸候选：1K/2K/4K 为模型原生档位，2K 为清晰度与成本的最佳平衡。
const SIZE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '1K', label: '1K（快 · 省）' },
  { value: '2K', label: '2K（清晰 · 推荐）' },
  { value: '4K', label: '4K（最清晰 · 慢 · 贵）' },
];

// 重试类参数（0–1 阈值改用滑块单独渲染，这里只留整数计数项）。
const RETRY_FIELDS: Array<{
  key: keyof GenerationConfig;
  label: string;
  desc: string;
  step?: number;
  min?: number;
  max?: number;
}> = [
  {
    key: 'initial_retry_budget',
    label: '首跑每页尝试次数',
    desc: '第一遍生成时，每页最多画几次（不达标就取最佳一版）',
    step: 1,
    min: 1,
    max: 10,
  },
  {
    key: 'max_frame_retry',
    label: '单页最大重画次数',
    desc: '单页补画 / 一致性修复时最多重画几次；越大越精，但越慢越费',
    step: 1,
    min: 1,
    max: 10,
  },
  {
    key: 'max_sequence_retry',
    label: '最大序列修复轮数',
    desc: '整书不一致时，最多重跑几轮修复（0 表示不修复）',
    step: 1,
    min: 0,
    max: 5,
  },
];

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onloadend = () => resolve(r.result as string);
    r.onerror = () => reject(new Error('读取图片失败'));
    r.readAsDataURL(file);
  });
}



const StoryConfigPanel: React.FC<Props> = ({ story, onSaved }) => {
  const [userTitle, setUserTitle] = useState(story.user_title ?? '');
  const [selectedStyles, setSelectedStyles] = useState<string[]>(
    () => parseStyle(story.style).sel
  );
  const [customStyle, setCustomStyle] = useState<string>(() => parseStyle(story.style).custom);
  const [pageCount, setPageCount] = useState(story.target_page_count ?? 6);
  const [gen, setGen] = useState<GenerationConfig>(
    story.generation_config ?? DEFAULT_GENERATION_CONFIG
  );
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [zoom, setZoom] = useState<string | null>(null);

  useEffect(() => {
    setUserTitle(story.user_title ?? '');
    const parsed = parseStyle(story.style);
    setSelectedStyles(parsed.sel);
    setCustomStyle(parsed.custom);
    setPageCount(story.target_page_count ?? 6);
    setGen(story.generation_config ?? DEFAULT_GENERATION_CONFIG);
    setFile(null);
  }, [
    story.id,
    story.user_title,
    story.style,
    story.target_page_count,
    story.generation_config,
  ]);

  const handleSave = async () => {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      let inspiration_image: string | undefined;
      if (file) inspiration_image = await readAsDataUrl(file);
      const styleValue = joinStyle(selectedStyles, customStyle);
      await api.updateStory(story.id, {
        user_title: userTitle,
        style: styleValue,
        target_page_count: pageCount,
        generation_config: gen,
        ...(inspiration_image ? { inspiration_image } : {}),
      });
      setFile(null);
      setMsg('配置已保存，将在下次改写/生图时生效。');
      onSaved();
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const inspirationUrl = assetUrl(story.inspiration_image_path);

  return (
    <div>
      <p className="text-xs text-muted mb-4">
        修改后需重新「改写」才会按新画风/页数重排分页脚本；灵感图只影响分页阶段。
      </p>

      {/* 基础信息 */}
      <ConfigSection title="基础信息">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="text-sm text-muted flex flex-col gap-1">
            标题
            <input
              value={userTitle}
              onChange={(e) => setUserTitle(e.target.value)}
              placeholder="留空则显示「故事 #ID」"
              className="px-2 py-1 border border-line rounded-lg bg-white text-ink focus-warm"
            />
          </label>
          <label className="text-sm text-muted flex flex-col gap-1">
            页数 (1–20)
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="减少页数"
                onClick={() => setPageCount(Math.max(1, pageCount - 1))}
                className="w-9 h-9 rounded-lg border border-line bg-white text-ink hover:bg-paper-2 cursor-pointer focus-warm"
              >
                −
              </button>
              <input
                type="number"
                min={1}
                max={20}
                value={pageCount}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  setPageCount(Number.isNaN(v) ? 1 : Math.min(Math.max(v, 1), 20));
                }}
                className="w-16 text-center px-2 py-1 border border-line rounded-lg bg-white text-ink focus-warm"
              />
              <button
                type="button"
                aria-label="增加页数"
                onClick={() => setPageCount(Math.min(20, pageCount + 1))}
                className="w-9 h-9 rounded-lg border border-line bg-white text-ink hover:bg-paper-2 cursor-pointer focus-warm"
              >
                +
              </button>
            </div>
          </label>
        </div>
        <div className="mt-2">
          <StylePicker
            selected={selectedStyles}
            custom={customStyle}
            onChange={(sel, c) => {
              setSelectedStyles(sel);
              setCustomStyle(c);
            }}
          />
        </div>
      </ConfigSection>

      {/* 生图质量 */}
      <ConfigSection
        title="生图质量"
        hint="阈值越高、重试越多越精细，但生图调用次数与费用也越多。"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
          <label className="text-sm text-muted flex flex-col gap-1">
            <span className="flex items-center justify-between">
              帧阈值（单页验收）
              <span className="text-ink font-medium tabular-nums">
                {(gen.frame_threshold as number).toFixed(2)}
              </span>
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={gen.frame_threshold as number}
              onChange={(e) =>
                setGen({ ...gen, frame_threshold: Number(e.target.value) } as GenerationConfig)
              }
              className="w-full accent-brand"
            />
            <span className="text-xs text-muted">
              角色一致性分与图文匹配分的较低者达到该值才通过
            </span>
          </label>
          <label className="text-sm text-muted flex flex-col gap-1">
            <span className="flex items-center justify-between">
              序列阈值（整书一致性）
              <span className="text-ink font-medium tabular-nums">
                {(gen.sequence_threshold as number).toFixed(2)}
              </span>
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={gen.sequence_threshold as number}
              onChange={(e) =>
                setGen({ ...gen, sequence_threshold: Number(e.target.value) } as GenerationConfig)
              }
              className="w-full accent-brand"
            />
            <span className="text-xs text-muted">
              全书翻页连贯性评分达到该值才不再修复
            </span>
          </label>
          {RETRY_FIELDS.map((f) => (
            <label key={f.key} className="text-sm text-muted flex flex-col gap-1">
              {f.label}
              <input
                type="number"
                step={f.step}
                min={f.min}
                max={f.max}
                value={gen[f.key] as number}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (!Number.isFinite(v)) return;
                  setGen({ ...gen, [f.key]: v } as GenerationConfig);
                }}
                className="px-2 py-1 border border-line rounded-lg bg-white text-ink focus-warm"
              />
              <span className="text-xs text-muted">{f.desc}</span>
            </label>
          ))}
        </div>
      </ConfigSection>

      {/* 输出规格 */}
      <ConfigSection title="输出规格">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="text-sm text-muted flex flex-col gap-1">
            出图比例
            <select
              value={gen.aspect_ratio}
              onChange={(e) => setGen({ ...gen, aspect_ratio: e.target.value } as GenerationConfig)}
              className="px-2 py-1 border border-line rounded-lg bg-white text-ink focus-warm"
            >
              {ASPECT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-muted flex flex-col gap-1">
            出图尺寸
            <select
              value={gen.image_size}
              onChange={(e) => setGen({ ...gen, image_size: e.target.value } as GenerationConfig)}
              className="px-2 py-1 border border-line rounded-lg bg-white text-ink focus-warm"
            >
              {SIZE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </ConfigSection>

      {/* 灵感图 */}
      <ConfigSection title="灵感图" hint="可选，仅用于分页阶段；不参与生图。">
        <div className="flex items-start gap-3">
          {inspirationUrl ? (
            <button
              type="button"
              onClick={() => setZoom(inspirationUrl)}
              aria-label="放大查看灵感图"
              title="点击放大查看"
              className="block w-24 h-24 cursor-zoom-in"
            >
              <img
                src={inspirationUrl}
                alt="灵感图"
                className="w-24 h-24 object-cover rounded-lg border border-line"
              />
            </button>
          ) : (
            <div className="w-24 h-24 flex items-center justify-center text-xs text-muted rounded-lg border border-dashed border-line">
              未设置
            </div>
          )}
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block text-sm text-muted cursor-pointer"
          />
        </div>
      </ConfigSection>

      {msg && <p className="text-emerald-600 text-sm mb-2">{msg}</p>}
      {err && <p className="text-red-500 text-sm mb-2">{err}</p>}

      <div className="flex justify-end gap-3 pt-1">
        <button
          disabled={busy}
          onClick={handleSave}
          className="inline-flex items-center justify-center min-h-[44px] px-6 rounded-xl font-semibold text-white bg-brand hover:bg-brand-strong cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-warm transition-colors duration-200"
        >
          保存配置
        </button>
      </div>
      {zoom && <Lightbox src={zoom} onClose={() => setZoom(null)} />}
    </div>
  );
};

export default StoryConfigPanel;
