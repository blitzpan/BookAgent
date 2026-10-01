import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";
import { db, DATA_DIR } from "../db/sqlite";
import { getStoryRaw } from "../services/storyService";
import { createTask } from "../services/generationService";
import { runTask } from "../services/taskRunner";
import {
  createAudioSet,
  listAudioSets,
  selectAudioSet,
  hasGeneratingAudioSet,
  getAudioSet,
  getBookAudio,
  getSelectedAudioSetId,
  type AudioSetConfig,
  type Lang,
} from "../services/ttsService";

const RESUMABLE = ["interrupted", "failed"];

export function registerTtsRoutes(app: FastifyInstance): void {
  // 生成配音（智能分流：续跑 interrupted/failed 的方案，否则新建；forceNew 强制新建）
  app.post("/api/stories/:id/tts", async (req, reply) => {
    const id = Number((req.params as any).id);
    if (!Number.isInteger(id)) {
      return reply.code(400).send({ error: "invalid id" });
    }
    const story = getStoryRaw(id);
    if (!story) return reply.code(404).send({ error: "故事不存在" });

    const body = (req.body || {}) as {
      name?: string;
      config?: AudioSetConfig;
      langs?: Lang[];
      regenerate?: boolean;
      forceNew?: boolean;
    };
    const langs = body.langs && body.langs.length ? body.langs : (["zh", "en"] as Lang[]);
    const config: AudioSetConfig = { ...(body.config || {}), langs };

    // 并发防重：本故事已有 generating 的方案 → 拒绝
    if (hasGeneratingAudioSet(id)) {
      return reply
        .code(409)
        .send({ error: "该故事已有进行中的配音任务，请稍候或刷新查看进度" });
    }

    let audioSetId: number;
    const existing = db
      .prepare(
        `SELECT id, status FROM audio_sets WHERE story_id = ? AND status IN (${RESUMABLE.map(
          () => "?"
        ).join(",")}) ORDER BY id DESC LIMIT 1`
      )
      .get(id, ...RESUMABLE) as { id: number; status: string } | undefined;

    if (existing && !body.forceNew) {
      // 续跑：复用同一方案，状态翻回 generating
      audioSetId = existing.id;
      db.prepare(`UPDATE audio_sets SET status='generating', config_json=?, updated_at=? WHERE id=?`).run(
        JSON.stringify(config),
        new Date().toISOString(),
        audioSetId
      );
    } else {
      const count = (
        db.prepare(`SELECT COUNT(*) AS c FROM audio_sets WHERE story_id = ?`).get(id) as {
          c: number;
        }
      ).c;
      const name = body.name?.trim() || `配音方案 #${count + 1}`;
      audioSetId = createAudioSet(id, name, config, "generating");
    }

    const runId = story.current_run_id ?? null;
    const taskId = createTask(id, runId, null, "tts", {
      audioSetId,
      langs,
      regenerate: body.regenerate ?? false,
    } as any);
    void runTask(taskId);

    return reply.code(201).send({ taskId, audioSetId });
  });

  // 列出某故事的全部配音方案
  app.get("/api/stories/:id/audio-sets", async (req, reply) => {
    const id = Number((req.params as any).id);
    if (!Number.isInteger(id)) {
      return reply.code(400).send({ error: "invalid id" });
    }
    return { audioSets: listAudioSets(id) };
  });

  // 设为选用方案
  app.post("/api/audio-sets/:setId/select", async (req, reply) => {
    const setId = Number((req.params as any).setId);
    if (!Number.isInteger(setId)) {
      return reply.code(400).send({ error: "invalid setId" });
    }
    const ok = selectAudioSet(setId);
    if (!ok) return reply.code(404).send({ error: "配音方案不存在" });
    return { ok: true };
  });

  // 显式续跑指定方案（仅当该方案非 generating）
  app.post("/api/audio-sets/:setId/resume", async (req, reply) => {
    const setId = Number((req.params as any).setId);
    if (!Number.isInteger(setId)) {
      return reply.code(400).send({ error: "invalid setId" });
    }
    const set = getAudioSet(setId);
    if (!set) return reply.code(404).send({ error: "配音方案不存在" });
    if (set.status === "generating") {
      return reply.code(409).send({ error: "该方案正在生成中" });
    }
    const langs = (JSON.parse(set.config_json || "{}").langs as Lang[]) || ["zh", "en"];
    db.prepare(`UPDATE audio_sets SET status='generating', updated_at=? WHERE id=?`).run(
      new Date().toISOString(),
      setId
    );
    const taskId = createTask(set.story_id, null, null, "tts", {
      audioSetId: setId,
      langs,
      regenerate: false,
    } as any);
    void runTask(taskId);
    return reply.code(201).send({ taskId, audioSetId: setId });
  });

  // 删除未选用方案（选用中的方案不可删）
  app.delete("/api/audio-sets/:setId", async (req, reply) => {
    const setId = Number((req.params as any).setId);
    if (!Number.isInteger(setId)) {
      return reply.code(400).send({ error: "invalid setId" });
    }
    const set = getAudioSet(setId);
    if (!set) return reply.code(404).send({ error: "配音方案不存在" });
    if (set.is_selected) {
      return reply.code(409).send({ error: "当前选用方案不可删除，请先选用其它方案" });
    }
    db.prepare(`DELETE FROM page_audio WHERE audio_set_id=?`).run(setId);
    db.prepare(`DELETE FROM audio_sets WHERE id=?`).run(setId);
    // S18：DB 删除成功后同步删盘，避免孤儿 mp3（失败只记日志，不影响主流程）
    try {
      const dir = path.join(
        DATA_DIR,
        "assets",
        String(set.story_id),
        "audio_sets",
        String(setId)
      );
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    } catch (e) {
      console.error("删除配音方案音频文件失败:", e);
    }
    return { ok: true };
  });

  // 阅读器用：当前（或指定）选用方案的逐页分段音频
  app.get("/api/stories/:id/book-audio", async (req, reply) => {
    const id = Number((req.params as any).id);
    if (!Number.isInteger(id)) {
      return reply.code(400).send({ error: "invalid id" });
    }
    const q = (req.query as any) || {};
    const setId = q.setId ? Number(q.setId) : getSelectedAudioSetId(id);
    if (!setId) return { audioSetId: null, pages: [] };
    const data = getBookAudio(id, setId);
    return data;
  });
}
