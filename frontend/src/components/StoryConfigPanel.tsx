import React, { useEffect, useState } from 'react';
import { api, assetUrl } from '../api/client';
import { DEFAULT_GENERATION_CONFIG } from '../constants';
import type { GenerationConfig, Story } from '../types';

interface Props {
  story: Story;
  onSaved: () => void;
}

// 配置项说明（与后端默认值为两套来源，故文案中不写死数字，默认值由后端下发后显示）
const GEN_FIELDS: Array<{
  key: keyof GenerationConfig;
  label: string;
  desc: string;
  step?: number;
  min?: number;
  max?: number;
}> = [
  {
    key: 'frame_threshold',
    label: '帧阈值',
    desc: '单页验收分数线：取「角色一致性分」与「图文匹配分」的较低者，达到该分数才通过',
    step: 0.01,
    min: 0,
    max: 1,
  },
  {
    key: 'sequence_threshold',
    label: '序列阈值',
    desc: '整书一致性分数线：全书翻页连贯性评分达到该值才不再修复',
    step: 0.01,
    min: 0,
    max: 1,
  },
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
  const [style, setStyle] = useState(story.style ?? '');
  const [pageCount, setPageCount] = useState(story.target_page_count ?? 6);
  const [gen, setGen] = useState<GenerationConfig>(
    story.generation_config ?? DEFAULT_GENERATION_CONFIG
  );
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    setUserTitle(story.user_title ?? '');
    setStyle(story.style ?? '');
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
      await api.updateStory(story.id, {
        user_title: userTitle,
        style,
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
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-5 mb-6">
      <h3 className="font-bold mb-1">故事配置</h3>
      <p className="text-xs text-gray-500 mb-3">
        修改后需重新「改写」才会按新画风/页数重排分页脚本；灵感图只影响分页阶段。
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <label className="text-sm text-gray-600 dark:text-gray-300 flex flex-col gap-1">
          标题
          <input
            value={userTitle}
            onChange={(e) => setUserTitle(e.target.value)}
            className="px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700"
          />
        </label>
        <label className="text-sm text-gray-600 dark:text-gray-300 flex flex-col gap-1">
          页数 (1–20)
          <input
            type="number"
            min={1}
            max={20}
            value={pageCount}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              setPageCount(Number.isNaN(v) ? 1 : Math.min(Math.max(v, 1), 20));
            }}
            className="px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700"
          />
        </label>
        <label className="text-sm text-gray-600 dark:text-gray-300 flex flex-col gap-1">
          画风 / 语气
          <input
            value={style}
            onChange={(e) => setStyle(e.target.value)}
            placeholder="whimsical, cute, children's picture-book style"
            className="px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700"
          />
        </label>
      </div>

      <div className="mb-4">
        <div className="text-sm font-semibold mb-2">生图参数</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {GEN_FIELDS.map((f) => (
            <label
              key={f.key}
              className="text-sm text-gray-600 dark:text-gray-300 flex flex-col gap-1"
            >
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
                className="px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700"
              />
              <span className="text-xs text-gray-400">{f.desc}</span>
            </label>
          ))}
          <label className="text-sm text-gray-600 dark:text-gray-300 flex flex-col gap-1">
            出图比例
            <input
              value={gen.aspect_ratio}
              onChange={(e) => setGen({ ...gen, aspect_ratio: e.target.value })}
              placeholder="4:3"
              className="px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700"
            />
            <span className="text-xs text-gray-400">生成图片的宽高比，如 4:3 / 1:1 / 16:9</span>
          </label>
          <label className="text-sm text-gray-600 dark:text-gray-300 flex flex-col gap-1">
            出图尺寸
            <input
              value={gen.image_size}
              onChange={(e) => setGen({ ...gen, image_size: e.target.value })}
              placeholder="2K"
              className="px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700"
            />
            <span className="text-xs text-gray-400">图像模型支持的尺寸档位，如 1K / 2K / 4K</span>
          </label>
        </div>
      </div>

      <div className="mb-4">
        <div className="text-sm text-gray-600 dark:text-gray-300 mb-1">灵感图</div>
        <div className="flex items-start gap-3">
          {inspirationUrl ? (
            <img
              src={inspirationUrl}
              alt="灵感图"
              className="w-24 h-24 object-cover rounded-lg border border-gray-300 dark:border-gray-600"
            />
          ) : (
            <div className="w-24 h-24 flex items-center justify-center text-xs text-gray-400 rounded-lg border border-dashed border-gray-300 dark:border-gray-600">
              未设置
            </div>
          )}
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block text-sm mt-1"
          />
        </div>
      </div>

      {msg && <p className="text-emerald-600 text-sm mb-2">{msg}</p>}
      {err && <p className="text-red-500 text-sm mb-2">{err}</p>}

      <button
        disabled={busy}
        onClick={handleSave}
        className="px-6 py-2 rounded-lg bg-indigo-600 text-white disabled:opacity-50"
      >
        保存配置
      </button>
    </div>
  );
};

export default StoryConfigPanel;
