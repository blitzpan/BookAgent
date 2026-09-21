import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getPublishedStories } from "../api/client";
import type { ShelfBook } from "../types";

function coverGradient(id: number): string {
  const a = (id * 47) % 360;
  const b = (a + 40) % 360;
  return `linear-gradient(135deg, hsl(${a} 65% 68%), hsl(${b} 70% 52%))`;
}

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
        <h1>绘本馆</h1>
        <p>精选已发布绘本</p>
      </header>

      {error && <div className="state state-error">{error}</div>}
      {!books && !error && <div className="state">加载中…</div>}
      {books && books.length === 0 && <div className="state">暂无已发布绘本</div>}

      <div className="shelf-grid">
        {books?.map((b) => (
          <Link key={b.id} to={`/book/${b.id}`} className="book-card">
            <div className="book-cover" style={{ background: coverGradient(b.id) }}>
              {b.coverUrl ? (
                <img src={b.coverUrl} alt={b.userTitle || "绘本"} />
              ) : (
                <span className="book-cover-title">{b.userTitle || "未命名绘本"}</span>
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
