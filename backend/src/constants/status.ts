// 状态常量 + 迁移守卫。
// 设计约束（见 design/架构设计.md §7、§4）：所有写操作经 canTransition 校验，非法迁移直接拒绝。

// 作品级生命周期 stories.status
// 设计原则（见 design/数据库设计.md §状态机）：
//  - 只守护「图文书的进度 + 数据完整性」，不约束可选增强层（配音/热区已移出状态机，改用 stories.has_audio / stories.has_hotspots 层快照表达）。
//  - 生图是一个「发布前可反复打磨」的闭环：只要未发布，可在 改写完成/生图中/生图完成/生图部分失败 间来回。
//  - 已发布 = 唯一真锁，只进「删除」，不可逆。
export const STORY_STATUS = {
  NEW: "新建",
  REWRITING: "AI改写中",
  REWRITE_DONE: "改写完成待生图",
  GENERATING: "生图中",
  GEN_DONE: "生图完成待发布",
  GEN_PARTIAL_FAILED: "生图部分失败",
  PUBLISHED: "审批通过的作品",
  DELETED: "删除",
} as const;

// run 状态 generation_runs.status（仅版本产出态；queued/interrupted 不属 run：
// queued 属 generation_tasks，interrupted 属 audio_sets，故此处只保留 run 实际使用的四个值）。
export const RUN_STATUS = {
  RUNNING: "running",
  COMPLETED: "completed",
  PARTIAL_FAILED: "partial_failed",
  FAILED: "failed",
} as const;

// 合法迁移边（stories.status）。删除为软删除，可从任意非删除态进入。
// 按钮是否可点由「是否做过该操作(hasGenerated/层快照) + 是否发布」驱动（见前端 StoryDetail），
// 这里只保证人类可能点的路径都是合法边，避免 assertStoryTransition 把人困住。
const STORY_TRANSITIONS: Record<string, string[]> = {
  新建: [STORY_STATUS.REWRITING, STORY_STATUS.DELETED],
  AI改写中: [STORY_STATUS.REWRITE_DONE, STORY_STATUS.NEW, STORY_STATUS.DELETED],
  // 改写完成态：可首次/续跑生图、可重新改写、可删除
  改写完成待生图: [
    STORY_STATUS.GENERATING,
    STORY_STATUS.REWRITING,
    STORY_STATUS.DELETED,
  ],
  生图中: [
    STORY_STATUS.GEN_DONE,
    STORY_STATUS.GEN_PARTIAL_FAILED,
    STORY_STATUS.REWRITE_DONE, // 崩溃/任务异常兜底：永远能退出「生图中」，不卡死
    STORY_STATUS.DELETED,
  ],
  // 生图完成（全部有图）：发布前可重做生图、可重新改写重排分页、可发布
  生图完成待发布: [
    STORY_STATUS.GENERATING,
    STORY_STATUS.REWRITING,
    STORY_STATUS.PUBLISHED,
    STORY_STATUS.DELETED,
  ],
  // 部分失败：可整书重跑、可补满缺图后晋级待发布、也可由人工带缺图直接发布
  生图部分失败: [
    STORY_STATUS.GENERATING,
    STORY_STATUS.GEN_DONE,
    STORY_STATUS.PUBLISHED,
    STORY_STATUS.DELETED,
  ],
  审批通过的作品: [STORY_STATUS.DELETED], // 冻结，只可软删
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
