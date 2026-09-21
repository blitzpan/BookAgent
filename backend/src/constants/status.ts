// 状态常量 + 迁移守卫。
// 设计约束（见 design/架构设计.md §7、§4）：所有写操作经 canTransition 校验，非法迁移直接拒绝。

// 作品级生命周期 stories.status
export const STORY_STATUS = {
  NEW: "新建",
  REWRITING: "AI改写中",
  REWRITE_DONE: "改写完成待生图",
  GENERATING: "生图中",
  GEN_DONE: "生图完成待审批",
  GEN_PARTIAL_FAILED: "生图部分失败",
  PENDING_PUBLISH: "待审批发行",
  PUBLISHED: "审批通过的作品",
  DELETED: "删除",
} as const;

// run 状态 generation_runs.status
export const RUN_STATUS = {
  QUEUED: "queued",
  RUNNING: "running",
  COMPLETED: "completed",
  PARTIAL_FAILED: "partial_failed",
  FAILED: "failed",
  INTERRUPTED: "interrupted",
} as const;

// 合法迁移边（stories.status）。删除为软删除，可从任意非删除态进入。
const STORY_TRANSITIONS: Record<string, string[]> = {
  新建: [STORY_STATUS.REWRITING, STORY_STATUS.DELETED],
  AI改写中: [STORY_STATUS.REWRITE_DONE, STORY_STATUS.NEW, STORY_STATUS.DELETED],
  改写完成待生图: [
    STORY_STATUS.GENERATING,
    STORY_STATUS.REWRITING,
    STORY_STATUS.DELETED,
  ],
  生图中: [
    STORY_STATUS.GEN_DONE,
    STORY_STATUS.GEN_PARTIAL_FAILED,
    STORY_STATUS.DELETED,
  ],
  生图完成待审批: [
    STORY_STATUS.PENDING_PUBLISH,
    STORY_STATUS.GENERATING,
    STORY_STATUS.DELETED,
  ],
  生图部分失败: [
    STORY_STATUS.GENERATING,
    STORY_STATUS.PENDING_PUBLISH,
    STORY_STATUS.DELETED,
  ],
  待审批发行: [
    STORY_STATUS.PUBLISHED,
    STORY_STATUS.GEN_DONE,
    STORY_STATUS.DELETED,
  ],
  审批通过的作品: [STORY_STATUS.PENDING_PUBLISH, STORY_STATUS.DELETED],
  删除: [],
};

/**
 * 校验 stories.status 迁移是否合法。
 * - 同态迁移放行（幂等更新）。
 * - 任意态 -> 删除 放行（软删除）。
 * - 删除态不可再迁出。
 */
export function canTransitionStory(from: string, to: string): boolean {
  if (from === to) return true;
  if (to === STORY_STATUS.DELETED) return true;
  if (from === STORY_STATUS.DELETED) return false;
  return (STORY_TRANSITIONS[from] ?? []).includes(to);
}

/** 在事务/更新前调用，非法迁移抛出。 */
export function assertStoryTransition(from: string, to: string): void {
  if (!canTransitionStory(from, to)) {
    throw new Error(
      `非法状态迁移: ${from} -> ${to}（见 design/数据库设计.md stories.status 状态机）`
    );
  }
}
