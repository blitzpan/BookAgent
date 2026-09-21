import React, { useState } from 'react';
import type { GenerateConfig } from '../types';

interface Props {
  onGenerate: (cfg: GenerateConfig) => void;
  busy: boolean;
}

const PROVIDERS = ['gemini', 'qwen', 'ark', 'seedream', 'bailian'];

const GeneratePanel: React.FC<Props> = ({ onGenerate, busy }) => {
  const [frame_threshold, setFT] = useState(0.75);
  const [max_frame_retry, setMFR] = useState(3);
  const [sequence_threshold, setST] = useState(0.8);
  const [max_sequence_retry, setMSR] = useState(1);
  const [initial_retry_budget, setIRB] = useState(1);
  const [text_provider, setTP] = useState('ark');
  const [image_provider, setIP] = useState('ark');
  const [vision_provider, setVP] = useState('ark');
  const [aspect_ratio, setAR] = useState('4:3');
  const [image_size, setIS] = useState('2K');

  const numInput = (
    label: string,
    value: number,
    set: (n: number) => void,
    step = 0.01,
    min = 0,
    max = 1
  ) => (
    <label className="text-sm text-gray-600 dark:text-gray-300 flex flex-col gap-1">
      {label}
      <input
        type="number"
        step={step}
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          const v = Number(e.target.value);
          set(Number.isFinite(v) ? v : value);
        }}
        className="px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700"
      />
    </label>
  );

  const provInput = (label: string, value: string, set: (s: string) => void) => (
    <label className="text-sm text-gray-600 dark:text-gray-300 flex flex-col gap-1">
      {label}
      <select
        value={value}
        onChange={(e) => set(e.target.value)}
        className="px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700"
      >
        {PROVIDERS.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-5 mb-6">
      <h3 className="font-bold mb-3">生图配置</h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-4">
        {numInput('帧阈值', frame_threshold, setFT)}
        {numInput('最大帧重试', max_frame_retry, setMFR, 1, 1, 10)}
        {numInput('序列阈值', sequence_threshold, setST)}
        {numInput('最大序列修复', max_sequence_retry, setMSR, 1, 0, 5)}
        {numInput('首跑预算', initial_retry_budget, setIRB, 1, 1, 10)}
        {provInput('文本模型', text_provider, setTP)}
        {provInput('图像模型', image_provider, setIP)}
        {provInput('视觉校验', vision_provider, setVP)}
        <label className="text-sm text-gray-600 dark:text-gray-300 flex flex-col gap-1">
          比例
          <input
            value={aspect_ratio}
            onChange={(e) => setAR(e.target.value)}
            className="px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700"
          />
        </label>
        <label className="text-sm text-gray-600 dark:text-gray-300 flex flex-col gap-1">
          尺寸
          <input
            value={image_size}
            onChange={(e) => setIS(e.target.value)}
            className="px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700"
          />
        </label>
      </div>
      <button
        disabled={busy}
        onClick={() =>
          onGenerate({
            frame_threshold,
            max_frame_retry,
            sequence_threshold,
            max_sequence_retry,
            initial_retry_budget,
            text_provider,
            image_provider,
            vision_provider,
            aspect_ratio,
            image_size,
          })
        }
        className="w-full flex items-center justify-center gap-2 px-6 py-3 font-bold text-white bg-gradient-to-r from-purple-600 to-indigo-600 rounded-lg disabled:opacity-50"
      >
        开始生图
      </button>
    </div>
  );
};

export default GeneratePanel;
