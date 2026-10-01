import { describe, it, expect, beforeAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { initDb, db } from "../src/db/sqlite";
import { canTransitionStory } from "../src/constants/status";

// S2 回归：发布必须是最后一道人工闸门。
// 图与文本是硬门禁（缺则拒绝，阅读端会出现空白页）；配音与热区是软提示（允许纯图文绘本）。

describe("发布前的资产完整性闸门", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await initDb();
    await app.ready();
  });

  async function pollTask(id: number) {
    for (let i = 0; i < 500; i++) {
      const body = (
        await app.inject({ method: "GET", url: `/api/tasks/${id}` })
      ).json();
      if (["completed", "failed"].includes(body.task.status)) return body;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`task ${id} 超时未完成`);
  }

  /** 造一本生图完成的书（mock provider，无真实调用） */
  async function makeBook(): Promise<{ storyId: number; pageNumbers: number[] }> {
    const c = await app.inject({
      method: "POST",
      url: "/api/stories",
      payload: { original_text: "小狐狸种了一棵会发光的树。", target_page_count: 3 },
    });
    const storyId = c.json().id as number;
    await app.inject({ method: "POST", url: `/api/stories/${storyId}/rewrite` });
    const g = await app.inject({ method: "POST", url: `/api/stories/${storyId}/generate` });
    await pollTask(g.json().taskId);

    const detail = (await app.inject({ method: "GET", url: `/api/stories/${storyId}` })).json();
    expect(detail.story.status).toBe("生图完成待发布");
    return {
      storyId,
      pageNumbers: detail.pages.map((p: any) => p.page_number as number),
    };
  }

  it("完整的书可以发布", async () => {
    const { storyId } = await makeBook();
    const res = await app.inject({ method: "POST", url: `/api/stories/${storyId}/publish` });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("审批通过的作品");
  });

  it("缺插图的页被拒绝发布，并在 missing.images 中列出页码", async () => {
    const { storyId, pageNumbers } = await makeBook();
    const target = pageNumbers[0];

    // 删掉该页全部候选图，模拟"生图失败且未补齐"
    const pageRow = db
      .prepare(`SELECT id FROM pages WHERE story_id = ? AND page_number = ?`)
      .get(storyId, target) as { id: number };
    db.prepare(`DELETE FROM page_images WHERE page_id = ?`).run(pageRow.id);

    const res = await app.inject({ method: "POST", url: `/api/stories/${storyId}/publish` });
    expect(res.statusCode).toBe(409);
    expect(res.json().missing.images).toContain(target);
    expect(res.json().error).toContain("不可发布");

    // 被拒绝后状态不应改变
    const after = (await app.inject({ method: "GET", url: `/api/stories/${storyId}` })).json();
    expect(after.story.status).toBe("生图完成待发布");
  });

  it("缺中英文本的页被拒绝发布（空字符串按缺失处理）", async () => {
    const { storyId, pageNumbers } = await makeBook();
    const target = pageNumbers[0];
    db.prepare(`UPDATE pages SET text_zh = '' WHERE story_id = ? AND page_number = ?`).run(
      storyId,
      target
    );

    const res = await app.inject({ method: "POST", url: `/api/stories/${storyId}/publish` });
    expect(res.statusCode).toBe(409);
    expect(res.json().missing.texts).toContain(target);
  });

  it("无配音也可以发布（纯图文绘本），但 missing.audio 为 true", async () => {
    const { storyId } = await makeBook();
    const res = await app.inject({ method: "POST", url: `/api/stories/${storyId}/publish` });
    expect(res.statusCode).toBe(200);
    expect(res.json().missing.audio).toBe(true);
    expect(res.json().status).toBe("审批通过的作品");
  });

  it("缺热区不阻断发布，仅在 missing.hotspots 中提示", async () => {
    const { storyId, pageNumbers } = await makeBook();
    const res = await app.inject({ method: "POST", url: `/api/stories/${storyId}/publish` });
    expect(res.statusCode).toBe(200);
    expect(res.json().missing.hotspots.length).toBe(pageNumbers.length);
  });

  it("「生图部分失败」可补满晋级或带缺图发布", () => {
    // 补满缺图页 → 生图完成待发布；人工确认 → 审批通过的作品；整书重跑 → 生图中
    expect(canTransitionStory("生图部分失败", "生图完成待发布")).toBe(true);
    expect(canTransitionStory("生图部分失败", "审批通过的作品")).toBe(true);
    expect(canTransitionStory("生图部分失败", "生图中")).toBe(true);
  });
});
