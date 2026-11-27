import { useEffect, useState } from "react";
import { api, assetUrl } from "../api/client";
import type { CharacterView, CharacterBasicAttributes } from "../types";
import StylePicker from "./StylePicker";
import Loader from "./Loader";

interface Props {
  characterId: number;
  onBack: () => void;
}

/** 角色详情/编辑：基本属性、生图描述、照片墙、角色形象（按画风）。 */
export default function CharacterDetail({ characterId, onBack }: Props) {
  const [ch, setCh] = useState<CharacterView | null>(null);
  const [photos, setPhotos] = useState<{ id: number; url: string }[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // 表单状态
  const [name, setName] = useState("");
  const [visual, setVisual] = useState("");
  const [gender, setGender] = useState("");
  const [age, setAge] = useState("");
  const [hobbies, setHobbies] = useState("");
  const [habits, setHabits] = useState("");
  const [allergies, setAllergies] = useState("");

  // 生成角色形象
  const [selStyles, setSelStyles] = useState<string[]>([]);
  const [customStyle, setCustomStyle] = useState("");
  const [selPhotos, setSelPhotos] = useState<number[]>([]);

  const fillForm = (c: CharacterView) => {
    setName(c.name);
    setVisual(c.visualDescription ?? "");
    const a = c.basicAttributes;
    setGender((a.gender as string) ?? "");
    setAge(a.age != null ? String(a.age) : "");
    setHobbies(Array.isArray(a.hobbies) ? a.hobbies.join("、") : "");
    setHabits(Array.isArray(a.habits) ? a.habits.join("、") : "");
    setAllergies(Array.isArray(a.allergies) ? a.allergies.join("、") : "");
  };

  const reload = () => {
    setError("");
    Promise.all([api.getCharacter(characterId)])
      .then(async ([r]) => {
        setCh(r.character);
        fillForm(r.character);
        if (r.character.category === "custom") {
          const p = await api.listCharacterPhotos(characterId);
          setPhotos(p.photos);
          setSelPhotos((prev) => prev.length ? prev : p.photos.map((x) => x.id));
        }
      })
      .catch((e) => setError(String(e?.message ?? e)));
  };

  useEffect(reload, [characterId]);

  const saveProfile = async () => {
    if (!ch) return;
    setBusy(true);
    setError("");
    const attrs: CharacterBasicAttributes = {
      gender: gender.trim() || undefined,
      age: age.trim() ? (Number.isNaN(Number(age)) ? age.trim() : Number(age)) : undefined,
      hobbies: hobbies.split(/[、,，]/).map((s) => s.trim()).filter(Boolean),
      habits: habits.split(/[、,，]/).map((s) => s.trim()).filter(Boolean),
      allergies: allergies.split(/[、,，]/).map((s) => s.trim()).filter(Boolean),
    };
    try {
      const r = await api.updateCharacter(characterId, { name: name.trim(), visualDescription: visual, basicAttributes: attrs });
      setCh(r.character);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const uploadPhotos = async (files: FileList | null) => {
    if (!files?.length || !ch) return;
    setBusy(true);
    setError("");
    try {
      const images = await Promise.all(
        Array.from(files).map(
          (f) => new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = reject;
            reader.readAsDataURL(f);
          })
        )
      );
      await api.addCharacterPhotos(characterId, images);
      const p = await api.listCharacterPhotos(characterId);
      setPhotos(p.photos);
      setSelPhotos((prev) => [...new Set([...prev, ...p.photos.map((x) => x.id)])]);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const doGenerateSheet = async (replace = false) => {
    const style = [...selStyles, customStyle.trim()].filter(Boolean).join("，");
    if (!style) { setError("请选择或填写画风"); return; }
    if (!selPhotos.length) { setError("请至少选择一张照片"); return; }
    setBusy(true);
    setError("");
    try {
      await api.generateCharacterSheet(characterId, { style, photoIds: selPhotos }, replace);
      const r = await api.getCharacter(characterId);
      setCh(r.character);
    } catch (e: any) {
      if (e?.needReplace) {
        if (window.confirm("该画风角色形象已存在，是否重新生成？")) doGenerateSheet(true);
        return;
      }
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  if (!ch) return error ? <div className="text-red-600">{error}</div> : <Loader message="正在加载角色…" />;

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="px-3 py-2 rounded-lg border border-line bg-white text-sm cursor-pointer focus-warm">← 返回</button>
        <h1 className="font-display text-2xl font-bold">角色管理 · {ch.name}</h1>
        <span className={`text-xs px-2 py-0.5 rounded-full ${ch.category === "custom" ? "bg-brand/10 text-brand" : "bg-gray-100 text-gray-500"}`}>
          {ch.category === "custom" ? "自定义" : "自动生成"}
        </span>
      </div>
      {error && <div className="rounded-xl border border-red-200 bg-red-50 text-red-700 p-3 text-sm">{error}</div>}

      {/* 基本属性 + 生图描述 */}
      <section className="rounded-2xl border border-line bg-white p-5 space-y-4">
        <h2 className="font-semibold text-ink">人物档案</h2>
        {ch.category === "auto" && (
          <p className="text-xs text-muted rounded-lg bg-paper-2 p-2">该角色由系统从故事自动生成。补全描述后即可跨画风生成角色形象并复用。</p>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="text-sm text-muted flex flex-col gap-1">名字
            <input value={name} onChange={(e) => setName(e.target.value)} className="px-3 py-2 border border-line rounded-lg bg-paper text-ink focus-warm" />
          </label>
          <label className="text-sm text-muted flex flex-col gap-1">性别
            <select value={gender} onChange={(e) => setGender(e.target.value)} className="px-3 py-2 border border-line rounded-lg bg-paper text-ink focus-warm">
              <option value="">未指定</option>
              {["男", "女", "其他"].map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
              {gender && !["男", "女", "其他"].includes(gender) && (
                <option value={gender}>{gender}</option>
              )}
            </select>
          </label>
          <label className="text-sm text-muted flex flex-col gap-1">年龄
            <input type="number" min={0} max={120} value={age} onChange={(e) => setAge(e.target.value)} placeholder="如：5" className="px-3 py-2 border border-line rounded-lg bg-paper text-ink focus-warm" />
          </label>
          <label className="text-sm text-muted flex flex-col gap-1">爱好（顿号分隔）
            <input value={hobbies} onChange={(e) => setHobbies(e.target.value)} placeholder="画画、看蚂蚁" className="px-3 py-2 border border-line rounded-lg bg-paper text-ink focus-warm" />
          </label>
          <label className="text-sm text-muted flex flex-col gap-1">生活习惯 / 性格
            <input value={habits} onChange={(e) => setHabits(e.target.value)} placeholder="爱挑食" className="px-3 py-2 border border-line rounded-lg bg-paper text-ink focus-warm" />
          </label>
          <label className="text-sm text-muted flex flex-col gap-1">过敏 / 需注意
            <input value={allergies} onChange={(e) => setAllergies(e.target.value)} placeholder="花生" className="px-3 py-2 border border-line rounded-lg bg-paper text-ink focus-warm" />
          </label>
        </div>
        <label className="text-sm text-muted flex flex-col gap-1">外貌与随身物品（生图描述）
          <textarea value={visual} onChange={(e) => setVisual(e.target.value)} rows={2} placeholder="圆脸，齐刘海，戴红框眼镜，背黄色小书包" className="px-3 py-2 border border-line rounded-lg bg-paper text-ink focus-warm" />
        </label>
        <button onClick={saveProfile} disabled={busy} className="px-4 py-2 rounded-lg bg-brand text-white text-sm cursor-pointer focus-warm disabled:opacity-50">保存档案</button>
      </section>

      {/* 照片墙（仅自定义角色） */}
      {ch.category === "custom" && (
        <section className="rounded-2xl border border-line bg-white p-5 space-y-3">
          <h2 className="font-semibold text-ink">参考照片</h2>
          <p className="text-xs text-muted">上传孩子的照片，生成角色形象时会作为身份参考。</p>
          <input type="file" accept="image/*" multiple onChange={(e) => uploadPhotos(e.target.files)} className="text-sm" />
          <div className="flex flex-wrap gap-3">
            {photos.map((p) => (
              <div key={p.id} className="relative">
                <img src={assetUrl(p.url) ?? ""} alt="参考照片" className="w-20 h-20 object-cover rounded-lg border border-line" />
                <label className="absolute bottom-1 left-1 flex items-center gap-1 text-[10px] bg-white/90 rounded px-1">
                  <input type="checkbox" checked={selPhotos.includes(p.id)} onChange={() => setSelPhotos((prev) => prev.includes(p.id) ? prev.filter((x) => x !== p.id) : [...prev, p.id])} />
                  选用
                </label>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 生成角色形象 */}
      <section className="rounded-2xl border border-line bg-white p-5 space-y-3">
        <h2 className="font-semibold text-ink">生成角色形象</h2>
        <p className="text-xs text-muted">同一个人物可以有多种画风的形象，写故事时按画风选用。</p>
        <StylePicker selected={selStyles} custom={customStyle} onChange={(s, c) => { setSelStyles(s); setCustomStyle(c); }} />
        <button onClick={() => doGenerateSheet(false)} disabled={busy} className="px-4 py-2 rounded-lg bg-brand text-white text-sm cursor-pointer focus-warm disabled:opacity-50">
          {busy ? "生成中…" : "生成角色形象"}
        </button>
      </section>

      {/* 已有角色形象 */}
      <section className="rounded-2xl border border-line bg-white p-5 space-y-3">
        <h2 className="font-semibold text-ink">已有角色形象（{ch.sheets.length}）</h2>
        {ch.sheets.length === 0 ? (
          <p className="text-sm text-muted">还没有角色形象，先在上方生成一张。</p>
        ) : (
          <div className="flex flex-wrap gap-4">
            {ch.sheets.map((s) => (
              <div key={s.id} className="w-36 text-center">
                <img src={assetUrl(s.url) ?? ""} alt={s.style} className="w-36 h-36 object-cover rounded-xl border border-line" />
                <p className="text-xs text-ink mt-1">{s.style}</p>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
