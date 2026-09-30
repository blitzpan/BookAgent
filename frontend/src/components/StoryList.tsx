import React, { useEffect, useMemo, useState } from 'react';
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
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

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

  const total = stories.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const rows = useMemo(
    () => stories.slice((safePage - 1) * pageSize, safePage * pageSize),
    [stories, safePage, pageSize]
  );

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
        {total === 0 ? (
          <p className="text-gray-500">还没有故事，先在上方创建一个吧。</p>
        ) : (
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-left">
                  <tr>
                    <th className="px-4 py-3 w-16">ID</th>
                    <th className="px-4 py-3">标题</th>
                    <th className="px-4 py-3 w-40">状态</th>
                    <th className="px-4 py-3 w-20">页数</th>
                    <th className="px-4 py-3 w-32">创建时间</th>
                    <th className="px-4 py-3 w-40 text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {rows.map((s) => (
                    <tr key={s.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <td className="px-4 py-3 text-gray-500">#{s.id}</td>
                      <td className="px-4 py-3 font-medium">
                        <span className="line-clamp-1">{s.user_title || `故事 #${s.id}`}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`text-xs px-2 py-1 rounded-full ${storyStatusColor(s.status)}`}
                        >
                          {s.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">{s.page_count}</td>
                      <td className="px-4 py-3 text-gray-500">
                        {s.created_at ? s.created_at.slice(0, 10) : '-'}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <button
                          onClick={() => onView(s.id)}
                          className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 text-xs"
                        >
                          管理
                        </button>
                        <button
                          onClick={() => handleDelete(s.id)}
                          className="ml-2 px-3 py-1.5 rounded-lg bg-red-500 text-white hover:bg-red-600 text-xs"
                        >
                          删除
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-gray-200 dark:border-gray-700 text-sm">
              <div className="text-gray-500">
                共 {total} 条 · 第 {safePage} / {totalPages} 页
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setPage(1);
                  }}
                  className="px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700"
                >
                  {[10, 20, 50].map((n) => (
                    <option key={n} value={n}>
                      {n} 条/页
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => setPage(1)}
                  disabled={safePage === 1}
                  className="px-3 py-1 rounded-lg bg-gray-200 dark:bg-gray-700 disabled:opacity-40"
                >
                  首页
                </button>
                <button
                  onClick={() => setPage(safePage - 1)}
                  disabled={safePage === 1}
                  className="px-3 py-1 rounded-lg bg-gray-200 dark:bg-gray-700 disabled:opacity-40"
                >
                  上一页
                </button>
                <button
                  onClick={() => setPage(safePage + 1)}
                  disabled={safePage === totalPages}
                  className="px-3 py-1 rounded-lg bg-gray-200 dark:bg-gray-700 disabled:opacity-40"
                >
                  下一页
                </button>
                <button
                  onClick={() => setPage(totalPages)}
                  disabled={safePage === totalPages}
                  className="px-3 py-1 rounded-lg bg-gray-200 dark:bg-gray-700 disabled:opacity-40"
                >
                  末页
                </button>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
};

export default StoryList;
