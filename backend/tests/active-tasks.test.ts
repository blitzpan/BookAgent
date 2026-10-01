import { describe, it, expect, beforeAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { initDb, db } from "../src/db/sqlite";

// S11 回归：详情页挂载时通过一次拉取恢复所有进行中任务，避免刷新即丢失状态
describe("活跃任务端点 /tasks/active", () => {
  let app: FastifyInstance;
  let storyId = 0;

  beforeAll(async () => {
    app = await buildApp();
    await initDb();
    await app.ready();
    const c = await app.inject({
      method: "POST",
      url: "/api/stories",
      payload: { original_text: "猫追着蝴蝶跑过花园。", target_page_count: 2 },
    });
    storyId = c.json().id as number;
  });

  it("返回该故事进行中的任务并解析 progress", async () => {
    db.prepare(
      `INSERT INTO generation_tasks (story_id, run_id, kind, status, progress)
       VALUES (?, ?, 'full', 'running', ?)`
    ).run(storyId, null, JSON.stringify({ total: 2, done: 1, failed: 0 }));

    const res = await app.inject({
      method: "GET",
      url: `/api/stories/${storyId}/tasks/active`,
    });
    expect(res.statusCode).toBe(200);
    const tasks = res.json().tasks as Array<{ kind: string; status: string; progress: any }>;
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks[0].progress).toEqual({ total: 2, done: 1, failed: 0 });
  });

  it("不返回已完成的任务", async () => {
    db.prepare(
      `INSERT INTO generation_tasks (story_id, run_id, kind, status)
       VALUES (?, ?, 'tts', 'completed')`
    ).run(storyId, null);

    const res = await app.inject({
      method: "GET",
      url: `/api/stories/${storyId}/tasks/active`,
    });
    const tasks = res.json().tasks as Array<{ status: string }>;
    expect(tasks.every((t) => t.status !== "completed")).toBe(true);
  });
});
