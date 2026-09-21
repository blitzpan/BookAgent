import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 每轮 e2e 独立的后端数据目录（保证与真实数据 / 上次运行隔离）
const DATA_DIR = join(tmpdir(), `bookagent-e2e-${Date.now()}`);

export default defineConfig({
  testDir: "./e2e",
  timeout: 120000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5173",
    trace: "off",
  },
  webServer: [
    {
      command: "npx tsx src/index.ts",
      cwd: "backend",
      url: "http://localhost:3000/api/health",
      reuseExistingServer: true,
      timeout: 60000,
      env: {
        PORT: "3000",
        TEXT_PROVIDER: "mock",
        IMAGE_PROVIDER: "mock",
        VISION_PROVIDER: "mock",
        GEMINI_API_KEY: "",
        ARK_API_KEY: "",
        DASHSCOPE_API_KEY: "",
        BOOKAGENT_DATA_DIR: DATA_DIR,
      },
    },
    {
      command: "npx vite --port 5173 --host",
      cwd: "reader",
      url: "http://localhost:5173",
      reuseExistingServer: true,
      timeout: 60000,
    },
  ],
  projects: [
    { name: "mobile", use: { ...devices["Pixel 7"] } },
    { name: "pad", use: { ...devices["iPad Pro 11"] } },
  ],
  globalSetup: resolve(__dirname, "e2e/global.setup.ts"),
});
