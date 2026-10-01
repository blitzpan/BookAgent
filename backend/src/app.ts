// 应用构建：把 Fastify 实例的创建与路由注册抽离，
// 便于测试中用 app.inject() 直接驱动，无需监听端口 / 真实网络。

import Fastify from "fastify";
import fs from "node:fs";
import path from "node:path";
import { ASSETS_DIR, BACKEND_DIR } from "./db/sqlite";
import { registerRoutes } from "./routes";

export async function buildApp() {
  const app = Fastify({ logger: false, bodyLimit: 20 * 1024 * 1024 });

  // 统一错误处理器：所有未捕获异常/校验错误都收口为 {error} 结构，
  // 避免把堆栈或 Fastify 默认 HTML 泄露给前端（前端只读 j.error）。
  app.setErrorHandler((err, _req, reply) => {
    const e = err as { statusCode?: number; message?: string };
    const status = e.statusCode && e.statusCode >= 400 ? e.statusCode : 500;
    if (status >= 500) console.error(err);
    reply.code(status).send({ error: e.message || "服务器内部错误" });
  });
  app.setNotFoundHandler((_req, reply) => {
    reply.code(404).send({ error: "接口不存在" });
  });

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
        : ext === "mp3"
        ? "audio/mpeg"
        : ext === "json"
        ? "application/json"
        : "image/png";
    const stat = fs.statSync(abs);
    // 图片/静态资源内容不可变（文件名含 id）→ 长期缓存；音频可接受较短缓存
    const cacheControl =
      ext === "mp3"
        ? "public, max-age=3600"
        : "public, max-age=31536000, immutable";
    const res = reply.raw;
    reply.header("Content-Type", mime);
    reply.header("Accept-Ranges", "bytes");
    reply.header("Cache-Control", cacheControl);

    // 支持 Range（206）：音频可拖动进度条 / 断点续传
    const range = req.headers.range;
    if (range) {
      const m = /bytes=(\d+)-(\d*)/.exec(range);
      if (m) {
        const start = Number(m[1]);
        const end = m[2] ? Math.min(Number(m[2]), stat.size - 1) : stat.size - 1;
        if (start <= end && end < stat.size) {
          reply.code(206);
          reply.header("Content-Range", `bytes ${start}-${end}/${stat.size}`);
          reply.header("Content-Length", end - start + 1);
          const stream = fs.createReadStream(abs, { start, end });
          stream.on("error", () => res.destroy());
          return reply.send(stream);
        }
      }
      reply.header("Content-Range", `bytes */${stat.size}`);
      return reply.code(416).send();
    }

    reply.header("Content-Length", stat.size);
    const stream = fs.createReadStream(abs);
    stream.on("error", () => res.destroy());
    return reply.send(stream);
  });

  app.get("/api/health", async () => ({ ok: true }));

  return app;
}
