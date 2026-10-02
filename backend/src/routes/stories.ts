import type { FastifyInstance } from "fastify";
import {
  createStory,
  rewriteStory,
  updateStory,
  listStories,
  getStoryDetail,
  getPublishReadiness,
  getSegmentCount,
  softDelete,
} from "../services/storyService";
import { STORY_STATUS } from "../constants/status";
import { mergeGenerationConfig } from "../constants/generationConfig";
import { hasActiveTaskForStory, getActiveTasksForStory } from "../services/generationService";
import { listAudioSets, getSelectedAudioSetId } from "../services/ttsService";
import {
  generateStoryFromTheme,
  optimizeStory,
} from "../services/geminiService";

// 自由文本入参上限：提示词层的「边界」只是软防护，代码层再兜一道，
// 避免超长输入撑爆上下文或被用来注入指令。
const MAX_DRAFT_INPUT = 2000;

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

  // 草稿旁路（不落库）：主题 → 完整故事。与改写共用 TEXT 后端。
  // 只收主题：页数归「改写」，画风归「生图」，标题属于故事属性，都不在此处使用。
  app.post("/api/story-draft/generate", async (req, reply) => {
    const body = req.body as { theme?: string };
    if (!body?.theme || !body.theme.trim()) {
      return reply.code(400).send({ error: "theme 不能为空" });
    }
    if (body.theme.length > MAX_DRAFT_INPUT) {
      return reply.code(400).send({ error: `theme 过长（上限 ${MAX_DRAFT_INPUT} 字符）` });
    }
    try {
      const { story } = await generateStoryFromTheme(body.theme);
      return reply.send({ story });
    } catch (err: any) {
      return reply.code(400).send({ error: err?.message ?? String(err) });
    }
  });

  // 草稿旁路（不落库）：故事 + 本轮修改要求（+ 已生效要求）→ 修订后的故事，可多轮迭代。
  app.post("/api/story-draft/optimize", async (req, reply) => {
    const body = req.body as {
      story?: string;
      feedback?: string;
      applied_feedback?: unknown;
    };
    if (!body?.story || !body.story.trim()) {
      return reply.code(400).send({ error: "story 不能为空" });
    }
    if (!body?.feedback || !body.feedback.trim()) {
      return reply.code(400).send({ error: "feedback 不能为空" });
    }
    if (body.feedback.length > MAX_DRAFT_INPUT) {
      return reply.code(400).send({ error: `feedback 过长（上限 ${MAX_DRAFT_INPUT} 字符）` });
    }
    // 已生效的修改要求：只取字符串，最多保留最近 5 条，避免多轮后上下文无限膨胀
    const applied = Array.isArray(body.applied_feedback)
      ? body.applied_feedback.filter((x): x is string => typeof x === "string").slice(-5)
      : [];
    try {
      const { story } = await optimizeStory(body.story, body.feedback, applied);
      return reply.send({ story });
    } catch (err: any) {
      return reply.code(400).send({ error: err?.message ?? String(err) });
    }
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

  // 列表（支持过滤：?title= & ?status= & ?generated= & ?audio= & ?hotspots=）
  app.get("/api/stories", async (req) => {
    const q = req.query as any;
    return {
      stories: listStories({
        title: q.title as string | undefined,
        status: q.status as string | undefined,
        generated: q.generated as any,
        audio: q.audio as any,
        hotspots: q.hotspots as any,
      }),
    };
  });

  // 该故事进行中的任务（生图/补画/配音等），供前端恢复轮询时一次拉取
  app.get("/api/stories/:id/tasks/active", async (req, reply) => {
    const id = Number((req.params as any).id);
    if (!Number.isInteger(id)) {
      return reply.code(400).send({ error: "invalid id" });
    }
    const tasks = getActiveTasksForStory(id).map((t) => {
      let progress = { total: 0, done: 0, failed: 0 };
      try {
        const p = t.progress ? JSON.parse(t.progress as string) : null;
        if (p) progress = { total: p.total ?? 0, done: p.done ?? 0, failed: p.failed ?? 0 };
      } catch {
        /* 进度损坏不影响列表 */
      }
      return {
        id: t.id,
        kind: t.kind,
        status: t.status,
        pageId: t.page_id,
        progress,
      };
    });
    return { tasks };
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
      readiness: getPublishReadiness(id),
      segment_count: getSegmentCount(id),
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
