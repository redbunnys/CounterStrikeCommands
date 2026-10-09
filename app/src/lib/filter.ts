import type { CommandEntry } from '../types.ts';

/**
 * 纯函数筛选核心（无任何 DOM / React 依赖，便于 Node 端 smoke test 直接复用）。
 *
 * 语义：
 *  - 同一维度内多选 = OR；不同维度之间 = AND。
 *  - 搜索：大小写不敏感，匹配「命令名 + 中文描述 + 英文描述」；多个空格分隔的关键词之间为 AND。
 */

export type DefaultValueFilter = 'any' | 'has' | 'none';

export interface FilterState {
  query: string;
  flags: string[];
  sections: string[];
  defaultValue: DefaultValueFilter;
}

export const EMPTY_FILTERS: FilterState = {
  query: '',
  flags: [],
  sections: [],
  defaultValue: 'any',
};

export function splitQueryTerms(rawQuery: string): string[] {
  return rawQuery
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 0);
}

export function matchesQuery(entry: CommandEntry, rawQuery: string): boolean {
  const terms = splitQueryTerms(rawQuery);
  if (terms.length === 0) return true;
  const haystack = [
    entry.command.toLowerCase(),
    (entry.descriptionZh ?? '').toLowerCase(),
    (entry.descriptionEn ?? '').toLowerCase(),
  ];
  return terms.every((term) => haystack.some((field) => field.includes(term)));
}

export function matchesFlags(entry: CommandEntry, selected: string[]): boolean {
  if (selected.length === 0) return true;
  return selected.some((flag) => entry.flags.includes(flag));
}

export function matchesSection(entry: CommandEntry, selected: string[]): boolean {
  if (selected.length === 0) return true;
  return selected.includes(entry.section);
}

export function matchesDefaultValue(entry: CommandEntry, filter: DefaultValueFilter): boolean {
  if (filter === 'any') return true;
  const hasValue = entry.defaultValue !== null && String(entry.defaultValue).trim() !== '';
  return filter === 'has' ? hasValue : !hasValue;
}

/** 单个条目是否通过全部维度（维度间 AND） */
export function matchesFilters(entry: CommandEntry, state: FilterState): boolean {
  return (
    matchesQuery(entry, state.query) &&
    matchesFlags(entry, state.flags) &&
    matchesSection(entry, state.sections) &&
    matchesDefaultValue(entry, state.defaultValue)
  );
}

export function filterCommands(entries: CommandEntry[], state: FilterState): CommandEntry[] {
  return entries.filter((entry) => matchesFilters(entry, state));
}

export function hasActiveFilters(state: FilterState): boolean {
  return (
    state.query.trim() !== '' ||
    state.flags.length > 0 ||
    state.sections.length > 0 ||
    state.defaultValue !== 'any'
  );
}

/** 某个维度内的选中项在点击时做 OR 追加 / 移除 */
export function toggleValue(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

export interface FacetCount {
  key: string;
  count: number;
}

/** 统计某个维度上各取值的条目数（用于筛选按钮上的计数，基于全量数据） */
export function countBy(entries: CommandEntry[], pick: (entry: CommandEntry) => string[]): FacetCount[] {
  const map = new Map<string, number>();
  for (const entry of entries) {
    for (const key of pick(entry)) {
      map.set(key, (map.get(key) ?? 0) + 1);
    }
  }
  return [...map.entries()].map(([key, count]) => ({ key, count }));
}

/** 稳定排序：先按命令名升序（数据本身已升序，这里做一次防御性保证） */
export function sortByCommand(entries: CommandEntry[]): CommandEntry[] {
  return [...entries].sort((a, b) => (a.command < b.command ? -1 : a.command > b.command ? 1 : 0));
}
