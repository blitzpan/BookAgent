// 图片落盘工具：dataURL <-> 磁盘文件，统一相对路径约定。
// 页图：assets/{story_id}/{page_id}/{image_id}.png
// 锚图：assets/{story_id}/anchors/{character_id}.png
// 灵感图：assets/{story_id}/inspiration.{ext}

import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "../db/sqlite";

function extFromDataUrl(dataUrl: string): string {
  const [header] = dataUrl.split(",");
  const mime = /data:(.*?);base64/.exec(header)?.[1] ?? "image/png";
  if (mime.includes("jpeg")) return "jpg";
  if (mime.includes("webp")) return "webp";
  return "png";
}

function mimeFromExt(ext: string): string {
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  return "image/png";
}

/** 把 dataURL 写入磁盘，返回相对 DATA_DIR 的路径（如 assets/1/anchors/7.png）。 */
export function writeDataUrl(dataUrl: string, relativePath: string): string {
  const abs = path.join(DATA_DIR, relativePath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const [, b64] = dataUrl.split(",");
  fs.writeFileSync(abs, Buffer.from(b64, "base64"));
  return relativePath;
}

/** 相对路径 -> dataURL（供 director / 接口返回时读取）。 */
export function readDataUrl(relativePath: string): string {
  const abs = path.join(DATA_DIR, relativePath);
  const b64 = fs.readFileSync(abs).toString("base64");
  const ext = path.extname(abs).slice(1).toLowerCase();
  return `data:${mimeFromExt(ext)};base64,${b64}`;
}

/** 灵感图专用：保存并返回相对路径（ext 由 dataURL 推导）。 */
export function saveInspiration(storyId: number, dataUrl: string): string {
  const ext = extFromDataUrl(dataUrl);
  return writeDataUrl(dataUrl, `assets/${storyId}/inspiration.${ext}`);
}

/** 锚图专用：assets/{story_id}/anchors/{character_id}.png */
export function saveSheet(
  storyId: number,
  characterId: number,
  dataUrl: string
): string {
  return writeDataUrl(dataUrl, `assets/${storyId}/anchors/${characterId}.png`);
}

/** 页图专用：assets/{story_id}/{page_id}/{image_id}.png */
export function savePageImage(
  storyId: number,
  pageId: number,
  imageId: number,
  dataUrl: string
): string {
  return writeDataUrl(
    dataUrl,
    `assets/${storyId}/${pageId}/${imageId}.png`
  );
}

/** 读取某故事全部锚图，返回 { characterId: dataUrl }。 */
export function loadSheetDataUrls(storyId: number): Record<number, string> {
  const dir = path.join(DATA_DIR, `assets/${storyId}/anchors`);
  const map: Record<number, string> = {};
  if (!fs.existsSync(dir)) return map;
  for (const f of fs.readdirSync(dir)) {
    const m = /^(\d+)\.png$/.exec(f);
    if (m) {
      const id = Number(m[1]);
      map[id] = readDataUrl(`assets/${storyId}/anchors/${f}`);
    }
  }
  return map;
}
