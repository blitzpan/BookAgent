// 任务调度：以 generation_tasks 为驱动异步执行，并用内存集合防止同一任务重复执行。
// 进程启动时会调用 recoverAndStart() 续跑宕机前未完成的任务（执行状态在 task，不在 run）。

import {
  getTask,
  runFullGeneration,
  runSinglePage,
  runTtsGeneration,
  recoverTasks,
  finishTask,
} from "./generationService";

const running = new Set<number>();

export async function runTask(taskId: number): Promise<void> {
  if (running.has(taskId)) return;
  const task = getTask(taskId);
  if (!task) return;
  if (task.status === "completed" || task.status === "failed") return;
  running.add(taskId);
  try {
    if (task.kind === "tts") await runTtsGeneration(taskId);
    else if (task.kind === "single_page") await runSinglePage(taskId);
    else await runFullGeneration(taskId);
  } catch (err: any) {
    // generationService 内部已自行落任务/故事状态；此处仅作最终兜底
    try {
      finishTask(taskId, "failed", err?.message ?? String(err));
    } catch {
      /* ignore */
    }
  } finally {
    running.delete(taskId);
  }
}

/** 启动续跑：把 queued/running 的任务重新派发（不阻塞服务器启动）。 */
export function recoverAndStart(): void {
  for (const id of recoverTasks()) {
    void runTask(id);
  }
}
