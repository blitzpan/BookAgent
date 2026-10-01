// 画风/语气：中文标签 → 英文 prompt 片段。
// 前端弹窗用中文多选，库里存中文；真正喂给图像/改写模型前由 styleToEnglish 转英文
// （图像模型主要在英文语料上训练，英文画风关键词遵循度更好）。
// 前端 STYLE_PRESETS 的 label 必须与这里的中文键完全一致。

export const STYLE_EN: Record<string, string> = {
  水彩手绘: "watercolor illustration",
  治愈系扁平: "cozy flat illustration",
  卡通3D: "cartoon 3D render",
  铅笔素描: "pencil sketch",
  复古绘本插画: "vintage storybook illustration",
  厚涂插画: "painterly illustration with visible brushstrokes",
  国风水墨: "Chinese ink wash painting",
  梦核柔和: "dreamy soft pastel",
  温暖治愈: "warm and healing",
  奇幻冒险: "whimsical and adventurous",
  清新自然: "fresh and natural",
  俏皮可爱: "cute and playful",
};

export const DEFAULT_STYLE_EN = "whimsical, cute, children's picture-book style";

/**
 * 把库里存储的 style（中文标签 / 自定义原文混合）转成英文 prompt 片段。
 * - 命中 STYLE_EN 的中文标签 → 英文
 * - 未命中（多为用户自定义英文/中文）→ 原样保留
 * - 空 → 回退默认英文串
 */
export function styleToEnglish(raw?: string | null): string {
  if (!raw || !raw.trim()) return DEFAULT_STYLE_EN;
  const parts = raw
    .split(/[，,、]/)
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.map((p) => STYLE_EN[p] ?? p).join(", ");
}
