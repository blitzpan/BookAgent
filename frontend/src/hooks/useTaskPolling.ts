import { useEffect, useRef } from 'react';
import { api } from '../api/client';
import type { GenerationTask } from '../types';

/**
 * 统一轮询一个异步任务的进度（替代原先散落在组件里的 5 处 setInterval timer）。
 * - 默认 2s 轮询；连续 3 次请求失败退避到 5s，避免网络抖动时狂打请求。
 * - 任务进入终态（completed / failed）后停止轮询，并回调 onDone。
 * - 网络异常只退避、不弹错、不中断轮询。
 */
export function useTaskPolling(
  task: GenerationTask | null,
  onTick: (task: GenerationTask) => void,
  onDone: (task: GenerationTask) => void
): void {
  const onTickRef = useRef(onTick);
  const onDoneRef = useRef(onDone);
  onTickRef.current = onTick;
  onDoneRef.current = onDone;

  const failRef = useRef(0);

  useEffect(() => {
    if (!task || !['queued', 'running'].includes(task.status)) return;
    let cancelled = false;
    let handle: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      try {
        const { task: t } = await api.getTask(task.id);
        failRef.current = 0;
        onTickRef.current(t);
        if (!['queued', 'running'].includes(t.status)) {
          onDoneRef.current(t);
          return;
        }
      } catch {
        failRef.current += 1;
      }
      const interval = failRef.current >= 3 ? 5000 : 2000;
      if (!cancelled) handle = setTimeout(tick, interval);
    };

    tick();
    return () => {
      cancelled = true;
      if (handle) clearTimeout(handle);
    };
    // 仅在「任务 id 或状态」变化时重新挂载轮询；running 期间的逐次更新不会重建 timer
  }, [task?.id, task?.status]);
}
