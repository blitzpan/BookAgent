// 火山方舟（Volcengine Ark）统一后端：文本/视觉走 OpenAI 兼容 chat/completions，
// 图像走 Seedream 图像接口（同属 Ark）。因此一个 provider 即可覆盖全部三个角色，
// 且只需一个 ARK_API_KEY，是国内"全链路可访问"的最简方案。
//
// CORS：开发环境经 Vite 代理 /ark-api -> https://ark.cn-beijing.volcesengine.com，
//   文本/视觉调用 /ark-api/api/v3/chat/completions，图像调用 /ark-api/api/v3/images/generations。

import { createChatJSONMethod } from "./openaiLike";
import { buildImagePrompt, toDataUrl } from "./util";
import type { GenerateImageArgs, ModelBackend } from "./types";

const ARK_BASE = process.env.ARK_BASE_URL || "/ark-api";
const apiKey = process.env.ARK_API_KEY || "";
const textModel = process.env.ARK_TEXT_MODEL_NAME || "doubao-seed-1.8";
const visionModel = process.env.ARK_VISION_MODEL_NAME || "doubao-1.5-vision-pro";
const imageModel = process.env.ARK_IMAGE_MODEL_NAME || "seedream-5.0-pro";

const chatUrl = `${ARK_BASE}/api/v3/chat/completions`;
const imageUrl = `${ARK_BASE}/api/v3/images/generations`;

function pickSize(aspectRatio?: string): string {
  if (aspectRatio === "16:9") return "1600x900";
  if (aspectRatio === "1:1") return "1024x1024";
  return "1024x768";
}

export const createArkBackend = (): ModelBackend => ({
  id: "ark",
  label: "Volcengine Ark (Doubao + Seedream)",
  maxRefs: 10, // Seedream 多参考图上限
  supportsVision: true,

  generateJSON: createChatJSONMethod({
    id: "ark",
    label: "Volcengine Ark",
    chatUrl,
    apiKey,
    textModel,
    visionModel,
  }),

  async generateImage(args: GenerateImageArgs): Promise<string> {
    if (!apiKey) {
      throw new Error(
        "ARK_API_KEY 未设置。请在 .env.local 配置后，将 IMAGE_PROVIDER=ark 才能使用火山方舟生图。"
      );
    }

    const cleanedRefs = (args.referenceDataUrls || []).filter(Boolean);
    const fullPrompt = buildImagePrompt(args.prompt);
    const size = pickSize(args.aspectRatio);

    const body: Record<string, unknown> = {
      model: imageModel,
      prompt: fullPrompt,
      size,
      response_format: "b64_json",
    };

    if (cleanedRefs.length > 0) {
      body.image_ref = await Promise.all(
        cleanedRefs.map(async (d) => ({ image: await toDataUrl(d) }))
      );
    }

    const res = await fetch(imageUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Ark image API error ${res.status}: ${txt}`);
    }

    const json: any = await res.json();
    const b64 =
      json?.data?.[0]?.b64_json ||
      json?.generated_images?.[0]?.image?.imageBytes ||
      json?.image?.imageBytes;
    const url =
      json?.data?.[0]?.url || json?.generated_images?.[0]?.url || json?.url;

    if (b64) return `data:image/png;base64,${b64}`;
    if (url) return await toDataUrl(url);
    throw new Error("Ark image API 返回中未找到图像数据（b64_json / url）。");
  },
});
