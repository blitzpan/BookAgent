import { describe, it, expect, beforeAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { initDb } from "../src/db/sqlite";
import { getTextBackend } from "../src/providers";

// 场景：新建故事弹窗的「主题生成 + 多轮优化」草稿旁路。
// 覆盖：① 原输入流程不受影响 ② 复用改写的 TEXT 模型 ③ mock 可用且确定性。
// 注：页数归「改写」、画风归「生图」，故生成/优化接口与提示词都不再接收这两项。
describe("新建故事：主题生成 + 多轮优化（草稿旁路）", () => {
  let app: FastifyInstance;

  const cjkLen = (s: string) => s.replace(/[^\u4e00-\u9fa5]/g, "").length;

  // mock 在生成/优化阶段使用的固定篇幅当量（见 providers/mock.ts DRAFT_TARGET_CHARS）
  const MOCK_TARGET_CHARS = 360;

  async function generate(payload: Record<string, unknown>) {
    const res = await app.inject({
      method: "POST",
      url: "/api/story-draft/generate",
      payload,
    });
    return { status: res.statusCode, body: res.json() as any };
  }

  async function optimize(payload: Record<string, unknown>) {
    const res = await app.inject({
      method: "POST",
      url: "/api/story-draft/optimize",
      payload,
    });
    return { status: res.statusCode, body: res.json() as any };
  }

  beforeAll(async () => {
    app = await buildApp();
    await initDb();
    await app.ready();
  });

  // 约束 ②：与改写（refineStoryForPageCount）共用同一个 TEXT 后端
  it("与改写共用同一个 TEXT 后端（mock 环境下为 mock）", () => {
    expect(getTextBackend().id).toBe("mock");
  });

  it("主题生成：返回非空故事，且以用户主题开头（内容来自请求）", async () => {
    const theme = "写一个防止校园霸凌的故事，主角是转学来的小刺猬阿栗";
    const { status, body } = await generate({ theme });
    expect(status).toBe(200);
    expect(typeof body.story).toBe("string");
    expect(body.story.length).toBeGreaterThan(0);
    expect(body.story).toContain("小刺猬阿栗");
  });

  it("主题生成：同输入同输出（确定性）", async () => {
    const a = await generate({ theme: "小狐狸找星星" });
    const b = await generate({ theme: "小狐狸找星星" });
    expect(a.body.story).toBe(b.body.story);
  });

  it("主题生成：主题不同则内容不同", async () => {
    const a = await generate({ theme: "小狐狸找星星" });
    const b = await generate({ theme: "小刺猬学道歉" });
    expect(a.body.story).not.toBe(b.body.story);
  });

  it("入参校验：空 theme 返回 400", async () => {
    const g = await generate({ theme: "   " });
    expect(g.status).toBe(400);
    expect(g.body.error).toBe("theme 不能为空");
  });

  it("入参校验：超长 theme 被拒（提示词注入 / 上下文膨胀防护）", async () => {
    const g = await generate({ theme: "霸凌".repeat(1500) });
    expect(g.status).toBe(400);
    expect(String(g.body.error)).toContain("theme 过长");
  });

  it("多轮优化：返回修订稿，保留原主题句且与原文不同", async () => {
    const before = "小兔子第一天上学，路上遇到了一只打瞌睡的蜗牛。它挥挥手，继续往前走。";
    const { status, body } = await optimize({
      story: before,
      feedback: "结尾再欢乐一点",
    });
    expect(status).toBe(200);
    const after = String(body.story);
    expect(after.length).toBeGreaterThan(0);
    expect(after).not.toBe(before);
    expect(after.startsWith("小兔子第一天上学")).toBe(true);
  });

  it("多轮优化：识别缩短意图时按固定当量截断", async () => {
    const before = Array.from(
      { length: 40 },
      (_, i) => `第${i + 1}句，小动物在森林里遇见了好朋友。`
    ).join("");
    const { body } = await optimize({
      story: before,
      feedback: "压到 2 页内",
    });
    expect(cjkLen(String(body.story))).toBeLessThanOrEqual(MOCK_TARGET_CHARS);
    expect(cjkLen(String(body.story))).toBeLessThan(cjkLen(before));
  });

  it("多轮优化：接受 applied_feedback（已生效要求）并正常返回", async () => {
    const { status, body } = await optimize({
      story: "小熊在河边捡到一颗发光的石头。",
      feedback: "加一句心理描写",
      applied_feedback: ["结尾再欢乐一点", "把主角名字统一成小熊"],
    });
    expect(status).toBe(200);
    expect(String(body.story).length).toBeGreaterThan(0);
    expect(String(body.story).startsWith("小熊在河边")).toBe(true);
  });

  it("入参校验：空 story / 空 feedback / 超长 feedback 均返回 400", async () => {
    const o1 = await optimize({ story: "", feedback: "改短一点" });
    expect(o1.status).toBe(400);
    expect(o1.body.error).toBe("story 不能为空");

    const o2 = await optimize({ story: "小熊的一天。", feedback: "  " });
    expect(o2.status).toBe(400);
    expect(o2.body.error).toBe("feedback 不能为空");

    const o3 = await optimize({ story: "小熊的一天。", feedback: "改".repeat(2500) });
    expect(o3.status).toBe(400);
    expect(String(o3.body.error)).toContain("feedback 过长");
  });

  // 约束 ①：不使用 AI、直接输入故事原文必须照旧可用
  it("回归：不碰 AI，直接输入故事原文仍能提交（原流程不变）", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/stories",
      payload: { original_text: "一只小熊的奇妙一天。", target_page_count: 4 },
    });
    expect(res.statusCode).toBe(201);
    expect(typeof res.json().id).toBe("number");
  });

  it("闭环：AI 生成 → 提交建故事 → 改写分页成功（页数仍在改写阶段生效）", async () => {
    const { body: gen } = await generate({ theme: "小猫学会说对不起" });
    expect(String(gen.story).length).toBeGreaterThan(0);

    const created = await app.inject({
      method: "POST",
      url: "/api/stories",
      payload: { original_text: gen.story, target_page_count: 6 },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as number;

    const rw = await app.inject({
      method: "POST",
      url: `/api/stories/${id}/rewrite`,
    });
    expect(rw.statusCode).toBe(200);
    expect(rw.json().pageCount).toBe(6);
  });
});
