// 任务调度：异步触发 run 执行，并用内存集合防止同一 run 重复执行。
// 进程启动时会调用 recoverRunsAndStart() 续跑宕机前未完成的 run。

import {
  getRun,
  runFullGeneration,
  runSinglePage,
  recoverRuns,
  setRunFailed,
} from "./generationService";
import { RUN_STATUS } from "../constants/status";

const running = new Set<number>();

export async function runRun(runId: number): Promise<void> {
  if (running.has(runId)) return;
  const run = getRun(runId);
  if (!run) return;
  if (
    run.status === RUN_STATUS.COMPLETED ||
    run.status === RUN_STATUS.PARTIAL_FAILED ||
    run.status === RUN_STATUS.FAILED
  ) {
    return;
  }
  running.add(runId);
  try {
    if (run.scope === "single_page") await runSinglePage(runId);
    else await runFullGeneration(runId);
  } catch (err: any) {
    // generationService 内部已自行落 run/故事状态；此处仅作最终兜底
    try {
      await setRunFailed(runId, err?.message ?? String(err));
    } catch {
      /* ignore */
    }
  } finally {
    running.delete(runId);
  }
}

/** 启动续跑：把 queued/running 的 run 重新派发（不阻塞服务器启动）。 */
export function recoverRunsAndStart(): void {
  const ids = recoverRuns();
  for (const id of ids) {
    void runRun(id);
  }
}
