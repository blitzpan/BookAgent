import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';
import type { CastSlot, SpeakerVoice, VoiceOption, VoiceCategory } from '../types';

interface Props {
  storyId: number;
}

const Icon = ({ d, className }: { d: string; className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className ?? 'w-4 h-4'}
    aria-hidden="true"
  >
    <path d={d} />
  </svg>
);
const SparkIcon = (p: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={p.className ?? 'w-4 h-4'} aria-hidden="true">
    <path d="M12 2l1.8 5.4L19 9.2l-5.2 1.8L12 16.4l-1.8-5.4L5 9.2l5.2-1.8Z" />
    <path d="M18.5 15l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9Z" />
  </svg>
);
const PlayIcon = (p: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={p.className ?? 'w-4 h-4'} aria-hidden="true">
    <path d="M8 5.5v13l11-6.5Z" />
  </svg>
);

const CATEGORY_LABEL: Record<VoiceCategory, string> = {
  mandarin: '普通话',
  dialect: '方言 / 地方口音',
  english: '英文',
};

const SELECT_CLS =
  'h-9 min-w-[7rem] max-w-[16rem] rounded-lg border border-line bg-white px-2 text-xs text-ink cursor-pointer focus-warm transition-colors duration-200 hover:border-brand/60';
const SMALL_BTN =
  'inline-flex items-center justify-center h-9 px-3 rounded-lg text-xs font-medium cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed focus-warm transition-colors duration-200';

const rowKey = (slot: CastSlot, speaker: string) => `${slot}|${speaker}`;

/** 角色音色配置：AI 推荐为主，可逐角色改写；未指定音色的角色跟随兜底。 */
const SpeakerVoicePanel: React.FC<Props> = ({ storyId }) => {
  const [items, setItems] = useState<SpeakerVoice[]>([]);
  const [pool, setPool] = useState<VoiceOption[]>([]);
  const [draft, setDraft] = useState<Record<string, { voiceZh: string; voiceEn: string }>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [recommending, setRecommending] = useState(false);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getSpeakerVoices(storyId);
      setItems(res.items);
      setPool(res.pool);
      const d: Record<string, { voiceZh: string; voiceEn: string }> = {};
      for (const it of res.items) {
        d[rowKey(it.slot, it.speaker)] = { voiceZh: it.voiceZh ?? '', voiceEn: it.voiceEn ?? '' };
      }
      setDraft(d);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [storyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const zhPool = useMemo(() => pool.filter((v) => v.category !== 'english'), [pool]);
  const enPool = useMemo(
    () => pool.filter((v) => v.category === 'english' || (v.locale ?? '').startsWith('en')),
    [pool]
  );

  const dirty = useMemo(
    () =>
      items.some((it) => {
        const d = draft[rowKey(it.slot, it.speaker)];
        return !!d && (d.voiceZh !== (it.voiceZh ?? '') || d.voiceEn !== (it.voiceEn ?? ''));
      }),
    [items, draft]
  );

  const setField = (key: string, field: 'voiceZh' | 'voiceEn', value: string) => {
    setDraft((prev) => ({ ...prev, [key]: { ...prev[key], [field]: value } }));
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await api.saveSpeakerVoices(
        storyId,
        items.map((it) => {
          const d = draft[rowKey(it.slot, it.speaker)] ?? { voiceZh: '', voiceEn: '' };
          return {
            slot: it.slot,
            speaker: it.speaker,
            voiceZh: it.slot === 'character' ? d.voiceZh || null : d.voiceZh,
            voiceEn: it.slot === 'character' ? d.voiceEn || null : d.voiceEn,
          };
        })
      );
      setItems(res.items);
      setPool(res.pool);
      setMessage('音色配置已保存。改音色后需重新生成配音才会生效。');
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleRecommend = async () => {
    setRecommending(true);
    setError(null);
    setMessage(null);
    try {
      const res = await api.recommendSpeakerVoices(storyId);
      setItems(res.items);
      setPool(res.pool);
      const d: Record<string, { voiceZh: string; voiceEn: string }> = {};
      for (const it of res.items) {
        d[rowKey(it.slot, it.speaker)] = { voiceZh: it.voiceZh ?? '', voiceEn: it.voiceEn ?? '' };
      }
      setDraft(d);
      setMessage(`AI 已重新推荐 ${res.items.filter((i) => i.slot === 'character').length} 个角色的音色。`);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setRecommending(false);
    }
  };

  const handlePreview = async (voice: string) => {
    if (!voice) return;
    setPreviewing(voice);
    try {
      const { url } = await api.previewVoice(voice, 'zh');
      if (!audioRef.current) audioRef.current = new Audio();
      audioRef.current.src = url;
      await audioRef.current.play();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setPreviewing(null);
    }
  };

  const renderSelect = (
    key: string,
    field: 'voiceZh' | 'voiceEn',
    options: VoiceOption[],
    allowEmpty: boolean,
    recommended: string[]
  ) => {
    const value = draft[key]?.[field] ?? '';
    const rec = recommended.filter((id) => options.some((o) => o.id === id));
    const groups: Array<{ label: string; items: VoiceOption[] }> = [];
    if (rec.length) {
      groups.push({
        label: 'AI 推荐',
        items: rec.map((id) => options.find((o) => o.id === id)!).filter(Boolean),
      });
    }
    for (const c of ['mandarin', 'dialect', 'english'] as VoiceCategory[]) {
      const g = options.filter((o) => (o.category ?? 'mandarin') === c && !rec.includes(o.id));
      if (g.length) groups.push({ label: CATEGORY_LABEL[c], items: g });
    }
    return (
      <select
        value={value}
        aria-label={field === 'voiceZh' ? '中文音色' : '英文音色'}
        onChange={(e) => setField(key, field, e.target.value)}
        className={SELECT_CLS}
      >
        {allowEmpty && <option value="">跟随兜底（未指定）</option>}
        {groups.map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.items.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}（{v.gender === 'male' ? '男' : '女'}
                {v.child ? '·童声' : ''}）{v.tags.slice(0, 2).join('、')}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    );
  };

  const narration = items.find((i) => i.slot === 'narration');
  const fallback = items.find((i) => i.slot === 'fallback');
  const characters = items.filter((i) => i.slot === 'character');

  return (
    <div className="rounded-xl2 border border-line bg-white p-4 shadow-card space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="font-display text-base font-bold text-ink">角色音色</h4>
          <p className="text-sm text-muted-strong mt-0.5 leading-relaxed">
            重要角色拥有各自音色，台词较少的角色统一使用兜底音色；可随时手动改写。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleRecommend}
            disabled={recommending || loading}
            className={`${SMALL_BTN} bg-brand-soft text-brand-strong hover:bg-brand/20`}
          >
            <SparkIcon className={`w-4 h-4 ${recommending ? 'animate-pulse' : ''}`} />
            {recommending ? 'AI 选角中…' : 'AI 重新推荐'}
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !dirty}
            className={`${SMALL_BTN} ${dirty ? 'bg-brand text-white hover:bg-brand-strong' : 'bg-paper-3 text-muted-strong'}`}
          >
            {saving ? '保存中…' : '保存音色配置'}
          </button>
        </div>
      </div>

      {loading && <p className="text-sm text-muted-strong">加载角色音色中…</p>}

      {!loading && items.length === 0 && (
        <p className="text-sm text-muted-strong">
          尚无角色音色配置。点击「新建配音」时会自动按 AI 推荐生成一次。
        </p>
      )}

      {!loading && items.length > 0 && (
        <div className="space-y-2">
          {/* 兜底两行：视觉弱化，与角色行区分层级 */}
          {[narration, fallback].map(
            (row) =>
              row && (
                <div
                  key={row.slot}
                  className="flex flex-wrap items-center gap-2 rounded-xl bg-paper-2 px-3 py-2"
                >
                  <span className="text-xs font-semibold text-muted-strong w-24 shrink-0">
                    {row.slot === 'narration' ? '旁白音色' : '其余角色音色'}
                  </span>
                  {renderSelect(rowKey(row.slot, row.speaker), 'voiceZh', zhPool, false, [])}
                  {renderSelect(rowKey(row.slot, row.speaker), 'voiceEn', enPool, false, [])}
                  <button
                    onClick={() => handlePreview(draft[rowKey(row.slot, row.speaker)]?.voiceZh || row.voiceZh || '')}
                    disabled={previewing !== null}
                    title="试听该音色"
                    className={`${SMALL_BTN} bg-white border border-line text-ink hover:bg-paper-3`}
                  >
                    <PlayIcon className="w-3.5 h-3.5" />
                    试听
                  </button>
                </div>
              )
          )}

          {characters.length > 0 && (
            <div className="max-h-72 overflow-y-auto rounded-xl border border-line divide-y divide-line">
              {characters.map((c) => {
                const key = rowKey(c.slot, c.speaker);
                const d = draft[key] ?? { voiceZh: '', voiceEn: '' };
                const isDirty = d.voiceZh !== (c.voiceZh ?? '') || d.voiceEn !== (c.voiceEn ?? '');
                const hasOwn = !!(c.voiceZh || c.voiceEn);
                return (
                  <div key={key} className="flex flex-wrap items-center gap-2 px-3 py-2">
                    <span className="min-w-[6rem] font-semibold text-ink text-sm">{c.speaker}</span>
                    <span className="text-xs text-muted-strong">{c.lineCount} 句</span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        hasOwn ? 'bg-sage-soft text-[#3f5a35]' : 'bg-paper-3 text-muted-strong'
                      }`}
                    >
                      {hasOwn ? '专属音色' : '走兜底'}
                    </span>
                    {c.source === 'manual' && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-gold-soft text-[#8a5a1e]">手动</span>
                    )}
                    <div className="ml-auto flex flex-wrap items-center gap-2">
                      {renderSelect(key, 'voiceZh', zhPool, true, [
                        ...(c.voiceZh ? [c.voiceZh] : []),
                        ...c.altVoices,
                      ])}
                      {renderSelect(key, 'voiceEn', enPool, true, [])}
                      <button
                        onClick={() => handlePreview(d.voiceZh)}
                        disabled={!d.voiceZh || previewing !== null}
                        title="试听该音色"
                        className={`${SMALL_BTN} bg-white border border-line text-ink hover:bg-paper-3`}
                      >
                        <PlayIcon className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => {
                          setField(key, 'voiceZh', '');
                          setField(key, 'voiceEn', '');
                        }}
                        disabled={!hasOwn && !d.voiceZh}
                        title="恢复为兜底音色"
                        className={`${SMALL_BTN} bg-paper-2 text-muted-strong hover:bg-line`}
                      >
                        <Icon className="w-3.5 h-3.5" d="M3 12a9 9 0 1 0 2.64-6.36M3 3v6h6" />
                      </button>
                      {isDirty && (
                        <span
                          title="未保存"
                          className="w-2 h-2 rounded-full bg-[#F59E0B] shrink-0"
                          aria-label="未保存"
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <p className="text-xs text-muted">
        提示：这里改的是「音色配置」，已生成的音频不会变——保存后重新生成一次配音即可生效。
      </p>

      {message && (
        <div className="text-sm p-2 rounded-lg border-l-4 border-sage bg-sage-soft text-[#3f5a35]">
          {message}
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="text-sm p-2 rounded-lg border-l-4 border-[#b3453a] bg-[#f9ecea] text-[#8f3327]"
        >
          {error}
        </div>
      )}
    </div>
  );
};

export default SpeakerVoicePanel;
