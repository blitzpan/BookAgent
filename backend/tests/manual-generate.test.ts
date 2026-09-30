import { describe, it, expect, beforeAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { initDb } from "../src/db/sqlite";

// 场景 2：手动生成绘本（单页补画）
// 新语义：补画是「执行任务」，不产生新的 run（版本），只给当前版本追加候选图。
describe("手动生成绘本（单页补画）", () => {
  let app: FastifyInstance;
  let storyId = 0;
  let fullRunId = 0;
  let pageId = 0;
  let candidateCountBefore = 0;

  beforeAll(async () => {
    app = await buildApp();
    await initDb();
    await app.ready();

    const c = await app.inject({
      method: "POST",
      url: "/api/stories",
      payload: { original_text: "海边的一天。", target_page_count: 4 },
    });
    storyId = c.json().id;

    await app.inject({ method: "POST", url: `/api/stories/${storyId}/rewrite` });

    const g = await app.inject({
      method: "POST",
      url: `/api/stories/${storyId}/generate`,
    });
    fullRunId = g.json().runId;
    await pollTask(g.json().taskId);

    const detail = await app.inject({ method: "GET", url: `/api/stories/${storyId}` });
    pageId = detail.json().pages[0].id;

    const runDetail = await app.inject({ method: "GET", url: `/api/runs/${fullRunId}` });
    const pd = runDetail.json().pages.find((p: any) => p.page.id === pageId);
    candidateCountBefore = pd.candidates.length;
  });

  async function pollTask(id: number) {
    for (let i = 0; i < 200; i++) {
      const res = await app.inject({ method: "GET", url: `/api/tasks/${id}` });
      const body = res.json();
      if (["completed", "failed"].includes(body.task.status)) return body;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error("task 超时未完成");
  }

  it("补画只建任务、不建新版本", async () => {
    const before = await app.inject({
      method: "GET",
      url: `/api/stories/${storyId}/runs`,
    });
    expect(before.json().runs.length).toBe(1);

    const res = await app.inject({
      method: "POST",
      url: `/api/pages/${pageId}/images`,
    });
    expect(res.statusCode).toBe(201);
    const { taskId } = res.json();
    expect(taskId).toBeGreaterThan(0);

    const task = await pollTask(taskId);
    expect(task.task.status).toBe("completed");

    const after = await app.inject({
      method: "GET",
      url: `/api/stories/${storyId}/runs`,
    });
    expect(after.json().runs.length).toBe(1); // 补画不产生新版本
  });

  it("补画给当前版本追加候选图，且不翻默认图", async () => {
    const res = await app.inject({ method: "GET", url: `/api/runs/${fullRunId}` });
    const pd = res.json().pages.find((p: any) => p.page.id === pageId);
    expect(pd.candidates.length).toBeGreaterThan(candidateCountBefore);
    expect(pd.default_image).not.toBeNull();
    expect(pd.default_image.image_path.startsWith("assets/")).toBe(true);
  });
});
