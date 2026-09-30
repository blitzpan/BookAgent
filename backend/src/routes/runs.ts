import type { FastifyInstance } from "fastify";
import { db } from "../db/sqlite";
import {
  getStoryRaw,
  setStatus,
  setCurrentRun,
} from "../services/storyService";
import { STORY_STATUS } from "../constants/status";
import { mergeGenerationConfig } from "../constants/generationConfig";
import {
  createRun,
  createTask,
  getActiveTask,
  getRunDetail,
  getTask,
  listRunsForStory,
} from "../services/generationService";
import { runTask } from "../services/taskRunner";
import type { GenerateConfig } from "../types";

export function registerRunRoutes(app: FastifyInstance): void {
  // 整书生图
  app.post("/api/stories/:id/generate", async (req, reply) => {
    const id = Number((req.params as any).id);
    if (!Number.isInteger(id)) {
      return reply.code(400).send({ error: "invalid id" });
    }
    const body = (req.body || {}) as GenerateConfig;
    const story = getStoryRaw(id);
    if (!story) return reply.code(404).send({ error: "故事不存在" });

    // 参数：故事配置为准，请求体仅为一次性覆盖
    const cfg = mergeGenerationConfig(story.generation_config);
    const effective = { ...cfg, ...(body || {}) };

    try {
      setStatus(id, STORY_STATUS.GENERATING);
    } catch (err: any) {
      return reply.code(409).send({ error: err?.message ?? "当前状态不可生图" });
    }

    // 版本：首次建 run；续跑复用同一 run（幂等跳过已成功页，只补失败页）
    let runId = story.current_run_id;
    if (!runId) {
      runId = createRun(id, effective);
      setCurrentRun(id, runId);
    }

    // 同一版本的整书任务同时只允许一个
    if (getActiveTask(runId, "full")) {
      return reply.code(409).send({ error: "该故事已有进行中的生图任务" });
    }

    const taskId = createTask(id, runId, null, "full", effective);
    void runTask(taskId); // 异步执行，先返回 taskId
    return reply.code(201).send({ taskId, runId });
  });

  // 单页补画：只给当前版本追加候选图，不新建 run
  app.post("/api/pages/:pageId/images", async (req, reply) => {
    const pageId = Number((req.params as any).pageId);
    if (!Number.isInteger(pageId)) {
      return reply.code(400).send({ error: "invalid pageId" });
    }
    const page = db
      .prepare(`SELECT * FROM pages WHERE id = ?`)
      .get(pageId) as any;
    if (!page) return reply.code(404).send({ error: "页面不存在" });

    const story = getStoryRaw(page.story_id);
    if (!story) return reply.code(404).send({ error: "故事不存在" });
    const runId = story.current_run_id;
    if (!runId) {
      return reply
        .code(409)
        .send({ error: "该故事还没有整书生成版本，请先整书生图" });
    }
    if (getActiveTask(runId, "single_page", pageId)) {
      return reply.code(409).send({ error: "该页已有进行中的补画任务" });
    }

    const cfg = mergeGenerationConfig(story.generation_config);
    const taskId = createTask(story.id, runId, pageId, "single_page", cfg);
    void runTask(taskId);
    return reply.code(201).send({ taskId });
  });

  app.get("/api/stories/:id/runs", async (req, reply) => {
    const id = Number((req.params as any).id);
    if (!Number.isInteger(id)) {
      return reply.code(400).send({ error: "invalid id" });
    }
    return { runs: listRunsForStory(id) };
  });

  app.get("/api/runs/:runId", async (req, reply) => {
    const runId = Number((req.params as any).runId);
    if (!Number.isInteger(runId)) {
      return reply.code(400).send({ error: "invalid runId" });
    }
    const detail = getRunDetail(runId);
    if (!detail) return reply.code(404).send({ error: "run 不存在" });
    return detail;
  });

  // 任务（执行）状态与进度：整书生图 / 单页补画 都用它轮询
  app.get("/api/tasks/:taskId", async (req, reply) => {
    const taskId = Number((req.params as any).taskId);
    if (!Number.isInteger(taskId)) {
      return reply.code(400).send({ error: "invalid taskId" });
    }
    const task = getTask(taskId);
    if (!task) return reply.code(404).send({ error: "task 不存在" });
    return { task };
  });

  // 发布：生图完成待审批 →（桥接 待审批发行）→ 审批通过的作品
  // 两步迁移均经 canTransitionStory 校验，最终落到已发布态（MVP 单人场景一步到位）。
  app.post("/api/stories/:id/publish", async (req, reply) => {
    const id = Number((req.params as any).id);
    if (!Number.isInteger(id)) {
      return reply.code(400).send({ error: "invalid id" });
    }
    const story = getStoryRaw(id);
    if (!story) return reply.code(404).send({ error: "故事不存在" });
    if (story.status !== STORY_STATUS.GEN_DONE) {
      return reply
        .code(409)
        .send({ error: `当前状态(${story.status})不可发布，需为「生图完成待审批」` });
    }
    try {
      setStatus(id, STORY_STATUS.PENDING_PUBLISH);
      setStatus(id, STORY_STATUS.PUBLISHED);
    } catch (err: any) {
      return reply.code(409).send({ error: err?.message ?? String(err) });
    }
    return { ok: true, status: STORY_STATUS.PUBLISHED };
  });
}
