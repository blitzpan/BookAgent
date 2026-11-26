// 统一的线性 SVG 图标（替代 emoji，避免不同平台渲染不一致、也更"干净"）。
// 全部使用 currentColor，颜色随父元素；尺寸默认 24，可按需传入。

type IconProps = {
  size?: number;
  className?: string;
  strokeWidth?: number;
};

function base(size: number, className?: string) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
    "aria-hidden": true,
  };
}

export function IconPlay({ size = 24, className, strokeWidth = 2 }: IconProps) {
  return (
    <svg {...base(size, className)} strokeWidth={strokeWidth}>
      <path d="M8 5.5v13l11-6.5-11-6.5z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconPause({ size = 24, className, strokeWidth = 2 }: IconProps) {
  return (
    <svg {...base(size, className)} strokeWidth={strokeWidth}>
      <rect x="6.5" y="5" width="3.5" height="14" rx="1.4" fill="currentColor" stroke="none" />
      <rect x="14" y="5" width="3.5" height="14" rx="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconArrowLeft({ size = 24, className, strokeWidth = 2.4 }: IconProps) {
  return (
    <svg {...base(size, className)} strokeWidth={strokeWidth}>
      <path d="M14 6l-6 6 6 6" />
    </svg>
  );
}

export function IconArrowRight({ size = 24, className, strokeWidth = 2.4 }: IconProps) {
  return (
    <svg {...base(size, className)} strokeWidth={strokeWidth}>
      <path d="M10 6l6 6-6 6" />
    </svg>
  );
}

export function IconBack({ size = 24, className, strokeWidth = 2.2 }: IconProps) {
  return (
    <svg {...base(size, className)} strokeWidth={strokeWidth}>
      <path d="M14 6l-6 6 6 6" />
      <path d="M9 12h10" />
    </svg>
  );
}

export function IconSun({ size = 24, className, strokeWidth = 2 }: IconProps) {
  return (
    <svg {...base(size, className)} strokeWidth={strokeWidth}>
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.5v2.4M12 19.1v2.4M4.4 4.4l1.7 1.7M17.9 17.9l1.7 1.7M2.5 12h2.4M19.1 12h2.4M4.4 19.6l1.7-1.7M17.9 6.1l1.7-1.7" />
    </svg>
  );
}

export function IconMoon({ size = 24, className, strokeWidth = 2 }: IconProps) {
  return (
    <svg {...base(size, className)} strokeWidth={strokeWidth}>
      <path d="M20 14.5A8 8 0 1 1 9.5 4a6.3 6.3 0 0 0 10.5 10.5z" />
    </svg>
  );
}

export function IconVolume({ size = 24, className, strokeWidth = 2 }: IconProps) {
  return (
    <svg {...base(size, className)} strokeWidth={strokeWidth}>
      <path d="M4 9.5v5h3.5L12 19V5L7.5 9.5H4z" fill="currentColor" stroke="none" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M18 6a8.5 8.5 0 0 1 0 12" />
    </svg>
  );
}

export function IconStar({ size = 24, className, strokeWidth = 2 }: IconProps) {
  return (
    <svg {...base(size, className)} strokeWidth={strokeWidth}>
      <path
        d="M12 3.2l2.5 5.1 5.6.8-4 4 1 5.6L12 16.9 6.9 18.7l1-5.6-4-4 5.6-.8L12 3.2z"
        fill="currentColor"
        stroke="none"
      />
    </svg>
  );
}

export function IconBook({ size = 24, className, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg {...base(size, className)} strokeWidth={strokeWidth}>
      <path d="M12 6.2C10.4 5 7.8 4.5 5 5v12.5c2.8-.5 5.4 0 7 1.2 1.6-1.2 4.2-1.7 7-1.2V5c-2.8-.5-5.4 0-7 1.2z" />
      <path d="M12 6.2V18.7" />
    </svg>
  );
}
