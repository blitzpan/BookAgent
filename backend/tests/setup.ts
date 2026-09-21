// 后端测试全局环境：
//  1) 强制走 mock provider，真实 Key 全部置空（零真实 API 调用）
//  2) 每进程独立临时数据目录，保证测试间隔离
//  3) 金钱安全守门：任何非 localhost 的网络请求直接 reject，即便误配真实 provider 也不花钱

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.TEXT_PROVIDER = "mock";
process.env.IMAGE_PROVIDER = "mock";
process.env.VISION_PROVIDER = "mock";
process.env.GEMINI_API_KEY = "";
process.env.ARK_API_KEY = "";
process.env.DASHSCOPE_API_KEY = "";

const dataDir = mkdtempSync(join(tmpdir(), "bookagent-test-"));
process.env.BOOKAGENT_DATA_DIR = dataDir;

const realFetch = globalThis.fetch;
globalThis.fetch = ((input: any, init?: any) => {
  const url = typeof input === "string" ? input : input?.url;
  if (url && /^https?:\/\//i.test(url)) {
    try {
      const u = new URL(url);
      if (u.hostname === "localhost" || u.hostname === "127.0.0.1") {
        return realFetch(input, init);
      }
    } catch {
      /* fallthrough to reject */
    }
    return Promise.reject(
      new Error(`[money-safety] 拦截了外部网络请求（防止真实付费 API 调用）: ${url}`)
    );
  }
  return realFetch(input, init);
}) as typeof fetch;
