import { useEffect, useState } from "react";
import { IconSun, IconMoon } from "./icons";

const KEY = "reader-theme";
type Theme = "day" | "night";

function apply(t: Theme) {
  if (t === "night") document.documentElement.dataset.readerTheme = "night";
  else delete document.documentElement.dataset.readerTheme;
}

/** 阅读端主题：默认明亮的「白天绘本」，可一键切柔和的「夜灯」睡前模式。 */
export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem(KEY) as Theme | null;
    return saved === "night" ? "night" : "day";
  });

  useEffect(() => {
    apply(theme);
    localStorage.setItem(KEY, theme);
  }, [theme]);

  const isDay = theme === "day";
  return (
    <button
      className="btn-theme"
      onClick={() => setTheme((t) => (t === "day" ? "night" : "day"))}
      title={isDay ? "切换到夜灯模式" : "切换到白天模式"}
      aria-label={isDay ? "切换到夜灯模式" : "切换到白天模式"}
    >
      {isDay ? <IconSun /> : <IconMoon />}
      {isDay ? "夜灯" : "白天"}
    </button>
  );
}
