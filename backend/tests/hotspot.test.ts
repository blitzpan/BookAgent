import { describe, it, expect, beforeAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { initDb } from "../src/db/sqlite";

// 图片热区：CRUD + 中心坐标夹紧 + AI 自动生成（mock 走回退网格）+ 保留人工微调
describe("图片热区 CRUD / AI 生成", () => {
  let app: FastifyInstance;
  let storyId = 0;

  beforeAll(async () => {
    app = await buildApp();
    await initDb();
    await app.ready();
    const c = await app.inject({
      method: "POST",
      url: "/api/stories",
      payload: { original_text: "海边的一天，小螃蟹找到了一颗星星。", target_page_count: 3 },
    });
    storyId = c.json().id;
    await app.inject({ method: "POST", url: `/api/stories/${storyId}/rewrite` });
    const g = await app.inject({ method: "POST", url: `/api/stories/${storyId}/generate` });
    await pollTask(g.json().taskId);
  });

  async function pollTask(id: number) {
    for (let i = 0; i < 400; i++) {
      const res = await app.inject({ method: "GET", url: `/api/tasks/${id}` });
      const body = res.json();
      if (["completed", "failed"].includes(body.task.status)) return body;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error("task 超时未完成");
  }

  const firstPageNumber = async (): Promise<number> => {
    const detail = await app.inject({ method: "GET", url: `/api/stories/${storyId}` });
    return detail.json().pages?.[0]?.page_number ?? 1;
  };

  const clearHotspots = async () => {
    const list = await app.inject({ method: "GET", url: `/api/stories/${storyId}/hotspots` });
    for (const h of list.json().hotspots) {
      await app.inject({ method: "DELETE", url: `/api/hotspots/${h.id}` });
    }
  };

  it("创建热区会把越界中心点裁剪到 [0,1]，且不存 w/h", async () => {
    const n = await firstPageNumber();
    const res = await app.inject({
      method: "POST",
      url: `/api/stories/${storyId}/pages/${n}/hotspots`,
      payload: { segment_seq: 1, x: 2, y: -1, kind: "audio", label: "测试\nTest" },
    });
    expect(res.statusCode).toBe(201);
    const h = res.json();
    expect(h.x).toBeCloseTo(1, 5);
    expect(h.y).toBeCloseTo(0, 5);
    expect(h.source).toBe("manual");
    // 尺寸不入库：由 label 渲染推导，库里不应存在任何 w/h 字段
    expect(h.w).toBeUndefined();
    expect(h.h).toBeUndefined();
  });

  it("列出 / 更新 / 删除 热区", async () => {
    const n = await firstPageNumber();
    const c = await app.inject({
      method: "POST",
      url: `/api/stories/${storyId}/pages/${n}/hotspots`,
      payload: { segment_seq: 1, x: 0.5, y: 0.5 },
    });
    const id = c.json().id;

    const list = await app.inject({ method: "GET", url: `/api/stories/${storyId}/hotspots` });
    expect(list.json().hotspots.some((h: any) => h.id === id)).toBe(true);

    const upd = await app.inject({
      method: "PATCH",
      url: `/api/hotspots/${id}`,
      payload: { x: 0.4, y: 0.4 },
    });
    expect(upd.json().x).toBeCloseTo(0.4, 5);

    const del = await app.inject({ method: "DELETE", url: `/api/hotspots/${id}` });
    expect(del.json().ok).toBe(true);

    const list2 = await app.inject({ method: "GET", url: `/api/stories/${storyId}/hotspots` });
    expect(list2.json().hotspots.some((h: any) => h.id === id)).toBe(false);
  });

  it("AI 生成热区是异步任务：返回 taskId，轮询完成后落库 source=ai", async () => {
    await clearHotspots();
    const res = await app.inject({
      method: "POST",
      url: `/api/stories/${storyId}/hotspots/auto-generate`,
    });
    expect(res.statusCode).toBe(201);
    const { taskId } = res.json();
    expect(taskId).toBeGreaterThan(0);

    const done = await pollTask(taskId);
    expect(done.task.status).toBe("completed");

    const list = await app.inject({ method: "GET", url: `/api/stories/${storyId}/hotspots` });
    const ai = list.json().hotspots;
    expect(ai.length).toBeGreaterThan(0);
    expect(ai.every((h: any) => h.source === "ai")).toBe(true);
    expect(ai.every((h: any) => h.segment_seq != null)).toBe(true);
    // 中心坐标在 [0,1]
    expect(ai.every((h: any) => h.x >= 0 && h.x <= 1 && h.y >= 0 && h.y <= 1)).toBe(true);
    // AI 生成的也不存 w/h（尺寸由 label 渲染推导）
    expect(ai.every((h: any) => h.w === undefined && h.h === undefined)).toBe(true);
  });

  it("重新 AI 生成只清 ai 热区、保留 manual", async () => {
    await clearHotspots();
    const n = await firstPageNumber();
    await app.inject({
      method: "POST",
      url: `/api/stories/${storyId}/pages/${n}/hotspots`,
      payload: { segment_seq: 1, x: 0.5, y: 0.5 },
    });
    const gen = await app.inject({
      method: "POST",
      url: `/api/stories/${storyId}/hotspots/auto-generate`,
    });
    await pollTask(gen.json().taskId);

    const list = await app.inject({ method: "GET", url: `/api/stories/${storyId}/hotspots` });
    const manual = list.json().hotspots.filter((h: any) => h.source === "manual");
    expect(manual.length).toBe(1);
  });

  it("批量保存：增/改/删一个事务完成；页码不存在返回 404", async () => {
    await clearHotspots();
    const n = await firstPageNumber();

    const bad = await app.inject({
      method: "POST",
      url: `/api/stories/${storyId}/pages/9999/hotspots/batch`,
      payload: { create: [{ x: 0.5, y: 0.5, label: "x" }] },
    });
    expect(bad.statusCode).toBe(404);

    const b1 = await app.inject({
      method: "POST",
      url: `/api/stories/${storyId}/pages/${n}/hotspots/batch`,
      payload: {
        create: [
          { segment_seq: 1, x: 0.2, y: 0.3, label: "甲" },
          { segment_seq: 2, x: 0.7, y: 0.6, label: "乙" },
        ],
      },
    });
    expect(b1.statusCode).toBe(200);
    expect(b1.json()).toEqual({ created: 2, updated: 0, deleted: 0 });

    const rows = (
      await app.inject({ method: "GET", url: `/api/stories/${storyId}/hotspots` })
    ).json().hotspots;
    expect(rows.length).toBe(2);

    const b2 = await app.inject({
      method: "POST",
      url: `/api/stories/${storyId}/pages/${n}/hotspots/batch`,
      payload: { update: [{ id: rows[0].id, x: 0.9 }], delete: [rows[1].id] },
    });
    expect(b2.json()).toEqual({ created: 0, updated: 1, deleted: 1 });

    const after = (
      await app.inject({ method: "GET", url: `/api/stories/${storyId}/hotspots` })
    ).json().hotspots;
    expect(after.length).toBe(1);
    expect(after[0].x).toBeCloseTo(0.9, 5);
  });

  it("可查询最近一次热区任务（刷新页面后恢复按钮状态）", async () => {
    await clearHotspots();
    const gen = await app.inject({
      method: "POST",
      url: `/api/stories/${storyId}/hotspots/auto-generate`,
    });
    await pollTask(gen.json().taskId);

    const res = await app.inject({
      method: "GET",
      url: `/api/stories/${storyId}/hotspots/task`,
    });
    expect(res.statusCode).toBe(200);
    const { task } = res.json();
    expect(task).not.toBeNull();
    expect(task.kind).toBe("hotspot");
    expect(task.status).toBe("completed");
  });
});
