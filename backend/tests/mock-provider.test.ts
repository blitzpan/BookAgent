import { describe, it, expect } from "vitest";
import { getTextBackend, getImageBackend, getVisionBackend } from "../src/providers";

// 金钱安全险：确保测试全程走 mock provider，绝不发生真实大模型 / 生图调用。
describe("mock provider 金钱安全", () => {
  it("三个角色都返回 mock backend（而非真实 provider）", () => {
    expect(getTextBackend().id).toBe("mock");
    expect(getImageBackend().id).toBe("mock");
    expect(getVisionBackend().id).toBe("mock");
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
