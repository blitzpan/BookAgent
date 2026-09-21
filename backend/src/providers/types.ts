// 多模型后端统一接口定义。
// 设计要点：把"文本生成 / 图像生成 / 视觉校验"三类能力抽象成统一后端，
// 每个角色（TEXT / IMAGE / VISION）可独立选择不同 provider。

/** Gemini 风格的 parts：纯文本或内联图片。 */
export type Part =
  | { text: string }
  | { inlineData: { data: string; mimeType: string } };

/** 生成结构化 JSON（文本或带图的多模态都走这个，role 决定用哪个模型）。 */
export interface GenerateJSONArgs {
  systemInstruction?: string;
  /** 已构建好的 parts（文本 + 内联图片），由调用方按原逻辑组装，保证行为一致。 */
  parts: Part[];
  /** Gemini 风格的 responseSchema 对象（含 type/OBJECT 等）。 */
  schema: object;
  /** Gemini 后端据此选择 text 模型还是 vision 模型；其它后端可忽略。 */
  role?: "text" | "vision";
}

/** 图像生成请求。referenceDataUrls 约定： */
export interface GenerateImageArgs {
  /** 完整 prompt（已包含 REFERENCE ROLES 说明）。 */
  prompt: string;
  /** 参考图 dataURL 数组，约定 [0]=风格参考，[1..]=角色锚图。调用方已按 maxRefs 截断。 */
  referenceDataUrls: string[];
  aspectRatio?: string;
  imageSize?: string;
}

export interface ModelBackend {
  id: string;
  label: string;
  /** 图像模型最多接受的参考图数量（Gemini 14 / Seedream 10）。 */
  maxRefs: number;
  /** 该后端是否能"看懂图"（用于三个 Director 与图像安全校验）。 */
  supportsVision: boolean;
  generateJSON(args: GenerateJSONArgs): Promise<any>;
  /** 返回 data:image/...;base64,... 形式的 dataURL。 */
  generateImage(args: GenerateImageArgs): Promise<string>;
}
