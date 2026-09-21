import type { FastifyInstance } from "fastify";
import { db } from "../db/sqlite";
import {
  getPageImages,
  setDefaultImageForPage,
  createRun,
} from "../services/generationService";
import { runRun } from "../services/taskRunner";

export function registerPageImageRoutes(app: FastifyInstance): void {
  // 某页全部候选图
  app.get("/api/pages/:pageId/images", async (req, reply) => {
    const pageId = Number((req.params as any).pageId);
    if (!Number.isInteger(pageId)) {
      return reply.code(400).send({ error: "invalid pageId" });
    }
    const images = getPageImages(pageId).map((row: any) => ({
      id: row.id,
      is_default: !!row.is_default,
      kind: row.kind,
      combined_score: row.combined_score,
      identity_score: row.identity_score,
      frame_score: row.frame_score,
      image_path: row.image_path,
      created_at: row.created_at,
    }));
    return { images };
  });

  // 翻默认：把某候选图设为该页最终图
  app.patch("/api/page-images/:imageId", async (req, reply) => {
    const imageId = Number((req.params as any).imageId);
    if (!Number.isInteger(imageId)) {
      return reply.code(400).send({ error: "invalid imageId" });
    }
    const row = db
      .prepare(`SELECT * FROM page_images WHERE id = ?`)
      .get(imageId) as any;
    if (!row) return reply.code(404).send({ error: "图片不存在" });
    setDefaultImageForPage(row.page_id, imageId);
    return { ok: true };
  });

  // 单页重画（等价于 POST /pages/:pageId/images）
  app.post("/api/page-images/:imageId/redraw", async (req, reply) => {
    const imageId = Number((req.params as any).imageId);
    if (!Number.isInteger(imageId)) {
      return reply.code(400).send({ error: "invalid imageId" });
    }
    const row = db
      .prepare(`SELECT * FROM page_images WHERE id = ?`)
      .get(imageId) as any;
    if (!row) return reply.code(404).send({ error: "图片不存在" });
    const body = (req.body || {}) as any;
    const runId = createRun(row.story_id, "single_page", row.page_id, body);
    void runRun(runId);
    return reply.code(201).send({ runId });
  });
}
