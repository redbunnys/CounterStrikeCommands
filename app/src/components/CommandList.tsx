import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { CommandEntry } from '../types.ts';
import { buildCommandLine, valueForCommand } from '../lib/copy.ts';
import { flagLabel, flagTooltip, sectionLabel } from '../lib/flags.ts';
import { PlaceholderText } from './PlaceholderText.tsx';

/** 分块渲染步长：首屏只渲染 80 条，滚动到底部再追加，保证 2528 条下滚动流畅。 */
const CHUNK_SIZE = 80;

interface CommandRowProps {
  entry: CommandEntry;
  value: string;
  selected: boolean;
  showGloss: boolean;
  onToggleSelect: (id: number) => void;
  onValueChange: (id: number, value: string) => void;
  onCopy: (text: string, label: string) => void;
}

const CommandRow = memo(function CommandRow({
  entry,
  value,
  selected,
  showGloss,
  onToggleSelect,
  onValueChange,
  onCopy,
}: CommandRowProps) {
  const zh = entry.descriptionZh.trim();
  const en = entry.descriptionEn.trim();
  const defaultValueText = entry.defaultValue === null ? '—' : entry.defaultValue;
  const lineWithValue = buildCommandLine(entry.command, value);

  return (
    <li className={`cmd-row${selected ? ' is-selected' : ''}`} data-command={entry.command}>
      <label className="cmd-row__check" title="勾选后可批量复制">
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect(entry.id)}
          aria-label={`选择 ${entry.command}`}
        />
      </label>

      <div className="cmd-row__body">
        <div className="cmd-row__head">
          <button
            type="button"
            className="cmd-name"
            title="点击复制命令名"
            onClick={() => onCopy(entry.command, entry.command)}
          >
            {entry.command}
          </button>
          <span className="badge badge--section" title={`首字母段落：${sectionLabel(entry.section)}`}>
            {entry.section}
          </span>
          {entry.flags.map((flag) => (
            <span key={flag} className={`badge badge--flag flag-${flag}`} title={flagTooltip(flag)}>
              {flagLabel(flag)}
            </span>
          ))}
        </div>

        <p className="cmd-row__desc">
          {zh ? (
            <span className="desc-zh">
              <PlaceholderText text={zh} showGloss={showGloss} />
            </span>
          ) : en ? (
            <>
              <span className="desc-en">
                <PlaceholderText text={en} showGloss={showGloss} />
              </span>
              <span className="badge badge--untranslated" title="该条目的中文译文尚未合并，暂时回退显示英文原文">
                英文原文
              </span>
            </>
          ) : (
            <span className="desc-empty">（数据源未提供描述）</span>
          )}
        </p>

        <p className="cmd-row__meta">
          <span className="cmd-row__default">
            默认值：<code>{defaultValueText}</code>
            {entry.defaultValue === 'cmd' && <em>（该条是命令，不是变量）</em>}
          </span>
        </p>
      </div>

      <div className="cmd-row__actions">
        <label className="value-field" title="可编辑：复制时会用这里的值">
          <span>值</span>
          <input
            type="text"
            className="value-field__input"
            value={value}
            placeholder="可留空"
            spellCheck={false}
            onChange={(event) => onValueChange(entry.id, event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                onCopy(buildCommandLine(entry.command, event.currentTarget.value), lineWithValue);
              }
            }}
          />
        </label>
        <div className="cmd-row__buttons">
          <button
            type="button"
            className="btn btn--primary btn--sm"
            title={`复制：${lineWithValue}`}
            onClick={() => onCopy(lineWithValue, lineWithValue)}
          >
            复制命令+值
          </button>
          <button
            type="button"
            className="btn btn--sm"
            title={`复制：${entry.command}`}
            onClick={() => onCopy(entry.command, entry.command)}
          >
            仅命令
          </button>
        </div>
      </div>
    </li>
  );
});

export interface CommandListProps {
  entries: CommandEntry[];
  values: Record<number, string>;
  selected: Set<number>;
  showGloss: boolean;
  onToggleSelect: (id: number) => void;
  onValueChange: (id: number, value: string) => void;
  onCopy: (text: string, label: string) => void;
  onClearFilters: () => void;
  hasFilters: boolean;
}

export function CommandList({
  entries,
  values,
  selected,
  showGloss,
  onToggleSelect,
  onValueChange,
  onCopy,
  onClearFilters,
  hasFilters,
}: CommandListProps) {
  const [visibleCount, setVisibleCount] = useState(CHUNK_SIZE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setVisibleCount(CHUNK_SIZE);
  }, [entries]);

  const visible = useMemo(() => entries.slice(0, visibleCount), [entries, visibleCount]);
  const hasMore = visibleCount < entries.length;

  useEffect(() => {
    if (!hasMore) return;
    const node = sentinelRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (records) => {
        if (records.some((record) => record.isIntersecting)) {
          setVisibleCount((count) => Math.min(count + CHUNK_SIZE, entries.length));
        }
      },
      { rootMargin: '320px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, entries.length]);

  if (entries.length === 0) {
    return (
      <div className="empty-state" role="status">
        <p className="empty-state__title">没有匹配的命令</p>
        <p className="empty-state__hint">
          试试减少筛选条件、换一个关键词，或检查是否输入了多余的空格（搜索会同时匹配命令名与描述）。
        </p>
        {hasFilters && (
          <button type="button" className="btn btn--primary" onClick={onClearFilters}>
            清空全部筛选
          </button>
        )}
      </div>
    );
  }

  const valueFor = (entry: CommandEntry): string =>
    values[entry.id] ?? valueForCommand(entry.defaultValue);

  return (
    <div className="cmd-list-wrap">
      <ul className="cmd-list">
        {visible.map((entry) => (
          <CommandRow
            key={entry.id}
            entry={entry}
            value={valueFor(entry)}
            selected={selected.has(entry.id)}
            showGloss={showGloss}
            onToggleSelect={onToggleSelect}
            onValueChange={onValueChange}
            onCopy={onCopy}
          />
        ))}
      </ul>

      {hasMore && (
        <div className="cmd-list__more" ref={sentinelRef}>
          <span className="cmd-list__progress">
            已渲染 {visible.length} / {entries.length} 条
          </span>
          <button
            type="button"
            className="btn"
            onClick={() => setVisibleCount((count) => Math.min(count + CHUNK_SIZE * 2, entries.length))}
          >
            显示更多（+{Math.min(CHUNK_SIZE * 2, entries.length - visible.length)} 条）
          </button>
        </div>
      )}
    </div>
  );
}

export interface BatchBarProps {
  selectedCount: number;
  resultCount: number;
  onCopyNames: () => void;
  onCopyWithValues: () => void;
  onCopyCfg: () => void;
  onSelectAllResults: () => void;
  onClearSelection: () => void;
}

export function BatchBar({
  selectedCount,
  resultCount,
  onCopyNames,
  onCopyWithValues,
  onCopyCfg,
  onSelectAllResults,
  onClearSelection,
}: BatchBarProps) {
  if (selectedCount === 0) return null;
  return (
    <div className="batch-bar" role="region" aria-label="批量复制">
      <span className="batch-bar__count">已选 {selectedCount} 条</span>
      <div className="batch-bar__actions">
        <button type="button" className="btn btn--primary btn--sm" onClick={onCopyWithValues}>
          批量复制（命令+值）
        </button>
        <button type="button" className="btn btn--sm" onClick={onCopyNames}>
          批量复制命令名
        </button>
        <button type="button" className="btn btn--sm" onClick={onCopyCfg} title="含值与行尾换行，可直接保存为 .cfg">
          复制为 .cfg
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onSelectAllResults}>
          全选当前结果（{resultCount} 条）
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onClearSelection}>
          清空选择
        </button>
      </div>
    </div>
  );
}
