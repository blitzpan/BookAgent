// 前后端共用的小工具。

/** 浏览器 File -> inlineData（上传灵感图用）。 */
export const fileToGenerativePart = async (file: File) => {
  const base64EncodedDataPromise = new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () =>
      resolve((reader.result as string).split(",")[1]);
    reader.readAsDataURL(file);
  });

  return {
    inlineData: {
      data: await base64EncodedDataPromise,
      mimeType: file.type,
    },
  };
};

/** dataURL -> inlineData（给 director 看已生成好的 PNG）。 */
export const dataUrlToInlineImagePart = (dataUrl: string) => {
  const [header, base64] = dataUrl.split(",");
  const mimeMatch = /data:(.*?);base64/.exec(header);
  const mimeType = mimeMatch?.[1] ?? "image/png";

  return {
    inlineData: {
      data: base64,
      mimeType,
    },
  };
};

/**
 * 组装图像生成的完整 prompt（REFERENCE ROLES 约定）。
 * 所有参考图均为角色锚图（CHARACTER SHEETS）；不再传入"上一页整图"作为风格参考，
 * 因为图像模型会整体复刻参考图构图，导致第 N 页复制第 N-1 页。
 * 多个后端（Gemini / Seedream / Ark / Bailian）共用，保证 prompt 口径一致。
 */
export const buildImagePrompt = (prompt: string): string =>
  `REFERENCE ROLES (must follow):\n` +
  `- All reference images are CHARACTER SHEETS. You MUST match their species, fur/skin colors, clothing, and accessories exactly.\n` +
  `- If the story text conflicts with the refs, keep character appearance consistent with the CHARACTER SHEETS.\n\n` +
  `${prompt}\n` +
  `IMPORTANT: Follow the page text literally. Do not invent extra major objects or characters.\n`;

/** dataURL 或远程 URL -> dataURL（供 Seedream / Ark 图像接口使用）。 */
export async function toDataUrl(input: string): Promise<string> {
  if (input.startsWith("data:")) return input;
  const res = await fetch(input);
  const blob = await res.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read image blob."));
    reader.readAsDataURL(blob);
  });
}
