import { useMemo } from 'react';
import type { CommandEntry } from '../types.ts';
import {
  countBy,
  toggleValue,
  type DefaultValueFilter,
  type FilterState,
} from '../lib/filter.ts';
import {
  FLAG_ORDER,
  FLAG_PRESETS,
  SECTION_ORDER,
  flagLabel,
  flagTooltip,
  sectionLabel,
} from '../lib/flags.ts';

interface FilterPanelProps {
  entries: CommandEntry[];
  state: FilterState;
  onChange: (next: FilterState) => void;
  onClear: () => void;
}

const DEFAULT_VALUE_OPTIONS: { value: DefaultValueFilter; label: string; hint: string }[] = [
  { value: 'any', label: '全部', hint: '不按默认值筛选' },
  { value: 'has', label: '有默认值', hint: 'default value 不为空' },
  { value: 'none', label: '无默认值', hint: 'default value 为空（数据源未给出）' },
];

export function FilterPanel({ entries, state, onChange, onClear }: FilterPanelProps) {
  const flagFacets = useMemo(() => {
    const counts = new Map(countBy(entries, (entry) => entry.flags).map((f) => [f.key, f.count]));
    const ordered = FLAG_ORDER.filter((flag) => counts.has(flag));
    const unknown = [...counts.keys()].filter((flag) => !FLAG_ORDER.includes(flag)).sort();
    return [...ordered, ...unknown].map((flag) => ({ flag, count: counts.get(flag) ?? 0 }));
  }, [entries]);

  const sectionFacets = useMemo(() => {
    const counts = new Map(countBy(entries, (entry) => [entry.section]).map((f) => [f.key, f.count]));
    const rank = (key: string) => {
      const index = SECTION_ORDER.indexOf(key);
      return index === -1 ? SECTION_ORDER.length : index;
    };
    return [...counts.entries()]
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => rank(a.key) - rank(b.key) || a.key.localeCompare(b.key));
  }, [entries]);

  const toggleFlag = (flag: string) => onChange({ ...state, flags: toggleValue(state.flags, flag) });
  const toggleSection = (section: string) =>
    onChange({ ...state, sections: toggleValue(state.sections, section) });

  return (
    <section className="filters" aria-label="筛选条件">
      <div className="filters__row">
        <span className="filters__label">常用</span>
        <div className="chips chips--presets">
          {FLAG_PRESETS.map((preset) => {
            const active = state.flags.length === 1 && state.flags[0] === preset.flag;
            return (
              <button
                key={preset.id}
                type="button"
                className={`chip chip--preset${active ? ' is-active' : ''}`}
                title={`${preset.hint}（再次点击取消）`}
                aria-pressed={active}
                onClick={() => onChange({ ...state, flags: active ? [] : [preset.flag] })}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="filters__row">
        <span className="filters__label">标记</span>
        <div className="chips">
          {flagFacets.map(({ flag, count }) => {
            const active = state.flags.includes(flag);
            return (
              <button
                key={flag}
                type="button"
                className={`chip${active ? ' is-active' : ''}`}
                aria-pressed={active}
                title={flagTooltip(flag)}
                onClick={() => toggleFlag(flag)}
              >
                <span className="chip__zh">{flagLabel(flag)}</span>
                <span className="chip__code">{flag}</span>
                <span className="chip__count">{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="filters__row">
        <span className="filters__label">首字母</span>
        <div className="chips chips--sections">
          {sectionFacets.map(({ key, count }) => {
            const active = state.sections.includes(key);
            return (
              <button
                key={key}
                type="button"
                className={`chip chip--section${active ? ' is-active' : ''}`}
                aria-pressed={active}
                title={`${sectionLabel(key)}：${count} 条`}
                onClick={() => toggleSection(key)}
              >
                {key === '_' ? '_' : key}
                <span className="chip__count">{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="filters__row">
        <span className="filters__label">默认值</span>
        <div className="chips">
          {DEFAULT_VALUE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`chip${state.defaultValue === option.value ? ' is-active' : ''}`}
              aria-pressed={state.defaultValue === option.value}
              title={option.hint}
              onClick={() => onChange({ ...state, defaultValue: option.value })}
            >
              {option.label}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn--ghost filters__clear" onClick={onClear}>
          清空筛选
        </button>
      </div>
    </section>
  );
}
