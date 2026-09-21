// SQLite 访问层（基于 sql.js —— 纯 WASM，无需原生编译，npm install 即可运行）。
// 提供与 better-sqlite3 近似的同步 API（prepare/run/get/all/transaction），
// 以免改动 service 层的大量调用。
//
// 注意：sql.js 是内存库，每次写入后自动把整个 DB 导出落盘（MVP 数据量小，开销可忽略）。

import initSqlJs, { type Database as SqlJsDatabase } from "sql.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 本文件位于 backend/src/db/sqlite.ts → 取 backend 目录作为基准
export const BACKEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// sql.js 的 wasm 随包发布在 node_modules/sql.js/dist 下，直接据此定位（避免 exports 屏蔽 package.json 子路径）。
const SQLJS_DIST = path.join(BACKEND_DIR, "node_modules/sql.js/dist");

export const DATA_DIR =
  process.env.BOOKAGENT_DATA_DIR || path.join(BACKEND_DIR, "data");
export const ASSETS_DIR = path.join(DATA_DIR, "assets");
export const DB_PATH = path.join(DATA_DIR, "bookagent.db");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(ASSETS_DIR)) fs.mkdirSync(ASSETS_DIR, { recursive: true });

// ===== sql.js 包装层 =====

class Stmt {
  private engine: SqlJsDatabase;
  private stmt: any;
  constructor(engine: SqlJsDatabase, stmt: any) {
    this.engine = engine;
    this.stmt = stmt;
  }

  private bindParams(p: any) {
    if (p == null) return;
    const toBind = Array.isArray(p)
      ? p
      : typeof p === "object"
      ? p
      : [p];
    try {
      this.stmt.bind(toBind);
    } catch {
      // 绑定失败（如参数数量不匹配）时退化为忽略
    }
  }

  run(...params: any[]): { lastInsertRowid: number; changes: number } {
    this.bindParams(params);
    this.stmt.step();
    this.stmt.reset();
    const info = rawQuery(this.engine, "SELECT last_insert_rowid() AS lid, changes() AS c");
    const result = {
      lastInsertRowid: Number(info?.lid ?? 0),
      changes: Number(info?.c ?? 0),
    };
    this.stmt.free();
    persist();
    return result;
  }

  get(...params: any[]): any {
    this.bindParams(params);
    const ok = this.stmt.step();
    let row: any = undefined;
    if (ok) row = this.stmt.getAsObject();
    this.stmt.reset();
    this.stmt.free();
    return row;
  }

  all(...params: any[]): any[] {
    this.bindParams(params);
    const rows: any[] = [];
    while (this.stmt.step()) rows.push(this.stmt.getAsObject());
    this.stmt.reset();
    this.stmt.free();
    return rows;
  }
}

function rawQuery(engine: SqlJsDatabase, sql: string): any {
  const s = engine.prepare(sql);
  s.step();
  const o = s.getAsObject();
  s.free();
  return o;
}

class SqlDb {
  engine!: SqlJsDatabase;

  prepare(sql: string): Stmt {
    return new Stmt(this.engine, this.engine.prepare(sql));
  }

  exec(sql: string): void {
    this.engine.exec(sql);
  }

  transaction<T>(fn: () => T): () => T {
    // sql.js 无独立事务语义；run() 已逐条落盘。这里返回一个函数，调用时执行并落盘。
    return () => {
      const r = fn();
      persist();
      return r;
    };
  }
}

export const db = new SqlDb();

let initialized = false;

export async function initDb(): Promise<void> {
  if (initialized) return;
  const SQL = await initSqlJs({
    locateFile: (file: string) => path.join(SQLJS_DIST, file),
  });

  if (fs.existsSync(DB_PATH)) {
    db.engine = new SQL.Database(fs.readFileSync(DB_PATH));
  } else {
    db.engine = new SQL.Database();
  }

  // 建表（SQL 与 database设计.md 一致；去掉 WAL pragma，sql.js 不支持）
  const schema = fs.readFileSync(path.join(BACKEND_DIR, "src/db/schema.sql"), "utf-8");
  db.exec(schema);
  persist();
  initialized = true;
}

export function persist(): void {
  if (!db.engine) return;
  fs.writeFileSync(DB_PATH, Buffer.from(db.engine.export()));
}
