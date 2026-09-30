import { describe, it, expect } from "vitest";
import { getTextBackend, getImageBackend, getVisionBackend } from "../src/providers";

// 金钱安全险：确保测试全程走 mock provider，绝不发生真实大模型 / 生图调用。
describe("mock provider 金钱安全", () => {
  it("三个角色都返回 mock backend（而非真实 provider）", () => {
    expect(getTextBackend().id).toBe("mock");
    expect(getImageBackend().id).toBe("mock");
    expect(getVisionBackend().id).toBe("mock");
  });

  it("总开关 MOCK_AI=1 优先级最高，关闭后回落到分角色配置", () => {
    const saved = { ai: process.env.MOCK_AI, text: process.env.TEXT_PROVIDER };
    try {
      process.env.TEXT_PROVIDER = "gemini"; // 故意配成真实 provider
      process.env.MOCK_AI = "1";
      expect(getTextBackend().id).toBe("mock"); // 总开关覆盖分角色配置

      delete process.env.MOCK_AI;
      expect(getTextBackend().id).toBe("gemini"); // 关闭总开关后按分角色配置走
    } finally {
      if (saved.text === undefined) delete process.env.TEXT_PROVIDER;
      else process.env.TEXT_PROVIDER = saved.text;
      if (saved.ai === undefined) delete process.env.MOCK_AI;
      else process.env.MOCK_AI = saved.ai;
    }
  });

  it("generateImage 返回合法 dataURL，不触网", async () => {
    const url = await getImageBackend().generateImage({
      prompt: "x",
      referenceDataUrls: [],
    });
    expect(url.startsWith("data:image/")).toBe(true);
  });

  it("fetch 守门拦截任何外部请求（即便误配真实 provider 也不花钱）", async () => {
    await expect(
      (globalThis.fetch as any)("https://generativelanguage.googleapis.com/v1/...")
    ).rejects.toThrow(/money-safety/);
    await expect(
      (globalThis.fetch as any)("https://api.dashscope.com/...")
    ).rejects.toThrow(/money-safety/);
  });
});
