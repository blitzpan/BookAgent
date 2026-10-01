import { useEffect, useState } from "react";

const KEY = "reader-theme";
type Theme = "night" | "day";

function apply(t: Theme) {
  document.documentElement.dataset.readerTheme = t;
}

/** 阅读端主题切换：默认「绘本夜」（暖近黑），可一键切「日间绘本」（暖纸感）。 */
export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem(KEY) as Theme | null;
    return saved === "day" ? "day" : "night";
  });

  useEffect(() => {
    apply(theme);
    localStorage.setItem(KEY, theme);
  }, [theme]);

  const toDay = theme === "night";
  return (
    <button
      className="btn-theme"
      onClick={() => setTheme((t) => (t === "night" ? "day" : "night"))}
      title={toDay ? "切换到日间模式" : "切换到夜间模式"}
    >
      {toDay ? "☀️ 日间" : "🌙 夜间"}
    </button>
  );
}
