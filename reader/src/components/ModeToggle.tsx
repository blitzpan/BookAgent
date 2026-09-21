import type { ReadMode } from "../types";

const OPTIONS: [ReadMode, string][] = [
  ["single", "单页"],
  ["spread", "跨页"],
];

export default function ModeToggle({
  value,
  onChange,
}: {
  value: ReadMode;
  onChange: (v: ReadMode) => void;
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
