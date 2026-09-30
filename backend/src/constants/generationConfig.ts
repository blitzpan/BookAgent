// 生图配置的默认值、解析与校验（单一来源：前端不再硬编码默认值）。
// 存于 stories.generation_config（JSON TEXT），读取时与默认值 merge，缺失字段走默认。

export interface GenerationConfig {
  frame_threshold: number;
  max_frame_retry: number;
  sequence_threshold: number;
  max_sequence_retry: number;
  initial_retry_budget: number;
  aspect_ratio: string;
  image_size: string;
}

export const DEFAULT_GENERATION_CONFIG: GenerationConfig = {
  frame_threshold: 0.75,
  max_frame_retry: 3,
  sequence_threshold: 0.8,
  max_sequence_retry: 1,
  initial_retry_budget: 1,
  aspect_ratio: "4:3",
  image_size: "2K",
};

const NUM_KEYS: Record<string, { min: number; max: number }> = {
  frame_threshold: { min: 0, max: 1 },
  sequence_threshold: { min: 0, max: 1 },
  max_frame_retry: { min: 1, max: 10 },
  max_sequence_retry: { min: 0, max: 5 },
  initial_retry_budget: { min: 1, max: 10 },
};

const STR_KEYS = ["aspect_ratio", "image_size"] as const;

/** 读取：把数据库里的 JSON 与默认值合并（NULL/缺字段/脏数据都安全回落默认值）。 */
export function mergeGenerationConfig(stored?: string | null): GenerationConfig {
  const base = { ...DEFAULT_GENERATION_CONFIG };
  if (!stored) return base;
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return base;
  }
  if (!parsed || typeof parsed !== "object") return base;
  const obj = parsed as Record<string, unknown>;
  for (const key of Object.keys(NUM_KEYS)) {
    const v = obj[key];
    if (typeof v === "number" && Number.isFinite(v)) {
      const { min, max } = NUM_KEYS[key];
      base[key as keyof GenerationConfig] = Math.min(Math.max(v, min), max) as never;
    }
  }
  for (const key of STR_KEYS) {
    const v = obj[key];
    if (typeof v === "string" && v.trim()) base[key] = v.trim();
  }
  return base;
}

/**
 * 写入：把传入的补丁收敛为合法的部分配置（未知键忽略，越界截断）。
 * 空补丁返回 {} —— 调用方据此判断"无需落库"。
 */
export function sanitizeGenerationConfigPatch(
  patch: unknown
): Partial<GenerationConfig> {
  if (!patch || typeof patch !== "object") return {};
  const obj = patch as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(NUM_KEYS)) {
    const v = obj[key];
    if (v === undefined || v === null) continue;
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n)) throw new Error(`${key} 必须是数字`);
    const { min, max } = NUM_KEYS[key];
    out[key] = Math.min(Math.max(n, min), max);
  }
  for (const key of STR_KEYS) {
    const v = obj[key];
    if (v === undefined || v === null) continue;
    if (typeof v !== "string" || !v.trim()) throw new Error(`${key} 必须是非空字符串`);
    out[key] = v.trim();
  }
  return out as Partial<GenerationConfig>;
}

/** 合并补丁到现有配置（部分更新语义：只覆盖传来的键）。 */
export function applyConfigPatch(
  stored: string | null | undefined,
  patch: unknown
): GenerationConfig {
  return { ...mergeGenerationConfig(stored), ...sanitizeGenerationConfigPatch(patch) };
}
