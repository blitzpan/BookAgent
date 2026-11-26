import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getPublishedStories } from "../api/client";
import type { ShelfBook } from "../types";
import ThemeToggle from "../components/ThemeToggle";
import { IconBook } from "../components/icons";

// 没有封面时，给每本书一个柔和的"小书"底色，像一排彩色绘本
const COVER_COLORS = [
  "linear-gradient(160deg, #ffd6a5, #ff9eb5)",
  "linear-gradient(160deg, #a5d8ff, #b5b9ff)",
  "linear-gradient(160deg, #caffbf, #9bf6ff)",
  "linear-gradient(160deg, #ffc6ff, #ffadad)",
  "linear-gradient(160deg, #fdffb6, #ffd6a5)",
];

export default function Shelf() {
  const [books, setBooks] = useState<ShelfBook[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getPublishedStories()
      .then((b) => alive && setBooks(b))
      .catch((e) => alive && setError(e?.message || "加载失败"));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="shelf">
      <header className="shelf-header">
        <div className="shelf-header-row">
          <div>
            <h1 className="display">绘本馆</h1>
            <p>挑一本喜欢的故事，开始读吧</p>
          </div>
          <ThemeToggle />
        </div>
      </header>

      {error && (
        <div className="state state-error">
          <IconBook size={56} className="state-emoji" />
          <p>书架暂时打不开了</p>
          <p style={{ fontSize: 13 }}>{error}</p>
        </div>
      )}
      {!books && !error && (
        <div className="state">
          <div className="loading-dots">
            <span />
            <span />
            <span />
          </div>
          <p>正在搬小板凳，准备绘本…</p>
        </div>
      )}
      {books && books.length === 0 && (
        <div className="state">
          <IconBook size={56} className="state-emoji" />
          <p>书架还空空的，先去上架一本绘本吧</p>
        </div>
      )}

      <div className="shelf-grid">
        {books?.map((b, i) => (
          <Link key={b.id} to={`/book/${b.id}`} className="book-card">
            <div className="book-cover">
              {b.coverUrl ? (
                <img src={b.coverUrl} alt={b.userTitle || "绘本"} loading="lazy" />
              ) : (
                <span
                  className="book-cover-title"
                  style={{ background: COVER_COLORS[i % COVER_COLORS.length], borderRadius: 14, padding: "24px 14px", width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}
                >
                  {b.userTitle || "未命名绘本"}
                </span>
              )}
            </div>
            <div className="book-meta">
              <div className="book-title">{b.userTitle || "未命名绘本"}</div>
              <div className="book-sub">{b.pageCount} 页</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
