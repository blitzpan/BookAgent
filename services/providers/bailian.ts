// 阿里云百炼（Bailian）平台后端：通义千问（文本/视觉）+ 通义万相（图像）。
// 百炼与 DashScope 共用同一网关（dashscope.aliyuncs.com）与 API Key。
// - 文本 / 视觉：复用 openaiLike.createChatJSONMethod，走 OpenAI 兼容 /chat/completions。
// - 图像：走万相 2.7 的 multimodal-generation/generation 同步端点，
//   该端点支持在 content 中传入多张 base64 参考图（image 字段），契合我们的
//   "上一页(风格参考) + 角色锚图" 一致性闭环（L2 多参考图）。
//
// 注：万相 2.7 支持最多 0–9 张参考图；若使用更老的 wanx 模型，可能需要改走
// 异步 image-generation/generation（X-DashScope-Async 轮询）或业务空间专属域名，
// 可通过 BAILIAN_BASE_URL / BAILIAN_IMAGE_MODEL_NAME 调整。

import { createChatJSONMethod } from "./openaiLike";
import type { GenerateImageArgs, ModelBackend } from "./types";
import { buildImagePrompt, toDataUrl } from "./util";

// 开发环境走 Vite 代理（避免浏览器 CORS）：/bailian-api -> dashscope.aliyuncs.com（前缀被 rewrite 去掉）。
// 生产/自部署可把 BAILIAN_BASE_URL 设为完整地址（如业务空间专属域名）。
const BASE_URL = process.env.BAILIAN_BASE_URL || process.env.QWEN_BASE_URL || "/bailian-api";
// 百炼与 DashScope 同网关，Key 通用：优先 BAILIAN_API_KEY，回退 QWEN_API_KEY。
const API_KEY = process.env.BAILIAN_API_KEY || process.env.QWEN_API_KEY || "";

const TEXT_MODEL = process.env.BAILIAN_TEXT_MODEL_NAME || process.env.QWEN_TEXT_MODEL_NAME || "qwen-plus";
const VISION_MODEL = process.env.BAILIAN_VISION_MODEL_NAME || process.env.QWEN_VISION_MODEL_NAME || "qwen-vl-plus";
const IMAGE_MODEL = process.env.BAILIAN_IMAGE_MODEL_NAME || "wan2.7-image";

// 万相 2.7 / 通义千问图像 最多接受 0–9 张参考图。
const MAX_REFS = 9;

// 百炼图像模型用 "宽*高"（如 "2048*2048"），而本应用传入 Gemini 风格的 "2K"。
// 这里做映射，避免 size 非法导致 API 拒绝。
function toQwenSize(imageSize?: string): string {
  switch ((imageSize || "2K").toUpperCase()) {
    case "1K": return "1024*1024";
    case "2K": return "2048*2048";
    case "4K": return "2048*2048"; // 百炼上限 2048*2048
    default: return imageSize!.includes("*") ? imageSize! : "2048*2048";
  }
}

export const createBailianBackend = (): ModelBackend => ({
  id: "bailian",
  label: "Alibaba Bailian (Qwen + Wanxiang)",
  maxRefs: MAX_REFS,
  supportsVision: true,

  generateJSON: createChatJSONMethod({
    id: "bailian",
    label: "Alibaba Bailian",
    chatUrl: `${BASE_URL}/compatible-mode/v1/chat/completions`,
    apiKey: API_KEY,
    textModel: TEXT_MODEL,
    visionModel: VISION_MODEL,
  }),

  async generateImage(args: GenerateImageArgs): Promise<string> {
    if (!API_KEY) {
      throw new Error(
        "百炼(Bailian) 图像生成缺少 API Key。请在 .env.local 配置 BAILIAN_API_KEY（或 QWEN_API_KEY），并将 IMAGE_PROVIDER 设为 bailian / qwen。"
      );
    }

    const cleanedRefs = (args.referenceDataUrls || []).filter(Boolean);
    const fullPrompt = buildImagePrompt(args.prompt);
    const size = toQwenSize(args.imageSize);

    // 多图参考：把参考图作为 image content 传入（百炼支持 data:...;base64,...）。
    // 约定：所有参考图均为角色锚图（CHARACTER SHEETS），已在 buildImagePrompt / App.tsx 的 REFERENCE USAGE 中说明。
    const content: any[] = cleanedRefs.map((d) => ({ image: d }));
    content.push({ text: fullPrompt });

    const body: Record<string, unknown> = {
      model: IMAGE_MODEL,
      input: { messages: [{ role: "user", content }] },
      parameters: { size, n: 1, watermark: false },
    };

    const res = await fetch(`${BASE_URL}/api/v1/services/aigc/multimodal-generation/generation`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Bailian image API error ${res.status}: ${txt}`);
    }

    const json: any = await res.json();

    // 兼容同步返回结构：output.choices[].message.content[].image（也可能直接是 choices[...]）。
    const imageUrl =
      json?.output?.choices?.[0]?.message?.content?.find((c: any) => c?.image)?.image ||
      json?.choices?.[0]?.message?.content?.[0]?.image ||
      json?.output?.choices?.[0]?.message?.content?.[0]?.image;

    if (imageUrl) return await toDataUrl(imageUrl);
    throw new Error(
      "Bailian image API 返回中未找到图像数据（期望 output.choices[].message.content[].image）。请检查 BAILIAN_IMAGE_MODEL_NAME 是否为万相 2.6/2.7 系列，或调整 BAILIAN_BASE_URL。"
    );
  },
});
