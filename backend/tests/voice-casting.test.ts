// 角色音色（AI 选角）+ 音色池（AI 筛选）的行为测试。
//
// 关键：AI 调用点全部用 vi.mock 注入可控返回，专门验证「解析 / 校验 / 去重 / 兜底」这条
// 我们自己写的链路——真实大模型返回什么不可控，但这四步必须永远产出合法且互不冲突的音色。

import { describe, it, expect, beforeAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";

// ---- 可控的假 AI 后端（注入 src/providers） ----
const h = vi.hoisted(() => {
  const state: { calls: any[]; handler: (args: any) => any } = {
    calls: [],
    handler: () => ({}),
  };
  return state;
});

vi.mock("../src/providers", () => ({
  getTextBackend: () => ({
    id: "fake-text",
    label: "fake",
    maxRefs: 14,
    supportsVision: false,
    generateJSON: async (args: any) => {
      h.calls.push(args);
      return h.handler(args);
    },
    generateImage: async () => "data:image/png;base64,AA==",
  }),
  getImageBackend: () => ({ id: "fake-image" }) as any,
  getVisionBackend: () => ({ id: "fake-vision" }) as any,
  getProviderNames: () => ({ text: "fake-text", image: "fake-image", vision: "fake-vision" }),
}));

// ---- 可控的微软音色列表（注入 edge-tts-universal，避免真实网络） ----
const FAKE_MS_VOICES = [
  { ShortName: "zh-CN-XiaoxiaoNeural", Locale: "zh-CN", Gender: "Female", FriendlyName: "Xiaoxiao" },
  { ShortName: "zh-CN-YunxiNeural", Locale: "zh-CN", Gender: "Male", FriendlyName: "Yunxi" },
  { ShortName: "zh-CN-YunxiaNeural", Locale: "zh-CN", Gender: "Male", FriendlyName: "Yunxia" },
  { ShortName: "zh-CN-XiaoyiNeural", Locale: "zh-CN", Gender: "Female", FriendlyName: "Xiaoyi" },
  { ShortName: "zh-CN-YunyangNeural", Locale: "zh-CN", Gender: "Male", FriendlyName: "Yunyang" },
  { ShortName: "zh-CN-YunjianNeural", Locale: "zh-CN", Gender: "Male", FriendlyName: "Yunjian" },
  { ShortName: "zh-CN-liaoning-XiaobeiNeural", Locale: "zh-CN-liaoning", Gender: "Female", FriendlyName: "Xiaobei" },
  { ShortName: "zh-HK-WanLungNeural", Locale: "zh-HK", Gender: "Male", FriendlyName: "WanLung" },
  { ShortName: "en-US-AriaNeural", Locale: "en-US", Gender: "Female", FriendlyName: "Aria" },
  { ShortName: "en-US-GuyNeural", Locale: "en-US", Gender: "Male", FriendlyName: "Guy" },
];

vi.mock("edge-tts-universal", async (importOriginal) => {
  const orig = await importOriginal<any>();
  return { ...orig, listVoices: async () => FAKE_MS_VOICES };
});

process.env.TTS_MOCK = "1"; // HTTP 用例里合成静音占位，不联网

import { db, initDb } from "../src/db/sqlite";
import { BUILTIN_VOICE_POOL } from "../src/constants/voices";
import { createStory } from "../src/services/storyService";
import {
  ensureCasting,
  getSpeakerVoices,
  saveSpeakerVoices,
  resolveAudioSetConfig,
} from "../src/services/voiceCastingService";
import {
  refreshVoicePool,
  getVoicePool,
  getVoicePoolStats,
} from "../src/services/voicePoolService";

const ZH_IDS = BUILTIN_VOICE_POOL.filter((v) => v.category !== "english").map((v) => v.id);
const ALL_IDS = BUILTIN_VOICE_POOL.map((v) => v.id);

/** 造一个有若干对话角色的故事（角色名 → 台词条数）。 */
function makeStory(speakers: Array<[string, number]>): number {
  const story = createStory({ original_text: "小兔子和小松鼠在森林里冒险。", user_title: "voice-test" });
  const storyId = story.id;
  db.prepare(`INSERT INTO pages (story_id, page_number, text_zh, text_en) VALUES (?, 1, 'x', 'x')`).run(storyId);
  const pageId = (db.prepare(`SELECT id FROM pages WHERE story_id = ?`).get(storyId) as { id: number }).id;

  const addSeg = (...a: any[]) =>
    db
      .prepare(
        `INSERT INTO page_segments (page_id, story_id, seq, role, speaker, speaker_en, text_zh, text_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(...a);

  let seq = 1;
  addSeg(pageId, storyId, seq++, "narration", null, null, "旁白", "narration");
  for (const [name, count] of speakers) {
    for (let i = 0; i < count; i++) {
      addSeg(pageId, storyId, seq++, "dialogue", name, name, `${name}的第${i + 1}句`, `line ${i + 1}`);
    }
  }
  return storyId;
}

/** 假 AI：按 speaker 顺序给 voiceId（可重复、可非法，用于验证校验逻辑）。 */
function castingReply(list: Array<{ speaker: string; voiceId: string; alternates?: string[] }>) {
  return {
    casting: list,
    narrationVoiceId: "zh-CN-XiaoxiaoNeural",
    fallbackVoiceId: "zh-CN-YunxiNeural",
  };
}

describe("角色音色：AI 选角", () => {
  beforeAll(async () => {
    await initDb();
  });

  it("AI 返回互不重复的合法音色 → 每个角色音色不同且都在池内", async () => {
    const storyId = makeStory([
      ["小兔子", 3],
      ["小松鼠", 2],
      ["猫头鹰", 2],
    ]);
    h.handler = () =>
      castingReply([
        { speaker: "小兔子", voiceId: "zh-CN-XiaoxiaoNeural", alternates: ["zh-CN-XiaoyiNeural"] },
        { speaker: "小松鼠", voiceId: "zh-CN-YunxiNeural" },
        { speaker: "猫头鹰", voiceId: "zh-CN-YunyangNeural" },
      ]);

    const rows = await ensureCasting(storyId, { force: true });
    const chars = rows.filter((r) => r.slot === "character");
    const voices = chars.map((c) => c.voiceZh);

    expect(chars.map((c) => c.speaker).sort()).toEqual(["小兔子", "小松鼠", "猫头鹰"].sort());
    expect(new Set(voices).size).toBe(voices.length); // 互不重复
    for (const v of voices) expect(ZH_IDS).toContain(v); // 都在池内
    for (const c of chars) expect(ALL_IDS).toContain(c.voiceEn); // 英文音色也已映射
  });

  it("AI 给多个角色返回同一个音色 → 自动去重后仍然互不相同", async () => {
    const storyId = makeStory([
      ["小兔子", 3],
      ["小松鼠", 2],
    ]);
    h.handler = () =>
      castingReply([
        { speaker: "小兔子", voiceId: "zh-CN-YunxiNeural" },
        { speaker: "小松鼠", voiceId: "zh-CN-YunxiNeural" }, // 故意撞车
      ]);

    const chars = (await ensureCasting(storyId, { force: true })).filter((r) => r.slot === "character");
    const voices = chars.map((c) => c.voiceZh);
    expect(new Set(voices).size).toBe(voices.length);
    for (const v of voices) expect(ZH_IDS).toContain(v);
  });

  it("AI 返回不存在的音色 → 非法值丢弃，改用池内音色，不产生野音色", async () => {
    const storyId = makeStory([["小兔子", 3]]);
    h.handler = () =>
      castingReply([
        { speaker: "小兔子", voiceId: "zh-CN-NotExistNeural" }, // 幻觉 id
      ]);

    const chars = (await ensureCasting(storyId, { force: true })).filter((r) => r.slot === "character");
    expect(chars[0].voiceZh).toBeTruthy();
    expect(ZH_IDS).toContain(chars[0].voiceZh);
  });

  it("AI 抛错 / 返回空 → 落到确定性兜底，音色合法且仍能生成", async () => {
    const storyId = makeStory([
      ["小兔子", 3],
      ["小松鼠", 2],
      ["狐狸", 2],
    ]);
    h.handler = () => {
      throw new Error("AI 挂了");
    };

    const rows = await ensureCasting(storyId, { force: true });
    const chars = rows.filter((r) => r.slot === "character");
    expect(chars.length).toBe(3);
    const voices = chars.map((c) => c.voiceZh!);
    expect(new Set(voices).size).toBe(voices.length);
    for (const v of voices) expect(ZH_IDS).toContain(v);
    expect(chars.every((c) => c.source === "fallback")).toBe(true);
  });

  it("台词太少的角色不分配专属音色（走兜底），也不写进 voicesBySpeaker", async () => {
    const storyId = makeStory([
      ["小兔子", 5],
      ["路人甲", 1], // 只有 1 句 → 不够门槛
    ]);
    h.handler = () => castingReply([{ speaker: "小兔子", voiceId: "zh-CN-XiaoxiaoNeural" }]);

    await ensureCasting(storyId, { force: true });
    const rows = getSpeakerVoices(storyId);
    const lu = rows.find((r) => r.speaker === "路人甲");
    expect(lu).toBeTruthy();
    expect(lu!.voiceZh).toBeNull(); // 未分配专属音色

    const cfg = resolveAudioSetConfig(storyId);
    expect(Object.keys(cfg.voicesBySpeaker ?? {})).toEqual(["小兔子"]);
    expect(cfg.voices?.dialogue?.zh).toBeTruthy();
  });

  it("角色名带首尾空格时音色仍生效（page_segments.speaker 落库未 trim）", async () => {
    const storyId = makeStory([["小兔子", 3]]);
    // 追加一条带尾随空格的同名台词，模拟 AI 输出不干净
    const pageId = (db.prepare(`SELECT id FROM pages WHERE story_id = ?`).get(storyId) as { id: number }).id;
    db.prepare(
      `INSERT INTO page_segments (page_id, story_id, seq, role, speaker, speaker_en, text_zh, text_en)
       VALUES (?, ?, 99, 'dialogue', '小兔子 ', 'Little Rabbit', '带空格的一句', 'spaced')`
    ).run(pageId, storyId);

    h.handler = () => castingReply([{ speaker: "小兔子", voiceId: "zh-CN-YunyangNeural" }]);
    await ensureCasting(storyId, { force: true });

    const cfg = resolveAudioSetConfig(storyId);
    expect(cfg.voicesBySpeaker?.["小兔子"]?.zh).toBe("zh-CN-YunyangNeural");
    expect(cfg.voicesBySpeaker?.["小兔子 "]?.zh).toBe("zh-CN-YunyangNeural"); // 原始拼写也能命中
  });

  it("手工保存生效；传 null 可清空回兜底", async () => {
    const storyId = makeStory([
      ["小兔子", 3],
      ["小松鼠", 2],
    ]);
    h.handler = () =>
      castingReply([
        { speaker: "小兔子", voiceId: "zh-CN-XiaoxiaoNeural" },
        { speaker: "小松鼠", voiceId: "zh-CN-YunxiNeural" },
      ]);
    await ensureCasting(storyId, { force: true });

    // 手工改小松鼠
    saveSpeakerVoices(storyId, [
      { slot: "character", speaker: "小松鼠", voiceZh: "zh-CN-YunyangNeural", voiceEn: "en-US-ChristopherNeural" },
    ]);
    let cfg = resolveAudioSetConfig(storyId);
    expect(cfg.voicesBySpeaker?.["小松鼠"]?.zh).toBe("zh-CN-YunyangNeural");
    expect(cfg.voicesBySpeaker?.["小松鼠"]?.en).toBe("en-US-ChristopherNeural");
    expect(cfg.voicesBySpeaker?.["小兔子"]?.zh).toBe("zh-CN-XiaoxiaoNeural"); // 别的角色不受影响

    // 清空 → 回兜底
    saveSpeakerVoices(storyId, [
      { slot: "character", speaker: "小松鼠", voiceZh: null, voiceEn: null },
    ]);
    cfg = resolveAudioSetConfig(storyId);
    expect(cfg.voicesBySpeaker?.["小松鼠"]).toBeUndefined();
    expect(cfg.voices?.dialogue?.zh).toBeTruthy();
  });
});

describe("音色池：AI 筛选", () => {
  beforeAll(async () => {
    await initDb();
  });

  it("刷新后落库并统计；AI 编造的 id 被丢弃", async () => {
    h.handler = (args: any) => {
      // 音色池筛选请求：schema 顶层含 mandarin
      const props = Object.keys((args.schema as any)?.properties ?? {});
      if (props.includes("mandarin")) {
        return {
          mandarin: [
            { id: "zh-CN-XiaoxiaoNeural", label: "晓晓", tags: ["温柔"] },
            { id: "zh-CN-YunxiNeural", label: "云希", tags: ["温暖"] },
            { id: "zh-CN-HallucinatedNeural", label: "不存在", tags: [] }, // 应被丢弃
          ],
          dialect: [{ id: "zh-CN-liaoning-XiaobeiNeural", label: "晓北", tags: ["东北"] }],
          english: [
            { id: "en-US-AriaNeural", label: "Aria", tags: ["温和"] },
            { id: "en-US-GuyNeural", label: "Guy", tags: ["温暖"], child: false },
          ],
        };
      }
      return {};
    };

    const stats = await refreshVoicePool();
    expect(stats.mandarin).toBe(2); // 幻觉 id 被剔除
    expect(stats.dialect).toBe(1);
    expect(stats.english).toBe(2);
    expect(stats.total).toBe(5);
    expect(stats.source).toBe("ai");

    const pool = getVoicePool();
    expect(pool.map((v) => v.id).sort()).toEqual(
      [
        "zh-CN-XiaoxiaoNeural",
        "zh-CN-YunxiNeural",
        "zh-CN-liaoning-XiaobeiNeural",
        "en-US-AriaNeural",
        "en-US-GuyNeural",
      ].sort()
    );
    // 性别/语种以微软真实字段为准，不被 AI 影响
    expect(pool.find((v) => v.id === "zh-CN-YunxiNeural")?.gender).toBe("male");
    expect(pool.find((v) => v.id === "en-US-AriaNeural")?.category).toBe("english");
    expect(getVoicePoolStats().updatedAt).toBeTruthy();
  });

  it("AI 一个合法音色都没返回 → 报错且不动旧池", async () => {
    const before = getVoicePoolStats();
    h.handler = () => ({ mandarin: [{ id: "zh-CN-NopeNeural", label: "x" }] });
    await expect(refreshVoicePool()).rejects.toThrow();
    const after = getVoicePoolStats();
    expect(after.total).toBe(before.total);
    expect(after.updatedAt).toBe(before.updatedAt);
  });
});

describe("HTTP 回归：新建配音默认带上角色音色", () => {
  it("POST /api/stories/:id/tts 仍返回 201，且方案 config 含 AI 推荐的 voicesBySpeaker", async () => {
    const { buildApp } = await import("../src/app");
    const app: FastifyInstance = await buildApp();
    await app.ready();

    const storyId = makeStory([
      ["小兔子", 3],
      ["小松鼠", 2],
    ]);
    h.handler = () =>
      castingReply([
        { speaker: "小兔子", voiceId: "zh-CN-XiaoxiaoNeural" },
        { speaker: "小松鼠", voiceId: "zh-CN-YunxiNeural" },
      ]);

    const res = await app.inject({
      method: "POST",
      url: `/api/stories/${storyId}/tts`,
      payload: { forceNew: true },
    });
    expect(res.statusCode).toBe(201);
    const { audioSetId, taskId } = res.json();

    const row = db.prepare(`SELECT config_json FROM audio_sets WHERE id = ?`).get(audioSetId) as {
      config_json: string;
    };
    const cfg = JSON.parse(row.config_json);
    expect(cfg.voicesBySpeaker?.["小兔子"]?.zh).toBe("zh-CN-XiaoxiaoNeural");
    expect(cfg.voicesBySpeaker?.["小松鼠"]?.zh).toBe("zh-CN-YunxiNeural");
    expect(cfg.voices?.narration?.zh).toBeTruthy();

    // 等后台任务收尾，避免悬挂
    for (let i = 0; i < 500; i++) {
      const t = (await app.inject({ method: "GET", url: `/api/tasks/${taskId}` })).json();
      if (["completed", "failed"].includes(t.task?.status)) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    await app.close();
  });
});
