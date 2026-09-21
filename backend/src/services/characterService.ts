// 角色锚图服务：整书生图前抽取角色并生成"角色表"(anchor)，
// 后续页面以这些锚图作为参考以保证一致性。已存在则复用（避免重复生图）。

import { db } from "../db/sqlite";
import { saveSheet, loadSheetDataUrls } from "../storage/imageStore";
import { extractCharacters, generateImage } from "./geminiService";
import type { ExtractedCharacter } from "./geminiService";

const now = () => new Date().toISOString();

export interface CharacterSheet {
  id: number;
  char_key: string;
  name: string;
  visualDescription: string;
  dataUrl: string | null;
}

export function getCharacters(storyId: number): CharacterSheet[] {
  return db
    .prepare(
      `SELECT id, char_key, name, visual_description, sheet_image_path
       FROM characters WHERE story_id = ? ORDER BY id ASC`
    )
    .all(storyId) as CharacterSheet[];
}

function attachDataUrls(
  storyId: number,
  chars: CharacterSheet[]
): CharacterSheet[] {
  const map = loadSheetDataUrls(storyId); // keyed by numeric character id
  return chars.map((c) => ({ ...c, dataUrl: map[c.id] ?? null }));
}

/** char_key -> 锚图 dataURL 映射，供每页 buildRefsForPage 选用。 */
export function loadSheetMap(storyId: number): Map<string, string> {
  const m = new Map<string, string>();
  for (const c of attachDataUrls(storyId, getCharacters(storyId))) {
    if (c.dataUrl) m.set(c.char_key, c.dataUrl);
  }
  return m;
}

/**
 * 确保故事已有角色锚图：已有则直接复用；否则抽取 + 逐张生图 + 落库。
 * 返回 { characters（含 dataUrl）, extracted（角色定义，供一致性逻辑） }。
 */
export async function ensureAnchors(
  storyId: number,
  runId: number,
  style: string,
  sourceText: string
): Promise<{
  characters: CharacterSheet[];
  extracted: ExtractedCharacter[];
}> {
  const existing = getCharacters(storyId);
  if (existing.length) {
    const chars = attachDataUrls(storyId, existing);
    return {
      characters: chars,
      extracted: chars.map((c) => ({
        id: c.char_key,
        name: c.name,
        visualDescription: c.visualDescription,
      })),
    };
  }

  let extracted = await extractCharacters(sourceText, style);
  if (!extracted || extracted.length === 0) {
    extracted = [
      {
        id: "main_character",
        name: "Main character",
        visualDescription: "the main character described in the story",
      },
    ];
  }
  extracted = extracted.slice(0, 5);

  const created: CharacterSheet[] = [];
  for (const ch of extracted) {
    const info = db
      .prepare(
        `INSERT INTO characters
          (story_id, generation_run_id, char_key, name, visual_description, sheet_image_path)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(storyId, runId, ch.id, ch.name, ch.visualDescription, null);
    const id = Number(info.lastInsertRowid);

    const sheetPrompt =
      `CHARACTER SHEET for ${ch.name}.\n` +
      `Style: ${style}.\n` +
      `Clean neutral background. Full body, clear view.\n` +
      `Exact character: ${ch.visualDescription}.\n` +
      `Do not add extra props unless described.\n` +
      `CHILD-SAFE ONLY: no violence, no gore, no adult themes.`;

    const dataUrl = await generateImage(sheetPrompt, [], { aspectRatio: "1:1" });
    const relPath = saveSheet(storyId, id, dataUrl);
    db.prepare(`UPDATE characters SET sheet_image_path = ? WHERE id = ?`).run(
      relPath,
      id
    );
    created.push({
      id,
      char_key: ch.id,
      name: ch.name,
      visualDescription: ch.visualDescription,
      dataUrl,
    });
  }
  return { characters: created, extracted };
}
