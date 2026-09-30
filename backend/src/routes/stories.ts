import type { FastifyInstance } from "fastify";
import {
  createStory,
  rewriteStory,
  updateStory,
  listStories,
  getStoryDetail,
  softDelete,
} from "../services/storyService";
import { STORY_STATUS } from "../constants/status";
import { mergeGenerationConfig } from "../constants/generationConfig";
import { hasActiveTaskForStory } from "../services/generationService";
import { listAudioSets, getSelectedAudioSetId } from "../services/ttsService";

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

  // 列表（支持 ?status= 已发布过滤；无参返回全部未删除，兼容管理壳）
  app.get("/api/stories", async (req) => {
    const status = (req.query as any)?.status as string | undefined;
    return { stories: listStories(status) };
  });

  // 详情
  app.get("/api/stories/:id", async (req, reply) => {
    const id = Number((req.params as any).id);
    if (!Number.isInteger(id)) {
      return reply.code(400).send({ error: "invalid id" });
    }
    const detail = getStoryDetail(id);
    if (!detail) return reply.code(404).send({ error: "故事不存在" });
    return {
      story: {
        ...detail.story,
        generation_config: mergeGenerationConfig(detail.story.generation_config),
      },
      pages: detail.pages,
      audioSets: listAudioSets(id),
      selectedAudioSetId: getSelectedAudioSetId(id),
    };
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

  // 更新故事配置（标题 / 画风 / 目标页数 / 灵感图）
  app.patch("/api/stories/:id", { bodyLimit: 20 * 1024 * 1024 }, async (req, reply) => {
    const id = Number((req.params as any).id);
    if (!Number.isInteger(id)) {
      return reply.code(400).send({ error: "invalid id" });
    }
    const body = req.body as {
      user_title?: string | null;
      style?: string | null;
      target_page_count?: number | null;
      inspiration_image?: string; // 可选 dataURL
      generation_config?: unknown; // 生图参数补丁
    };
    const story = getStoryDetail(id)?.story;
    if (!story) return reply.code(404).send({ error: "故事不存在" });

    // 生图进行中：只允许改标题，其余会影响本次生成的字段一律拒绝
    const generating =
      story.status === STORY_STATUS.GENERATING || hasActiveTaskForStory(id);
    if (generating) {
      const blocked = [
        "style",
        "target_page_count",
        "inspiration_image",
        "generation_config",
      ].filter((k) => (body as any)?.[k] !== undefined);
      if (blocked.length > 0) {
        return reply
          .code(409)
          .send({ error: `生图进行中，暂不可修改：${blocked.join("、")}` });
      }
    }

    try {
      const updated = updateStory(id, body);
      return {
        story: {
          ...updated,
          generation_config: mergeGenerationConfig(updated.generation_config),
        },
      };
    } catch (err: any) {
      return reply.code(400).send({ error: err?.message ?? String(err) });
    }
  });

  // 状态枚举（方便前端下拉/校验）
  app.get("/api/constants/status", async () => {
    return { story_status: STORY_STATUS };
  });
}
