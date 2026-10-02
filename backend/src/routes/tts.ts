import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";
import { EdgeTTS } from "edge-tts-universal";
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
import {
  ensureCasting,
  getSpeakerVoices,
  resolveAudioSetConfig,
  saveSpeakerVoices,
  type CastSlot,
} from "../services/voiceCastingService";
import { getVoicePool } from "../services/voicePoolService";

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

    // 并发防重：本故事已有 generating 的方案 → 拒绝（先判重，避免无谓地跑一次 AI 选角）
    if (hasGeneratingAudioSet(id)) {
      return reply
        .code(409)
        .send({ error: "该故事已有进行中的配音任务，请稍候或刷新查看进度" });
    }

    // 首次生成（或尚无配置）时自动跑一次 AI 选角；失败静默降级到兜底音色，不阻断配音。
    try {
      await ensureCasting(id);
    } catch (e: any) {
      console.error(`[tts] story=${id} 自动选角失败，使用兜底音色:`, e?.message || e);
    }
    const config: AudioSetConfig = {
      ...(body.config || {}),
      ...resolveAudioSetConfig(id),
      langs,
    };

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

  // 可用音色列表（角色音色下拉用）
  app.get("/api/tts/voices", async () => {
    return { pool: getVoicePool() };
  });

  // 音色试听：用指定音色合成一句示例，返回可播放的音频地址。
  // 结果按音色缓存到 assets/_voice_preview/{voiceId}_{lang}.mp3，重复试听不重复联网。
  app.post("/api/tts/preview", async (req, reply) => {
    const body = (req.body || {}) as { voice?: string; text?: string; lang?: Lang };
    const voice = String(body.voice || "").trim();
    if (!voice || !getVoicePool().some((v) => v.id === voice)) {
      return reply.code(400).send({ error: "未知音色" });
    }
    const lang: Lang = body.lang === "en" ? "en" : "zh";
    const text =
      String(body.text || "").trim() ||
      (lang === "zh"
        ? "今天天气真好，我们一起去看那片会发光的森林吧。"
        : "What a lovely day. Let's go and see the glowing forest together.");

    const relPath = path
      .join("assets", "_voice_preview", `${voice}_${lang}.mp3`)
      .split(path.sep)
      .join("/");
    const absPath = path.join(DATA_DIR, relPath);

    if (!fs.existsSync(absPath)) {
      try {
        const tts = new EdgeTTS(text, voice, { rate: "+0%", volume: "+0%", pitch: "+0Hz" });
        const result = await tts.synthesize();
        const buf = Buffer.from(await result.audio.arrayBuffer());
        if (!buf.length) throw new Error("合成结果为空（可能被限流或网络不可达）");
        fs.mkdirSync(path.dirname(absPath), { recursive: true });
        fs.writeFileSync(absPath, buf);
      } catch (e: any) {
        console.error(`[tts] 试听音色 ${voice} 失败:`, e?.message || e);
        return reply.code(500).send({ error: `试听失败：${e?.message || e}` });
      }
    }
    return { url: `/assets/${relPath.replace(/^assets\//, "")}` };
  });

  // 读取故事的角色音色配置（含旁白/兜底两行）
  app.get("/api/stories/:id/speaker-voices", async (req, reply) => {
    const id = Number((req.params as any).id);
    if (!Number.isInteger(id)) {
      return reply.code(400).send({ error: "invalid id" });
    }
    return { items: getSpeakerVoices(id), pool: getVoicePool() };
  });

  // 保存手工选择的角色音色
  app.put("/api/stories/:id/speaker-voices", async (req, reply) => {
    const id = Number((req.params as any).id);
    if (!Number.isInteger(id)) {
      return reply.code(400).send({ error: "invalid id" });
    }
    if (!getStoryRaw(id)) return reply.code(404).send({ error: "故事不存在" });
    const body = (req.body || {}) as {
      items?: Array<{ slot: CastSlot; speaker?: string; voiceZh?: string | null; voiceEn?: string | null }>;
    };
    if (!Array.isArray(body.items) || !body.items.length) {
      return reply.code(400).send({ error: "items 不能为空" });
    }
    return { items: saveSpeakerVoices(id, body.items), pool: getVoicePool() };
  });

  // 重新 AI 推荐（覆盖已有角色音色；手工设置过的旁白/兜底行保留）
  app.post("/api/stories/:id/speaker-voices/recommend", async (req, reply) => {
    const id = Number((req.params as any).id);
    if (!Number.isInteger(id)) {
      return reply.code(400).send({ error: "invalid id" });
    }
    if (!getStoryRaw(id)) return reply.code(404).send({ error: "故事不存在" });
    try {
      const items = await ensureCasting(id, { force: true });
      return { items, pool: getVoicePool() };
    } catch (e: any) {
      console.error(`[tts] story=${id} 重新推荐音色失败:`, e?.message || e);
      return reply.code(500).send({ error: `AI 推荐音色失败：${e?.message || e}` });
    }
  });
}
