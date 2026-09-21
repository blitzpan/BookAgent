import type { LangMode } from "../types";

const OPTIONS: [LangMode, string][] = [
  ["zh", "中文"],
  ["en", "English"],
  ["both", "双语"],
];

export default function LangToggle({
  value,
  onChange,
}: {
  value: LangMode;
  onChange: (v: LangMode) => void;
}) {
  return (
    <div className="toggle">
      {OPTIONS.map(([v, label]) => (
        <button key={v} className={value === v ? "active" : ""} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}
