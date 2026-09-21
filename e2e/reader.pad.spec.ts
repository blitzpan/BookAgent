import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function getStoryId(): number {
  const p = fileURLToPath(new URL("./seed.json", import.meta.url));
  return JSON.parse(readFileSync(p, "utf-8")).storyId;
}

// 场景 4：Pad 端阅读（>=768px）
test.describe("Pad 端阅读绘本", () => {
  let pageErrors: string[] = [];

  test.beforeEach(async ({ page }) => {
    pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
  });

  test("默认单页渲染，可切到跨页双页", async ({ page }) => {
    await page.goto(`/book/${getStoryId()}`);
    await expect(page.locator(".page-view")).first().waitFor();

    // 默认单页：一个 page-view
    await expect(page.locator(".page-view").first()).toBeVisible();

    // Pad 显示跨页切换按钮；切到跨页
    await page.locator(".toggle button", { hasText: "跨页" }).click();
    await expect(page.locator(".spread")).toBeVisible();
    // 跨页左右两半各一个 page-view
    await expect(page.locator(".spread .spread-half").count()).toBe(2);

    // 翻页一次翻一对页：指示 "1-2 / 4"
    const indicator = page.locator(".page-indicator");
    await expect(indicator).toHaveText(/1-2 \/ 4/);
  });

  test("跨页翻页一次翻一对页", async ({ page }) => {
    await page.goto(`/book/${getStoryId()}`);
    await expect(page.locator(".page-view")).first().waitFor();
    await page.locator(".toggle button", { hasText: "跨页" }).click();
    await expect(page.locator(".spread")).toBeVisible();

    await page.locator(".reader-nav button", { hasText: "下一页" }).click();
    const indicator = page.locator(".page-indicator");
    await expect(indicator).toHaveText(/3-4 \/ 4/);
  });

  test("语言 / 字号切换在 Pad 同样生效", async ({ page }) => {
    await page.goto(`/book/${getStoryId()}`);
    await expect(page.locator(".page-view")).first().waitFor();
    await page.locator(".toggle button", { hasText: "跨页" }).click();
    await expect(page.locator(".spread")).toBeVisible();

    const caption = page.locator(".spread .page-caption").first();
    const sizeSmall = await caption.evaluate(
      (el) => parseFloat(getComputedStyle(el).fontSize)
    );
    await page.locator(".toggle button", { hasText: "大" }).click();
    const sizeLarge = await caption.evaluate(
      (el) => parseFloat(getComputedStyle(el).fontSize)
    );
    expect(sizeLarge).toBeGreaterThan(sizeSmall);

    // 语言切换不报错
    await page.locator(".toggle button", { hasText: "English" }).click();
    await expect(caption).toBeVisible();
  });

  test("无横向溢出、图片铺满（object-fit 生效）", async ({ page }) => {
    await page.goto(`/book/${getStoryId()}`);
    await expect(page.locator(".page-view")).first().waitFor();
    await page.locator(".toggle button", { hasText: "跨页" }).click();
    await expect(page.locator(".spread")).toBeVisible();

    const img = page.locator(".spread .page-image").first();
    await expect(img).toBeVisible();
    const fit = await img.evaluate(
      (el) => getComputedStyle(el).objectFit
    );
    expect(fit).toBe("contain"); // global.css 中 .page-image 为 object-fit: contain
    // 无横向滚动条
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1
    );
    expect(overflow).toBe(true);
  });

  test("全程无 JS 运行时异常", async ({ page }) => {
    await page.goto(`/book/${getStoryId()}`);
    await expect(page.locator(".page-view")).first().waitFor();
    await page.locator(".toggle button", { hasText: "跨页" }).click();
    await expect(page.locator(".spread")).toBeVisible();
    expect(pageErrors).toEqual([]);
  });
});
