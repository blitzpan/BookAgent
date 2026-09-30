import type { FastifyInstance } from "fastify";
import { getStoryRaw } from "../services/storyService";
import { createTask } from "../services/generationService";
import { runTask } from "../services/taskRunner";
import {
  listByStory,
  listByPage,
  createHotspot,
  updateHotspot,
  removeHotspot,
  pageExists,
  savePageHotspots,
  getActiveHotspotTaskId,
  getLatestHotspotTask,
  getHotspotEditorData,
  type HotspotInput,
  type HotspotKind,
} from "../services/hotspotService";

const ALLOWED_KINDS: HotspotKind[] = ["audio", "text", "link"];

function parseNum(v: any, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function toInput(v: any): HotspotInput {
  return {
    segment_seq: v?.segment_seq != null ? Number(v.segment_seq) : null,
    x: parseNum(v?.x),
    y: parseNum(v?.y),
    shape: v?.shape === "circle" ? "circle" : "rect",
    kind: ALLOWED_KINDS.includes(v?.kind) ? v.kind : "audio",
    label: v?.label ?? null,
    payload: v?.payload ?? null,
  };
}

/** 只带上显式传入的字段，避免用默认值覆盖未修改的列。 */
function toUpdate(v: any): { id: number } & Partial<HotspotInput> {
  const patch: Partial<HotspotInput> = {};
  if (v?.segment_seq !== undefined)
    patch.segment_seq = v.segment_seq != null ? Number(v.segment_seq) : null;
  if (v?.x !== undefined) patch.x = parseNum(v.x);
  if (v?.y !== undefined) patch.y = parseNum(v.y);
  if (v?.shape === "circle" || v?.shape === "rect") patch.shape = v.shape;
  if (ALLOWED_KINDS.includes(v?.kind)) patch.kind = v.kind;
  if (v?.label !== undefined) patch.label = v.label;
  if (v?.payload !== undefined) patch.payload = v.payload;
  return { id: Number(v?.id), ...patch };
}

export function registerHotspotRoutes(app: FastifyInstance): void {
  // 阅读端：一次拉全本热区（按 page_number 归并）
  app.get("/api/stories/:id/hotspots", async (req, reply) => {
    const id = Number((req.params as any).id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: "invalid id" });
    return { hotspots: listByStory(id) };
  });

  // 最近一次热区任务（任意状态）：刷新页面后恢复按钮状态 / 判断是否在生成中
  app.get("/api/stories/:id/hotspots/task", async (req, reply) => {
    const id = Number((req.params as any).id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: "invalid id" });
    return { task: getLatestHotspotTask(id) };
  });

  // 热区编辑器数据：每页默认图 + 分段（一次返回）
  app.get("/api/stories/:id/hotspot-editor", async (req, reply) => {
    const id = Number((req.params as any).id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: "invalid id" });
    if (!getStoryRaw(id)) return reply.code(404).send({ error: "故事不存在" });
    return getHotspotEditorData(id);
  });

  // 某页热区列表
  app.get("/api/stories/:id/pages/:n/hotspots", async (req, reply) => {
    const id = Number((req.params as any).id);
    const n = Number((req.params as any).n);
    if (!Number.isInteger(id) || !Number.isInteger(n))
      return reply.code(400).send({ error: "invalid id or page" });
    return { hotspots: listByPage(id, n) };
  });

  // 新建热区（拖放落点 = 中心点）
  app.post("/api/stories/:id/pages/:n/hotspots", async (req, reply) => {
    const id = Number((req.params as any).id);
    const n = Number((req.params as any).n);
    if (!Number.isInteger(id) || !Number.isInteger(n))
      return reply.code(400).send({ error: "invalid id or page" });
    if (!getStoryRaw(id)) return reply.code(404).send({ error: "故事不存在" });

    const b = (req.body || {}) as any;
    const kind = ALLOWED_KINDS.includes(b.kind) ? b.kind : "audio";
    const input: HotspotInput = {
      segment_seq: b.segment_seq != null ? Number(b.segment_seq) : null,
      x: parseNum(b.x),
      y: parseNum(b.y),
      shape: b.shape === "circle" ? "circle" : "rect",
      kind,
      label: b.label ?? null,
      payload: b.payload ?? null,
    };
    if (!pageExists(id, n)) return reply.code(404).send({ error: "页码不存在" });
    const row = createHotspot(id, n, input);
    return reply.code(201).send(row);
  });

  // 单页批量保存：新增 / 修改 / 删除在一个事务完成（前端只提交变更项）
  app.post("/api/stories/:id/pages/:n/hotspots/batch", async (req, reply) => {
    const id = Number((req.params as any).id);
    const n = Number((req.params as any).n);
    if (!Number.isInteger(id) || !Number.isInteger(n))
      return reply.code(400).send({ error: "invalid id or page" });

    const b = (req.body || {}) as any;
    const payload = {
      create: Array.isArray(b.create) ? b.create.map(toInput) : [],
      update: Array.isArray(b.update) ? b.update.map(toUpdate) : [],
      delete: Array.isArray(b.delete)
        ? b.delete.map(Number).filter(Number.isInteger)
        : [],
    };
    try {
      return savePageHotspots(id, n, payload);
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      return reply.code(msg.includes("不存在") ? 404 : 400).send({ error: msg });
    }
  });

  // 单条更新
  app.patch("/api/hotspots/:hotspotId", async (req, reply) => {
    const hid = Number((req.params as any).hotspotId);
    if (!Number.isInteger(hid))
      return reply.code(400).send({ error: "invalid hotspotId" });
    const b = (req.body || {}) as any;
    const patch: Partial<HotspotInput> = {};
    if (b.segment_seq !== undefined) patch.segment_seq = Number(b.segment_seq);
    if (b.x !== undefined) patch.x = parseNum(b.x);
    if (b.y !== undefined) patch.y = parseNum(b.y);
    if (b.shape === "circle" || b.shape === "rect") patch.shape = b.shape;
    if (ALLOWED_KINDS.includes(b.kind)) patch.kind = b.kind;
    if (b.label !== undefined) patch.label = b.label;
    if (b.payload !== undefined) patch.payload = b.payload;

    const row = updateHotspot(hid, patch);
    if (!row) return reply.code(404).send({ error: "热区不存在" });
    return row;
  });

  // 单条删除
  app.delete("/api/hotspots/:hotspotId", async (req, reply) => {
    const hid = Number((req.params as any).hotspotId);
    if (!Number.isInteger(hid))
      return reply.code(400).send({ error: "invalid hotspotId" });
    const ok = removeHotspot(hid);
    if (!ok) return reply.code(404).send({ error: "热区不存在" });
    return { ok: true };
  });

  // AI 生成热区：异步任务（逐页跑 VISION，前端轮询 /api/tasks/:id）
  app.post("/api/stories/:id/hotspots/auto-generate", async (req, reply) => {
    const id = Number((req.params as any).id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: "invalid id" });
    const story = getStoryRaw(id);
    if (!story) return reply.code(404).send({ error: "故事不存在" });

    const active = getActiveHotspotTaskId(id);
    if (active != null)
      return reply.code(409).send({ error: "已有生成中的热区任务", taskId: active });

    const b = (req.body || {}) as any;
    const taskId = createTask(id, story.current_run_id ?? null, null, "hotspot", {
      regenerate: b.regenerate !== false,
    } as any);
    void runTask(taskId);
    return reply.code(201).send({ taskId });
  });

  // 继续生成：崩溃 / 部分失败后补跑缺失页（保留已生成的 AI 热区，不推翻重来）
  app.post("/api/stories/:id/hotspots/resume", async (req, reply) => {
    const id = Number((req.params as any).id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: "invalid id" });
    const story = getStoryRaw(id);
    if (!story) return reply.code(404).send({ error: "故事不存在" });

    const active = getActiveHotspotTaskId(id);
    if (active != null)
      return reply.code(409).send({ error: "已有生成中的热区任务", taskId: active });

    const taskId = createTask(id, story.current_run_id ?? null, null, "hotspot", {
      regenerate: false,
    } as any);
    void runTask(taskId);
    return reply.code(201).send({ taskId });
  });
}
