// Seedream 后端（字节跳动 / 火山方舟 Volcengine Ark）。
// 仅实现图像生成（多参考图）。文本与视觉校验仍走 Gemini（见 providers/index.ts 的角色回退）。
//
// 注意：Seedream 官方 API 字段可能随版本变动，本实现按 Volcengine Ark 图像生成
// 接口（/api/v3/images/generations）的常见形态编写，并尽量兼容多种返回结构。
// 若你的账号字段名不同，请以火山引擎官方文档为准微调下方 body。

import type { GenerateJSONArgs, GenerateImageArgs, ModelBackend } from "./types";
import { buildImagePrompt, toDataUrl } from "./util";

// 开发环境走 Vite 代理（避免浏览器 CORS）：/seedream-api -> 火山方舟 host。
// 生产/自部署可设 SEEDREAM_BASE_URL 为完整地址。
// 注：若想用同一个火山方舟账号覆盖"文本+视觉+图像"全部角色，直接用 IMAGE_PROVIDER=ark 即可。
const BASE_URL = process.env.SEEDREAM_BASE_URL || "/seedream-api";
const API_KEY = process.env.SEEDREAM_API_KEY || process.env.ARK_API_KEY || "";
const MODEL = process.env.SEEDREAM_MODEL_NAME || "seedream-5.0-pro";

export const createSeedreamBackend = (): ModelBackend => ({
  id: "seedream",
  label: "ByteDance Seedream",
  maxRefs: 10,
  supportsVision: false,

  async generateJSON(_args: GenerateJSONArgs): Promise<any> {
    throw new Error(
      "Seedream backend only supports image generation, not text/JSON or vision judging."
    );
  },

  async generateImage(args: GenerateImageArgs): Promise<string> {
    if (!API_KEY) {
      throw new Error(
        "SEEDREAM_API_KEY 未设置。请在 .env.local 配置后，将 IMAGE_PROVIDER=seedream 才能使用 Seedream 生图。"
      );
    }

    const cleanedRefs = (args.referenceDataUrls || []).filter(Boolean);
    const fullPrompt = buildImagePrompt(args.prompt);

    const size =
      args.aspectRatio === "16:9"
        ? "1600x900"
        : args.aspectRatio === "1:1"
        ? "1024x1024"
        : "1024x768";

    const body: Record<string, unknown> = {
      model: MODEL,
      prompt: fullPrompt,
      size,
      response_format: "b64_json",
    };

    // 多参考图：Volcengine Seedream 的参考图字段为 image_ref（数组）。
    if (cleanedRefs.length > 0) {
      body.image_ref = await Promise.all(
        cleanedRefs.map(async (d) => ({ image: await toDataUrl(d) }))
      );
    }

    const res = await fetch(BASE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Seedream API error ${res.status}: ${txt}`);
    }

    const json: any = await res.json();

    // 兼容多种返回结构：OpenAI 风格 data[].b64_json / url，或火山 generated_images。
    const b64 =
      json?.data?.[0]?.b64_json ||
      json?.generated_images?.[0]?.image?.imageBytes ||
      json?.image?.imageBytes;
    const url =
      json?.data?.[0]?.url || json?.generated_images?.[0]?.url || json?.url;

    if (b64) return `data:image/png;base64,${b64}`;
    if (url) return await toDataUrl(url);
    throw new Error("Seedream API 返回中未找到图像数据（b64_json / url）。");
  },
});
