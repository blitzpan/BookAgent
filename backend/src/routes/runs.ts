import type { FastifyInstance } from "fastify";
import { db } from "../db/sqlite";
import {
  getStoryRaw,
  setStatus,
  setCurrentRun,
  getPublishReadiness,
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
import { writeDataUrl } from "../storage/imageStore";
import { requestCancel } from "../db/sqlite";
import type { GenerateConfig } from "../types";

const now = () => new Date().toISOString();

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
  // 若请求体带 `image`（dataURL）→ 同步落盘并设为默认图，不触发图像模型（人工补图兜底）。
  app.post(
    "/api/pages/:pageId/images",
    { bodyLimit: 20 * 1024 * 1024 },
    async (req, reply) => {
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

      const body = (req.body || {}) as { image?: string; kind?: string };
      if (body.image) {
        // 人工补图：直接落盘，绕过任何进行中的补画任务（不留孤儿异步任务）
        const info = db
          .prepare(
            `INSERT INTO page_images
              (page_id, story_id, generation_run_id, is_default, kind, created_at)
             VALUES (?, ?, ?, 1, 'manual_upload', ?)`
          )
          .run(pageId, story.id, runId, now());
        const newId = Number(info.lastInsertRowid);
        const imagePath = `assets/${story.id}/${pageId}/${newId}.png`;
        writeDataUrl(body.image, imagePath);
        db.prepare(`UPDATE page_images SET image_path = ? WHERE id = ?`).run(
          imagePath,
          newId
        );
        return reply.code(201).send({ imageId: newId });
      }

      if (getActiveTask(runId, "single_page", pageId)) {
        return reply.code(409).send({ error: "该页已有进行中的补画任务" });
      }

      const cfg = mergeGenerationConfig(story.generation_config);
      const taskId = createTask(story.id, runId, pageId, "single_page", cfg);
      void runTask(taskId);
      return reply.code(201).send({ taskId });
    }
  );

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

  // 任务取消（S16，页级）：仅置标记，进行中的单次模型调用跑完当前页即停，已完成部分保留
  app.post("/api/tasks/:taskId/cancel", async (req, reply) => {
    const taskId = Number((req.params as any).taskId);
    if (!Number.isInteger(taskId)) {
      return reply.code(400).send({ error: "invalid taskId" });
    }
    const ok = requestCancel(taskId);
    if (!ok) {
      return reply.code(409).send({ error: "任务已完成或不存在" });
    }
    return { ok: true };
  });

  // 发布：发布前可随时发布（hasGenerated = current_run_id 非空即「生过图」），仅冻结后不可。
  // 图与文本是硬门禁（缺则默认拒绝，避免阅读端空白页）；配音与热区是软提示（允许纯图文绘本）。
  // 硬门禁可被 ?force=1 人工覆盖（防止程序把人困住：出了问题仍能带缺图发布，由人确认）。
  app.post("/api/stories/:id/publish", async (req, reply) => {
    const id = Number((req.params as any).id);
    if (!Number.isInteger(id)) {
      return reply.code(400).send({ error: "invalid id" });
    }
    const story = getStoryRaw(id);
    if (!story) return reply.code(404).send({ error: "故事不存在" });
    // 入口判据：必须生过图（current_run_id 非空）。未生图的书不能发布。
    if (story.current_run_id == null) {
      return reply.code(409).send({ error: "尚未生图，请先生成插图后再发布" });
    }

    const force =
      (req.query as any)?.force === "1" || (req.body as any)?.force === true;

    // 资产完整性闸门：图与文本缺则默认拒绝（阅读端会出现空白页）；配音/热区仅软提示。
    const readiness = getPublishReadiness(id);
    const blocked: string[] = [];
    if (readiness.images.length > 0) {
      blocked.push(`第 ${readiness.images.join("、")} 页缺少插图`);
    }
    if (readiness.texts.length > 0) {
      blocked.push(`第 ${readiness.texts.join("、")} 页缺少中英文本`);
    }
    if (blocked.length > 0 && !force) {
      return reply
        .code(409)
        .send({ error: `不可发布：${blocked.join("；")}`, missing: readiness });
    }

    try {
      // 单次迁移直接落到已发布态（MVP 单人场景，无独立审批态）。
      setStatus(id, STORY_STATUS.PUBLISHED);
    } catch (err: any) {
      return reply.code(409).send({ error: err?.message ?? String(err) });
    }
    return { ok: true, status: STORY_STATUS.PUBLISHED, missing: readiness, force: !!force };
  });
}
