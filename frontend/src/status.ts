// 状态 → 暖色徽标配色。去 AI 味：冷蓝/靛/紫/绿 收敛为 赤陶/暖金/墨绿/暖红/暖灰 大地色系。

export function storyStatusColor(status: string): string {
  switch (status) {
    case '新建':
      return 'bg-stone-100 text-stone-700';
    case 'AI改写中':
      return 'bg-[#f6dccd] text-[#9c4a2c]';
    case '改写完成待生图':
      return 'bg-[#f6e6c8] text-[#8a5a1e]';
    case '生图中':
      return 'bg-[#f6dccd] text-[#9c4a2c]';
    case '生图完成待审批':
      return 'bg-[#f6e6c8] text-[#8a5a1e]';
    case '生图部分失败':
      return 'bg-[#f3d9d3] text-[#9c3b30]';
    case '待审批发行':
      return 'bg-[#dfe7d5] text-[#3f5a35]';
    case '审批通过的作品':
      return 'bg-[#dfe7d5] text-[#3f5a35]';
    default:
      return 'bg-stone-100 text-stone-700';
  }
}

export function runStatusColor(status: string): string {
  switch (status) {
    case 'queued':
      return 'bg-stone-100 text-stone-700';
    case 'running':
      return 'bg-[#f6dccd] text-[#9c4a2c]';
    case 'completed':
      return 'bg-[#dfe7d5] text-[#3f5a35]';
    case 'partial_failed':
      return 'bg-[#f7dccb] text-[#9c4a2c]';
    case 'failed':
      return 'bg-[#f3d9d3] text-[#9c3b30]';
    case 'interrupted':
      return 'bg-[#f6e6c8] text-[#8a5a1e]';
    default:
      return 'bg-stone-100 text-stone-700';
  }
}
