import Fastify from "fastify";
import fs from "node:fs";
import path from "node:path";
import { ASSETS_DIR, initDb, BACKEND_DIR } from "./db/sqlite";
import { registerRoutes } from "./routes";
import { recoverRunsAndStart } from "./services/taskRunner";

const PORT = Number(process.env.PORT || 3000);

const app = Fastify({ logger: true });

// 路由（建表在 initDb 内执行）
registerRoutes(app);

// 根路径：托管极简前端壳（public/index.html）
app.get("/", async (_req, reply) => {
  const fs = await import("node:fs");
  const p = path.join(BACKEND_DIR, "public", "index.html");
  if (!fs.existsSync(p)) return reply.code(404).send({ error: "not found" });
  reply.header("Content-Type", "text/html; charset=utf-8");
  return reply.send(fs.readFileSync(p));
});

// 静态资源：/assets/* —— 自实现路径穿越防护（R11）
// 仅允许访问 ASSETS_DIR 下的真实文件，拒绝 .. / 绝对路径 / 越界。
app.get("/assets/*", async (req, reply) => {
  const rel = (req.params as any)["*"] ?? "";
  let decoded: string;
  try {
    decoded = decodeURIComponent(rel);
  } catch {
    return reply.code(400).send({ error: "invalid path" });
  }
  if (!decoded || decoded.includes("..") || path.isAbsolute(decoded)) {
    return reply.code(400).send({ error: "invalid path" });
  }
  const abs = path.join(ASSETS_DIR, decoded);
  if (!abs.startsWith(ASSETS_DIR) || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    return reply.code(404).send({ error: "not found" });
  }
  const ext = path.extname(abs).slice(1).toLowerCase();
  const mime =
    ext === "jpg" || ext === "jpeg"
      ? "image/jpeg"
      : ext === "webp"
      ? "image/webp"
      : "image/png";
  reply.header("Content-Type", mime);
  return reply.send(fs.readFileSync(abs));
});

app.get("/api/health", async () => ({ ok: true }));

async function start() {
  await initDb();
  // 续跑宕机前未完成的 run（不阻塞 listen）
  recoverRunsAndStart();
  await app.listen({ port: PORT, host: "0.0.0.0" });
  app.log.info(`BookAgent backend listening on :${PORT}`);
}

start().catch((err) => {
  app.log.error(err);
  process.exit(1);
});
