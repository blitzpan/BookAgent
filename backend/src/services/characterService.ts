// 角色库服务：角色（custom/auto）、照片、角色形象（锚图）、故事绑定的数据访问与业务校验。
//
// 改版要点：角色独立于故事与 run，先有角色再由故事引用；auto 角色由生图流程自动生成并入库；
// 一致性参考通过 story_character_bindings + char_key 串起，不再依赖旧的 characters.story_id/run。

import { db } from "../db/sqlite";
import {
  saveCharacterPhoto,
  saveCharacterSheet,
  readDataUrl,
  removeAsset,
} from "../storage/imageStore";
import {
  extractCharacters,
  generateCharacterSheet,
  generateImage,
} from "./geminiService";
import type { ExtractedCharacter } from "./geminiService";
import { styleToEnglish, stylesMatch as stylesMatchCore, styleTokens } from "../constants/style";
import { logger, timer } from "../logger";
import type {
  Character,
  CharacterBasicAttributes,
  CharacterPhoto,
  CharacterSheet,
  StoryCharacterBinding,
} from "../types";

const now = () => new Date().toISOString();

// ===================== 视图类型 =====================

export interface SheetView {
  id: number;
  style: string;
  url: string;
  promptUsed: string | null;
  sourcePhotoIds: number[];
  createdAt: string | null;
}

export interface CharacterView {
  id: number;
  charKey: string;
  name: string;
  category: "custom" | "auto";
  basicAttributes: CharacterBasicAttributes;
  visualDescription: string | null;
  sourceStoryId: number | null;
  sheets: SheetView[];
  photoCount: number;
  createdAt: string | null;
}

/** 限制档案字段规模，避免自由文本无限膨胀 prompt（内部使用，轻量校验即可）。 */
function sanitizeAttributes(input?: CharacterBasicAttributes): CharacterBasicAttributes {
  if (!input || typeof input !== "object") return {};
  const clip = (v: unknown, max: number): string =>
    typeof v === "string" ? v.slice(0, max) : v == null ? "" : String(v).slice(0, max);
  const list = (v: unknown, max: number): string[] =>
    Array.isArray(v)
      ? v.slice(0, 20).map((x) => clip(x, max)).filter(Boolean)
      : [];
  return {
    gender: clip(input.gender, 40),
    age: clip(input.age, 40),
    hobbies: list(input.hobbies, 80),
    habits: list(input.habits, 80),
    allergies: list(input.allergies, 80),
  };
}

function parseAttributes(json: string | null): CharacterBasicAttributes {
  if (!json) return {};
  try {
    const v = JSON.parse(json);
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

function toUrl(rel: string | null): string | null {
  if (!rel) return null;
  return `/assets/${rel.replace(/^assets[/\\]/, "")}`;
}

function sheetView(row: CharacterSheet): SheetView {
  let ids: number[] = [];
  try {
    const v = JSON.parse(row.source_photo_ids_json || "[]");
    if (Array.isArray(v)) ids = v.map((x) => Number(x)).filter((n) => Number.isFinite(n));
  } catch {
    /* ignore */
  }
  return {
    id: row.id,
    style: row.style,
    url: toUrl(row.sheet_image_path) ?? "",
    promptUsed: row.prompt_used,
    sourcePhotoIds: ids,
    createdAt: row.created_at,
  };
}

function getSheets(characterId: number): CharacterSheet[] {
  return db
    .prepare(`SELECT * FROM character_sheets WHERE character_id = ? ORDER BY id ASC`)
    .all(characterId) as CharacterSheet[];
}

function getPhotos(characterId: number): CharacterPhoto[] {
  return db
    .prepare(`SELECT * FROM character_photos WHERE character_id = ? ORDER BY id ASC`)
    .all(characterId) as CharacterPhoto[];
}

export function getCharacter(id: number): Character | undefined {
  return db
    .prepare(`SELECT * FROM characters WHERE id = ? AND deleted_at IS NULL`)
    .get(id) as Character | undefined;
}

function toView(ch: Character): CharacterView {
  return {
    id: ch.id,
    charKey: ch.char_key,
    name: ch.name,
    category: ch.category,
    basicAttributes: parseAttributes(ch.basic_attributes_json),
    visualDescription: ch.visual_description,
    sourceStoryId: ch.source_story_id,
    sheets: getSheets(ch.id).map(sheetView),
    photoCount: getPhotos(ch.id).length,
    createdAt: ch.created_at,
  };
}

export function getCharacterDetail(id: number): CharacterView | null {
  const ch = getCharacter(id);
  return ch ? toView(ch) : null;
}

export function listCharacters(filter?: {
  category?: "custom" | "auto";
  q?: string;
}): CharacterView[] {
  const where = ["deleted_at IS NULL"];
  const params: unknown[] = [];
  if (filter?.category) {
    where.push("category = ?");
    params.push(filter.category);
  }
  if (filter?.q) {
    where.push("(name LIKE ? OR visual_description LIKE ?)");
    params.push(`%${filter.q}%`, `%${filter.q}%`);
  }
  const rows = db
    .prepare(`SELECT * FROM characters WHERE ${where.join(" AND ")} ORDER BY id DESC`)
    .all(...params) as Character[];
  return rows.map(toView);
}

// ===================== char_key 生成 =====================

const slug = (s: string): string =>
  s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "character";

function uniqueCharKey(base: string): string {
  let key = base;
  let i = 1;
  while (db.prepare(`SELECT 1 FROM characters WHERE char_key = ?`).get(key)) {
    key = `${base}_${i++}`;
  }
  return key;
}

// ===================== 角色 CRUD =====================

export function createCharacter(input: {
  name: string;
  category?: "custom" | "auto";
  basicAttributes?: CharacterBasicAttributes;
  visualDescription?: string;
  sourceStoryId?: number | null;
  charKey?: string;
}): CharacterView {
  const category = input.category ?? "custom";
  const base =
    input.charKey ??
    (category === "custom" ? `child_${slug(input.name)}` : slug(input.name));
  const charKey = uniqueCharKey(base);
  const info = db
    .prepare(
      `INSERT INTO characters
        (char_key, name, category, basic_attributes_json, visual_description, source_story_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      charKey,
      input.name,
      category,
      JSON.stringify(sanitizeAttributes(input.basicAttributes)),
      input.visualDescription ?? null,
      input.sourceStoryId ?? null,
      now(),
      now()
    );
  return getCharacterDetail(Number(info.lastInsertRowid))!;
}

export function updateCharacter(
  id: number,
  patch: {
    name?: string;
    basicAttributes?: CharacterBasicAttributes;
    visualDescription?: string;
    category?: "custom" | "auto";
  }
): CharacterView {
  const ch = getCharacter(id);
  if (!ch) throw new Error("角色不存在");
  const sets: string[] = [];
  const args: unknown[] = [];
  if (patch.name !== undefined) {
    sets.push("name = ?");
    args.push(patch.name);
  }
  if (patch.basicAttributes !== undefined) {
    sets.push("basic_attributes_json = ?");
    args.push(JSON.stringify(sanitizeAttributes(patch.basicAttributes)));
  }
  if (patch.visualDescription !== undefined) {
    sets.push("visual_description = ?");
    args.push(patch.visualDescription);
  }
  if (patch.category !== undefined) {
    sets.push("category = ?");
    args.push(patch.category);
  }
  if (sets.length) {
    sets.push("updated_at = ?");
    args.push(now(), id);
    db.prepare(`UPDATE characters SET ${sets.join(", ")} WHERE id = ?`).run(...args);
  }
  return getCharacterDetail(id)!;
}

/** 引用检查：只统计未软删故事的绑定。 */
export function characterReferenceCount(characterId: number): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n
       FROM story_character_bindings b
       JOIN stories s ON s.id = b.story_id
       WHERE b.character_id = ? AND s.deleted_at IS NULL`
    )
    .get(characterId) as { n: number };
  return Number(row?.n ?? 0);
}

export function softDeleteCharacter(id: number): void {
  if (!getCharacter(id)) throw new Error("角色不存在");
  db.prepare(`UPDATE characters SET deleted_at = ?, updated_at = ? WHERE id = ?`).run(now(), now(), id);
}

// ===================== 照片 =====================

export function addPhotos(
  characterId: number,
  dataUrls: string[]
): Array<{ id: number; url: string }> {
  const ch = getCharacter(characterId);
  if (!ch) throw new Error("角色不存在");
  if (ch.category !== "custom") throw new Error("仅自定义角色可上传照片");
  const out: Array<{ id: number; url: string }> = [];
  const tx = db.transaction(() => {
    for (const du of dataUrls) {
      const info = db
        .prepare(`INSERT INTO character_photos (character_id, photo_path, created_at) VALUES (?, ?, ?)`)
        .run(characterId, "", now());
      const id = Number(info.lastInsertRowid);
      const rel = saveCharacterPhoto(characterId, id, du);
      db.prepare(`UPDATE character_photos SET photo_path = ? WHERE id = ?`).run(rel, id);
      out.push({ id, url: toUrl(rel) ?? "" });
    }
  });
  tx();
  return out;
}

export function listPhotosForCharacter(characterId: number): Array<{ id: number; url: string }> {
  return getPhotos(characterId).map((p) => ({ id: p.id, url: toUrl(p.photo_path) ?? "" }));
}

export function deletePhoto(characterId: number, photoId: number): void {
  const row = db
    .prepare(`SELECT * FROM character_photos WHERE id = ? AND character_id = ?`)
    .get(photoId, characterId) as CharacterPhoto | undefined;
  if (!row) throw new Error("照片不存在");
  db.prepare(`DELETE FROM character_photos WHERE id = ?`).run(photoId);
  removeAsset(row.photo_path);
}

// ===================== 角色形象（锚图）=====================

export function listSheetViews(characterId: number): SheetView[] {
  return getSheets(characterId).map(sheetView);
}

/** 判断画风是否匹配故事画风（统一委托 constants/style 的规范化语义）。 */
export function styleMatches(sheetStyle: string, storyStyle: string | null): boolean {
  return stylesMatchCore(sheetStyle, storyStyle);
}

export interface GenerateSheetResult {
  sheet: SheetView;
  replaced: boolean;
}

export async function generateSheetForCharacter(
  characterId: number,
  input: { style: string; photoIds: number[]; extraPrompt?: string },
  replace = false
): Promise<GenerateSheetResult> {
  const ch = getCharacter(characterId);
  if (!ch) throw new Error("角色不存在");

  const existing = getSheets(characterId).find((s) => s.style === input.style);
  if (existing && !replace) {
    const err = new Error("该画风角色形象已存在，是否重新生成？") as Error & { code?: string };
    err.code = "SHEET_EXISTS";
    throw err;
  }

  const photos = getPhotos(characterId).filter((p) => input.photoIds.includes(p.id));
  if (!photos.length) throw new Error("请至少选择一张有效照片");

  const photosDataUrls = photos.map((p) => readDataUrl(p.photo_path));
  const attrs = parseAttributes(ch.basic_attributes_json);
  const profileBits: string[] = [];
  if (attrs.gender) profileBits.push(String(attrs.gender));
  if (attrs.age !== undefined && attrs.age !== "") profileBits.push(`about ${attrs.age} years old`);
  const prompt =
    `CHARACTER SHEET for ${ch.name}.\n` +
    `Style: ${styleToEnglish(input.style)}.\n` +
    `${ch.visual_description ?? ""}\n` +
    (input.extraPrompt ? `${input.extraPrompt}\n` : "") +
    (profileBits.length ? `PROFILE: ${profileBits.join(", ")}.\n` : "") +
    `Clean neutral background. Full body, clear view. CHILD-SAFE ONLY.`;

  const t = timer();
  const dataUrl = await generateCharacterSheet(prompt, photosDataUrls, input.style);

  // 替换：新建行拿新 id → 新文件名（绕开 immutable 缓存）→ binding 改指新 id → 删旧行。
  const info = db
    .prepare(
      `INSERT INTO character_sheets
        (character_id, style, sheet_image_path, source_photo_ids_json, prompt_used, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(characterId, input.style, "", JSON.stringify(input.photoIds), prompt, now());
  const sheetId = Number(info.lastInsertRowid);
  const rel = saveCharacterSheet(characterId, sheetId, dataUrl);
  db.prepare(`UPDATE character_sheets SET sheet_image_path = ? WHERE id = ?`).run(rel, sheetId);

  const tx = db.transaction(() => {
    if (replace && existing) {
      db.prepare(`UPDATE story_character_bindings SET character_sheet_id = ? WHERE character_sheet_id = ?`).run(sheetId, existing.id);
      db.prepare(`DELETE FROM character_sheets WHERE id = ?`).run(existing.id);
      removeAsset(existing.sheet_image_path);
    }
  });
  tx();

  logger.info("character", "sheet_generated", {
    characterId,
    style: input.style,
    photoCount: photos.length,
    replace: replace && !!existing,
    duration_ms: t.elapsedMs(),
  });

  return {
    sheet: {
      id: sheetId,
      style: input.style,
      url: toUrl(rel) ?? "",
      promptUsed: prompt,
      sourcePhotoIds: input.photoIds,
      createdAt: now(),
    },
    replaced: replace && !!existing,
  };
}

export function deleteSheet(characterId: number, sheetId: number): void {
  const sheet = db
    .prepare(`SELECT * FROM character_sheets WHERE id = ? AND character_id = ?`)
    .get(sheetId, characterId) as CharacterSheet | undefined;
  if (!sheet) throw new Error("角色形象不存在");
  const refs = db
    .prepare(`SELECT COUNT(*) AS n FROM story_character_bindings WHERE character_sheet_id = ?`)
    .get(sheetId) as { n: number };
  if (Number(refs?.n ?? 0) > 0) throw new Error("该角色形象被故事引用，请先解除绑定");
  db.prepare(`DELETE FROM character_sheets WHERE id = ?`).run(sheetId);
  removeAsset(sheet.sheet_image_path);
}

// ===================== 生图期：加载绑定形象 + auto 临时角色 =====================

/** 该故事所有绑定的角色（主角排前），供生图与详情展示。 */
export function getBoundCharactersForStory(storyId: number): Array<{
  binding: StoryCharacterBinding;
  character: Character;
  sheet: CharacterSheet | null;
}> {
  const rows = db
    .prepare(
      `SELECT b.id AS b_id, b.story_id AS b_story_id, b.character_id AS b_character_id,
              b.character_sheet_id AS b_character_sheet_id, b.role_in_story AS b_role_in_story,
              b.name_in_story AS b_name_in_story, b.source AS b_source, b.created_at AS b_created_at,
              c.*
       FROM story_character_bindings b
       JOIN characters c ON c.id = b.character_id AND c.deleted_at IS NULL
       WHERE b.story_id = ?
       ORDER BY CASE WHEN b.role_in_story = 'protagonist' THEN 0 ELSE 1 END, b.id ASC`
    )
    .all(storyId) as any[];
  return rows.map((r) => ({
    binding: {
      id: r.b_id,
      story_id: r.b_story_id,
      character_id: r.b_character_id,
      character_sheet_id: r.b_character_sheet_id,
      role_in_story: r.b_role_in_story,
      name_in_story: r.b_name_in_story,
      source: r.b_source,
      created_at: r.b_created_at,
    },
    character: {
      id: r.id,
      char_key: r.char_key,
      name: r.name,
      category: r.category,
      basic_attributes_json: r.basic_attributes_json,
      visual_description: r.visual_description,
      source_story_id: r.source_story_id,
      created_at: r.created_at,
      updated_at: r.updated_at,
      deleted_at: r.deleted_at,
    },
    sheet: r.b_character_sheet_id
      ? (db.prepare(`SELECT * FROM character_sheets WHERE id = ?`).get(r.b_character_sheet_id) as CharacterSheet)
      : null,
  }));
}

/**
 * 加载已绑定角色形象：返回 char_key -> dataURL 的映射，以及 ExtractedLike 列表（主角在前）。
 * 只处理已有 sheet 的绑定；auto 且无 sheet 的由 ensureAutoCharacters 补齐。
 */
export function loadBoundSheets(storyId: number): {
  extracted: ExtractedLike[];
  sheetMap: Map<string, string>;
} {
  const bound = getBoundCharactersForStory(storyId);
  const extracted: ExtractedLike[] = [];
  const sheetMap = new Map<string, string>();
  for (const { binding, character, sheet } of bound) {
    const name = binding.name_in_story || character.name;
    extracted.push({
      id: character.char_key,
      name,
      visualDescription: character.visual_description || name,
    });
    if (sheet?.sheet_image_path) {
      try {
        sheetMap.set(character.char_key, readDataUrl(sheet.sheet_image_path));
      } catch {
        /* 文件缺失则跳过该参考 */
      }
    }
  }
  return { extracted, sheetMap };
}

export interface ExtractedLike {
  id: string;
  name: string;
  visualDescription: string;
}

/**
 * 为尚未绑定形象的 auto 角色生成临时锚图并入库（生图流程调用）。
 * 去重完全由 SQL 条件（source='auto' AND character_sheet_id IS NULL）保证。
 */
export async function ensureAutoCharacters(
  storyId: number,
  runId: number,
  style: string,
  sourceText: string
): Promise<{ created: number }> {
  // 只处理 source='auto' 且尚无 sheet 的绑定对应的角色；这类绑定在首次生图时由 story-draft 流程建立。
  const pending = db
    .prepare(
      `SELECT b.character_id, b.name_in_story, c.char_key, c.visual_description
       FROM story_character_bindings b
       JOIN characters c ON c.id = b.character_id AND c.deleted_at IS NULL
       WHERE b.story_id = ? AND b.source = 'auto' AND b.character_sheet_id IS NULL`
    )
    .all(storyId) as Array<{
    character_id: number;
    name_in_story: string | null;
    char_key: string;
    visual_description: string | null;
  }>;

  if (!pending.length) return { created: 0 };

  let created = 0;
  for (const row of pending) {
    const desc = row.visual_description || row.name_in_story || "the character";
    const sheetPrompt =
      `CHARACTER SHEET for ${row.name_in_story || desc}.\n` +
      `Style: ${style}.\n` +
      `Clean neutral background. Full body, clear view.\n` +
      `Exact character: ${desc}.\n` +
      `CHILD-SAFE ONLY: no violence, no gore, no adult themes.`;
    try {
      const dataUrl = await generateImage(sheetPrompt, [], { aspectRatio: "1:1" });
      const info = db
        .prepare(
          `INSERT INTO character_sheets (character_id, style, sheet_image_path, prompt_used, created_at)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(row.character_id, style, "", sheetPrompt, now());
      const sheetId = Number(info.lastInsertRowid);
      const rel = saveCharacterSheet(row.character_id, sheetId, dataUrl);
      db.prepare(`UPDATE character_sheets SET sheet_image_path = ? WHERE id = ?`).run(rel, sheetId);
      db.prepare(`UPDATE story_character_bindings SET character_sheet_id = ? WHERE character_id = ? AND story_id = ? AND source = 'auto'`).run(
        sheetId,
        row.character_id,
        storyId
      );
      created++;
      logger.info("anchor", "generated", {
        storyId,
        runId,
        characterId: row.character_id,
        style,
        auto: true,
      });
    } catch (err) {
      logger.error("character", "auto_sheet_failed", {
        storyId,
        runId,
        characterId: row.character_id,
        error: String(err),
      });
    }
  }
  return { created };
}

/**
 * 从故事文本抽取临时角色，建为 auto 角色 + auto 绑定（首次生图前调用，替代旧 ensureAnchors 的抽取部分）。
 * 已有绑定（custom 主角或 auto）的角色名会被跳过。
 */
export async function discoverAutoCharactersFromStory(
  storyId: number,
  style: string,
  sourceText: string
): Promise<{ created: number }> {
  const existing = getBoundCharactersForStory(storyId);
  const boundNames = existing.map(
    (b) => (b.binding.name_in_story || b.character.name).toLowerCase()
  );
  let extracted: ExtractedCharacter[] = [];
  try {
    extracted = await extractCharacters(sourceText, style);
  } catch {
    extracted = [];
  }
  // 兜底：故事未抽出任何角色且无任何绑定时，建一个通用主角（与原 ensureAnchors 行为一致）。
  if (!extracted.length && !existing.length) {
    const view = createCharacter({
      name: "Main character",
      category: "auto",
      visualDescription: "the main character described in the story",
      sourceStoryId: storyId,
      charKey: "main_character",
    });
    db.prepare(
      `INSERT INTO story_character_bindings
        (story_id, character_id, character_sheet_id, role_in_story, name_in_story, source, created_at)
       VALUES (?, ?, NULL, 'protagonist', 'Main character', 'auto', ?)`
    ).run(storyId, view.id, now());
    return { created: 1 };
  }

  let created = 0;
  for (const ch of extracted.slice(0, 5)) {
    const name = (ch.name || "Main character").trim();
    // 精确匹配（忽略大小写/首尾空白）：双向 includes 会把「小雨」与「小雨点精灵」等
    // 有包含关系的不同角色误合并，导致故事里的角色不生成锚图。
    if (boundNames.some((n) => n && n === name.toLowerCase())) {
      continue;
    }
    const view = createCharacter({
      name,
      category: "auto",
      visualDescription: ch.visualDescription || name,
      sourceStoryId: storyId,
      charKey: ch.id || slug(name),
    });
    db.prepare(
      `INSERT INTO story_character_bindings
        (story_id, character_id, character_sheet_id, role_in_story, name_in_story, source, created_at)
       VALUES (?, ?, NULL, 'supporting', ?, 'auto', ?)`
    ).run(storyId, view.id, name, now());
    created++;
  }
  return { created };
}

/** 由角色 id 列表拼主角档案（草稿旁路用，此时故事尚未落库）；第一个为主角。 */
export function buildProtagonistContextFromIds(characterIds?: number[]): string {
  if (!Array.isArray(characterIds) || !characterIds.length) return "";
  const ch = getCharacter(intOrZero(characterIds[0]));
  if (!ch) return "";
  const attrs = parseAttributes(ch.basic_attributes_json);
  const lines: string[] = [`名字：${ch.name}`];
  if (attrs.gender) lines.push(String(attrs.gender));
  if (attrs.age !== undefined && attrs.age !== "") lines.push(`${attrs.age} 岁`);
  const list = (key: "hobbies" | "habits" | "allergies", label: string) => {
    const v = attrs[key];
    if (Array.isArray(v) && v.length) lines.push(`${label}：${v.join("、")}`);
  };
  list("hobbies", "爱好");
  list("habits", "生活习惯与性格");
  list("allergies", "过敏/需注意");
  if (ch.visual_description) lines.push(`外貌与随身物品：${ch.visual_description}`);
  return (
    `\n\n【本书主角档案（必须体现在故事里）】\n${lines.join("\n")}\n` +
    `要求：把主角自然融入情节，让上述属性变成具体、温暖、适合 3–8 岁儿童的生活情境，` +
    `不要生硬罗列；涉及过敏/习惯的内容要正面化解，不渲染恐惧。`
  );
}

function intOrZero(v: unknown): number {
  const n = Number(v);
  return Number.isInteger(n) ? n : 0;
}

/** 把主角属性拼成注入故事生成/改写的「主角档案」块；无主角返回空串。 */
export function buildProtagonistContext(storyId: number): string {
  const bound = getBoundCharactersForStory(storyId);
  const prot = bound.find((b) => b.binding.role_in_story === "protagonist");
  if (!prot) return "";
  const attrs = parseAttributes(prot.character.basic_attributes_json);
  const name = prot.binding.name_in_story || prot.character.name;
  const lines: string[] = [`名字：${name}`];
  if (attrs.gender) lines.push(String(attrs.gender));
  if (attrs.age !== undefined && attrs.age !== "") lines.push(`${attrs.age} 岁`);
  const list = (key: "hobbies" | "habits" | "allergies", label: string) => {
    const v = attrs[key];
    if (Array.isArray(v) && v.length) lines.push(`${label}：${v.join("、")}`);
  };
  list("hobbies", "爱好");
  list("habits", "生活习惯与性格");
  list("allergies", "过敏/需注意");
  if (prot.character.visual_description) lines.push(`外貌与随身物品：${prot.character.visual_description}`);
  return (
    `\n\n【本书主角档案（必须体现在故事里）】\n${lines.join("\n")}\n` +
    `要求：把主角自然融入情节，让上述属性变成具体、温暖、适合 3–8 岁儿童的生活情境，` +
    `不要生硬罗列；涉及过敏/习惯的内容要正面化解，不渲染恐惧。`
  );
}

/**
 * 改写清理 auto 绑定后，回收由此故事抽取、且已无任何绑定的孤儿 auto 角色（含其形象与照片）。
 * 被用户「扶正」为 custom 或被其它故事引用的角色保留。返回回收数量。
 */
export function purgeOrphanAutoCharacters(storyId: number): number {
  const candidates = db
    .prepare(
      `SELECT c.id FROM characters c
       WHERE c.category = 'auto' AND c.source_story_id = ? AND c.deleted_at IS NULL`
    )
    .all(storyId) as Array<{ id: number }>;
  let purged = 0;
  const tx = db.transaction(() => {
    for (const c of candidates) {
      const refs = db
        .prepare(`SELECT COUNT(*) AS n FROM story_character_bindings WHERE character_id = ?`)
        .get(c.id) as { n: number };
      if (Number(refs?.n ?? 0) > 0) continue;
      const sheets = db.prepare(`SELECT id, sheet_image_path FROM character_sheets WHERE character_id = ?`).all(c.id) as Array<{ id: number; sheet_image_path: string }>;
      for (const s of sheets) {
        db.prepare(`DELETE FROM character_sheets WHERE id = ?`).run(s.id);
        removeAsset(s.sheet_image_path);
      }
      db.prepare(`DELETE FROM character_photos WHERE character_id = ?`).run(c.id);
      db.prepare(`UPDATE characters SET deleted_at = ?, updated_at = ? WHERE id = ?`).run(now(), now(), c.id);
      purged++;
    }
  });
  tx();
  return purged;
}

/**
 * 生图前置校验（D2：不允许跨画风凑数）。
 * 返回因「缺对应画风形象」而阻断生图的角色（主角/自定义角色）。auto 配角允许无形象。
 */
export function validateBindingsForGeneration(storyId: number, storyStyle: string | null): Array<{
  characterId: number;
  name: string;
  reason: string;
}> {
  if (styleTokens(storyStyle).length === 0) return []; // 未指定画风 → 不阻断（走默认）
  const blocked: Array<{ characterId: number; name: string; reason: string }> = [];
  for (const { binding, character, sheet } of getBoundCharactersForStory(storyId)) {
    const needSheet = binding.role_in_story === "protagonist" || character.category === "custom";
    if (!needSheet) continue;
    const name = binding.name_in_story || character.name;
    if (!sheet?.sheet_image_path) {
      blocked.push({ characterId: character.id, name, reason: "尚无角色形象" });
    } else if (!stylesMatchCore(sheet.style, storyStyle)) {
      blocked.push({ characterId: character.id, name, reason: `无「${storyStyle}」画风的角色形象` });
    }
  }
  return blocked;
}

/** 供 voiceCastingService 用：故事绑定角色的 name + visual_description（替代旧 characters.story_id 查询）。 */
export function getCharacterDescriptionsForStory(
  storyId: number
): Array<{ name: string | null; visual_description: string | null }> {
  return db
    .prepare(
      `SELECT c.name, c.visual_description
       FROM story_character_bindings b
       JOIN characters c ON c.id = b.character_id AND c.deleted_at IS NULL
       WHERE b.story_id = ?`
    )
    .all(storyId) as Array<{ name: string | null; visual_description: string | null }>;
}
