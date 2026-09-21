// 状态 → Tailwind 徽标配色。

export function storyStatusColor(status: string): string {
  switch (status) {
    case '新建':
      return 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200';
    case 'AI改写中':
      return 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200';
    case '改写完成待生图':
      return 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-200';
    case '生图中':
      return 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-200';
    case '生图完成待审批':
      return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-200';
    case '生图部分失败':
      return 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200';
    case '待审批发行':
      return 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-200';
    case '审批通过的作品':
      return 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-200';
    default:
      return 'bg-gray-100 text-gray-700';
  }
}

export function runStatusColor(status: string): string {
  switch (status) {
    case 'queued':
      return 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200';
    case 'running':
      return 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-200';
    case 'completed':
      return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-200';
    case 'partial_failed':
      return 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-200';
    case 'failed':
      return 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200';
    case 'interrupted':
      return 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-200';
    default:
      return 'bg-gray-100 text-gray-700';
  }
}
