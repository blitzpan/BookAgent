import React from 'react';

interface Props {
  title: string;
  hint?: string;
  children: React.ReactNode;
}

/** 配置弹窗内的分组区块：标题 + 可选说明，与「图像配置」保持一致。 */
const ConfigSection: React.FC<Props> = ({ title, hint, children }) => {
  return (
    <div className="mb-5 last:mb-0">
      <div className="flex items-baseline justify-between mb-2">
        <h4 className="text-sm font-bold text-ink">{title}</h4>
      </div>
      {hint && <p className="text-xs text-muted mb-2 leading-relaxed">{hint}</p>}
      {children}
    </div>
  );
};

export default ConfigSection;
