// Reader 端数据类型，字段对齐 backend 真实响应（见 docs/reader-dev-prompt.md §2）。
// 注意：后端返回 snake_case（DB 原行），这里在 api/client.ts 中已映射为 camelCase。

export type LangMode = "zh" | "en" | "both";
export type ReadMode = "single" | "spread";

export interface Hotspot {
  x: number; // 归一化 0~1
  y: number;
  w: number;
  h: number;
  type: string;
  payload: string;
}

/** 单页阅读数据 */
export interface ReaderPage {
  pageNumber: number;
  textZh: string | null; // 来自 page.text_zh（MVP 多为 null）
  textEn: string | null; // 来自 page.text_en
  imageUrl: string | null; // 来自 default_image.image_path 拼 API_BASE；无图则 null
  audioUrl?: string; // 预留：每页音频（后端未来入库）
  hotspots?: Hotspot[]; // 预留：热区（后端未来入库）
}

/** 书架卡片 */
export interface ShelfBook {
  id: number;
  userTitle: string | null;
  status: string;
  pageCount: number;
  createdAt: string | null;
  coverUrl: string | null; // 当前后端列表不带图，恒为 null（标题卡占位）
}
