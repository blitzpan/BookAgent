import { describe, it, expect, beforeAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { initDb } from "../src/db/sqlite";
import { db } from "../src/db/sqlite";

// 生图配置与生成闸门：
//   - 配置存在故事上（部分 merge + 范围校验）
//   - 完成后禁止再次整书生图
//   - 无版本时禁止补画
//   - 生图期间禁止改生成相关配置
describe("生图配置与生成闸门", () => {
  let app: FastifyInstance;
  let storyId = 0;

  beforeAll(async () => {
    app = await buildApp();
    await initDb();
    await app.ready();

    const c = await app.inject({
      method: "POST",
      url: "/api/stories",
      payload: { original_text: "山里的小狐狸。", target_page_count: 3 },
    });
    storyId = c.json().id;
  });

  it("新建故事即带默认生图配置", async () => {
    const res = await app.inject({ method: "GET", url: `/api/stories/${storyId}` });
    const cfg = res.json().story.generation_config;
    expect(cfg.frame_threshold).toBe(0.75);
    expect(cfg.max_frame_retry).toBe(3);
    expect(cfg.aspect_ratio).toBe("4:3");
  });

  it("配置部分更新：只覆盖传来的键，越界被截断", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/stories/${storyId}`,
      payload: { generation_config: { frame_threshold: 9, image_size: "1K" } },
    });
    expect(res.statusCode).toBe(200);
    const cfg = res.json().story.generation_config;
    expect(cfg.frame_threshold).toBe(1); // 越界截断到 1
    expect(cfg.image_size).toBe("1K");
    expect(cfg.max_frame_retry).toBe(3); // 未传的键保留原值
  });

  it("没有整书版本时禁止补画", async () => {
    await app.inject({ method: "POST", url: `/api/stories/${storyId}/rewrite` });
    const detail = await app.inject({ method: "GET", url: `/api/stories/${storyId}` });
    const pageId = detail.json().pages[0].id;
    const res = await app.inject({ method: "POST", url: `/api/pages/${pageId}/images` });
    expect(res.statusCode).toBe(409);
  });

  it("生图期间拒绝修改生成相关配置（标题仍可改）", async () => {
    db.prepare(`UPDATE stories SET status = '生图中' WHERE id = ?`).run(storyId);

    const blocked = await app.inject({
      method: "PATCH",
      url: `/api/stories/${storyId}`,
      payload: { generation_config: { frame_threshold: 0.5 }, style: "水墨风" },
    });
    expect(blocked.statusCode).toBe(409);

    const ok = await app.inject({
      method: "PATCH",
      url: `/api/stories/${storyId}`,
      payload: { user_title: "小狐狸" },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().story.user_title).toBe("小狐狸");

    db.prepare(`UPDATE stories SET status = '改写完成待生图' WHERE id = ?`).run(storyId);
  });

  it("整书生图完成后禁止再次生图", async () => {
    const g = await app.inject({
      method: "POST",
      url: `/api/stories/${storyId}/generate`,
    });
    expect(g.statusCode).toBe(201);
    const { taskId, runId } = g.json();
    expect(taskId).toBeGreaterThan(0);
    expect(runId).toBeGreaterThan(0);

    for (let i = 0; i < 200; i++) {
      const t = await app.inject({ method: "GET", url: `/api/tasks/${taskId}` });
      if (["completed", "failed"].includes(t.json().task.status)) break;
      await new Promise((r) => setTimeout(r, 20));
    }

    const again = await app.inject({
      method: "POST",
      url: `/api/stories/${storyId}/generate`,
    });
    expect(again.statusCode).toBe(409);

    const runs = await app.inject({
      method: "GET",
      url: `/api/stories/${storyId}/runs`,
    });
    expect(runs.json().runs.length).toBe(1); // 始终只有一个版本
  });
});
