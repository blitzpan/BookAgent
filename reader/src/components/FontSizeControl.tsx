export default function FontSizeControl({
  idx,
  onChange,
}: {
  idx: number;
  onChange: (i: number) => void;
}) {
  const labels = ["小", "中", "大"];
  return (
    <div className="toggle">
      {labels.map((label, i) => (
        <button key={label} className={idx === i ? "active" : ""} onClick={() => onChange(i)}>
          {label}
        </button>
      ))}
    </div>
  );
}
