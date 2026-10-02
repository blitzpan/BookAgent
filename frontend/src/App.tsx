import React, { useState } from "react";
import { Routes, Route, Navigate, Link, useNavigate, useParams } from "react-router-dom";
import StoryList from "./components/StoryList";
import StoryDetail from "./components/StoryDetail";
import HotspotSettings from "./components/HotspotSettings";
import SettingsPanel from "./components/SettingsPanel";
import { MagicWandIcon } from "./components/icons/MagicWandIcon";

/** 绘本库首页：自加载数据，onView 跳转详情。 */
function LibraryRoute() {
  const navigate = useNavigate();
  return <StoryList onView={(id) => navigate(`/stories/${id}`)} />;
}

/** 详情页：从路由取 id，返回/跳转转成导航。 */
function StoryDetailRoute() {
  const { id } = useParams();
  const navigate = useNavigate();
  return (
    <StoryDetail
      storyId={Number(id)}
      onBack={() => navigate("/")}
      onChanged={() => {}}
      onOpenHotspots={(sid) => navigate(`/stories/${sid}/hotspots`)}
    />
  );
}

/** 热区设置页：返回详情。 */
function HotspotRoute() {
  const { id } = useParams();
  const navigate = useNavigate();
  return <HotspotSettings storyId={Number(id)} onBack={() => navigate(`/stories/${id}`)} />;
}

const App: React.FC = () => {
  const [settingsOpen, setSettingsOpen] = useState(false);
  return (
    <div className="min-h-screen bg-paper text-ink">
      <header className="border-b border-line bg-paper/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center gap-3">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand text-white shadow-soft">
              <MagicWandIcon className="w-5 h-5" />
            </span>
            <span className="font-display text-xl font-bold tracking-tight text-ink">
              绘本馆<span className="text-brand">工作室</span>
            </span>
          </Link>
          <div className="flex-1" />
          <span className="text-sm text-muted hidden sm:block">绘本生产 · 管理与发布</span>
          <button
            onClick={() => setSettingsOpen(true)}
            title="设置（TTS 音色库等）"
            className="inline-flex items-center gap-2 h-10 px-3 rounded-xl text-sm font-medium bg-white border border-line text-ink hover:bg-paper-2 cursor-pointer focus-warm transition-colors duration-200"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-4 h-4"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
            </svg>
            设置
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Routes>
          <Route path="/" element={<LibraryRoute />} />
          <Route path="/stories/:id" element={<StoryDetailRoute />} />
          <Route path="/stories/:id/hotspots" element={<HotspotRoute />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
};

export default App;
