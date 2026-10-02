// 音色池维护：拉取微软全量音色 → AI 筛选 → 校验 → 落库 tts_voice_pool。
//
// 设计要点：
//  - 运行时读库，库空则回落内置默认池（constants/voices.ts），保证任何情况下都能配音；
//  - AI 只负责「挑哪些音色 + 给中文名和气质标签」，gender/locale/category 一律以微软返回的真实字段为准；
//  - AI 返回的 id 必须与本次拉取到的真实列表取交集，非法 id 直接丢弃（否则合成会 NoAudioReceived）。

import { Type } from "@google/genai";
import { listVoices } from "edge-tts-universal";
import { db } from "../db/sqlite";
import { getTextBackend } from "../providers";
import {
  BUILTIN_VOICE_POOL,
  type VoiceCategory,
  type VoiceGender,
  type VoiceOption,
} from "../constants/voices";

export interface VoicePoolStats {
  total: number;
  mandarin: number;
  dialect: number;
  english: number;
  updatedAt: string | null;
  source: "ai" | "builtin";
}

/**
 * 筛选目标数量（只是给 AI 的软目标，不强制）。
 * 注意：微软在售中文音色远少于预期（2026-10 实测普通话仅 6 个），
 * 因此这里允许 AI 返回远少于目标的数量——合法性比凑数重要。
 */
const TARGET = { mandarin: 25, dialect: 4, english: 8 } as const;

const FETCH_TIMEOUT_MS = Number(process.env.VOICE_FETCH_TIMEOUT_MS) || 30000;

function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(msg)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

interface RawVoice {
  ShortName: string;
  Locale: string;
  Gender: string;
  FriendlyName?: string;
  VoiceTag?: { VoicePersonalities?: string[]; ContentCategories?: string[] };
}

/** 拉取微软全量音色列表。 */
async function fetchMicrosoftVoices(): Promise<RawVoice[]> {
  const list = await withTimeout(
    listVoices(),
    FETCH_TIMEOUT_MS,
    `拉取微软音色列表超时（>${FETCH_TIMEOUT_MS}ms）`
  );
  return (Array.isArray(list) ? list : []).map((v: any) => ({
    ShortName: String(v?.ShortName || ""),
    Locale: String(v?.Locale || ""),
    Gender: String(v?.Gender || ""),
    FriendlyName: String(v?.FriendlyName || ""),
    VoiceTag: v?.VoiceTag,
  }));
}

/** 本地预筛：只保留中文（含方言）与美式英文，把 400+ 压到 ~80 条再喂 AI。 */
function prefilter(list: RawVoice[]): RawVoice[] {
  return list.filter((v) => {
    if (!v.ShortName) return false;
    const loc = v.Locale.toLowerCase();
    if (loc === "en-us") return true;
    return loc.startsWith("zh");
  });
}

function isPlainMandarin(v: RawVoice): boolean {
  return v.Locale.toLowerCase() === "zh-cn";
}
function isDialect(v: RawVoice): boolean {
  const loc = v.Locale.toLowerCase();
  return loc.startsWith("zh") && loc !== "zh-cn";
}

interface AiPick {
  id: string;
  label: string;
  tags: string[];
  child?: boolean;
}

/** AI 筛选：按 mandarin / dialect / english 三组返回音色 id + 中文名 + 气质标签。 */
async function filterWithAi(candidates: RawVoice[]): Promise<Record<VoiceCategory, AiPick[]>> {
  const lines = candidates
    .map((v) => {
      const traits = (v.VoiceTag?.VoicePersonalities || []).join("、");
      const cats = (v.VoiceTag?.ContentCategories || []).join("、");
      return `- ${v.ShortName} | ${v.Locale} | ${v.Gender} | ${v.FriendlyName}${traits ? " | " + traits : ""}${cats ? " | " + cats : ""}`;
    })
    .join("\n");

  // 把每组「候选池里实际有多少条」直接告诉模型：微软在售中文音色远少于直觉
  // （实测普通话仅 6 个），不给出真实数量时模型会为了凑目标数而编造 id。
  const counts = {
    mandarin: candidates.filter((v) => isPlainMandarin(v)).length,
    dialect: candidates.filter((v) => isDialect(v)).length,
    english: candidates.filter((v) => v.Locale === "en-US").length,
  };

  const systemInstruction = `You curate the text-to-speech voice catalogue for a Chinese children's picture-book app.
The picked voices are shown to users in a dropdown AND fed to a later "cast one distinct voice per story character" step.

# Hard rules (violations make the output useless)
1. Copy every "id" verbatim from the CANDIDATE list. Never invent, guess or edit an id. Invented ids are dropped automatically and only waste the result.
2. An id may appear in AT MOST ONE of the three groups.
3. Return fewer items rather than padding. If a group has only ${Math.min(counts.mandarin, 3)} usable voices, return ${Math.min(counts.mandarin, 3)}. Accuracy beats hitting a target number.

# What to keep
- Voices that sound natural reading picture-book narration and character dialogue aloud.
- Temperament fits children's content: prefer VoicePersonalities like Warm, Gentle, Cheerful, Cute, Friendly, Pleasant, Lively, Sunshine.
- Stable, mainstream voices. A voice is risky if its ContentCategories are ONLY from {News, Sports, Copilot}, or if it looks like a limited/preview variant.

# What to drop
- Anything tuned for ads, customer service, newsreading or sports commentary.
- "Multilingual" variants of English voices (keep the plain en-US one).
- For mandarin: any voice with a regional accent (those belong in "dialect").

# Groups
- "mandarin": Standard Mandarin, locale exactly zh-CN, no regional accent. Target up to ${TARGET.mandarin}; the candidate list only has ${counts.mandarin}. If available, make sure the group ends up with at least one adult female, one adult male, and one child-like voice.
- "dialect": up to ${TARGET.dialect} of the most recognizable regional Chinese voices (Northeast Mandarin, Shaanxi, Cantonese zh-HK, Taiwan zh-TW). Candidate list has ${counts.dialect}.
- "english": about ${TARGET.english} plain en-US voices. Candidate list has ${counts.english}. Cover female narration, male narration, and one child-like voice if available.

# Fields per item
- "label": short display name in Chinese, 2-4 chars (e.g. "晓晓", "云希"). English voices may keep their English name.
- "tags": 2-3 short Chinese adjectives on temperament (e.g. ["温柔", "叙述"]).
- "child": true only if the voice clearly sounds like a child.

# Ordering
Sort each group by usefulness, most suitable for picture books first. This order is used as a tie-breaker later, so put the safest, most versatile voice first.

Example item: {"id":"zh-CN-XiaoxiaoNeural","label":"晓晓","tags":["温柔","亲切"],"child":false}

Return ONLY JSON that matches the schema.`;

  const userPrompt =
    `CANDIDATE VOICES (${candidates.length} total: zh-CN ${counts.mandarin} / dialect ${counts.dialect} / en-US ${counts.english}):\n` +
    lines;

  const json = await getTextBackend().generateJSON({
    systemInstruction,
    parts: [{ text: userPrompt }],
    schema: {
      type: Type.OBJECT,
      properties: {
        mandarin: { type: Type.ARRAY, items: pickItemSchema() },
        dialect: { type: Type.ARRAY, items: pickItemSchema() },
        english: { type: Type.ARRAY, items: pickItemSchema() },
      },
      required: ["mandarin", "english"],
    },
    role: "text",
  });

  return {
    mandarin: normalizePicks(json?.mandarin),
    dialect: normalizePicks(json?.dialect),
    english: normalizePicks(json?.english),
  };
}

function pickItemSchema() {
  return {
    type: Type.OBJECT,
    properties: {
      id: { type: Type.STRING },
      label: { type: Type.STRING },
      tags: { type: Type.ARRAY, items: { type: Type.STRING } },
      child: { type: Type.BOOLEAN },
    },
    required: ["id", "label"],
  };
}

function normalizePicks(raw: any): AiPick[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((p: any) => ({
      id: String(p?.id || "").trim(),
      label: String(p?.label || "").trim(),
      tags: Array.isArray(p?.tags) ? p.tags.map((t: any) => String(t)).filter(Boolean).slice(0, 3) : [],
      child: p?.child === true,
    }))
    .filter((p) => p.id.length > 0);
}

/** 与真实列表取交集，补齐 gender/locale/category，去重。 */
function buildPool(candidates: RawVoice[], picks: Record<VoiceCategory, AiPick[]>): VoiceOption[] {
  const byId = new Map<string, RawVoice>();
  for (const v of candidates) byId.set(v.ShortName, v);

  const out: VoiceOption[] = [];
  const seen = new Set<string>();
  const order: VoiceCategory[] = ["mandarin", "dialect", "english"];

  for (const category of order) {
    for (const p of picks[category]) {
      if (seen.has(p.id)) continue;
      const raw = byId.get(p.id);
      if (!raw) continue; // 非法 id：丢弃
      seen.add(p.id);
      out.push({
        id: p.id,
        label: p.label || shortNameToLabel(p.id),
        gender: (raw.Gender === "Male" ? "male" : "female") as VoiceGender,
        child: !!p.child,
        tags: p.tags.length ? p.tags : ["自然"],
        locale: raw.Locale,
        category,
      });
    }
  }
  return out;
}

/** 兜底展示名：zh-CN-YunxiNeural → 云希 */
function shortNameToLabel(id: string): string {
  const m = id.match(/-([A-Za-z]+)Neural$/);
  return m ? m[1] : id;
}

/** 落库：整表替换（一次事务，COMMIT 后统一落盘）。 */
function savePool(pool: VoiceOption[]): void {
  const now = new Date().toISOString();
  const replace = db.transaction(() => {
    db.prepare(`DELETE FROM tts_voice_pool`).run();
    // 注意：sqlite.ts 的 Stmt 每次执行后即 free，不能复用，须逐条 prepare。
    for (const v of pool) {
      db.prepare(
        `INSERT INTO tts_voice_pool (voice_id, locale, label, gender, child, tags_json, category, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        v.id,
        v.locale || null,
        v.label,
        v.gender,
        v.child ? 1 : 0,
        JSON.stringify(v.tags),
        v.category || "mandarin",
        now
      );
    }
  });
  replace();
}

/** 读取音色池：DB 优先，空则回落内置默认池。 */
export function getVoicePool(): VoiceOption[] {
  try {
    const rows = db
      .prepare(
        `SELECT voice_id, locale, label, gender, child, tags_json, category
         FROM tts_voice_pool ORDER BY id ASC`
      )
      .all() as Array<{
      voice_id: string;
      locale: string | null;
      label: string | null;
      gender: string | null;
      child: number | null;
      tags_json: string | null;
      category: string | null;
    }>;
    if (!rows.length) return BUILTIN_VOICE_POOL;
    return rows.map((r) => ({
      id: r.voice_id,
      label: r.label || shortNameToLabel(r.voice_id),
      gender: (r.gender === "male" ? "male" : "female") as VoiceGender,
      child: !!r.child,
      tags: safeTags(r.tags_json),
      locale: r.locale || undefined,
      category: (r.category || "mandarin") as VoiceCategory,
    }));
  } catch {
    return BUILTIN_VOICE_POOL;
  }
}

function safeTags(json: string | null): string[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

/** 音色池统计（供设置页展示）。 */
export function getVoicePoolStats(): VoicePoolStats {
  const pool = getVoicePool();
  const updatedAt = getPoolUpdatedAt();
  const count = (c: VoiceCategory) => pool.filter((v) => v.category === c).length;
  return {
    total: pool.length,
    mandarin: count("mandarin"),
    dialect: count("dialect"),
    english: count("english"),
    updatedAt,
    source: updatedAt ? "ai" : "builtin",
  };
}

function getPoolUpdatedAt(): string | null {
  try {
    const row = db.prepare(`SELECT MAX(updated_at) AS t FROM tts_voice_pool`).get() as
      | { t: string | null }
      | undefined;
    return row?.t || null;
  } catch {
    return null;
  }
}

/**
 * 刷新音色池：拉取 → AI 筛选 → 校验 → 落库。
 * 任一步失败都抛出错误，由路由层转成 500；此时旧池保持不变。
 */
export async function refreshVoicePool(): Promise<VoicePoolStats> {
  const all = await fetchMicrosoftVoices();
  if (!all.length) throw new Error("拉取到的音色列表为空");

  const candidates = prefilter(all);
  if (!candidates.length) throw new Error("预筛后无可用中文/英文音色");

  const picks = await filterWithAi(candidates);
  const pool = buildPool(candidates, picks);
  if (!pool.length) throw new Error("AI 未返回任何合法音色");

  savePool(pool);
  console.log(
    `[voicePool] 已更新音色池：共 ${pool.length} 条（普通话 ${picks.mandarin.length} / 方言 ${picks.dialect.length} / 英文 ${picks.english.length}）`
  );
  return getVoicePoolStats();
}
