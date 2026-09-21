import { useEffect, useState } from "react";
import { getBook } from "../api/client";
import type { ReaderPage } from "../types";

/** 加载某书的阅读页数据（含加载/错误态） */
export function useBook(storyId: number) {
  const [pages, setPages] = useState<ReaderPage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    setPages(null);
    getBook(storyId)
      .then((p) => alive && setPages(p))
      .catch((e) => alive && setError(e?.message || "加载失败"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [storyId]);

  return { pages, error, loading };
}
