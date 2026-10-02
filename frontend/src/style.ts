// 画风预设（中文标签，可多选组合）。label 必须与后端 constants/style.ts 的中文键一致，
// 后端在生图/改写时才转成英文喂给图像模型。
export const STYLE_PRESETS = [
  '水彩手绘',
  '治愈系扁平',
  '卡通3D',
  '铅笔素描',
  '复古绘本插画',
  '厚涂插画',
  '国风水墨',
  '梦核柔和',
  '温暖治愈',
  '奇幻冒险',
  '清新自然',
  '俏皮可爱',
];

const STYLE_KNOWN = new Set(STYLE_PRESETS);

/** 把库里存储的 style（中文标签 / 自定义原文混合）解析成「已选预设 + 自定义片段」。 */
export function parseStyle(raw?: string | null): { sel: string[]; custom: string } {
  if (!raw) return { sel: [], custom: '' };
  const sel: string[] = [];
  const custom: string[] = [];
  raw
    .split(/[，,、]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((p) => {
      if (STYLE_KNOWN.has(p)) sel.push(p);
      else custom.push(p);
    });
  return { sel, custom: custom.join('，') };
}

/** 预设 + 自定义片段拼回存储格式（后端按中文键转英文）。 */
export function joinStyle(sel: string[], custom: string): string {
  return [...sel, custom.trim()].filter(Boolean).join('，');
}
