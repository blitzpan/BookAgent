import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function getStoryId(): number {
  const p = fileURLToPath(new URL("./seed.json", import.meta.url));
  return JSON.parse(readFileSync(p, "utf-8")).storyId;
}

// 场景 3：移动端阅读（<768px 默认单页）
test.describe("移动端阅读绘本", () => {
  let pageErrors: string[] = [];

  test.beforeEach(async ({ page }) => {
    pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
  });

  test("书架出现已发布绘本且可进入阅读页", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".book-card")).first().waitFor();
    const count = await page.locator(".book-card").count();
    expect(count).toBeGreaterThan(0);
    await page.locator(".book-card").first().click();
    await expect(page).toHaveURL(/\/book\/\d+/);
  });

  test("单页满版图 + 双语旁白渲染（降级不白屏）", async ({ page }) => {
    await page.goto(`/book/${getStoryId()}`);
    await expect(page.locator(".page-view")).first().waitFor();
    // 图片已加载（mock 落盘的真实图）
    const img = page.locator(".page-image").first();
    await expect(img).toBeVisible();
    await expect(img).toHaveJSProperty("naturalWidth", 1);
    // 旁白存在（mock 数据 text_zh 为 null，双语降级为 English，不应白屏）
    const caption = page.locator(".page-caption").first();
    await expect(caption).toBeVisible();
    await expect(caption).not.toHaveText("");
  });

  test("翻页（点下一页，页码 +1）", async ({ page }) => {
    await page.goto(`/book/${getStoryId()}`);
    await expect(page.locator(".page-view")).first().waitFor();
    const indicator = page.locator(".page-indicator");
    await expect(indicator).toHaveText(/1 \/ 4/);
    await page.locator(".reader-nav button", { hasText: "下一页" }).click();
    await expect(indicator).toHaveText(/2 \/ 4/);
  });

  test("语言切换（中文降级为英文，不报错）", async ({ page }) => {
    await page.goto(`/book/${getStoryId()}`);
    await expect(page.locator(".page-view")).first().waitFor();
    await page.locator(".toggle button", { hasText: "中文" }).click();
    const caption = page.locator(".page-caption").first();
    await expect(caption).toBeVisible(); // 降级渲染，不白屏
    await page.locator(".toggle button", { hasText: "English" }).click();
    await expect(caption).toBeVisible();
  });

  test("字号三档切换改变 caption 字号", async ({ page }) => {
    await page.goto(`/book/${getStoryId()}`);
    await expect(page.locator(".page-view")).first().waitFor();
    const caption = page.locator(".page-caption").first();
    const sizeSmall = await caption.evaluate(
      (el) => parseFloat(getComputedStyle(el).fontSize)
    );
    await page.locator(".toggle button", { hasText: "大" }).click();
    const sizeLarge = await caption.evaluate(
      (el) => parseFloat(getComputedStyle(el).fontSize)
    );
    expect(sizeLarge).toBeGreaterThan(sizeSmall);
  });

  test("图片加载失败时仍不崩溃（缺图兜底）", async ({ page }) => {
    await page.route("**/assets/**", (route) => route.abort());
    await page.goto(`/book/${getStoryId()}`);
    await expect(page.locator(".page-view")).first().waitFor();
    // 即便图片被拦截，旁白仍渲染、无 JS 异常
    await expect(page.locator(".page-caption").first()).toBeVisible();
    expect(pageErrors).toEqual([]);
  });
});
