// 通用 OpenAI 兼容 chat 后端工厂。
// 通义千问（DashScope）与火山方舟（Ark）的对话/视觉接口都兼容 OpenAI
// /v1/chat/completions 协议，因此文本与视觉（VLM）两类角色可共用同一实现，
// 仅需不同的 chatUrl / apiKey / 模型名。
//
// 视觉（VISION）角色会把 parts 中的图片转成 image_url（dataURL）塞入消息；
// 文本角色则把文本 parts 拼接后传入。两者都用 response_format=json_object 约束输出。

import type { GenerateJSONArgs, Part } from "./types";

export type ChatBackendOpts = {
  /** provider 标识，用于报错信息。 */
  id: string;
  /** 展示名。 */
  label: string;
  /** 完整的 chat/completions 端点（已包含代理路径，如 /bailian-api/compatible-mode/v1/chat/completions 或 /ark-api/api/v3/chat/completions）。 */
  chatUrl: string;
  apiKey: string;
  textModel: string;
  visionModel: string;
  maxRefs?: number;
};

type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

// 把 Gemini 风格的 parts 转成 OpenAI chat 的 content。
function partsToContent(parts: Part[]): string | ChatContentPart[] {
  const hasImage = parts.some((p) => "inlineData" in p);
  if (!hasImage) {
    return parts.map((p) => ("text" in p ? p.text : "")).join("\n");
  }
  const content: ChatContentPart[] = [];
  for (const p of parts) {
    if ("text" in p) {
      if (p.text.trim()) content.push({ type: "text", text: p.text });
    } else if ("inlineData" in p) {
      const { data, mimeType } = p.inlineData;
      content.push({
        type: "image_url",
        image_url: { url: `data:${mimeType};base64,${data}` },
      });
    }
  }
  return content;
}

export function createChatJSONMethod(opts: ChatBackendOpts) {
  return async (args: GenerateJSONArgs): Promise<any> => {
    if (!opts.apiKey) {
      throw new Error(
        `${opts.id} 后端缺少 API Key。请在 .env.local 配置 ${opts.id.toUpperCase()}_API_KEY（火山方舟也可共用 ARK_API_KEY）。`
      );
    }

    // 文本与视觉用不同模型（纯文本 LLM vs 多模态 VLM）。
    const model = args.role === "vision" ? opts.visionModel : opts.textModel;

    const messages: any[] = [];
    if (args.systemInstruction) {
      messages.push({ role: "system", content: args.systemInstruction });
    }
    // 兼容端点（qwen / ark）会忽略 schema，模型常自作主张改字段名
    // （如把 isSafe 写成 safe_for_children），导致上层 Boolean(json.isSafe)
    // 拿到 undefined 被误判。这里把期望的顶层键名写进提示，约束模型按约定键名返回。
    let userContent: string | ChatContentPart[] = partsToContent(args.parts);
    const schemaProps = (args.schema as any)?.properties;
    if (schemaProps && typeof schemaProps === "object") {
      const keys = Object.keys(schemaProps);
      const hint = `\n\nRespond with a JSON object. Use EXACTLY these top-level keys (do not rename them): ${keys.join(", ")}.`;
      if (typeof userContent === "string") {
        userContent += hint;
      } else {
        userContent.push({ type: "text", text: hint });
      }
    }
    messages.push({ role: "user", content: userContent });

    const res = await fetch(opts.chatUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        response_format: { type: "json_object" },
        temperature: 0.7,
      }),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`${opts.label} API error ${res.status}: ${txt}`);
    }

    const json: any = await res.json();
    const content = json?.choices?.[0]?.message?.content ?? "{}";
    const text = typeof content === "string" ? content : JSON.stringify(content);
    return JSON.parse(text);
  };
}
