// e2e 全局初始化：用一个已发布（含默认图）的绘本来喂阅读端。
// 全程走 mock provider（由 playwright.config 注入 env），零真实 API 调用。

import { request, type FullConfig } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const BASE = process.env.E2E_API_BASE || "http://localhost:3000";

async function pollRun(api: any, runId: number) {
  for (let i = 0; i < 400; i++) {
    const r = await api.get(`/api/runs/${runId}`);
    const b = await r.json();
    if (["completed", "partial_failed", "failed"].includes(b.run.status)) return b;
    await new Promise((res) => setTimeout(res, 30));
  }
  throw new Error("run 超时未完成");
}

export default async function globalSetup(_config: FullConfig) {
  const api = await request.newContext({ baseURL: BASE });

  // 建故事
  const c = await api.post("/api/stories", {
    data: {
      original_text: "一只小猫在森林里开始了奇妙的一天。",
      target_page_count: 4,
      user_title: "测试绘本",
    },
  });
  if (!c.ok()) throw new Error(`建故事失败: ${c.status()} ${await c.text()}`);
  const storyId = (await c.json()).id;

  // 改写（同步）
  const rw = await api.post(`/api/stories/${storyId}/rewrite`);
  if (!rw.ok()) throw new Error(`改写失败: ${rw.status()} ${await rw.text()}`);
  const rwBody = await rw.json();
  if (rwBody.pageCount !== 4) throw new Error(`改写页数异常: ${rwBody.pageCount}`);

  // 整书生图
  const g = await api.post(`/api/stories/${storyId}/generate`);
  if (!g.ok()) throw new Error(`生图失败: ${g.status()} ${await g.text()}`);
  const runId = (await g.json()).runId;
  await pollRun(api, runId);

  // 发布
  const pb = await api.post(`/api/stories/${storyId}/publish`);
  if (!pb.ok()) throw new Error(`发布失败: ${pb.status()} ${await pb.text()}`);

  await api.dispose();

  const seedPath = fileURLToPath(new URL("./seed.json", import.meta.url));
  writeFileSync(seedPath, JSON.stringify({ storyId }));
  // eslint-disable-next-line no-console
  console.log(`[e2e seed] 已发布绘本 storyId=${storyId}`);
}
