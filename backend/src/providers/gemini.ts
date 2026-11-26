// Gemini 后端：完整保留原 @google/genai 行为（含模型名 env 覆盖、14 张参考图、
// generateImages 兜底、fail-open 之外的报错透传）。默认路径必须与原实现 100% 一致。

import { GoogleGenAI } from "@google/genai";
import type { GenerateJSONArgs, GenerateImageArgs, ModelBackend, Part } from "./types";
import { buildImagePrompt, dataUrlToInlineImagePart } from "./util";

const TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || "gemini-3-pro-preview";
const VISION_MODEL = process.env.GEMINI_VISION_MODEL || "gemini-3-pro-preview";
const IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-3-pro-image-preview";

// 懒加载：仅在真正调用 gemini backend 时才构造客户端 / 打印警告。
// 这样全 mock（MOCK_AI=1 或分角色 mock）模式下不会触发任何 gemini 初始化噪音，
// 模块导入本身保持零副作用。
let _ai: GoogleGenAI | null = null;
function getAi(): GoogleGenAI {
  if (_ai) return _ai;
  const API_KEY =
    process.env.API_KEY || process.env.GEMINI_API_KEY || "fallback_api_key_for_dev";
  if (!API_KEY || API_KEY === "fallback_api_key_for_dev") {
    console.warn(
      "[gemini] API_KEY / GEMINI_API_KEY 未设置，将使用 fallback 占位 key（生成会失败）。请在 .env.local 配置 GEMINI_API_KEY。"
    );
  }
  _ai = new GoogleGenAI({ apiKey: API_KEY });
  return _ai;
}

export const createGeminiBackend = (): ModelBackend => ({
  id: "gemini",
  label: "Google Gemini",
  maxRefs: 14,
  supportsVision: true,

  async generateJSON(args: GenerateJSONArgs): Promise<any> {
    const model = args.role === "vision" ? VISION_MODEL : TEXT_MODEL;
    const response = await getAi().models.generateContent({
      model,
      contents: { parts: args.parts },
      config: {
        systemInstruction: args.systemInstruction,
        responseMimeType: "application/json",
        responseSchema: args.schema as any,
      },
    });
    return JSON.parse(response.text ?? "{}");
  },

  async generateImage(args: GenerateImageArgs): Promise<string> {
    const cleanedRefs = (args.referenceDataUrls || []).filter(Boolean);
    const identity = args.referenceRole === "identity";
    const styleRef = !identity && cleanedRefs.length > 0 ? cleanedRefs[0] : null;
    const characterRefs = identity ? cleanedRefs : cleanedRefs.length > 1 ? cleanedRefs.slice(1) : [];

    const fullPrompt = buildImagePrompt(args.prompt, args.referenceRole);

    const parts: Part[] = [];
    if (styleRef) {
      parts.push({ text: "[STYLE REFERENCE IMAGE — style only]" });
      parts.push(dataUrlToInlineImagePart(styleRef));
    }
    if (characterRefs.length) {
      parts.push({
        text: identity
          ? "[IDENTITY REFERENCE PHOTOS — same real person, match facial identity]"
          : "[CHARACTER REFERENCE IMAGES — match identity exactly]",
      });
      for (const d of characterRefs) parts.push(dataUrlToInlineImagePart(d));
    }
    parts.push({ text: fullPrompt });

    const aspectRatio = args.aspectRatio || "4:3";
    const imageSize = args.imageSize || "2K";

    try {
      const response = await getAi().models.generateContent({
        model: IMAGE_MODEL,
        contents: parts as any,
        config: {
          responseModalities: ["Image"],
          imageConfig: { aspectRatio, imageSize },
        } as any,
      });

      const respParts: any[] = response?.candidates?.[0]?.content?.parts ?? [];
      const imgPart = respParts.find((p: any) => p.inlineData?.data);

      if (!imgPart) {
        throw new Error("No inline image data in Gemini response.");
      }

      const b64 = imgPart.inlineData.data as string;
      const mime = imgPart.inlineData.mimeType || "image/png";
      return `data:${mime};base64,${b64}`;
    } catch (error: any) {
      // 兜底：无参考图时退回到 generateImages（旧路径）。
      if (cleanedRefs.length === 0) {
        try {
          const response = await getAi().models.generateImages({
            model: IMAGE_MODEL,
            prompt: args.prompt,
            config: {
              numberOfImages: 1,
              outputMimeType: "image/png",
              aspectRatio,
            } as any,
          });

          const base64ImageBytes = response?.generatedImages?.[0]?.image?.imageBytes;
          if (base64ImageBytes) {
            return `data:image/png;base64,${base64ImageBytes}`;
          }
        } catch {
          /* fallthrough */
        }
      }

      console.error("Gemini image generation failed:", error);
      const msg =
        error?.message || (typeof error === "string" ? error : JSON.stringify(error));
      throw new Error(
        `Failed to generate an illustration.\nModel: ${IMAGE_MODEL}\nReason: ${msg}`
      );
    }
  },
});
