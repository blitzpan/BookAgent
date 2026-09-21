import type { FastifyInstance } from "fastify";
import { db } from "../db/sqlite";
import {
  getStoryRaw,
  setStatus,
} from "../services/storyService";
import { STORY_STATUS } from "../constants/status";
import {
  createRun,
  getRun,
  getRunDetail,
  listRunsForStory,
} from "../services/generationService";
import { runRun } from "../services/taskRunner";
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

    try {
      setStatus(id, STORY_STATUS.GENERATING);
    } catch (err: any) {
      return reply.code(409).send({ error: err?.message ?? "当前状态不可生图" });
    }

    const runId = createRun(id, "full", null, body);
    void runRun(runId); // 异步执行，先返回 runId
    return reply.code(201).send({ runId });
  });

  // 单页补画（手动新增候选图）
  app.post("/api/pages/:pageId/images", async (req, reply) => {
    const pageId = Number((req.params as any).pageId);
    if (!Number.isInteger(pageId)) {
      return reply.code(400).send({ error: "invalid pageId" });
    }
    const body = (req.body || {}) as GenerateConfig;
    const page = db
      .prepare(`SELECT * FROM pages WHERE id = ?`)
      .get(pageId) as any;
    if (!page) return reply.code(404).send({ error: "页面不存在" });

    const runId = createRun(page.story_id, "single_page", pageId, body);
    void runRun(runId);
    return reply.code(201).send({ runId });
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
