// 角色管理路由：角色 CRUD、照片上传/删除、角色形象（锚图）生成与维护。

import type { FastifyInstance } from "fastify";
import {
  listCharacters,
  getCharacterDetail,
  createCharacter,
  updateCharacter,
  softDeleteCharacter,
  characterReferenceCount,
  addPhotos,
  deletePhoto,
  listPhotosForCharacter,
  listSheetViews,
  generateSheetForCharacter,
  deleteSheet,
} from "../services/characterService";

const intId = (v: unknown): number => {
  const n = Number(v);
  return Number.isInteger(n) ? n : NaN;
};

export function registerCharacterRoutes(app: FastifyInstance): void {
  // 列表
  app.get("/api/characters", async (req) => {
    const q = req.query as { category?: string; q?: string };
    const category = q.category === "custom" || q.category === "auto" ? q.category : undefined;
    return {
      characters: listCharacters({ category, q: q.q?.trim() || undefined }),
    };
  });

  // 新建
  app.post("/api/characters", async (req, reply) => {
    const body = req.body as {
      name?: string;
      category?: string;
      basicAttributes?: Record<string, unknown>;
      visualDescription?: string;
    };
    if (!body?.name?.trim()) return reply.code(400).send({ error: "name 不能为空" });
    const category = body.category === "auto" ? "auto" : "custom";
    const ch = createCharacter({
      name: body.name.trim(),
      category,
      basicAttributes: body.basicAttributes,
      visualDescription: body.visualDescription,
    });
    return reply.code(201).send({ character: ch });
  });

  // 详情
  app.get("/api/characters/:id", async (req, reply) => {
    const id = intId((req.params as any).id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: "invalid id" });
    const ch = getCharacterDetail(id);
    if (!ch) return reply.code(404).send({ error: "角色不存在" });
    return { character: ch };
  });

  // 更新
  app.patch("/api/characters/:id", async (req, reply) => {
    const id = intId((req.params as any).id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: "invalid id" });
    const body = req.body as {
      name?: string;
      basicAttributes?: Record<string, unknown>;
      visualDescription?: string;
      category?: string;
      confirmCategoryChange?: boolean;
    };
    if (!getCharacterDetail(id)) return reply.code(404).send({ error: "角色不存在" });
    if (body.category && body.category !== "custom" && body.category !== "auto") {
      return reply.code(400).send({ error: "invalid category" });
    }
    const current = getCharacterDetail(id)!;
    if (body.category && body.category !== current.category && body.confirmCategoryChange !== true) {
      return reply.code(409).send({
        error: `切换角色类别（${current.category}→${body.category}）需确认：请带 confirmCategoryChange=true`,
        needConfirmCategoryChange: true,
      });
    }
    try {
      const ch = updateCharacter(id, {
        name: body.name?.trim(),
        basicAttributes: body.basicAttributes,
        visualDescription: body.visualDescription,
        category:
          body.category === "custom" || body.category === "auto"
            ? body.category
            : undefined,
      });
      return { character: ch };
    } catch (err: any) {
      return reply.code(400).send({ error: err?.message ?? String(err) });
    }
  });

  // 删除（软删；被未删故事引用则拒绝）
  app.delete("/api/characters/:id", async (req, reply) => {
    const id = intId((req.params as any).id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: "invalid id" });
    if (!getCharacterDetail(id)) return reply.code(404).send({ error: "角色不存在" });
    const refs = characterReferenceCount(id);
    if (refs > 0) {
      return reply.code(409).send({ error: `该角色被 ${refs} 本故事引用，请先解除绑定` });
    }
    softDeleteCharacter(id);
    return { ok: true };
  });

  // ===== 照片 =====
  app.get("/api/characters/:id/photos", async (req, reply) => {
    const id = intId((req.params as any).id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: "invalid id" });
    if (!getCharacterDetail(id)) return reply.code(404).send({ error: "角色不存在" });
    return { photos: listPhotosForCharacter(id) };
  });

  app.post("/api/characters/:id/photos", { bodyLimit: 20 * 1024 * 1024 }, async (req, reply) => {
    const id = intId((req.params as any).id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: "invalid id" });
    const body = req.body as { images?: string[] };
    if (!Array.isArray(body?.images) || !body.images.length) {
      return reply.code(400).send({ error: "images 不能为空" });
    }
    if (body.images.length > 10) {
      return reply.code(400).send({ error: "单次最多上传 10 张照片" });
    }
    try {
      return reply.code(201).send({ photos: addPhotos(id, body.images) });
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      return reply.code(msg.includes("仅自定义") ? 409 : 400).send({ error: msg });
    }
  });

  app.delete("/api/characters/:id/photos/:photoId", async (req, reply) => {
    const id = intId((req.params as any).id);
    const photoId = intId((req.params as any).photoId);
    if (!Number.isInteger(id) || !Number.isInteger(photoId)) {
      return reply.code(400).send({ error: "invalid id" });
    }
    try {
      deletePhoto(id, photoId);
      return { ok: true };
    } catch (err: any) {
      return reply.code(404).send({ error: err?.message ?? String(err) });
    }
  });

  // ===== 角色形象（锚图）=====
  app.get("/api/characters/:id/sheets", async (req, reply) => {
    const id = intId((req.params as any).id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: "invalid id" });
    if (!getCharacterDetail(id)) return reply.code(404).send({ error: "角色不存在" });
    return { sheets: listSheetViews(id) };
  });

  app.post("/api/characters/:id/sheets", async (req, reply) => {
    const id = intId((req.params as any).id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: "invalid id" });
    const body = req.body as { style?: string; photoIds?: number[]; extraPrompt?: string };
    if (!body?.style?.trim()) return reply.code(400).send({ error: "style 不能为空" });
    if (!Array.isArray(body.photoIds) || !body.photoIds.length) {
      return reply.code(400).send({ error: "photoIds 不能为空" });
    }
    const replace = (req.query as any)?.replace === "1";
    try {
      const result = await generateSheetForCharacter(
        id,
        {
          style: body.style.trim(),
          photoIds: body.photoIds.map(Number).filter((n) => Number.isInteger(n)),
          extraPrompt: body.extraPrompt,
        },
        replace
      );
      return reply.code(201).send(result);
    } catch (err: any) {
      if (err?.code === "SHEET_EXISTS") {
        return reply.code(409).send({ error: err.message, needReplace: true });
      }
      return reply.code(400).send({ error: err?.message ?? String(err) });
    }
  });

  app.delete("/api/characters/:id/sheets/:sheetId", async (req, reply) => {
    const id = intId((req.params as any).id);
    const sheetId = intId((req.params as any).sheetId);
    if (!Number.isInteger(id) || !Number.isInteger(sheetId)) {
      return reply.code(400).send({ error: "invalid id" });
    }
    try {
      deleteSheet(id, sheetId);
      return { ok: true };
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      return reply.code(msg.includes("引用") ? 409 : 404).send({ error: msg });
    }
  });
}
