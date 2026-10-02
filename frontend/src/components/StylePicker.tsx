import React from 'react';
import { STYLE_PRESETS } from '../style';

interface Props {
  selected: string[];
  custom: string;
  onChange: (sel: string[], custom: string) => void;
  customPlaceholder?: string;
}

/**
 * 画风选择：中文预设可多选（自动组合），另可补充英文关键词。
 * 新建故事与「图像配置」弹窗共用，保证两处的选择项与交互一致。
 */
const StylePicker: React.FC<Props> = ({
  selected,
  custom,
  onChange,
  customPlaceholder,
}) => {
  const toggle = (p: string) =>
    onChange(
      selected.includes(p) ? selected.filter((x) => x !== p) : [...selected, p],
      custom
    );

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted">常用画风（可多选，自动组合）</p>
      <div className="flex flex-wrap gap-2">
        {STYLE_PRESETS.map((p) => {
          const on = selected.includes(p);
          return (
            <button
              type="button"
              key={p}
              aria-pressed={on}
              onClick={() => toggle(p)}
              className={`px-3 py-1 rounded-full text-xs border cursor-pointer focus-warm transition-colors duration-200 ${
                on
                  ? 'border-brand bg-[#f6e6c8] text-ink'
                  : 'border-line text-muted hover:border-brand'
              }`}
            >
              {on ? '✓ ' : ''}
              {p}
            </button>
          );
        })}
      </div>
      <label className="text-sm text-muted flex flex-col gap-1">
        画风 / 语气（自定义补充，建议英文）
        <input
          value={custom}
          onChange={(e) => onChange(selected, e.target.value)}
          placeholder={customPlaceholder ?? '可补充英文关键词，如：soft lighting, detailed'}
          className="px-2 py-1 border border-line rounded-lg bg-white text-ink focus-warm"
        />
      </label>
    </div>
  );
};

export default StylePicker;
