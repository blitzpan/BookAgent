// 日志框架验证：覆盖改写 / 生图 / 配音 / 热区 四类关键功能，
// 断言按日期分文件落盘、且关键事件 / 质量指标均被记录。
// 依赖全局 setup.ts：mock provider + 独立临时数据目录。

// 配音走 edge-tts-universal，需 TTS_MOCK 离线合成静音占位，避免真实付费调用。
process.env.TTS_MOCK = "1";

import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { initDb } from "../src/db/sqlite";
import { logger, getLogPath, pruneLogDir } from "../src/logger";

interface LogLine {
  ts: string;
  level: string;
  category: string;
  event: string;
  [k: string]: unknown;
}

async function readTodayLogs(): Promise<LogLine[]> {
  await logger.flush();
  const p = getLogPath();
  if (!fs.existsSync(p)) return [];
  const text = fs.readFileSync(p, "utf-8");
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as LogLine);
}

describe("日志框架：关键功能点记录", () => {
  let app: FastifyInstance;
  let storyId = 0;

  beforeAll(async () => {
    app = await buildApp();
    await initDb();
    await app.ready();
  });

  it("建故事", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/stories",
      payload: {
        original_text: "一只小熊在森林里认识了新朋友，一起度过了奇妙的一天。",
        target_page_count: 4,
        style: "温馨可爱",
      },
    });
    expect(res.statusCode).toBe(201);
    storyId = res.json().id;
    expect(storyId).toBeGreaterThan(0);
  });

  it("改写：应记录 rewrite 流程日志（含 mode / pageCount / 耗时）", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/stories/${storyId}/rewrite`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().pageCount).toBe(4);

    const logs = await readTodayLogs();
    const success = logs.find((l) => l.category === "rewrite" && l.event === "success");
    expect(success, "缺少 rewrite.success 日志").toBeTruthy();
    expect(success!.pageCount).toBe(4);
    expect(typeof success!.duration_ms).toBe("number");
    expect(["good_polish", "rewrite"]).toContain(success!.mode);
    // 改写内部应触发 AI 文本调用
    expect(logs.some((l) => l.category === "ai.text" && l.event === "success")).toBe(true);
  });

  it("生图：应记录 ai.image 成功、每页每轮打分(image.attempt) 与 run 汇总", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/stories/${storyId}/generate`,
    });
    expect(res.statusCode).toBe(201);
    const runId = res.json().runId;

    for (let i = 0; i < 200; i++) {
      const r = await app.inject({ method: "GET", url: `/api/runs/${runId}` });
      const body = r.json();
      if (["completed", "partial_failed", "failed"].includes(body.run.status)) break;
      await new Promise((r) => setTimeout(r, 20));
    }

    const logs = await readTodayLogs();
    expect(
      logs.some((l) => l.category === "ai.image" && l.event === "success"),
      "缺少 ai.image.success 日志"
    ).toBe(true);

    const attempts = logs.filter((l) => l.category === "image" && l.event === "attempt");
    expect(attempts.length).toBeGreaterThan(0);
    // 质量指标：每轮都有身份分 / 帧分 / 综合分
    for (const a of attempts) {
      expect(typeof a.identityScore).toBe("number");
      expect(typeof a.frameScore).toBe("number");
      expect(typeof a.combinedScore).toBe("number");
    }

    const runDone = logs.find((l) => l.category === "run" && l.event === "full_success");
    expect(runDone, "缺少 run.full_success 日志").toBeTruthy();
    expect(runDone!.totalPages).toBe(4);
    expect(typeof runDone!.duration_ms).toBe("number");

    // 锚图生成或复用也应被记录
    expect(
      logs.some((l) => l.category === "anchor" && ["generated", "reused"].includes(l.event as string)),
      "缺少 anchor 日志"
    ).toBe(true);
  });

  it("配音：应记录 tts 分段合成与汇总（含成功/失败数与耗时）", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/stories/${storyId}/tts`,
      payload: { langs: ["zh", "en"] },
    });
    expect(res.statusCode).toBe(201);

    for (let i = 0; i < 200; i++) {
      const r = await app.inject({ method: "GET", url: `/api/stories/${storyId}/audio-sets` });
      const sets = r.json().audioSets as Array<{ status: string }>;
      if (sets.length && sets[0].status !== "generating") break;
      await new Promise((r) => setTimeout(r, 20));
    }

    const logs = await readTodayLogs();
    const synth = logs.filter((l) => l.category === "tts" && l.event === "synth_done");
    expect(synth.length).toBeGreaterThan(0);
    for (const s of synth) {
      expect(typeof s.synth_ms).toBe("number");
      expect(["zh", "en"]).toContain(s.lang);
    }
    const summary = logs.find((l) => l.category === "tts" && l.event === "summary");
    expect(summary, "缺少 tts.summary 日志").toBeTruthy();
    expect(summary!.total).toBeGreaterThan(0);
    expect(typeof summary!.duration_ms).toBe("number");
  });

  it("热区：应记录 hotspot 起始 / 汇总（含 placed / failed）", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/stories/${storyId}/hotspots/auto-generate`,
    });
    expect(res.statusCode).toBe(201);
    const taskId = res.json().taskId;

    for (let i = 0; i < 200; i++) {
      const r = await app.inject({ method: "GET", url: `/api/tasks/${taskId}` });
      const t = r.json().task;
      if (["completed", "failed"].includes(t.status)) break;
      await new Promise((r) => setTimeout(r, 20));
    }

    const logs = await readTodayLogs();
    const start = logs.find((l) => l.category === "hotspot" && l.event === "start");
    expect(start, "缺少 hotspot.start 日志").toBeTruthy();
    const summary = logs.find((l) => l.category === "hotspot" && l.event === "summary");
    expect(summary, "缺少 hotspot.summary 日志").toBeTruthy();
    expect(typeof summary!.placed).toBe("number");
    // 热区生成内部应触发 AI 视觉调用
    expect(
      logs.some((l) => l.category === "ai.vision" && l.event === "success"),
      "缺少 ai.vision 日志"
    ).toBe(true);
  });

  it("日志按日期分文件且保留期配置生效（默认最多 10 天）", async () => {
    await logger.flush();
    const p = getLogPath();
    expect(fs.existsSync(p), `日志文件应存在: ${p}`).toBe(true);
    expect(p).toMatch(/bookagent-\d{4}-\d{2}-\d{2}\.log$/);
  });

  it("pruneLogDir 只保留最近 maxDays 天的日志，过期自动清理", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "log-prune-"));
    try {
      // 造 13 个日期文件（含一个非日志文件干扰）
      const dates = [
        "2026-01-01",
        "2026-02-01",
        "2026-03-01",
        "2026-04-01",
        "2026-05-01",
        "2026-06-01",
        "2026-07-01",
        "2026-08-01",
        "2026-09-01",
        "2026-10-01",
        "2026-11-01",
        "2026-12-01",
        "2099-12-31",
      ];
      for (const d of dates) {
        fs.writeFileSync(path.join(dir, `bookagent-${d}.log`), "x");
      }
      fs.writeFileSync(path.join(dir, "not-a-log.txt"), "y");

      const removed = pruneLogDir(dir, 10);
      const remaining = fs
        .readdirSync(dir)
        .filter((f) => /^bookagent-\d{4}-\d{2}-\d{2}\.log$/.test(f))
        .sort();

      // 13 个日志文件 → 保留最近 10 个，删掉最旧 3 个（2026-01/02/03）
      expect(remaining.length).toBe(10);
      expect(removed.length).toBe(3);
      expect(removed).toEqual([
        "bookagent-2026-01-01.log",
        "bookagent-2026-02-01.log",
        "bookagent-2026-03-01.log",
      ]);
      expect(remaining[0]).toBe("bookagent-2026-04-01.log");
      expect(remaining[remaining.length - 1]).toBe("bookagent-2099-12-31.log");
      // 非日志文件不受干扰
      expect(fs.existsSync(path.join(dir, "not-a-log.txt"))).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
