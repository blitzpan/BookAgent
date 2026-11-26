import { useEffect, useState } from "react";
import { api, assetUrl } from "../api/client";
import type { CharacterView } from "../types";
import Loader from "./Loader";

interface Props {
  onOpen: (id: number) => void;
}

/** 角色管理：自定义角色与系统自动生成角色统一列表，按类别筛选。 */
export default function CharacterList({ onOpen }: Props) {
  const [characters, setCharacters] = useState<CharacterView[] | null>(null);
  const [category, setCategory] = useState<"all" | "custom" | "auto">("custom");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  const load = () => {
    setError("");
    setCharacters(null);
    api
      .listCharacters(category === "all" ? undefined : { category })
      .then((r) => setCharacters(r.characters))
      .catch((e) => setError(String(e?.message ?? e)));
  };

  useEffect(load, [category]);

  const create = async () => {
    if (!newName.trim()) return;
    try {
      const { character } = await api.createCharacter({
        name: newName.trim(),
        category: "custom",
      });
      setCreating(false);
      setNewName("");
      onOpen(character.id);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">角色管理</h1>
          <p className="text-sm text-muted mt-1">先定义人物，再让故事围绕他展开</p>
        </div>
        <div className="flex-1" />
        <div className="inline-flex rounded-xl border border-line bg-white p-1">
          {(["custom", "auto", "all"] as const).map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={`px-3 py-1.5 rounded-lg text-sm cursor-pointer focus-warm ${
                category === c ? "bg-brand/10 text-brand" : "text-muted"
              }`}
            >
              {c === "custom" ? "自定义" : c === "auto" ? "自动生成" : "全部"}
            </button>
          ))}
        </div>
        <button
          onClick={() => setCreating(true)}
          className="px-4 py-2 rounded-xl bg-brand text-white text-sm font-medium cursor-pointer hover:opacity-90 focus-warm"
        >
          ＋ 新建角色
        </button>
      </div>

      {creating && (
        <div className="flex items-center gap-2 rounded-xl border border-line bg-white p-4">
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
            placeholder="角色名字，如：朵朵"
            className="flex-1 px-3 py-2 border border-line rounded-lg bg-paper focus-warm"
          />
          <button onClick={create} className="px-4 py-2 rounded-lg bg-brand text-white text-sm cursor-pointer focus-warm">创建</button>
          <button onClick={() => setCreating(false)} className="px-3 py-2 rounded-lg text-sm text-muted cursor-pointer focus-warm">取消</button>
        </div>
      )}

      {error && <div className="rounded-xl border border-red-200 bg-red-50 text-red-700 p-3 text-sm">{error}</div>}
      {!characters && !error && <Loader message="正在加载角色…" />}
      {characters && characters.length === 0 && category === "custom" && (
        <div className="rounded-2xl border border-dashed border-line bg-white p-10 text-center">
          <div className="text-4xl mb-3">🧸</div>
          <p className="font-medium text-ink">还没有自定义角色</p>
          <p className="text-sm text-muted mt-1">先创建一个人物（比如家里的孩子），上传照片生成角色形象，之后写故事就能直接使用他。</p>
          <button
            onClick={() => setCreating(true)}
            className="mt-4 px-4 py-2 rounded-xl bg-brand text-white text-sm cursor-pointer focus-warm"
          >
            创建第一个角色
          </button>
        </div>
      )}
      {characters && characters.length === 0 && category !== "custom" && (
        <div className="rounded-2xl border border-dashed border-line bg-white p-10 text-center text-muted">暂无角色</div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {characters?.map((ch) => {
          const cover = ch.sheets[0] ? assetUrl(ch.sheets[0].url) : null;
          return (
            <button
              key={ch.id}
              onClick={() => onOpen(ch.id)}
              className="rounded-2xl border border-line bg-white overflow-hidden text-left hover:shadow-soft transition-shadow cursor-pointer focus-warm"
            >
              <div className="aspect-square bg-paper-2 flex items-center justify-center overflow-hidden">
                {cover ? (
                  <img src={cover} alt={ch.name} className="w-full h-full object-cover" />
                ) : (
                  <span className="text-4xl">👤</span>
                )}
              </div>
              <div className="p-3">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-ink truncate">{ch.name}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${ch.category === "custom" ? "bg-brand/10 text-brand" : "bg-gray-100 text-gray-500"}`}>
                    {ch.category === "custom" ? "自定义" : "自动生成"}
                  </span>
                </div>
                <p className="text-xs text-muted mt-1">{ch.sheets.length} 张角色形象 · {ch.photoCount} 张照片</p>
                {ch.sourceStoryId && <p className="text-[10px] text-muted mt-0.5">来源故事 #{ch.sourceStoryId}</p>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
