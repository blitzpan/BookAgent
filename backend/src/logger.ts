// 轻量级日志框架（零第三方依赖）。
// 设计目标：
//  - 按日期分文件：logs/bookagent-YYYY-MM-DD.log，一天一个文件；
//  - 最多保留 N 天（默认 10）的日志文件，过期自动清理；
//  - 结构化输出（每行一条 JSON），便于后续 grep / 解析，统计 AI 生成效率与质量；
//  - 不阻塞主流程：写入走带缓冲的异步落盘，进程退出前同步刷盘兜底；
//  - 写失败不影响业务：退化到 console.error，绝不抛出。

import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./db/sqlite";

type Level = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

// 日志目录：可用 LOG_DIR 覆盖，否则落在数据目录下的 logs/。
const LOG_DIR = process.env.LOG_DIR
  ? path.resolve(process.env.LOG_DIR)
  : path.join(DATA_DIR, "logs");

// 保留天数：默认 10。LOG_MAX_DAYS=0 表示不清理（保留全部）。
const MAX_DAYS = Number(process.env.LOG_MAX_DAYS ?? 10);

// 最低输出级别：默认 info（debug 仅在 LOG_LEVEL=debug 时输出）。
const MIN_LEVEL: Level = (["debug", "info", "warn", "error"].includes(
  process.env.LOG_LEVEL || ""
)
  ? process.env.LOG_LEVEL
  : "info") as Level;

// 文件名日期后缀正则：bookagent-YYYY-MM-DD.log
const FILE_RE = /^bookagent-(\d{4}-\d{2}-\d{2})\.log$/;

function dateStr(d: Date = new Date()): string {
  // 用本地时区的日期（便于"按天"切分，与运维直觉一致）。
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 当前（或指定）日期对应的日志文件绝对路径。 */
export function getLogPath(d: Date = new Date()): string {
  return path.join(LOG_DIR, `bookagent-${dateStr(d)}.log`);
}

export function getLogDir(): string {
  return LOG_DIR;
}

/**
 * 删除 dir 下超出 maxDays 天的旧日志文件（保留最近 maxDays 天）。
 * 提取为纯函数便于单测；返回被删除的文件名列表。
 */
export function pruneLogDir(dir: string, maxDays: number): string[] {
  const removed: string[] = [];
  if (maxDays <= 0) return removed;
  try {
    if (!fs.existsSync(dir)) return removed;
    const files = fs.readdirSync(dir).filter((f) => FILE_RE.test(f));
    const dates = files
      .map((f) => f.match(FILE_RE)![1])
      .sort(); // 升序：最旧在前
    const excess = dates.length - maxDays;
    if (excess > 0) {
      for (let i = 0; i < excess; i++) {
        try {
          const fp = path.join(dir, `bookagent-${dates[i]}.log`);
          fs.rmSync(fp, { force: true });
          removed.push(`bookagent-${dates[i]}.log`);
        } catch {
          /* 单个删除失败不影响整体 */
        }
      }
    }
  } catch {
    /* 清理失败不应影响业务 */
  }
  return removed;
}

/** 删除超出保留天数的旧日志文件（保留最近 MAX_DAYS 天）。 */
function cleanupOld(now: Date = new Date()): void {
  pruneLogDir(LOG_DIR, MAX_DAYS);
}

class Logger {
  private currentDate = dateStr();
  private buffer: string[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private flushing = false;

  constructor() {
    try {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    } catch {
      /* ignore */
    }
    cleanupOld();
    // 进程退出前同步刷盘，确保最后一批日志不丢。
    process.on("exit", () => this.flushSync());
  }

  private filePath(): string {
    return path.join(LOG_DIR, `bookagent-${this.currentDate}.log`);
  }

  /** 跨天自动切换文件并做一次清理。 */
  private rolloverIfNeeded(): void {
    const today = dateStr();
    if (today !== this.currentDate) {
      this.currentDate = today;
      cleanupOld();
    }
  }

  log(
    level: Level,
    category: string,
    event: string,
    meta?: Record<string, unknown>
  ): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[MIN_LEVEL]) return;
    this.rolloverIfNeeded();
    const entry: Record<string, unknown> = {
      ts: new Date().toISOString(),
      level,
      category,
      event,
      msg: meta?.msg ?? "",
    };
    if (meta) {
      for (const k of Object.keys(meta)) {
        if (k === "msg") continue;
        entry[k] = meta[k];
      }
    }
    this.buffer.push(JSON.stringify(entry));
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushTimer || this.flushing) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, 50);
    // 不阻止进程退出：刷盘应尽量快，退出由 'exit' 兜底。
    this.flushTimer.unref?.();
  }

  /** 异步刷盘（await 后确保当前缓冲写入）。 */
  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.flushing) return;
    if (this.buffer.length === 0) return;
    this.flushing = true;
    const lines = this.buffer;
    this.buffer = [];
    try {
      fs.appendFileSync(this.filePath(), lines.join("\n") + "\n");
    } catch (e) {
      console.error("[logger] 写入失败:", e);
    } finally {
      this.flushing = false;
    }
  }

  /** 同步刷盘（进程退出兜底用，绝不在业务路径调用）。 */
  private flushSync(): void {
    if (this.buffer.length === 0) return;
    try {
      fs.appendFileSync(this.filePath(), this.buffer.join("\n") + "\n");
      this.buffer = [];
    } catch {
      /* 退出兜底失败只能放弃 */
    }
  }

  info(category: string, event: string, meta?: Record<string, unknown>): void {
    this.log("info", category, event, meta);
  }
  warn(category: string, event: string, meta?: Record<string, unknown>): void {
    this.log("warn", category, event, meta);
  }
  error(category: string, event: string, meta?: Record<string, unknown>): void {
    this.log("error", category, event, meta);
  }
  debug(category: string, event: string, meta?: Record<string, unknown>): void {
    this.log("debug", category, event, meta);
  }
}

export const logger = new Logger();

/** 简单错误描述，避免把整个对象（可能含 base64 大字段）写进日志。 */
export function errMsg(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

/** 尽力从模型返回里抽取 token 用量（不同 provider 字段不同）。 */
export function extractUsage(result: any): number | undefined {
  const u = result?.usageMetadata ?? result?.usage;
  if (!u) return undefined;
  if (typeof u.totalTokenCount === "number") return u.totalTokenCount;
  if (typeof u.totalTokens === "number") return u.totalTokens;
  return undefined;
}

/** 计时器：返回 start()，再调用 end() 得到毫秒耗时。 */
export function timer(): { mark(): void; elapsedMs(): number } {
  let t0 = Date.now();
  return {
    mark() {
      t0 = Date.now();
    },
    elapsedMs() {
      return Date.now() - t0;
    },
  };
}
