import React, { useState, useCallback, useEffect } from 'react';
import { api } from './api/client';
import type { StorySummary } from './types';
import StoryList from './components/StoryList';
import StoryDetail from './components/StoryDetail';
import { MagicWandIcon } from './components/icons/MagicWandIcon';

const App: React.FC = () => {
  const [stories, setStories] = useState<StorySummary[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStories = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { stories } = await api.listStories();
      setStories(stories);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStories();
  }, [loadStories]);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 font-sans p-4 sm:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto">
        <header className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <MagicWandIcon className="w-8 h-8 text-indigo-500" />
            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-purple-500 to-indigo-600">
              BookAgent 绘本管理
            </h1>
          </div>
          {selectedId != null && (
            <button
              onClick={() => setSelectedId(null)}
              className="px-4 py-2 rounded-lg bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-100 hover:opacity-80"
            >
              ← 返回列表
            </button>
          )}
        </header>

        {error && (
          <div className="mb-4 p-3 rounded-lg border-l-4 border-red-400 bg-red-50 dark:bg-red-900/30 text-sm text-red-700 dark:text-red-300 whitespace-pre-line">
            {error}
          </div>
        )}

        {selectedId == null ? (
          <StoryList
            stories={stories}
            loading={loading}
            onRefresh={loadStories}
            onView={setSelectedId}
            onChanged={loadStories}
          />
        ) : (
          <StoryDetail
            storyId={selectedId}
            onBack={() => setSelectedId(null)}
            onChanged={loadStories}
          />
        )}
      </div>
    </div>
  );
};

export default App;
