// 环境变量加载（Node 20+ 内置 process.loadEnvFile，无需 dotenv 依赖）。
//
// 优先级（由高到低）：
//   1. shell / 系统里已存在的环境变量（loadEnvFile 不会覆盖已有值，方便命令行临时覆盖）
//   2. backend/.env.local
//   3. 仓库根 .env.local
//   4. backend/.env
//   5. 仓库根 .env
//
// 必须在任何读取 process.env 的模块（例如 providers/* 在 import 时就读取 API Key）之前执行，
// 因此 index.ts 把它放在第一行 import。

// 先加载优先级高的：后加载的文件不会覆盖已存在的值。
// 路径相对本文件（backend/src/env.ts）：../ = backend/，../../ = 仓库根。
for (const file of [
  "../.env.local",
  "../../.env.local",
  "../.env",
  "../../.env",
]) {
  try {
    process.loadEnvFile(new URL(file, import.meta.url));
  } catch (err) {
    // 文件不存在是正常的（可选配置）；其它错误必须暴露，
    // 否则配置被静默忽略、回退到真实 provider 就会真的花钱。
    if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") {
      console.warn(`[env] 加载 ${file} 失败，配置未生效：`, err);
    }
  }
}
