import React, { useState } from 'react';
import Modal from './Modal';
import { Icon } from './settings/shared';
import TtsVoicesSection from './settings/TtsVoicesSection';

interface SettingsSectionDef {
  id: string;
  label: string;
  /** 侧栏副标题，说明这块配置管什么。 */
  desc: string;
  /** 内联 SVG path（见 settings/shared.tsx 的 Icon）。 */
  icon: string;
  Component: React.FC;
}

/**
 * 设置中心分区注册表。
 *
 * 新增一类配置时，只需在此数组追加一项（并实现一个自包含的分区组件，
 * 参考 TtsVoicesSection），外壳会自动生成侧栏导航项与右侧内容区——
 * 无需改动布局、弹窗或导航逻辑。后续可加：LLM 模型、图片生成、存储、快捷键等。
 */
const SECTIONS: SettingsSectionDef[] = [
  {
    id: 'tts-voices',
    label: 'TTS 音色库',
    desc: '配音可用音色',
    icon: 'M11 5 6 9H2v6h4l5 4V5z M19.07 4.93a10 10 0 0 1 0 14.14 M15.54 8.46a5 5 0 0 1 0 7.08',
    Component: TtsVoicesSection,
  },
  // 示例（尚未实现，按需取消注释并补组件即可）：
  // {
  //   id: 'llm',
  //   label: 'AI 模型',
  //   desc: '文本 / 图片 / 视觉',
  //   icon: 'M12 3v18 M3 12h18 M5.6 5.6l12.8 12.8 M18.4 5.6 5.6 18.4',
  //   Component: LlmSection,
  // },
];

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * 全局设置中心：左侧分区导航 + 右侧内容区，可横向扩展更多配置类目。
 * 目前仅含「TTS 音色库」，但结构已为多分区预留。
 */
const SettingsPanel: React.FC<Props> = ({ open, onClose }) => {
  const [activeId, setActiveId] = useState<string>(SECTIONS[0].id);
  const active = SECTIONS.find((s) => s.id === activeId) ?? SECTIONS[0];
  const ActiveComponent = active.Component;

  return (
    <Modal open={open} onClose={onClose} title="设置" maxWidth="max-w-4xl">
      <div className="flex flex-col sm:flex-row sm:gap-5">
        {/* 侧栏：移动端横向滚动，桌面端竖向固定 */}
        <nav className="flex gap-1 overflow-x-auto sm:flex-col sm:overflow-visible sm:w-52 sm:shrink-0 sm:border-l sm:border-line sm:pl-4 -ml-1 sm:ml-0 pb-2 sm:pb-0">
          {SECTIONS.map((s) => {
            const isActive = s.id === active.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setActiveId(s.id)}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap cursor-pointer focus-warm transition-colors duration-200 ${
                  isActive
                    ? 'bg-brand-soft text-brand'
                    : 'text-muted-strong hover:bg-paper-2'
                }`}
                aria-current={isActive ? 'page' : undefined}
              >
                <Icon className="w-4 h-4 shrink-0" d={s.icon} />
                <span className="flex flex-col items-start leading-tight">
                  <span>{s.label}</span>
                  <span className="text-[11px] font-normal text-muted">{s.desc}</span>
                </span>
              </button>
            );
          })}
        </nav>

        {/* 内容区：仅渲染当前分区，组件自管理加载与保存 */}
        <div className="flex-1 min-w-0 pt-3 sm:pt-0">
          <ActiveComponent />
        </div>
      </div>
    </Modal>
  );
};

export default SettingsPanel;
