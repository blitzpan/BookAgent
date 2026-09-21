// 应用构建：把 Fastify 实例的创建与路由注册抽离，
// 便于测试中用 app.inject() 直接驱动，无需监听端口 / 真实网络。

import Fastify from "fastify";
import fs from "node:fs";
import path from "node:path";
import { ASSETS_DIR, BACKEND_DIR } from "./db/sqlite";
import { registerRoutes } from "./routes";

export async function buildApp() {
  const app = Fastify({ logger: false });

  // CORS（零依赖手动实现，放行 reader 来源；生产用 CORS_ORIGIN 收紧）。
  const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
  app.addHook("onRequest", async (req, reply) => {
    reply.header("Access-Control-Allow-Origin", CORS_ORIGIN);
    reply.header("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
    reply.header("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
      return reply.code(204).send();
    }
  });

  registerRoutes(app);

  app.get("/", async (_req, reply) => {
    const p = path.join(BACKEND_DIR, "public", "index.html");
    if (!fs.existsSync(p)) return reply.code(404).send({ error: "not found" });
    reply.header("Content-Type", "text/html; charset=utf-8");
    return reply.send(fs.readFileSync(p));
  });

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

  return app;
}
