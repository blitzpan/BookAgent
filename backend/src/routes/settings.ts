import type { FastifyInstance } from "fastify";
import {
  getVoicePool,
  getVoicePoolStats,
  refreshVoicePool,
} from "../services/voicePoolService";

export function registerSettingsRoutes(app: FastifyInstance): void {
  // 当前音色池 + 统计（供设置页展示「多少中文 / 多少英文 / 多少方言」与具体列表）
  app.get("/api/settings/tts-voices", async () => {
    return { pool: getVoicePool(), stats: getVoicePoolStats() };
  });

  // 更新音色：拉取微软全量 → AI 筛选 → 校验落库。
  // 失败时旧池保持不变，仅返回错误信息供前端提示。
  app.post("/api/settings/tts-voices/refresh", async (_req, reply) => {
    try {
      const stats = await refreshVoicePool();
      return { ok: true, pool: getVoicePool(), stats };
    } catch (e: any) {
      const message = e?.message ? String(e.message) : String(e);
      console.error("刷新音色池失败:", message);
      return reply.code(500).send({ error: `更新音色失败：${message}` });
    }
  });
}
