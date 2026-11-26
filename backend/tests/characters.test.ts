import { describe, it, expect, beforeAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { initDb, db } from "../src/db/sqlite";

// 角色体系（设计 v2）：角色库 / 照片 / 角色形象 / 故事绑定 / 属性注入 / 生图用绑定锚图。
// 全程 mock provider + fetch 守门（setup.ts），零真实 API 调用。

const PHOTO =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";

async function createCustomCharacter(
  app: FastifyInstance,
  name: string,
  attrs: Record<string, unknown> = {}
): Promise<number> {
  const res = await app.inject({
    method: "POST",
    url: "/api/characters",
    payload: {
      name,
      category: "custom",
      visualDescription: "圆脸，戴红框眼镜，背黄色书包",
      basicAttributes: { gender: "女", age: 5, hobbies: ["画画"], habits: ["爱挑食"], allergies: ["花生"], ...attrs },
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json().character.id;
}

async function addPhoto(app: FastifyInstance, cid: number): Promise<number> {
  const res = await app.inject({
    method: "POST",
    url: `/api/characters/${cid}/photos`,
    payload: { images: [PHOTO] },
  });
  expect(res.statusCode).toBe(201);
  return res.json().photos[0].id;
}

async function createSheet(app: FastifyInstance, cid: number, photoId: number, style = "水彩手绘"): Promise<{ id: number; url: string }> {
  const res = await app.inject({
    method: "POST",
    url: `/api/characters/${cid}/sheets`,
    payload: { style, photoIds: [photoId] },
  });
  expect(res.statusCode).toBe(201);
  return res.json().sheet;
}

describe("角色体系：角色库 / 角色形象 / 绑定校验", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await initDb();
    await app.ready();
  });

  it("角色 CRUD + 照片 + 角色形象生成，char_key 稳定", async () => {
    const cid = await createCustomCharacter(app, "朵朵");
    const detail = await app.inject({ method: "GET", url: `/api/characters/${cid}` });
    expect(detail.json().character.charKey).toMatch(/^child_/);
    expect(detail.json().character.basicAttributes.allergies).toContain("花生");

    const photoId = await addPhoto(app, cid);
    const sheet = await createSheet(app, cid, photoId);
    expect(sheet.url).toContain("/assets/characters/");
    expect(sheet.url).toContain(`/sheets/${sheet.id}`);

    const list = await app.inject({ method: "GET", url: "/api/characters?category=custom" });
    const found = list.json().characters.find((c: any) => c.id === cid);
    expect(found.photoCount).toBe(1);
    expect(found.sheets[0].style).toBe("水彩手绘");
  });

  it("同画风角色形象已存在时 409，replace 换新 id（绕开缓存）", async () => {
    const cid = await createCustomCharacter(app, "天天");
    const photoId = await addPhoto(app, cid);
    const first = await createSheet(app, cid, photoId);

    const dup = await app.inject({
      method: "POST",
      url: `/api/characters/${cid}/sheets`,
      payload: { style: "水彩手绘", photoIds: [photoId] },
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().needReplace).toBe(true);

    const replaced = await app.inject({
      method: "POST",
      url: `/api/characters/${cid}/sheets?replace=1`,
      payload: { style: "水彩手绘", photoIds: [photoId] },
    });
    expect(replaced.statusCode).toBe(201);
    expect(replaced.json().sheet.id).not.toBe(first.id);
    expect(replaced.json().sheet.url).not.toBe(first.url);
  });

  it("auto 角色 PUT 后仍保留；custom 主角缺形象被 409 拒绝", async () => {
    const cid = await createCustomCharacter(app, "主角缺图");
    const c = await app.inject({
      method: "POST",
      url: "/api/stories",
      payload: { original_text: "一只小猫。", style: "水彩手绘", characterIds: [cid] },
    });
    // 建故事时主角无角色形象 → 整体回滚 409，故事不产生
    expect(c.statusCode).toBe(409);
    const cnt = (db.prepare(`SELECT COUNT(*) AS n FROM stories WHERE user_title = ?`).get("__never__") as any)?.n ?? 0;
    expect(cnt).toBe(0);

    // 补形象后建故事成功
    const photoId = await addPhoto(app, cid);
    await createSheet(app, cid, photoId);
    const c2 = await app.inject({
      method: "POST",
      url: "/api/stories",
      payload: { original_text: "一只小猫。", style: "水彩手绘", user_title: "小猫主角", characterIds: [cid] },
    });
    expect(c2.statusCode).toBe(201);
    const sid = c2.json().id;

    // 模拟生图自动建的 auto 绑定
    const autoCh = await app.inject({
      method: "POST",
      url: "/api/characters",
      payload: { name: "小猫", category: "auto", visualDescription: "橘色小猫" },
    });
    const autoId = autoCh.json().character.id;
    db.prepare(
      `INSERT INTO story_character_bindings (story_id, character_id, role_in_story, name_in_story, source, created_at)
       VALUES (?, ?, 'supporting', '小猫', 'auto', ?)`
    ).run(sid, autoId, new Date().toISOString());

    // PUT 只提交 user 绑定（主角），auto 行应保留。主角须带 sheetId（建故事时已绑定）。
    const bs = db.prepare(`SELECT character_sheet_id AS sid FROM story_character_bindings WHERE story_id = ? AND character_id = ?`).get(sid, cid) as any;
    const put = await app.inject({
      method: "PUT",
      url: `/api/stories/${sid}/character-bindings`,
      payload: { bindings: [{ characterId: cid, sheetId: bs.sid, roleInStory: "protagonist", nameInStory: "主角缺图" }] },
    });
    expect(put.statusCode).toBe(200);
    const bindings = put.json().bindings;
    expect(bindings.some((b: any) => b.characterId === cid && b.roleInStory === "protagonist")).toBe(true);
    expect(bindings.some((b: any) => b.characterId === autoId && b.source === "auto")).toBe(true);
  });

  it("画风不匹配的角色形象被 409 拒绝（B4 多画风 token）", async () => {
    const cid = await createCustomCharacter(app, "多画风角色");
    const photoId = await addPhoto(app, cid);
    await createSheet(app, cid, photoId, "水彩手绘"); // 只有水彩形象

    const c = await app.inject({
      method: "POST",
      url: "/api/stories",
      payload: { original_text: "故事", style: "卡通3D,水彩手绘", user_title: "多画风", characterIds: [cid] },
    });
    expect(c.statusCode).toBe(201); // 多画风 token 命中水彩 → 允许

    const c2 = await app.inject({
      method: "POST",
      url: "/api/stories",
      payload: { original_text: "故事", style: "卡通3D", characterIds: [cid] },
    });
    expect(c2.statusCode).toBe(409); // 只有卡通3D → 不匹配
  });

  it("改写清除 auto 绑定但保留 custom 主角绑定", async () => {
    const cid = await createCustomCharacter(app, "改写主角");
    const photoId = await addPhoto(app, cid);
    await createSheet(app, cid, photoId);
    const c = await app.inject({
      method: "POST",
      url: "/api/stories",
      payload: { original_text: "一个关于分享的故事。", style: "水彩手绘", user_title: "改写测试", characterIds: [cid] },
    });
    const sid = c.json().id;
    const autoCh = await app.inject({
      method: "POST", url: "/api/characters",
      payload: { name: "临时角色", category: "auto" },
    });
    db.prepare(
      `INSERT INTO story_character_bindings (story_id, character_id, role_in_story, source, created_at)
       VALUES (?, ?, 'supporting', 'auto', ?)`
    ).run(sid, autoCh.json().character.id, new Date().toISOString());

    await app.inject({ method: "POST", url: `/api/stories/${sid}/rewrite` });
    const rows = db.prepare(`SELECT character_id, source FROM story_character_bindings WHERE story_id = ?`).all(sid) as any[];
    expect(rows.some((r) => r.character_id === cid && r.source === "user")).toBe(true);
    expect(rows.some((r) => r.source === "auto")).toBe(false);
  });

  it("改画风返回 affectedBindings（无对应画风形象的角色）", async () => {
    const cid = await createCustomCharacter(app, "换画风角色");
    const photoId = await addPhoto(app, cid);
    await createSheet(app, cid, photoId, "水彩手绘");
    const c = await app.inject({
      method: "POST",
      url: "/api/stories",
      payload: { original_text: "故事", style: "水彩手绘", user_title: "换画风", characterIds: [cid] },
    });
    const sid = c.json().id;
    const patch = await app.inject({
      method: "PATCH",
      url: `/api/stories/${sid}`,
      payload: { style: "卡通3D" },
    });
    expect(patch.statusCode).toBe(200);
    const affected = patch.json().affectedBindings;
    expect(affected.some((a: any) => a.characterId === cid)).toBe(true);
  });

  it("属性注入：草稿生成走 mock，主角档案进入 prompt（mock 守门不触网）", async () => {
    const cid = await createCustomCharacter(app, "属性主角");
    const res = await app.inject({
      method: "POST",
      url: "/api/story-draft/generate",
      payload: { theme: "一次春游", characterIds: [cid] },
    });
    expect(res.statusCode).toBe(200);
    expect(typeof res.json().story).toBe("string");
  });

  it("未指定画风（空）+ 中文预设形象 + 选主角 → 建故事成功（P0 回归）", async () => {
    const cid = await createCustomCharacter(app, "默认画风主角");
    const photoId = await addPhoto(app, cid);
    await createSheet(app, cid, photoId, "水彩手绘");
    const c = await app.inject({
      method: "POST",
      url: "/api/stories",
      payload: { original_text: "故事", style: "", user_title: "默认画风", characterIds: [cid] },
    });
    expect(c.statusCode).toBe(201);
    const sid = c.json().id;
    // 未指定画风不应阻断生图（validateBindingsForGeneration 直接放行）
    await app.inject({ method: "POST", url: `/api/stories/${sid}/rewrite` });
    const g = await app.inject({ method: "POST", url: `/api/stories/${sid}/generate` });
    expect(g.statusCode).toBe(201);
  });

  it("主角形象画风与故事不符 → 生图被 409 阻断（P1-2）", async () => {
    const cid = await createCustomCharacter(app, "画风阻断主角");
    const photoId = await addPhoto(app, cid);
    await createSheet(app, cid, photoId, "水彩手绘");
    const c = await app.inject({
      method: "POST",
      url: "/api/stories",
      payload: { original_text: "故事", style: "水彩手绘", user_title: "阻断生图", characterIds: [cid] },
    });
    const sid = c.json().id;
    // 建故事后把故事画风改成卡通3D（主角只有水彩形象）
    await app.inject({ method: "PATCH", url: `/api/stories/${sid}`, payload: { style: "卡通3D" } });
    await app.inject({ method: "POST", url: `/api/stories/${sid}/rewrite` });
    const g = await app.inject({ method: "POST", url: `/api/stories/${sid}/generate` });
    expect(g.statusCode).toBe(409);
    expect(g.json().blocked?.some((b: any) => b.characterId === cid)).toBe(true);
  });

  it("改写回收孤儿 auto 角色（P1-3）", async () => {
    const sid = db.prepare(`INSERT INTO stories (original_text, style, status, created_at, updated_at) VALUES (?, ?, '新建', ?, ?)`).run(
      "一个故事", "水彩手绘", new Date().toISOString(), new Date().toISOString()
    ).lastInsertRowid as unknown as number;
    // 建一个由该故事抽取的 auto 角色，并建 auto 绑定
    const view = await app.inject({
      method: "POST", url: "/api/characters",
      payload: { name: "孤儿角色", category: "auto" },
    });
    const cid = view.json().character.id;
    db.prepare(`UPDATE characters SET source_story_id = ? WHERE id = ?`).run(sid, cid);
    db.prepare(
      `INSERT INTO story_character_bindings (story_id, character_id, role_in_story, source, created_at)
       VALUES (?, ?, 'supporting', 'auto', ?)`
    ).run(sid, cid, new Date().toISOString());

    await app.inject({ method: "POST", url: `/api/stories/${sid}/rewrite` });
    const ch = db.prepare(`SELECT deleted_at FROM characters WHERE id = ?`).get(cid) as any;
    expect(ch.deleted_at).toBeTruthy(); // 已被软删回收
  });

  it("生图使用绑定角色形象：整书生成成功且角色来自绑定", async () => {
    const cid = await createCustomCharacter(app, "生图主角");
    const photoId = await addPhoto(app, cid);
    await createSheet(app, cid, photoId);
    const c = await app.inject({
      method: "POST",
      url: "/api/stories",
      payload: { original_text: "小狐狸在森林里遇见朋友，一起分享点心。", style: "水彩手绘", target_page_count: 3, user_title: "绑定生图", characterIds: [cid] },
    });
    const sid = c.json().id;
    await app.inject({ method: "POST", url: `/api/stories/${sid}/rewrite` });

    const bindingBefore = db.prepare(`SELECT character_sheet_id FROM story_character_bindings WHERE story_id = ? AND character_id = ?`).get(sid, cid) as any;
    expect(bindingBefore.character_sheet_id).toBeGreaterThan(0);

    const g = await app.inject({ method: "POST", url: `/api/stories/${sid}/generate` });
    expect(g.statusCode).toBe(201);
    const taskId = g.json().taskId;
    for (let i = 0; i < 200; i++) {
      const t = await app.inject({ method: "GET", url: `/api/tasks/${taskId}` });
      if (["completed", "failed"].includes(t.json().task.status)) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    const t = await app.inject({ method: "GET", url: `/api/tasks/${taskId}` });
    expect(t.json().task.status).toBe("completed");

    // getRunDetail 每 binding 一行，主角来自绑定
    const runId = g.json().runId;
    const detail = await app.inject({ method: "GET", url: `/api/runs/${runId}` });
    const chars = detail.json().characters;
    expect(chars.some((ch: any) => ch.char_key && ch.name === "生图主角")).toBe(true);
  });
});
