import { useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import SettingsPanel from "./SettingsPanel";
import { MagicWandIcon } from "./icons/MagicWandIcon";

const COLLAPSE_KEY = "studio-menu-collapsed";

/** 绘本工作室外壳：顶栏（logo + 设置）+ 可折叠左菜单 + 右侧内容区。 */
export default function AppShell() {
  const [collapsed, setCollapsed] = useState<boolean>(
    () => localStorage.getItem(COLLAPSE_KEY) === "1"
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const location = useLocation();
  // 详情页（故事工作区）默认收起菜单给足宽度；用户手动展开仅本次会话有效，不写全局偏好。
  const isDetail = /^\/stories\/\d+/.test(location.pathname);
  const [detailExpanded, setDetailExpanded] = useState(false);
  const effectiveCollapsed = isDetail ? !detailExpanded : collapsed;

  const toggle = () => {
    if (isDetail) {
      setDetailExpanded((v) => !v);
      return;
    }
    setCollapsed((c) => {
      localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1");
      return !c;
    });
  };

  const navItem = (to: string, label: string, icon: React.ReactNode) => (
    <NavLink
      to={to}
      end={to === "/library"}
      className={({ isActive }) =>
        `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors focus-warm ${
          isActive
            ? "bg-brand/10 text-brand"
            : "text-ink/70 hover:bg-paper-2 hover:text-ink"
        } ${effectiveCollapsed ? "justify-center" : ""}`
      }
      title={effectiveCollapsed ? label : undefined}
    >
      <span className="shrink-0">{icon}</span>
      {!effectiveCollapsed && <span>{label}</span>}
    </NavLink>
  );

  return (
    <div className="min-h-screen bg-paper text-ink">
      <header className="border-b border-line bg-paper/80 backdrop-blur sticky top-0 z-20">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 h-16 flex items-center gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand text-white shadow-soft">
              <MagicWandIcon className="w-5 h-5" />
            </span>
            <span className="font-display text-xl font-bold tracking-tight text-ink">
              绘本<span className="text-brand">工作室</span>
            </span>
          </div>
          <div className="flex-1" />
          <button
            onClick={() => setSettingsOpen(true)}
            title="设置（TTS 音色库等）"
            className="inline-flex items-center gap-2 h-10 px-3 rounded-xl text-sm font-medium bg-white border border-line text-ink hover:bg-paper-2 cursor-pointer focus-warm transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06-.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06-.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
            </svg>
            设置
          </button>
        </div>
      </header>

      <div className="max-w-[1600px] mx-auto flex">
        <aside
          className={`sticky top-16 h-[calc(100vh-4rem)] shrink-0 border-r border-line px-3 py-5 transition-all duration-200 ${
            effectiveCollapsed ? "w-16" : "w-52"
          }`}
        >
          <button
            onClick={toggle}
            className="mb-4 flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-muted hover:bg-paper-2 hover:text-ink focus-warm w-full"
            title={effectiveCollapsed ? "展开菜单" : "收起菜单"}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`w-5 h-5 transition-transform ${effectiveCollapsed ? "rotate-180" : ""}`} aria-hidden="true">
              <path d="M15 18l-6-6 6-6" />
            </svg>
            {!effectiveCollapsed && <span>收起菜单</span>}
          </button>
          <nav className="flex flex-col gap-1.5">
            {navItem(
              "/library",
              "绘本库",
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5" aria-hidden="true">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
              </svg>
            )}
            {navItem(
              "/characters",
              "角色管理",
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5" aria-hidden="true">
                <circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" />
              </svg>
            )}
          </nav>
        </aside>

        <main className="flex-1 min-w-0 px-4 sm:px-6 lg:px-8 py-8">
          <Outlet />
        </main>
      </div>

      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
