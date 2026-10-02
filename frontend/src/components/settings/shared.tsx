import React from 'react';
import type { VoiceCategory } from '../../types';

/** 内联 SVG 图标（用 path 描述，避免引入图标库）。 */
export const Icon: React.FC<{ d: string; className?: string }> = ({ d, className }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className ?? 'w-4 h-4'}
    aria-hidden="true"
  >
    <path d={d} />
  </svg>
);

/** 刷新 / 重新加载图标（lucide refresh-cw）。 */
export const RefreshIcon: React.FC<{ className?: string }> = ({ className }) => (
  <Icon className={className} d="M3 12a9 9 0 1 0 2.64-6.36M3 3v6h6" />
);

/** 统一的次要按钮基线样式（与 App 顶部按钮一致）。 */
export const BUTTON_BASE =
  'inline-flex items-center justify-center gap-2 h-11 px-4 rounded-xl text-sm font-medium cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-warm transition-colors duration-200';

export function StatTile({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-xl border border-line bg-paper/70 px-3 py-2.5 text-center transition-colors duration-200 hover:border-brand/50">
      <div className="font-display text-2xl font-bold text-brand leading-tight">{value}</div>
      <div className="text-xs text-muted-strong mt-0.5">{label}</div>
    </div>
  );
}

export function formatTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const CATEGORY_LABEL: Record<VoiceCategory, string> = {
  mandarin: '普通话',
  dialect: '方言 / 地方口音',
  english: '英文',
};
export const CATEGORY_ORDER: VoiceCategory[] = ['mandarin', 'dialect', 'english'];
