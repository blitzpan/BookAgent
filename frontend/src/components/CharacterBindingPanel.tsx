import { useEffect, useState } from "react";
import { api, assetUrl } from "../api/client";
import type { CharacterBinding, CharacterView } from "../types";

interface Props {
  storyId: number;
  style?: string | null;
  disabled?: boolean;
}

/** 画风 token（与后端 constants/style.ts 一致，画风统一为中文预设）。 */
const styleTokens = (raw?: string | null): string[] =>
  (raw ?? "").split(/[，,、]/).map((s) => s.trim()).filter(Boolean);

/** 故事详情内的角色配置：主角/配角用哪个角色形象，auto 临时角色只读。 */
export default function CharacterBindingPanel({ storyId, style, disabled }: Props) {
  const [bindings, setBindings] = useState<CharacterBinding[]>([]);
  const [customChars, setCustomChars] = useState<CharacterView[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const load = () => {
    setError("");
    Promise.all([
      api.getCharacterBindings(storyId),
      api.listCharacters({ category: "custom" }),
    ])
      .then(([b, c]) => {
        setBindings(b.bindings);
        setCustomChars(c.characters);
      })
      .catch((e) => setError(String(e?.message ?? e)));
  };

  useEffect(load, [storyId]);

  const userBindings = bindings.filter((b) => b.source === "user");
  const autoBindings = bindings.filter((b) => b.source === "auto");
  const storyStyleTokens = styleTokens(style);

  /** 与该故事画风匹配的角色形象列表（画风统一为中文预设，做 token 交集）。 */
  const matchingSheets = (sheets: Array<{ id: number; style: string; url: string }>) =>
    storyStyleTokens.length === 0
      ? sheets
      : sheets.filter((s) => styleTokens(s.style).some((t) => storyStyleTokens.includes(t)));

  const update = (idx: number, patch: Partial<CharacterBinding>) =>
    setBindings((prev) => {
      const next = [...prev];
      const target = next.filter((b) => b.source === "user")[idx];
      next[next.indexOf(target)] = { ...target, ...patch };
      return next;
    });

  const addCharacter = () => {
    const c = customChars.find(
      (x) => !userBindings.some((b) => b.characterId === x.id) && matchingSheets(x.sheets).length > 0
    );
    if (!c) {
      setError(
        storyStyleTokens.length
          ? `没有「${style}」画风的角色形象可用，请先到角色管理生成`
          : "没有可添加的角色，请先在角色管理创建"
      );
      return;
    }
    const sheet = matchingSheets(c.sheets)[0];
    setBindings((prev) => [
      ...prev,
      {
        id: 0,
        characterId: c.id,
        characterName: c.name,
        category: "custom",
        charKey: c.charKey,
        sheetId: sheet?.id ?? null,
        sheetUrl: sheet?.url ?? null,
        sheetStyle: sheet?.style ?? null,
        roleInStory: "supporting",
        nameInStory: c.name,
        source: "user",
      },
    ]);
  };

  const removeUser = (idx: number) => {
    const target = userBindings[idx];
    setBindings((prev) => prev.filter((b) => b !== target));
  };

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const r = await api.putCharacterBindings(
        storyId,
        userBindings.map((b) => ({
          characterId: b.characterId,
          sheetId: b.sheetId,
          roleInStory: b.roleInStory,
          nameInStory: b.nameInStory ?? undefined,
        }))
      );
      setBindings(r.bindings);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">
        主角与自定义角色必须选定角色形象；系统从故事自动生成的临时角色在生图后自动加入（只读）。
      </p>
      {error && <div className="rounded-lg border border-red-200 bg-red-50 text-red-700 p-2 text-xs">{error}</div>}

      <div className="space-y-2">
        {userBindings.map((b, idx) => (
          <div key={b.characterId} className="flex items-center gap-3 rounded-xl border border-line bg-paper p-2">
            {b.sheetUrl && <img src={assetUrl(b.sheetUrl) ?? ""} alt="" className="w-10 h-10 rounded object-cover" />}
            <div className="min-w-0 flex-1">
              <div className="text-sm text-ink truncate">
                {b.characterName}
                {b.roleInStory === "protagonist" && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-brand/10 text-brand">主角</span>}
              </div>
              <select
                disabled={disabled}
                value={b.sheetId ?? ""}
                onChange={(e) => {
                  const c = customChars.find((x) => x.id === b.characterId);
                  const sheet = c?.sheets.find((s) => s.id === Number(e.target.value));
                  update(idx, { sheetId: sheet?.id ?? null, sheetUrl: sheet?.url ?? null, sheetStyle: sheet?.style ?? null });
                }}
                className="mt-1 text-xs px-2 py-1 border border-line rounded bg-white text-ink focus-warm"
              >
                <option value="">（未选角色形象）</option>
                {matchingSheets(customChars.find((x) => x.id === b.characterId)?.sheets ?? []).map((s) => (
                  <option key={s.id} value={s.id}>{s.style}</option>
                ))}
              </select>
            </div>
            <select
              disabled={disabled}
              value={b.roleInStory}
              onChange={(e) => update(idx, { roleInStory: e.target.value as "protagonist" | "supporting" })}
              className="text-xs px-2 py-1 border border-line rounded bg-white text-ink focus-warm"
            >
              <option value="protagonist">主角</option>
              <option value="supporting">配角</option>
            </select>
            <button disabled={disabled} onClick={() => removeUser(idx)} className="text-xs text-muted hover:text-red-600 cursor-pointer">移除</button>
          </div>
        ))}
      </div>

      {autoBindings.length > 0 && (
        <div className="text-xs text-muted">
          临时角色：{autoBindings.map((b) => b.characterName).join("、")}
        </div>
      )}

      <div className="flex gap-2">
        <button disabled={disabled} onClick={addCharacter} className="px-3 py-1.5 rounded-lg border border-line bg-white text-sm cursor-pointer focus-warm">＋ 添加角色</button>
        <button disabled={disabled || saving} onClick={save} className="px-4 py-1.5 rounded-lg bg-brand text-white text-sm cursor-pointer focus-warm disabled:opacity-50">{saving ? "保存中…" : "保存角色配置"}</button>
      </div>
    </div>
  );
}
