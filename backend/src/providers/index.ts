// 后端注册与按角色分发。
// - 默认全 gemini，行为与原实现一致。
// - 每个角色可经 .env.local 的 TEXT_PROVIDER / IMAGE_PROVIDER / VISION_PROVIDER 单独选择。
// - 可选 provider：
//     gemini  -> 文本/图像/视觉 全支持（默认）
//     qwen    -> 文本 + 视觉 + 图像（阿里百炼 DashScope：通义千问 + 通义万相）
//     bailian -> 同 qwen（百炼平台别名，全角色支持）
//     seedream-> 仅图像（国内可访问，火山方舟 Seedream）
//     ark     -> 文本 + 视觉 + 图像 全支持（火山方舟：豆包对话/视觉 + Seedream 生图，单一 ARK_API_KEY）
//     mock    -> 纯本地假数据（测试专用，零真实 API 调用，详见 ./mock）
//   若某 provider 不支持当前角色，自动回退 gemini 并在控制台告警。
//   全国内、单账号最简配置（零 Gemini 调用）：
//     火山方舟：TEXT_PROVIDER=ark / IMAGE_PROVIDER=ark / VISION_PROVIDER=ark
//     阿里百炼：TEXT_PROVIDER=bailian / IMAGE_PROVIDER=bailian / VISION_PROVIDER=bailian

import { createGeminiBackend } from "./gemini";
import { createBailianBackend } from "./bailian";
import { createSeedreamBackend } from "./seedream";
import { createArkBackend } from "./ark";
import { createMockBackend } from "./mock";
import type { ModelBackend } from "./types";

const gemini = createGeminiBackend();
const bailian = createBailianBackend();
const seedream = createSeedreamBackend();
const ark = createArkBackend();
const mock = createMockBackend();

function pick(role: "TEXT" | "IMAGE" | "VISION", envVar: string): ModelBackend {
  const choice = (process.env[envVar] || "gemini").toLowerCase();

  if (choice === "mock") return mock; // 测试专用：纯本地假数据，零真实 API

  if (choice === "gemini") return gemini;

  if (choice === "ark") return ark; // ark 支持全部三个角色

  if (choice === "qwen" || choice === "bailian") return bailian; // 百炼平台：文本+视觉+图像

  if (choice === "seedream") {
    if (role === "IMAGE") return seedream;
    console.warn(
      `[multi-model] provider "seedream" 不支持 ${role} 角色（它只能生图），已回退到 gemini。`
    );
    return gemini;
  }

  console.warn(
    `[multi-model] 未知 provider "${choice}"，已回退到 gemini。可选：gemini / qwen / bailian / seedream / ark。`
  );
  return gemini;
}

export const getTextBackend = () => pick("TEXT", "TEXT_PROVIDER");
export const getImageBackend = () => pick("IMAGE", "IMAGE_PROVIDER");
export const getVisionBackend = () => pick("VISION", "VISION_PROVIDER");

export type { ModelBackend } from "./types";
