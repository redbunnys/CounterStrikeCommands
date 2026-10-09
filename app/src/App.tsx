import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CommandEntry } from './types.ts';
import { useDataset } from './hooks/useDataset.ts';
import { EMPTY_FILTERS, filterCommands, hasActiveFilters, type FilterState } from './lib/filter.ts';
import { buildBatchText, buildCfgFile, buildCommandLine, valueForCommand } from './lib/copy.ts';
import { copyToClipboard } from './lib/clipboard.ts';
import { FilterPanel } from './components/FilterPanel.tsx';
import { BatchBar, CommandList } from './components/CommandList.tsx';
import { ParameterTokenGlossary } from './components/ParameterTokenGlossary.tsx';
import { ManualCopyPanel, Toast, type ToastState } from './components/Toast.tsx';

function truncate(text: string, max = 60): string {
  const oneLine = text.replace(/\s*\n\s*/g, ' ⏎ ');
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

interface ManualCopyState {
  text: string;
  reason: string;
}

export default function App() {
  const { state, reload } = useDataset();
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [values, setValues] = useState<Record<number, string>>({});
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [toast, setToast] = useState<ToastState | null>(null);
  const [manual, setManual] = useState<ManualCopyState | null>(null);
  const [showGloss, setShowGloss] = useState(true);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const toastSeq = useRef(0);

  const commands = useMemo<CommandEntry[]>(
    () => (state.status === 'ready' ? state.dataset.commands : []),
    [state],
  );

  const filtered = useMemo(() => filterCommands(commands, filters), [commands, filters]);
  const filtersActive = hasActiveFilters(filters);

  const translatedCount = useMemo(
    () => commands.filter((entry) => entry.descriptionZh.trim() !== '').length,
    [commands],
  );
  /** 源站有英文描述、理论上可翻译的条目数（其余条目源站本身就无描述） */
  const translatableCount = useMemo(
    () => commands.filter((entry) => entry.descriptionEn.trim() !== '').length,
    [commands],
  );

  const selectedInView = useMemo(
    () => filtered.filter((entry) => selected.has(entry.id)),
    [filtered, selected],
  );

  const pushToast = useCallback((text: string, tone: ToastState['tone']) => {
    toastSeq.current += 1;
    setToast({ id: toastSeq.current, text, tone });
  }, []);

  const handleCopy = useCallback(
    async (text: string, label: string) => {
      const outcome = await copyToClipboard(text);
      if (outcome.ok) {
        pushToast(`已复制：${truncate(label)}`, 'success');
        return;
      }
      setManual({ text: outcome.fallbackText, reason: outcome.reason });
      pushToast('自动复制失败，已打开手动复制面板', 'error');
    },
    [pushToast],
  );

  const handleValueChange = useCallback((id: number, value: string) => {
    setValues((prev) => ({ ...prev, [id]: value }));
  }, []);

  const handleToggleSelect = useCallback((id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clearFilters = useCallback(() => {
    setFilters(EMPTY_FILTERS);
    searchRef.current?.focus();
  }, []);

  const valueOf = useCallback(
    (entry: CommandEntry): string => values[entry.id] ?? valueForCommand(entry.defaultValue),
    [values],
  );

  const copySelection = useCallback(
    (mode: 'names' | 'values' | 'cfg') => {
      if (selectedInView.length === 0) {
        pushToast('当前结果里没有已勾选的命令', 'info');
        return;
      }
      const rows = selectedInView.map((entry) => ({
        command: entry.command,
        defaultValue: values[entry.id] ?? entry.defaultValue,
      }));
      const text =
        mode === 'names'
          ? buildBatchText(rows, { includeValues: false })
          : mode === 'cfg'
            ? buildCfgFile(rows)
            : buildBatchText(rows, { includeValues: true });
      const label =
        mode === 'names'
          ? `${rows.length} 条命令名`
          : mode === 'cfg'
            ? `${rows.length} 条 .cfg 文本`
            : `${rows.length} 条「命令+值」`;
      void handleCopy(text, label);
    },
    [handleCopy, pushToast, selectedInView, values],
  );

  // 键盘可用性：Esc 逐级清空；'/' 聚焦搜索框
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (manual) {
          setManual(null);
          return;
        }
        if (filters.query !== '') {
          setFilters((prev) => ({ ...prev, query: '' }));
          return;
        }
        if (hasActiveFilters(filters)) {
          setFilters(EMPTY_FILTERS);
          return;
        }
        return;
      }
      if (event.key === '/' && !event.metaKey && !event.ctrlKey) {
        const target = event.target as HTMLElement | null;
        const tag = target?.tagName?.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || target?.isContentEditable) return;
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [filters, manual]);

  const meta = state.status === 'ready' ? state.dataset.meta : undefined;
  const total = commands.length;

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header__titles">
          <h1>CS2 控制台命令与变量查询</h1>
          <p className="app-header__sub">
            Valve 开发者维基全表 · 共 {total > 0 ? total : '…'} 条 · 支持搜索 / 标记与首字母筛选 / 一键复制到 .cfg
          </p>
        </div>
        <div className="app-header__stats">
          <span className="stat">
            <strong>{total > 0 ? total : '—'}</strong> 条命令
          </span>
          <span className="stat">
            <strong>{translatedCount}</strong> 条已有中文
          </span>
          <span className="stat">
            <strong>{state.status === 'ready' ? filtered.length : '—'}</strong> 条命中
          </span>
        </div>
      </header>

      {state.status === 'ready' && (
        <>
          <div className="search-bar">
            <div className="search-bar__input-wrap">
              <input
                ref={searchRef}
                type="search"
                className="search-bar__input"
                placeholder="搜索命令名或描述（中英文均可），如 sv_cheats、回合、mp_roundt…"
                value={filters.query}
                spellCheck={false}
                autoComplete="off"
                aria-label="搜索命令"
                onChange={(event) => setFilters((prev) => ({ ...prev, query: event.target.value }))}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    const first = filtered[0];
                    if (!first) {
                      pushToast('没有匹配的命令，无法复制', 'info');
                      return;
                    }
                    void handleCopy(
                      buildCommandLine(first.command, valueOf(first)),
                      buildCommandLine(first.command, valueOf(first)),
                    );
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    setFilters((prev) => ({ ...prev, query: '' }));
                  }
                }}
              />
              {filters.query !== '' && (
                <button
                  type="button"
                  className="search-bar__clear"
                  aria-label="清空搜索"
                  onClick={() => {
                    setFilters((prev) => ({ ...prev, query: '' }));
                    searchRef.current?.focus();
                  }}
                >
                  ×
                </button>
              )}
            </div>
            <span className="search-bar__count" role="status">
              {filtersActive ? `筛选结果 ${filtered.length} / ${total} 条` : `全部 ${total} 条`}
            </span>
            {filtersActive && (
              <button type="button" className="btn btn--ghost btn--sm" onClick={clearFilters}>
                清空筛选
              </button>
            )}
          </div>

          <FilterPanel entries={commands} state={filters} onChange={setFilters} onClear={clearFilters} />

          <p className="shortcut-hint">
            快捷键：<kbd>Enter</kbd> 复制第一条结果 · <kbd>Esc</kbd> 清空搜索/筛选 · <kbd>/</kbd> 聚焦搜索框 ·
            行内「值」可编辑后再复制
            <label className="shortcut-hint__toggle" title="描述里的参数占位符（如 <player>）显示中文释义">
              <input
                type="checkbox"
                checked={showGloss}
                onChange={(event) => setShowGloss(event.target.checked)}
              />
              显示参数释义
            </label>
          </p>

          <ParameterTokenGlossary />

          {translatableCount > 0 && translatedCount === 0 && (
            <div className="notice notice--warn" role="status">
              <strong>中文描述尚未合并：</strong>
              <span>
                当前数据集里 {total} 条命令的 <code>descriptionZh</code> 全部为空，列表会回退显示英文原文，并逐条标注
                「英文原文」。
              </span>
            </div>
          )}
          {translatedCount > 0 && translatedCount < translatableCount && (
            <div className="notice notice--warn" role="status">
              <strong>部分翻译：</strong>
              <span>
                {translatedCount} / {translatableCount} 条有英文原文的命令已有中文描述，其余回退显示英文原文并标注
                「英文原文」。
              </span>
            </div>
          )}
          {translatedCount > 0 && translatedCount >= translatableCount && (
            <div className="notice" role="status">
              <strong>中文描述已全部合并：</strong>
              <span>
                {translatedCount} / {translatableCount} 条有英文原文的命令均已翻译为简体中文；另有{' '}
                {total - translatableCount} 条命令源站本身没有提供描述。
              </span>
            </div>
          )}

          {state.warnings.map((warning) => (
            <div key={warning.id} className="notice notice--warn" role="status">
              <strong>数据提示：</strong>
              <span>{warning.text}</span>
            </div>
          ))}
        </>
      )}

      <main className="app-main">
        {state.status === 'loading' && (
          <div className="state-card" role="status">
            <h2>正在加载命令数据…</h2>
            <p className="state-card__message">数据来源：<code>/data/commands.json</code></p>
          </div>
        )}

        {state.status === 'error' && (
          <div className="state-card state-card--error" role="alert">
            <h2>数据加载失败</h2>
            <p className="state-card__message">{state.message}</p>
            <pre className="state-card__detail">{state.detail}</pre>
            <h3>排查提示</h3>
            <ul className="state-card__hints">
              {state.hints.map((hint) => (
                <li key={hint}>{hint}</li>
              ))}
            </ul>
            <button type="button" className="btn btn--primary" onClick={reload}>
              重新加载
            </button>
          </div>
        )}

        {state.status === 'ready' && (
          <CommandList
            entries={filtered}
            values={values}
            selected={selected}
            showGloss={showGloss}
            onToggleSelect={handleToggleSelect}
            onValueChange={handleValueChange}
            onCopy={handleCopy}
            onClearFilters={clearFilters}
            hasFilters={filtersActive}
          />
        )}
      </main>

      {state.status === 'ready' && (
        <BatchBar
          selectedCount={selectedInView.length}
          resultCount={filtered.length}
          onCopyNames={() => copySelection('names')}
          onCopyWithValues={() => copySelection('values')}
          onCopyCfg={() => copySelection('cfg')}
          onSelectAllResults={() => setSelected(new Set(filtered.map((entry) => entry.id)))}
          onClearSelection={() => setSelected(new Set())}
        />
      )}

      <footer className="app-footer">
        {meta?.source ? (
          <p>
            数据来源：
            <a href={String(meta.source)} target="_blank" rel="noreferrer">
              {String(meta.source)}
            </a>
          </p>
        ) : (
          <p>数据来源：data/commands.json</p>
        )}
        <p>
          {meta?.sourceRetrieved ? `维基页面版本：${String(meta.sourceRetrieved)}` : ''}
          {meta?.sourceBuild ? ` · 游戏构建：${String(meta.sourceBuild)}` : ''}
          {meta?.generatedAt ? ` · 数据生成时间：${String(meta.generatedAt)}` : ''}
        </p>
        {selected.size > 0 && selectedInView.length !== selected.size && (
          <p className="app-footer__note">
            已勾选 {selected.size} 条，其中 {selectedInView.length} 条在当前筛选结果内（批量复制只作用于当前结果）。
          </p>
        )}
      </footer>

      <BatchBarSpacer visible={selectedInView.length > 0} />
      <Toast toast={toast} onDismiss={() => setToast(null)} />
      {manual && <ManualCopyPanel text={manual.text} reason={manual.reason} onClose={() => setManual(null)} />}
    </div>
  );
}

/** 底部批量条是 fixed 定位，用一个占位块避免遮挡最后一行。 */
function BatchBarSpacer({ visible }: { visible: boolean }) {
  return visible ? <div className="batch-bar-spacer" aria-hidden="true" /> : null;
}
