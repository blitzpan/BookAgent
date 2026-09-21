import { describe, it, expect, beforeAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { initDb } from "../src/db/sqlite";
import { getImageBackend } from "../src/providers";

// 场景 1：自动生成绘本（整书自动流水线）
describe("自动生成绘本（整书流水线）", () => {
  let app: FastifyInstance;
  let storyId = 0;
  let runId = 0;

  beforeAll(async () => {
    app = await buildApp();
    await initDb();
    await app.ready();
  });

  async function pollRun(id: number) {
    for (let i = 0; i < 200; i++) {
      const res = await app.inject({ method: "GET", url: `/api/runs/${id}` });
      const body = res.json();
      if (["completed", "partial_failed", "failed"].includes(body.run.status)) {
        return body;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error("run 超时未完成");
  }

  it("走 mock provider（金钱安全冗余校验）", () => {
    expect(getImageBackend().id).toBe("mock");
  });

  it("建故事（新建态）", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/stories",
      payload: { original_text: "一只小熊的奇妙一天。", target_page_count: 4 },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toBeGreaterThan(0);
    storyId = body.id;
  });

  it("改写（同步，返回分页长度 4）", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/stories/${storyId}/rewrite`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.pageCount).toBe(4);
  });

  it("生成整书并轮询完成", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/stories/${storyId}/generate`,
    });
    expect(res.statusCode).toBe(201);
    runId = res.json().runId;
    const detail = await pollRun(runId);
    expect(["completed", "partial_failed"]).toContain(detail.run.status);
  });

  it("每页都有默认图且 image_path 合法", async () => {
    const res = await app.inject({ method: "GET", url: `/api/runs/${runId}` });
    const detail = res.json();
    expect(detail.pages.length).toBe(4);
    for (const pd of detail.pages) {
      expect(pd.default_image).not.toBeNull();
      expect(pd.default_image.image_path.startsWith("assets/")).toBe(true);
    }
  });

  it("角色锚图已落库（sheet_image_path 非空）", async () => {
    const res = await app.inject({ method: "GET", url: `/api/runs/${runId}` });
    const detail = res.json();
    expect(detail.characters.length).toBeGreaterThan(0);
    expect(detail.characters[0].sheet_image_path).toBeTruthy();
  });

  it("序列一致性评分已记录（sequence_checks ≥ 1）", async () => {
    const res = await app.inject({ method: "GET", url: `/api/runs/${runId}` });
    const detail = res.json();
    expect(detail.sequence_checks.length).toBeGreaterThan(0);
  });

  it("发布为「审批通过的作品」", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/stories/${storyId}/publish`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("审批通过的作品");
  });

  it("已发布书架可查到该书", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/stories?status=审批通过的作品",
    });
    const ids = res.json().stories.map((s: any) => s.id);
    expect(ids).toContain(storyId);
  });
});
