import { describe, it, expect, beforeAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { initDb, BACKEND_DIR } from "../src/db/sqlite";

// S1 回归：page_audio 曾因 schema.sql 里的 DROP TABLE 被每次进程启动清空
// （audio_sets 仍显示"已配音"但进度归零，且重跑会重复付费合成）。
// 本文件守住两点：① schema 不得再出现无条件 DROP；② 重启进程后配音数据完好。

process.env.TTS_MOCK = "1"; // 离线静音 MP3，避免真实 TTS 调用

describe("page_audio 持久化（重启不丢配音）", () => {
  let app: FastifyInstance;
  let storyId = 0;
  let setId = 0;
  let beforeRestart = { done: 0, total: 0 };
  let urlsBefore: string[] = [];

  async function pollTask(id: number, get: (tid: number) => Promise<any>) {
    for (let i = 0; i < 500; i++) {
      const body = await get(id);
      if (["completed", "failed"].includes(body.task.status)) return body;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`task ${id} 超时未完成`);
  }

  beforeAll(async () => {
    app = await buildApp();
    await initDb();
    await app.ready();

    const c = await app.inject({
      method: "POST",
      url: "/api/stories",
      payload: { original_text: "小螃蟹在海边捡到一颗星星。", target_page_count: 3 },
    });
    storyId = c.json().id;
    await app.inject({ method: "POST", url: `/api/stories/${storyId}/rewrite` });

    const g = await app.inject({ method: "POST", url: `/api/stories/${storyId}/generate` });
    await pollTask(g.json().taskId, async (id) =>
      (await app.inject({ method: "GET", url: `/api/tasks/${id}` })).json()
    );

    const t = await app.inject({
      method: "POST",
      url: `/api/stories/${storyId}/tts`,
      payload: { forceNew: true },
    });
    expect(t.statusCode).toBe(201);
    setId = t.json().audioSetId;
    await pollTask(t.json().taskId, async (id) =>
      (await app.inject({ method: "GET", url: `/api/tasks/${id}` })).json()
    );

    const sets = (await app.inject({ method: "GET", url: `/api/stories/${storyId}/audio-sets` }))
      .json().audioSets;
    const mine = sets.find((s: any) => s.id === setId);
    beforeRestart = { done: mine.done, total: mine.total };
    expect(beforeRestart.total).toBeGreaterThan(0);

    const book = (
      await app.inject({ method: "GET", url: `/api/stories/${storyId}/book-audio?setId=${setId}` })
    ).json();
    urlsBefore = book.pages.flatMap((p: any) =>
      p.segments.flatMap((s: any) => [s.audioUrls?.zh, s.audioUrls?.en].filter(Boolean))
    );
    expect(urlsBefore.length).toBeGreaterThan(0);
  });

  it("schema.sql 不得包含会清空业务数据的 DROP TABLE", () => {
    const schema = fs.readFileSync(path.join(BACKEND_DIR, "src/db/schema.sql"), "utf-8");
    const drops = schema
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => /^DROP TABLE/i.test(l));
    expect(drops).toEqual([]);
  });

  it("重启进程后配音进度与音频 URL 均保持不变", async () => {
    // 模拟重启：必须清空模块缓存，否则 import 会命中同一实例、initDb 的
    // initialized 短路会让"重启"变成空操作（那这条测试就永远绿，失去守护价值）。
    vi.resetModules();
    const { initDb: initDb2 } = await import("../src/db/sqlite");
    const { buildApp: buildApp2 } = await import("../src/app");
    await initDb2();
    const app2 = await buildApp2();
    await app2.ready();

    const sets = (await app2.inject({ method: "GET", url: `/api/stories/${storyId}/audio-sets` }))
      .json().audioSets;
    const mine = sets.find((s: any) => s.id === setId);
    expect(mine).toBeTruthy();
    expect(mine.done).toBe(beforeRestart.done);
    expect(mine.total).toBe(beforeRestart.total);
    expect(mine.done).toBe(mine.total);

    const book = (
      await app2.inject({ method: "GET", url: `/api/stories/${storyId}/book-audio?setId=${setId}` })
    ).json();
    const urlsAfter = book.pages.flatMap((p: any) =>
      p.segments.flatMap((s: any) => [s.audioUrls?.zh, s.audioUrls?.en].filter(Boolean))
    );
    expect(urlsAfter.length).toBe(urlsBefore.length);
    expect(urlsAfter.sort()).toEqual(urlsBefore.sort());

    await app2.close();
  });
});
