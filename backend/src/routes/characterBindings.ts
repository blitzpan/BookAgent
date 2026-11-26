// 故事 ↔ 角色绑定路由：GET/PUT。
// 关键约束（设计 v2）：
//  - PUT 只替换 source='user' 的行，保留 source='auto' 的绑定；
//  - custom/主角必须有角色形象且画风匹配（B1），auto 可空；
//  - 生图/改写进行中禁止改绑定。

import type { FastifyInstance } from "fastify";
import { db } from "../db/sqlite";
import { getStoryRaw } from "../services/storyService";
import { hasActiveTaskForStory } from "../services/generationService";
import { STORY_STATUS } from "../constants/status";
import {
  getCharacter,
  getBoundCharactersForStory,
  listSheetViews,
  styleMatches,
} from "../services/characterService";

const intId = (v: unknown): number => {
  const n = Number(v);
  return Number.isInteger(n) ? n : NaN;
};

type BindingView = {
  id: number;
  characterId: number;
  characterName: string;
  category: "custom" | "auto";
  charKey: string;
  sheetId: number | null;
  sheetUrl: string | null;
  sheetStyle: string | null;
  roleInStory: "protagonist" | "supporting";
  nameInStory: string | null;
  source: "user" | "auto";
};

function sheetUrl(path: string | null): string | null {
  if (!path) return null;
  return `/assets/${path.replace(/^assets[/\\]/, "")}`;
}

function readBindings(storyId: number): BindingView[] {
  return getBoundCharactersForStory(storyId).map(({ binding, character, sheet }) => ({
    id: binding.id,
    characterId: character.id,
    characterName: character.name,
    category: character.category,
    charKey: character.char_key,
    sheetId: sheet?.id ?? null,
    sheetUrl: sheetUrl(sheet?.sheet_image_path ?? null),
    sheetStyle: sheet?.style ?? null,
    roleInStory: binding.role_in_story,
    nameInStory: binding.name_in_story,
    source: binding.source,
  }));
}

export function registerCharacterBindingRoutes(app: FastifyInstance): void {
  app.get("/api/stories/:id/character-bindings", async (req, reply) => {
    const id = intId((req.params as any).id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: "invalid id" });
    if (!getStoryRaw(id)) return reply.code(404).send({ error: "故事不存在" });
    return { bindings: readBindings(id) };
  });

  app.put("/api/stories/:id/character-bindings", async (req, reply) => {
    const id = intId((req.params as any).id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: "invalid id" });
    const story = getStoryRaw(id);
    if (!story) return reply.code(404).send({ error: "故事不存在" });

    if (story.status === STORY_STATUS.REWRITING || hasActiveTaskForStory(id)) {
      return reply.code(409).send({ error: "生图或改写进行中，暂不可修改角色绑定" });
    }

    const body = req.body as {
      bindings?: Array<{
        characterId?: number;
        sheetId?: number | null;
        roleInStory?: string;
        nameInStory?: string;
      }>;
    };
    const incoming = Array.isArray(body?.bindings) ? body.bindings : [];

    // 逐条校验（B1）
    for (const b of incoming) {
      const cid = intId(b.characterId);
      const ch = getCharacter(cid);
      if (!Number.isInteger(cid) || !ch) {
        return reply.code(400).send({ error: `角色不存在: ${b.characterId}` });
      }
      const role = b.roleInStory === "protagonist" ? "protagonist" : "supporting";
      const needSheet = role === "protagonist" || ch.category === "custom";
      const sheetId = b.sheetId == null ? null : intId(b.sheetId);

      if (needSheet) {
        if (sheetId == null || !Number.isInteger(sheetId)) {
          return reply.code(409).send({
            error: `「${ch.name}」还没有角色形象，请先在角色管理生成`,
            characterId: cid,
            needSheet: true,
          });
        }
        const sheets = listSheetViews(cid);
        const sheet = sheets.find((s) => s.id === sheetId);
        if (!sheet) {
          return reply.code(409).send({
            error: `「${ch.name}」的角色形象不存在`,
            characterId: cid,
            needSheet: true,
          });
        }
        if (!styleMatches(sheet.style, story.style)) {
          return reply.code(409).send({
            error: `「${ch.name}」没有当前画风（${story.style || "默认"}）的角色形象，请先生成`,
            characterId: cid,
            needSheet: true,
          });
        }
      }
    }

    // 事务：只替换 source='user' 的行，保留 source='auto' 的行（A2）
    const tx = db.transaction(() => {
      const keepUserIds: number[] = [];
      for (const b of incoming) {
        const cid = intId(b.characterId);
        const ch = getCharacter(cid)!;
        const role = b.roleInStory === "protagonist" ? "protagonist" : "supporting";
        const sheetId = b.sheetId == null ? null : intId(b.sheetId);
        const nameInStory = b.nameInStory?.trim() || ch.name;

        // 已在表中的 user 行 → 更新；auto 行被提交 → 扶正为 user；否则新增
        const existing = db
          .prepare(`SELECT * FROM story_character_bindings WHERE story_id = ? AND character_id = ?`)
          .get(id, cid) as { id: number; source: string } | undefined;
        if (existing) {
          db.prepare(
            `UPDATE story_character_bindings
               SET character_sheet_id = ?, role_in_story = ?, name_in_story = ?, source = 'user'
             WHERE id = ?`
          ).run(sheetId, role, nameInStory, existing.id);
          keepUserIds.push(existing.id);
        } else {
          const info = db
            .prepare(
              `INSERT INTO story_character_bindings
                (story_id, character_id, character_sheet_id, role_in_story, name_in_story, source, created_at)
               VALUES (?, ?, ?, ?, ?, 'user', ?)`
            )
            .run(id, cid, sheetId, role, nameInStory, new Date().toISOString());
          keepUserIds.push(Number(info.lastInsertRowid));
        }
      }
      // 删除未被提交的 user 行（不动 auto 行）
      const userRows = db
        .prepare(`SELECT id FROM story_character_bindings WHERE story_id = ? AND source = 'user'`)
        .all(id) as Array<{ id: number }>;
      for (const r of userRows) {
        if (!keepUserIds.includes(r.id)) {
          db.prepare(`DELETE FROM story_character_bindings WHERE id = ?`).run(r.id);
        }
      }
    });
    tx();

    return { bindings: readBindings(id) };
  });
}
