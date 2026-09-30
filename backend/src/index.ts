import "./env"; // 必须最先执行：加载 .env.local / .env

import { buildApp } from "./app";
import { initDb } from "./db/sqlite";
import { recoverAndStart } from "./services/taskRunner";

const PORT = Number(process.env.PORT || 3000);

async function start() {
  const app = await buildApp();
  await initDb();
  // 续跑宕机前未完成的任务（不阻塞 listen）
  recoverAndStart();
  await app.listen({ port: PORT, host: "0.0.0.0" });
  console.log(`BookAgent backend listening on :${PORT}`);
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
