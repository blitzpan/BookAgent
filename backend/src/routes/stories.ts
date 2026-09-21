import type { FastifyInstance } from "fastify";
import {
  createStory,
  rewriteStory,
  listStories,
  getStoryDetail,
  softDelete,
} from "../services/storyService";
import { STORY_STATUS } from "../constants/status";

export function registerStoryRoutes(app: FastifyInstance): void {
  // 建故事
  app.post("/api/stories", async (req, reply) => {
    const body = req.body as {
      original_text?: string;
      style?: string;
      target_page_count?: number;
      user_title?: string;
      inspiration_image?: string; // 可选 dataURL
    };
    if (!body?.original_text || !body.original_text.trim()) {
      return reply.code(400).send({ error: "original_text 不能为空" });
    }
    const result = createStory({
      original_text: body.original_text,
      style: body.style,
      target_page_count: body.target_page_count,
      user_title: body.user_title,
      inspiration_image_path: body.inspiration_image,
    });
    return reply.code(201).send(result);
  });

  // 改写（safety → refine → parse），同步返回
  app.post("/api/stories/:id/rewrite", async (req, reply) => {
    const id = Number((req.params as any).id);
    if (!Number.isInteger(id)) {
      return reply.code(400).send({ error: "invalid id" });
    }
    try {
      const result = await rewriteStory(id);
      return reply.send(result);
    } catch (err: any) {
      return reply.code(400).send({ error: err?.message ?? String(err) });
    }
  });

  // 列表
  app.get("/api/stories", async () => {
    return { stories: listStories() };
  });

  // 详情
  app.get("/api/stories/:id", async (req, reply) => {
    const id = Number((req.params as any).id);
    if (!Number.isInteger(id)) {
      return reply.code(400).send({ error: "invalid id" });
    }
    const detail = getStoryDetail(id);
    if (!detail) return reply.code(404).send({ error: "故事不存在" });
    return detail;
  });

  // 软删除
  app.delete("/api/stories/:id", async (req, reply) => {
    const id = Number((req.params as any).id);
    if (!Number.isInteger(id)) {
      return reply.code(400).send({ error: "invalid id" });
    }
    try {
      softDelete(id);
      return reply.send({ ok: true });
    } catch (err: any) {
      return reply.code(400).send({ error: err?.message ?? String(err) });
    }
  });

  // 状态枚举（方便前端下拉/校验）
  app.get("/api/constants/status", async () => {
    return { story_status: STORY_STATUS };
  });
}
