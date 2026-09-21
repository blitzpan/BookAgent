import React, { useState } from 'react';
import { api } from '../api/client';
import type { StorySummary } from '../types';
import { storyStatusColor } from '../status';
import { MagicWandIcon } from './icons/MagicWandIcon';

interface Props {
  stories: StorySummary[];
  loading: boolean;
  onRefresh: () => void;
  onView: (id: number) => void;
  onChanged: () => void;
}

const DEFAULT_STYLE = "whimsical, cute, soft-color children's picture-book style";

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onloadend = () => resolve(r.result as string);
    r.onerror = () => reject(new Error('读取图片失败'));
    r.readAsDataURL(file);
  });
}

const StoryList: React.FC<Props> = ({ stories, loading, onRefresh, onView, onChanged }) => {
  const [text, setText] = useState('');
  const [style, setStyle] = useState(DEFAULT_STYLE);
  const [pageCount, setPageCount] = useState(6);
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!text.trim()) {
      setErr('请先输入故事原文');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      let inspiration: string | undefined;
      if (file) inspiration = await readAsDataUrl(file);
      await api.createStory({
        original_text: text,
        style: style || undefined,
        target_page_count: pageCount,
        user_title: title || undefined,
        inspiration_image: inspiration,
      });
      setText('');
      setFile(null);
      setTitle('');
      await onChanged();
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm(`确认删除故事 #${id}？`)) return;
    try {
      await api.deleteStory(id);
      await onChanged();
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    }
  };

  return (
    <div className="space-y-8">
      <section className="max-w-3xl bg-white dark:bg-gray-800 rounded-2xl shadow p-6">
        <h2 className="text-xl font-bold mb-4">新建故事</h2>
        <div className="space-y-4">
          <textarea
            rows={8}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Once upon a time..."
            className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700"
          />
          <div className="flex flex-wrap gap-4">
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
                className="w-24 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700"
              />
            </label>
            <label className="text-sm text-gray-600 dark:text-gray-300 flex flex-col gap-1">
              标题 (可选)
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700"
              />
            </label>
          </div>
          <input
            value={style}
            onChange={(e) => setStyle(e.target.value)}
            placeholder="画风 / 语气"
            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700"
          />
          <div>
            <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">
              灵感图 (可选)
            </label>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block text-sm"
            />
          </div>
          {err && <p className="text-red-500 text-sm">{err}</p>}
          <button
            disabled={busy}
            onClick={handleCreate}
            className="w-full flex items-center justify-center gap-2 px-6 py-3 font-bold text-white bg-gradient-to-r from-purple-600 to-indigo-600 rounded-lg disabled:opacity-50"
          >
            <MagicWandIcon className="w-5 h-5" /> 创建故事
          </button>
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xl font-bold">故事列表</h2>
          <button
            onClick={onRefresh}
            disabled={loading}
            className="px-4 py-2 rounded-lg bg-gray-200 dark:bg-gray-700 disabled:opacity-50"
          >
            刷新
          </button>
        </div>
        {stories.length === 0 ? (
          <p className="text-gray-500">还没有故事，先在上方创建一个吧。</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {stories.map((s) => (
              <div
                key={s.id}
                className="bg-white dark:bg-gray-800 rounded-xl shadow p-4 flex flex-col"
              >
                <div className="flex items-center justify-between mb-2 gap-2">
                  <h3 className="font-semibold truncate">{s.user_title || `故事 #${s.id}`}</h3>
                  <span
                    className={`text-xs px-2 py-1 rounded-full flex-shrink-0 ${storyStatusColor(s.status)}`}
                  >
                    {s.status}
                  </span>
                </div>
                <div className="text-xs text-gray-500 mb-3">
                  #{s.id} · {s.page_count} 页 · {s.created_at ? s.created_at.slice(0, 10) : ''}
                </div>
                <div className="mt-auto flex gap-2">
                  <button
                    onClick={() => onView(s.id)}
                    className="flex-1 px-3 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 text-sm"
                  >
                    管理
                  </button>
                  <button
                    onClick={() => handleDelete(s.id)}
                    className="px-3 py-2 rounded-lg bg-red-500 text-white hover:bg-red-600 text-sm"
                  >
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};

export default StoryList;
