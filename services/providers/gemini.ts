// Gemini 后端：完整保留原 @google/genai 行为（含模型名 env 覆盖、14 张参考图、
// generateImages 兜底、fail-open 之外的报错透传）。默认路径必须与原实现 100% 一致。

import { GoogleGenAI } from "@google/genai";
import type { GenerateJSONArgs, GenerateImageArgs, ModelBackend, Part } from "./types";
import { buildImagePrompt, dataUrlToInlineImagePart } from "./util";

const API_KEY =
  process.env.API_KEY || process.env.GEMINI_API_KEY || "fallback_api_key_for_dev";

if (!API_KEY || API_KEY === "fallback_api_key_for_dev") {
  console.warn(
    "[gemini] API_KEY / GEMINI_API_KEY 未设置，将使用 fallback 占位 key（生成会失败）。请在 .env.local 配置 GEMINI_API_KEY。"
  );
}

const TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || "gemini-3-pro-preview";
const VISION_MODEL = process.env.GEMINI_VISION_MODEL || "gemini-3-pro-preview";
const IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-3-pro-image-preview";

const ai = new GoogleGenAI({ apiKey: API_KEY });

export const createGeminiBackend = (): ModelBackend => ({
  id: "gemini",
  label: "Google Gemini",
  maxRefs: 14,
  supportsVision: true,

  async generateJSON(args: GenerateJSONArgs): Promise<any> {
    const model = args.role === "vision" ? VISION_MODEL : TEXT_MODEL;
    const response = await ai.models.generateContent({
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
    const styleRef = cleanedRefs.length > 0 ? cleanedRefs[0] : null;
    const characterRefs = cleanedRefs.length > 1 ? cleanedRefs.slice(1) : [];

    const fullPrompt = buildImagePrompt(args.prompt);

    const parts: Part[] = [];
    if (styleRef) {
      parts.push({ text: "[STYLE REFERENCE IMAGE — style only]" });
      parts.push(dataUrlToInlineImagePart(styleRef));
    }
    if (characterRefs.length) {
      parts.push({ text: "[CHARACTER REFERENCE IMAGES — match identity exactly]" });
      for (const d of characterRefs) parts.push(dataUrlToInlineImagePart(d));
    }
    parts.push({ text: fullPrompt });

    const aspectRatio = args.aspectRatio || "4:3";
    const imageSize = args.imageSize || "2K";

    try {
      const response = await ai.models.generateContent({
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
          const response = await ai.models.generateImages({
            model: IMAGE_MODEL,
            prompt: args.prompt,
            config: {
              numberOfImages: 1,
              outputMimeType: "image/png",
              aspectRatio,
            } as any,
          });

          const base64ImageBytes: string = response?.generatedImages?.[0]?.image?.imageBytes;
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
