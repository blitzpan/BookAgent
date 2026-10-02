// 角色音色选角：为每个重要角色挑一个互不相同的音色，其余角色走兜底音色。
//
// 产出落在 story_speaker_voices（story 级，跨配音方案复用）；生成配音时由
// resolveAudioSetConfig() 解析成 AudioSetConfig 写入 audio_sets.config_json 做快照。
// ttsService 的 pickVoice 已实现 voicesBySpeaker > voices[role] > DEFAULT_VOICE 三级优先级，
// 故本服务只负责「出配置」，不触碰合成逻辑。

import { Type } from "@google/genai";
import { db } from "../db/sqlite";
import { getTextBackend } from "../providers";
import { getVoicePool } from "./voicePoolService";
import {
  FALLBACK_VOICE,
  enVoiceFor,
  findVoice,
  type VoiceOption,
} from "../constants/voices";
import type { AudioSetConfig } from "./ttsService";

export type CastSlot = "narration" | "fallback" | "character";

export interface SpeakerVoiceRow {
  slot: CastSlot;
  speaker: string; // slot='character' 时为角色中文名，其余为 ''
  speakerEn: string | null;
  voiceZh: string | null; // 为空 = 该角色跟随兜底音色
  voiceEn: string | null;
  altVoices: string[];
  lineCount: number;
  sortOrder: number;
  source: string; // 'ai' | 'manual' | 'fallback'
  reason: string | null;
}

interface SpeakerStat {
  speaker: string;
  speakerEn: string;
  lineCount: number;
  samples: string[];
  visual?: string;
}

/** 角色拥有专属音色的门槛：台词不少于 N 句。 */
const MIN_LINES_FOR_OWN_VOICE = 2;
/** 最多给多少个角色分配专属音色（角色再多，其余走兜底）。 */
const MAX_CAST_CHARACTERS = 6;

// ===== 读取 =====

export function getSpeakerVoices(storyId: number): SpeakerVoiceRow[] {
  const rows = db
    .prepare(
      `SELECT slot, speaker, speaker_en, voice_zh, voice_en, alt_voices_json, line_count, sort_order, source, reason
       FROM story_speaker_voices WHERE story_id = ?
       ORDER BY CASE slot WHEN 'narration' THEN 0 WHEN 'fallback' THEN 1 ELSE 2 END,
                sort_order ASC, line_count DESC, id ASC`
    )
    .all(storyId) as Array<{
    slot: string;
    speaker: string | null;
    speaker_en: string | null;
    voice_zh: string | null;
    voice_en: string | null;
    alt_voices_json: string | null;
    line_count: number | null;
    sort_order: number | null;
    source: string | null;
    reason: string | null;
  }>;

  return rows.map((r) => ({
    slot: (r.slot as CastSlot) || "character",
    speaker: r.speaker || "",
    speakerEn: r.speaker_en || null,
    voiceZh: r.voice_zh || null,
    voiceEn: r.voice_en || null,
    altVoices: parseAlt(r.alt_voices_json),
    lineCount: Number(r.line_count || 0),
    sortOrder: Number(r.sort_order || 0),
    source: r.source || "ai",
    reason: r.reason || null,
  }));
}

function parseAlt(json: string | null): string[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

// ===== 角色收集 =====

/** 按 page_segments.speaker 去重统计角色台词（角色唯一可信来源，不依赖 characters 表）。 */
function collectSpeakers(storyId: number): SpeakerStat[] {
  const segs = db
    .prepare(
      `SELECT speaker, speaker_en, text_zh FROM page_segments
       WHERE story_id = ? AND role = 'dialogue' AND speaker IS NOT NULL AND TRIM(speaker) <> ''
       ORDER BY id ASC`
    )
    .all(storyId) as Array<{ speaker: string; speaker_en: string | null; text_zh: string }>;

  const map = new Map<string, SpeakerStat>();
  for (const s of segs) {
    const name = s.speaker.trim();
    let st = map.get(name);
    if (!st) {
      st = { speaker: name, speakerEn: "", lineCount: 0, samples: [] };
      map.set(name, st);
    }
    st.lineCount += 1;
    if (!st.speakerEn && s.speaker_en) st.speakerEn = s.speaker_en.trim();
    if (st.samples.length < 3 && s.text_zh) st.samples.push(s.text_zh.trim().slice(0, 40));
  }

  const chars = db
    .prepare(`SELECT name, visual_description FROM characters WHERE story_id = ?`)
    .all(storyId) as Array<{ name: string | null; visual_description: string | null }>;
  for (const st of map.values()) {
    const hit = chars.find(
      (c) => c.name && (c.name === st.speaker || c.name.includes(st.speaker) || st.speaker.includes(c.name))
    );
    if (hit?.visual_description) st.visual = hit.visual_description.slice(0, 120);
  }

  return [...map.values()].sort((a, b) => b.lineCount - a.lineCount);
}

/** 只有台词够多的重要角色才配专属音色；一个都不够格时给台词最多的角色一个。 */
function pickImportant(speakers: SpeakerStat[]): SpeakerStat[] {
  const qualified = speakers.filter((s) => s.lineCount >= MIN_LINES_FOR_OWN_VOICE);
  if (!qualified.length) return speakers.slice(0, 1);
  return qualified.slice(0, MAX_CAST_CHARACTERS);
}

// ===== AI 推荐 =====

interface AiCast {
  characters: Array<{ speaker: string; voiceZh: string; voiceEn: string | null; altVoices: string[]; reason: string | null }>;
  fallbackVoiceZh: string | null;
  narrationVoiceZh: string | null;
}

function zhCandidatePool(pool: VoiceOption[]): VoiceOption[] {
  const zh = pool.filter((v) => v.category !== "english");
  return zh.length ? zh : pool;
}

async function recommendWithAi(pool: VoiceOption[], speakers: SpeakerStat[]): Promise<AiCast | null> {
  const candidates = zhCandidatePool(pool);
  const voiceLines = candidates
    .map(
      (v) =>
        `- ${v.id}｜${v.label}｜${v.gender === "male" ? "男" : "女"}${v.child ? "｜童声" : ""}｜${v.tags.join("、")}`
    )
    .join("\n");

  const charLines = speakers
    .map(
      (s) =>
        `- ${s.speaker}${s.speakerEn ? `（英：${s.speakerEn}）` : ""}｜台词 ${s.lineCount} 句${
          s.visual ? `｜形象：${s.visual}` : ""
        }${s.samples.length ? `｜示例：${s.samples.map((t) => `「${t}」`).join("")}` : ""}`
    )
    .join("\n");

  const systemInstruction = `You are casting voice actors for a Chinese children's picture book.
Assign ONE distinct text-to-speech voice to each story character. The output is fed straight to a speech synthesizer, so every voiceId you emit MUST exist in the VOICES list below — an invented id is dropped and that character silently falls back to a default voice.

# Inputs
- VOICES: the available voice catalogue (id ｜ Chinese label ｜ gender ｜ 童声 if child ｜ temperament tags). These are the ONLY valid ids.
- CHARACTERS: the story's characters, already sorted by importance (most lines first). Each shows its line-count — more lines means a more important character.

# Hard rules (violations produce wrong or duplicate audio)
1. Copy every "voiceId" and every "speaker" VERBATIM. Never invent, guess, translate, shorten, or edit them.
2. No voiceId may appear twice across ALL characters, the narration voice, the fallback voice, AND every character's "alternates". The union of assigned voices + all alternates must be globally unique.
3. Assign in the CHARACTERS order (most important first). If there are MORE characters than distinct voices, give voices to the most important ones and STOP — never reuse a voice for the rest. Leftover minor characters automatically use the fallback voice.
4. "narrationVoiceZh" and "fallbackVoiceZh" must EACH differ from every character's chosen voice and from each other.

# Matching guidance
- Match voice to persona: gender, approximate age (child or animal characters → child-like 童声 voice), and temperament (gentle, lively, grumpy, wise, timid...).
- Prefer Standard Mandarin (zh-CN). Use a dialect voice ONLY when the character clearly calls for local colour.
- "alternates": up to 2 extra voices for the SAME character, also globally unique per rule 2.

# Output fields
- casting: one object per assigned character, in CHARACTERS order: { speaker, voiceId, alternates[], reason }.
- reason: one short Chinese sentence (≤ 18 chars) on why this voice fits the character.
- narrationVoiceZh: a warm, clear storytelling/narrator voice.
- fallbackVoiceZh: a neutral, all-purpose dialogue voice for minor characters.

Return ONLY JSON that matches the schema.`;

  const userPrompt = `VOICES (${candidates.length}):\n${voiceLines}\n\nCHARACTERS (${speakers.length}):\n${charLines}`;

  const json = await getTextBackend().generateJSON({
    systemInstruction,
    parts: [{ text: userPrompt }],
    schema: {
      type: Type.OBJECT,
      properties: {
        casting: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              speaker: { type: Type.STRING },
              voiceId: { type: Type.STRING },
              alternates: { type: Type.ARRAY, items: { type: Type.STRING } },
              reason: { type: Type.STRING },
            },
            required: ["speaker", "voiceId"],
          },
        },
        narrationVoiceId: { type: Type.STRING },
        fallbackVoiceId: { type: Type.STRING },
      },
      required: ["casting"],
    },
    role: "text",
  });

  const raw: Array<{ speaker: string; voiceId: string; alternates?: string[]; reason?: string }> =
    Array.isArray(json?.casting) ? json.casting : [];
  if (!raw.length) return null;

  // 校验：id 必须在池中；并按角色去重，撞了的从池中挑下一个未用项。
  const used = new Set<string>();
  const bySpeaker = new Map(speakers.map((s) => [s.speaker, s]));
  const characters: AiCast["characters"] = [];
  let femaleOrdinal = 0;
  let maleOrdinal = 0;

  for (const item of raw) {
    const speaker = String(item?.speaker || "").trim();
    const stat = bySpeaker.get(speaker);
    if (!stat) continue;

    let voiceId = String(item?.voiceId || "").trim();
    let voice = findVoice(candidates, voiceId);
    if (!voice || used.has(voice.id)) {
      voice = candidates.find((v) => !used.has(v.id));
      if (!voice) break;
    }
    used.add(voice.id);

    const alts = (Array.isArray(item?.alternates) ? item.alternates : [])
      .map((a) => String(a))
      .filter((a) => candidates.some((v) => v.id === a) && !used.has(a))
      .slice(0, 2);

    const ordinal = voice.gender === "male" ? maleOrdinal++ : femaleOrdinal++;
    characters.push({
      speaker,
      voiceZh: voice.id,
      voiceEn: enVoiceFor(pool, voice.gender, !!voice.child, ordinal),
      altVoices: alts,
      reason: item?.reason ? String(item.reason) : null,
    });
  }

  if (!characters.length) return null;

  const pickVoiceOr = (id: any, def: string): string => {
    const v = findVoice(candidates, String(id || "").trim());
    return v && !used.has(v.id) ? v.id : def;
  };

  return {
    characters,
    narrationVoiceZh: pickVoiceOr(json?.narrationVoiceId, FALLBACK_VOICE.narration.zh),
    fallbackVoiceZh: pickVoiceOr(json?.fallbackVoiceId, FALLBACK_VOICE.dialogue.zh),
  };
}

// ===== 确定性兜底 =====

/** AI 不可用时的兜底：按角色顺序在普通话池中轮流取，保证互不重复；池不够则复用兜底音色。 */
function deterministicCasting(pool: VoiceOption[], speakers: SpeakerStat[]): AiCast {
  const candidates = zhCandidatePool(pool);
  let femaleOrdinal = 0;
  let maleOrdinal = 0;
  const characters = speakers.map((s, i) => {
    const v = candidates[i] || findVoice(candidates, FALLBACK_VOICE.dialogue.zh) || candidates[0];
    const ordinal = v.gender === "male" ? maleOrdinal++ : femaleOrdinal++;
    return {
      speaker: s.speaker,
      voiceZh: v?.id || FALLBACK_VOICE.dialogue.zh,
      voiceEn: enVoiceFor(pool, v?.gender || "male", !!v?.child, ordinal),
      altVoices: [] as string[],
      reason: "AI 选角不可用，按音色池顺序兜底分配",
    };
  });
  return {
    characters,
    narrationVoiceZh: FALLBACK_VOICE.narration.zh,
    fallbackVoiceZh: FALLBACK_VOICE.dialogue.zh,
  };
}

// ===== 落库 =====

function upsertRow(
  storyId: number,
  row: {
    slot: CastSlot;
    speaker: string;
    speakerEn: string | null;
    voiceZh: string | null;
    voiceEn: string | null;
    altVoices: string[];
    lineCount: number;
    sortOrder: number;
    source: string;
    reason: string | null;
  }
): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO story_speaker_voices
       (story_id, slot, speaker, speaker_en, voice_zh, voice_en, alt_voices_json, line_count, sort_order, source, reason, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(story_id, slot, speaker) DO UPDATE SET
       speaker_en = excluded.speaker_en,
       voice_zh = excluded.voice_zh,
       voice_en = excluded.voice_en,
       alt_voices_json = excluded.alt_voices_json,
       line_count = excluded.line_count,
       sort_order = excluded.sort_order,
       source = excluded.source,
       reason = excluded.reason,
       updated_at = excluded.updated_at`
  ).run(
    storyId,
    row.slot,
    row.speaker,
    row.speakerEn,
    row.voiceZh,
    row.voiceEn,
    JSON.stringify(row.altVoices),
    row.lineCount,
    row.sortOrder,
    row.source,
    row.reason,
    now,
    now
  );
}

function saveCast(
  storyId: number,
  cast: AiCast,
  speakers: SpeakerStat[],
  source: string,
  force: boolean
): void {
  const existing = getSpeakerVoices(storyId);
  const statOf = (name: string) => speakers.find((s) => s.speaker === name);

  // 旁白 / 兜底：仅在缺失（或强制且非手工设置）时写入。
  for (const slot of ["narration", "fallback"] as CastSlot[]) {
    const row = existing.find((r) => r.slot === slot);
    const shouldWrite = !row || (force && row.source !== "manual");
    if (!shouldWrite) continue;
    const voiceZh = slot === "narration" ? cast.narrationVoiceZh : cast.fallbackVoiceZh;
    upsertRow(storyId, {
      slot,
      speaker: "",
      speakerEn: null,
      voiceZh: voiceZh || (slot === "narration" ? FALLBACK_VOICE.narration.zh : FALLBACK_VOICE.dialogue.zh),
      voiceEn: slot === "narration" ? FALLBACK_VOICE.narration.en : FALLBACK_VOICE.dialogue.en,
      altVoices: [],
      lineCount: 0,
      sortOrder: 0,
      source,
      reason: slot === "narration" ? "叙述者音色" : "未分配音色的角色统一使用此音色",
    });
  }

  cast.characters.forEach((c, i) => {
    const st = statOf(c.speaker);
    upsertRow(storyId, {
      slot: "character",
      speaker: c.speaker,
      speakerEn: st?.speakerEn || null,
      voiceZh: c.voiceZh,
      voiceEn: c.voiceEn,
      altVoices: c.altVoices,
      lineCount: st?.lineCount || 0,
      sortOrder: i,
      source,
      reason: c.reason || null,
    });
  });

  // 未分配专属音色的角色也建行（voice 为空），让页面能列出它们并标注「走兜底」，
  // 用户可随时给其中某个角色单独指定音色。
  const casted = new Set(cast.characters.map((c) => c.speaker));
  let extra = 0;
  for (const s of speakers) {
    if (casted.has(s.speaker)) continue;
    upsertRow(storyId, {
      slot: "character",
      speaker: s.speaker,
      speakerEn: s.speakerEn || null,
      voiceZh: null,
      voiceEn: null,
      altVoices: [],
      lineCount: s.lineCount,
      sortOrder: cast.characters.length + extra++,
      source: "fallback",
      reason: "台词较少，统一使用兜底音色",
    });
  }
}

// ===== 对外入口 =====

/**
 * 确保故事已有角色音色配置：无配置时跑一次 AI 推荐（失败则用确定性兜底）。
 * force=true（「AI 重新推荐」按钮）时覆盖已有角色行；手工设置过的旁白/兜底行保留。
 */
export async function ensureCasting(
  storyId: number,
  opts?: { force?: boolean }
): Promise<SpeakerVoiceRow[]> {
  const existing = getSpeakerVoices(storyId);
  if (existing.length && !opts?.force) return existing;

  const pool = getVoicePool();
  const speakers = collectSpeakers(storyId);
  const important = pickImportant(speakers);

  let cast: AiCast | null = null;
  let source = "ai";
  if (important.length) {
    try {
      cast = await recommendWithAi(pool, important);
    } catch (e: any) {
      console.error(`[voiceCasting] story=${storyId} AI 选角失败:`, e?.message || e);
    }
  }
  if (!cast) {
    cast = deterministicCasting(pool, important);
    source = "fallback";
  }

  saveCast(storyId, cast, speakers, source, !!opts?.force);
  return getSpeakerVoices(storyId);
}

/** 保存用户在页面上的手工选择（source 置为 manual）。 */
export function saveSpeakerVoices(
  storyId: number,
  items: Array<{ slot: CastSlot; speaker?: string; voiceZh?: string | null; voiceEn?: string | null }>
): SpeakerVoiceRow[] {
  const existing = getSpeakerVoices(storyId);

  items.forEach((it) => {
    const prev = existing.find((r) => r.slot === it.slot && r.speaker === (it.speaker || ""));
    // 显式传 null = 清空（该角色跟随兜底）；未传该字段 = 保留原值。
    const voiceZh = it.voiceZh !== undefined ? it.voiceZh : (prev?.voiceZh ?? null);
    const voiceEn = it.voiceEn !== undefined ? it.voiceEn : (prev?.voiceEn ?? null);
    upsertRow(storyId, {
      slot: it.slot,
      speaker: it.speaker || "",
      speakerEn: prev?.speakerEn ?? null,
      voiceZh,
      voiceEn,
      altVoices: prev?.altVoices || [],
      lineCount: prev?.lineCount || 0,
      sortOrder: prev?.sortOrder || 0,
      source: "manual",
      reason: prev?.reason ?? null,
    });
  });

  return getSpeakerVoices(storyId);
}

/** 解析成 AudioSetConfig，生成配音时写入 audio_sets.config_json 做快照。 */
export function resolveAudioSetConfig(storyId: number): AudioSetConfig {
  const rows = getSpeakerVoices(storyId);
  const narration = rows.find((r) => r.slot === "narration");
  const fallback = rows.find((r) => r.slot === "fallback");

  const voices = {
    narration: {
      zh: narration?.voiceZh || FALLBACK_VOICE.narration.zh,
      en: narration?.voiceEn || FALLBACK_VOICE.narration.en,
    },
    dialogue: {
      zh: fallback?.voiceZh || FALLBACK_VOICE.dialogue.zh,
      en: fallback?.voiceEn || FALLBACK_VOICE.dialogue.en,
    },
  };

  const voicesBySpeaker: Record<string, { zh: string; en: string }> = {};
  for (const r of rows) {
    if (r.slot !== "character" || !r.speaker) continue;
    if (!r.voiceZh && !r.voiceEn) continue;
    voicesBySpeaker[r.speaker] = {
      zh: r.voiceZh || voices.dialogue.zh,
      en: r.voiceEn || voices.dialogue.en,
    };
  }

  // page_segments.speaker 落库时未 trim（storyService 直接写 AI 原值），而合成时 pickVoice
  // 用的是原始拼写。这里把带空白的原始拼写也注册一份，避免「小兔子 」这类名字静默丢音色。
  const rawSpeakers = db
    .prepare(`SELECT DISTINCT speaker FROM page_segments WHERE story_id = ? AND role = 'dialogue'`)
    .all(storyId) as Array<{ speaker: string | null }>;
  for (const { speaker } of rawSpeakers) {
    if (!speaker || speaker === speaker.trim()) continue;
    const hit = voicesBySpeaker[speaker] ?? voicesBySpeaker[speaker.trim()];
    if (hit) voicesBySpeaker[speaker] = hit;
  }

  return { voices, voicesBySpeaker };
}
