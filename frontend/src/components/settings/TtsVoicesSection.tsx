import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client';
import type { VoiceOption, VoicePoolStats } from '../../types';
import { BUTTON_BASE, CATEGORY_LABEL, CATEGORY_ORDER, RefreshIcon, StatTile, formatTime } from './shared';

/**
 * 设置中心 → 「TTS 音色库」分区。
 * 从微软拉取全部音色后由 AI 筛选，展示统计与明细，可手动触发更新。
 * 组件自包含：只负责本分区的数据与 UI，被 SettingsPanel 外壳在右侧内容区渲染。
 */
const TtsVoicesSection: React.FC = () => {
  const [pool, setPool] = useState<VoiceOption[]>([]);
  const [stats, setStats] = useState<VoicePoolStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showList, setShowList] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getVoicePool();
      setPool(res.pool);
      setStats(res.stats);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // 进入设置页时由外壳触发一次加载；这里再保底拉一次，避免外壳未传事件时空白。
  useEffect(() => {
    void load();
  }, [load]);

  const handleRefresh = async () => {
    setRefreshing(true);
    setError(null);
    setMessage(null);
    try {
      const res = await api.refreshVoicePool();
      setPool(res.pool);
      setStats(res.stats);
      setMessage(
        `已更新：普通话 ${res.stats.mandarin} · 方言 ${res.stats.dialect} · 英文 ${res.stats.english}（共 ${res.stats.total} 条）`
      );
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setRefreshing(false);
    }
  };

  const grouped = CATEGORY_ORDER.map((c) => ({
    category: c,
    items: pool.filter((v) => (v.category ?? 'mandarin') === c),
  })).filter((g) => g.items.length > 0);

  return (
    <section className="rounded-2xl border border-line bg-white p-5 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="font-display text-base font-bold text-ink">TTS 音色库</h4>
          <p className="text-sm text-muted-strong mt-0.5 leading-relaxed">
            从微软拉取全部音色后由 AI 筛选：以中文普通话为主，保留少量代表性方言，英文只留几条。
            筛选结果供「AI 角色选角」与页面下拉使用。
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing || loading}
          className={`${BUTTON_BASE} bg-brand text-white hover:bg-brand-strong`}
        >
          <RefreshIcon className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          {refreshing ? '拉取并筛选中…' : '更新音色'}
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-strong mt-4">加载音色库中…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
            <StatTile value={stats?.total ?? 0} label="共收录" />
            <StatTile value={stats?.mandarin ?? 0} label="普通话" />
            <StatTile value={stats?.dialect ?? 0} label="方言" />
            <StatTile value={stats?.english ?? 0} label="英文" />
          </div>

          <div className="flex flex-wrap items-center gap-2 mt-3 text-xs text-muted-strong">
            <span>更新于 {formatTime(stats?.updatedAt ?? null)}</span>
            <span
              className={`px-2 py-0.5 rounded-full ${
                stats?.source === 'ai' ? 'bg-sage-soft text-[#3f5a35]' : 'bg-paper-3 text-ink'
              }`}
            >
              {stats?.source === 'ai' ? 'AI 筛选' : '内置默认（尚未更新）'}
            </span>
            <button
              onClick={() => setShowList((v) => !v)}
              className="ml-auto inline-flex items-center h-8 px-3 rounded-lg text-xs font-medium bg-paper-2 text-ink hover:bg-line cursor-pointer focus-warm transition-colors duration-200"
            >
              {showList ? '收起列表' : '查看列表'}
            </button>
          </div>

          {message && (
            <div className="text-sm mt-3 p-2 rounded-lg border-l-4 border-sage bg-sage-soft text-[#3f5a35]">
              {message}
            </div>
          )}
          {error && (
            <div
              role="alert"
              className="text-sm mt-3 p-2 rounded-lg border-l-4 border-[#b3453a] bg-[#f9ecea] text-[#8f3327]"
            >
              {error}
              <span className="block text-xs text-muted-strong mt-1">
                音色库未变更，仍使用上一次结果（若从未更新过则使用内置默认池）。
              </span>
            </div>
          )}

          {showList && (
            <div className="mt-3 max-h-80 overflow-y-auto rounded-xl border border-line divide-y divide-line">
              {grouped.map((g) => (
                <div key={g.category} className="p-3">
                  <div className="text-xs font-semibold text-muted-strong mb-2">
                    {CATEGORY_LABEL[g.category]}（{g.items.length}）
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {g.items.map((v) => (
                      <span
                        key={v.id}
                        title={`${v.id} · ${v.gender === 'male' ? '男' : '女'}${
                          v.child ? ' · 童声' : ''
                        }${v.tags.length ? ' · ' + v.tags.join('、') : ''}`}
                        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-paper-2 text-xs text-ink cursor-default"
                      >
                        <span className="font-medium">{v.label}</span>
                        <span className="text-muted">
                          {v.gender === 'male' ? '男' : '女'}
                          {v.child ? '·童声' : ''}
                        </span>
                        {v.tags.slice(0, 2).map((t) => (
                          <span key={t} className="text-muted">
                            ·{t}
                          </span>
                        ))}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
              {!grouped.length && (
                <p className="p-3 text-sm text-muted-strong">暂无音色，点击「更新音色」拉取。</p>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
};

export default TtsVoicesSection;
