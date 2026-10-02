// 可用音色（voice）常量与工具。
//
// 音色池有兩個来源：
//  1) tts_voice_pool 表 —— 用户在「设置 → 更新音色」中拉取微软全量列表后经 AI 筛选落库，运行时以它为准；
//  2) BUILTIN_VOICE_POOL —— 本文件的内置默认池，仅在表为空（从未更新 / 刷新失败）时兜底使用，
//     保证系统在任何情况下都能配音。

export type VoiceGender = "male" | "female";
/** mandarin=普通话, dialect=方言/地方口音, english=英文 */
export type VoiceCategory = "mandarin" | "dialect" | "english";

export interface VoiceOption {
  id: string; // 微软 ShortName，如 zh-CN-YunxiNeural
  label: string; // 中文展示名
  gender: VoiceGender;
  child?: boolean; // 童声
  tags: string[]; // 气质标签，供 AI 选角与 UI tooltip 使用
  locale?: string; // zh-CN / zh-HK / en-US ...（来自微软列表，内置池可不填）
  category?: VoiceCategory;
}

// 兜底音色：与 ttsService.ts 的 DEFAULT_VOICE 保持一致（旁白 / 对话 各一，中英各一）。
// 角色未分配专属音色、或 AI 推荐失败时，一律落到这两个值。
export const FALLBACK_VOICE = {
  narration: { zh: "zh-CN-XiaoxiaoNeural", en: "en-US-AriaNeural" },
  dialogue: { zh: "zh-CN-YunxiNeural", en: "en-US-GuyNeural" },
} as const;

/**
 * 内置默认池：只收录长期稳定且**实测存在**的音色，供首次使用与刷新失败时兜底。
 *
 * 注意：微软已下线大量中文音色（晓涵/晓梦/晓墨/晓双/云野/云泽 等均已移除），
 * 按 2026-10 实测全量列表，普通话仅剩 6 个、方言 8 个。因此内置池刻意保持精简，
 * 任何新增条目都必须先用 listVoices() 实测其 ShortName 确实存在再写入。
 */
export const BUILTIN_VOICE_POOL: VoiceOption[] = [
  // ---- 普通话（微软当前全部在售，共 6 个） ----
  { id: "zh-CN-XiaoxiaoNeural", label: "晓晓", gender: "female", tags: ["温柔", "亲切", "叙述"], locale: "zh-CN", category: "mandarin" },
  { id: "zh-CN-XiaoyiNeural", label: "晓伊", gender: "female", tags: ["明亮", "轻快", "日常"], locale: "zh-CN", category: "mandarin" },
  { id: "zh-CN-YunxiNeural", label: "云希", gender: "male", tags: ["温暖", "阳光", "对话"], locale: "zh-CN", category: "mandarin" },
  { id: "zh-CN-YunxiaNeural", label: "云夏", gender: "male", child: true, tags: ["童声", "活泼", "好奇"], locale: "zh-CN", category: "mandarin" },
  { id: "zh-CN-YunyangNeural", label: "云扬", gender: "male", tags: ["沉稳", "播报", "成熟"], locale: "zh-CN", category: "mandarin" },
  { id: "zh-CN-YunjianNeural", label: "云健", gender: "male", tags: ["有力", "激昂", "运动"], locale: "zh-CN", category: "mandarin" },

  // ---- 方言 / 地方口音（各取代表性） ----
  { id: "zh-CN-liaoning-XiaobeiNeural", label: "晓北（东北）", gender: "female", tags: ["东北话", "幽默", "接地气"], locale: "zh-CN-liaoning", category: "dialect" },
  { id: "zh-CN-shaanxi-XiaoniNeural", label: "晓妮（陕西）", gender: "female", tags: ["陕西话", "朴实", "乡土"], locale: "zh-CN-shaanxi", category: "dialect" },
  { id: "zh-HK-HiuGaaiNeural", label: "晓佳（粤语）", gender: "female", tags: ["粤语", "明快", "亲切"], locale: "zh-HK", category: "dialect" },
  { id: "zh-HK-WanLungNeural", label: "云龙（粤语）", gender: "male", tags: ["粤语", "沉稳"], locale: "zh-HK", category: "dialect" },
  { id: "zh-TW-HsiaoChenNeural", label: "晓臻（台湾）", gender: "female", tags: ["台湾腔", "温柔", "软糯"], locale: "zh-TW", category: "dialect" },
  { id: "zh-TW-YunJheNeural", label: "云哲（台湾）", gender: "male", tags: ["台湾腔", "平和"], locale: "zh-TW", category: "dialect" },

  // ---- 英文（少量，不做精细角色区分） ----
  { id: "en-US-AriaNeural", label: "Aria", gender: "female", tags: ["温和", "叙述"], locale: "en-US", category: "english" },
  { id: "en-US-JennyNeural", label: "Jenny", gender: "female", tags: ["亲和", "日常"], locale: "en-US", category: "english" },
  { id: "en-US-AvaNeural", label: "Ava", gender: "female", tags: ["明亮", "轻快"], locale: "en-US", category: "english" },
  { id: "en-US-AnaNeural", label: "Ana", gender: "female", child: true, tags: ["童声", "可爱"], locale: "en-US", category: "english" },
  { id: "en-US-GuyNeural", label: "Guy", gender: "male", tags: ["温暖", "叙述"], locale: "en-US", category: "english" },
  { id: "en-US-ChristopherNeural", label: "Christopher", gender: "male", tags: ["沉稳", "可靠"], locale: "en-US", category: "english" },
  { id: "en-US-EricNeural", label: "Eric", gender: "male", tags: ["理性", "清晰"], locale: "en-US", category: "english" },
  { id: "en-US-AndrewNeural", label: "Andrew", gender: "male", tags: ["温暖", "平和"], locale: "en-US", category: "english" },
];

/** 按 id 在池中查找音色（找不到返回 undefined）。 */
export function findVoice(pool: VoiceOption[], id: string | null | undefined): VoiceOption | undefined {
  if (!id) return undefined;
  return pool.find((v) => v.id === id);
}

/**
 * 由中文音色推导英文音色：按 gender/child 在英文池中顺序取，同性别内按 ordinal 递增，
 * 使多个同性别角色尽量拿到不同英文音色；英文池不够则复用最后一条。
 */
export function enVoiceFor(pool: VoiceOption[], gender: VoiceGender, child: boolean, ordinal: number): string {
  const en = pool.filter((v) => v.category === "english" || (v.locale || "").startsWith("en-"));
  const candidates = en.filter((v) => v.gender === gender && (child ? !!v.child : !v.child));
  const fallback = en.filter((v) => v.gender === gender);
  const list = candidates.length ? candidates : fallback;
  if (!list.length) {
    return gender === "female" ? FALLBACK_VOICE.narration.en : FALLBACK_VOICE.dialogue.en;
  }
  const idx = Math.min(Math.max(ordinal, 0), list.length - 1);
  return list[idx].id;
}
