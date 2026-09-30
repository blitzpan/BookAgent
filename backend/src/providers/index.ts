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
//   本地开发「零成本」最简配置（推荐）：只设 MOCK_AI=1，一个开关让三个角色全部走 mock，
//   上面这些 provider 与 API Key 配置全部被忽略，不必再配。
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

/** 省钱总开关：MOCK_AI=1（或 true / yes / on）时整个后端零真实 API 调用。 */
function isMockEnabled(): boolean {
  return ["1", "true", "yes", "on"].includes(
    (process.env.MOCK_AI || "").trim().toLowerCase()
  );
}

/** 返回实际使用的后端及其名字（name 即落库留痕用的 provider 名）。 */
function pick(
  role: "TEXT" | "IMAGE" | "VISION",
  envVar: string
): { backend: ModelBackend; name: string } {
  // 单一总开关优先：开启后忽略 TEXT_PROVIDER / IMAGE_PROVIDER / VISION_PROVIDER。
  if (isMockEnabled()) return { backend: mock, name: mock.id };

  const choice = (process.env[envVar] || "gemini").toLowerCase();

  if (choice === "mock") return { backend: mock, name: mock.id };

  if (choice === "gemini") return { backend: gemini, name: gemini.id };

  if (choice === "ark") return { backend: ark, name: ark.id };

  if (choice === "qwen" || choice === "bailian")
    return { backend: bailian, name: bailian.id };

  if (choice === "seedream") {
    if (role === "IMAGE") return { backend: seedream, name: seedream.id };
    console.warn(
      `[multi-model] provider "seedream" 不支持 ${role} 角色（它只能生图），已回退到 gemini。`
    );
    return { backend: gemini, name: gemini.id };
  }

  console.warn(
    `[multi-model] 未知 provider "${choice}"，已回退到 gemini。可选：gemini / qwen / bailian / seedream / ark。`
  );
  return { backend: gemini, name: gemini.id };
}

export const getTextBackend = () => pick("TEXT", "TEXT_PROVIDER").backend;
export const getImageBackend = () => pick("IMAGE", "IMAGE_PROVIDER").backend;
export const getVisionBackend = () => pick("VISION", "VISION_PROVIDER").backend;

/**
 * 实际生效的 provider 名（含 MOCK_AI 总开关与不支持角色时的回退结果），
 * 供 generation_runs 落库留痕——记录"这次到底用的哪个模型"。
 */
export function getProviderNames(): {
  text: string;
  image: string;
  vision: string;
} {
  return {
    text: pick("TEXT", "TEXT_PROVIDER").name,
    image: pick("IMAGE", "IMAGE_PROVIDER").name,
    vision: pick("VISION", "VISION_PROVIDER").name,
  };
}

export type { ModelBackend } from "./types";
