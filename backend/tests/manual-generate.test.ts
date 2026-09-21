import { describe, it, expect, beforeAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { initDb } from "../src/db/sqlite";

// 场景 2：手动生成绘本（单页补画，scope=single_page，仅追加候选、不翻默认）
describe("手动生成绘本（单页补画）", () => {
  let app: FastifyInstance;
  let storyId = 0;
  let fullRunId = 0;
  let pageId = 0;

  beforeAll(async () => {
    app = await buildApp();
    await initDb();
    await app.ready();

    // 先产出一本整书（复用自动生成链路）
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

    for (let i = 0; i < 200; i++) {
      const r = await app.inject({ method: "GET", url: `/api/runs/${fullRunId}` });
      if (["completed", "partial_failed", "failed"].includes(r.json().run.status)) break;
      await new Promise((res) => setTimeout(res, 20));
    }

    const detail = await app.inject({ method: "GET", url: `/api/stories/${storyId}` });
    pageId = detail.json().pages[0].id;
  });

  async function pollRun(id: number) {
    for (let i = 0; i < 200; i++) {
      const res = await app.inject({ method: "GET", url: `/api/runs/${id}` });
      const body = res.json();
      if (["completed", "partial_failed", "failed"].includes(body.run.status)) return body;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error("run 超时未完成");
  }

  it("对指定页补画（单页 run）", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/pages/${pageId}/images`,
    });
    expect(res.statusCode).toBe(201);
    const manualRunId = res.json().runId;

    const detail = await pollRun(manualRunId);
    expect(["completed", "partial_failed"]).toContain(detail.run.status);

    // 单页 run 详情里包含目标页，且其候选图 ≥ 1
    const pd = detail.pages.find((p: any) => p.page.id === pageId);
    expect(pd).toBeTruthy();
    expect(pd.candidates.length).toBeGreaterThanOrEqual(1);
  });

  it("单页补画不翻默认（默认图仍然存在）", async () => {
    // 回到整书 run 详情，确认该页默认图仍非空（补画只追加候选）
    const res = await app.inject({ method: "GET", url: `/api/runs/${fullRunId}` });
    const detail = res.json();
    const pd = detail.pages.find((p: any) => p.page.id === pageId);
    expect(pd.default_image).not.toBeNull();
    expect(pd.default_image.image_path.startsWith("assets/")).toBe(true);
  });
});
