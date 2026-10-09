import type { CommandEntry } from '../types.ts';

/**
 * 纯字符串拼装（无 DOM 依赖，Node 端 smoke test 直接复用）。
 *
 * 复制规则：
 *  - 命令名：`sv_cheats`
 *  - 命令 + 值：`sv_cheats 1`（单空格分隔，可直接粘进 .cfg）
 *  - 数据里的 default value 为 `cmd` 时表示「该条本身是命令」，不作为值拼进命令行。
 *  - 批量复制：每行一条，行尾统一 LF，便于 .cfg 使用。
 */

/** 把数据里的 defaultValue 归一化成「可拼进命令行的值」；cmd / null / 空串 -> '' */
export function valueForCommand(defaultValue: string | null | undefined): string {
  const value = (defaultValue ?? '').toString().trim();
  if (value === '' || value.toLowerCase() === 'cmd') return '';
  return value;
}

/** 拼一条命令行；value 为空时退化为单命令名 */
export function buildCommandLine(command: string, value?: string | null): string {
  const name = (command ?? '').trim();
  const normalized = valueForCommand(value);
  return normalized === '' ? name : `${name} ${normalized}`;
}

/** 默认值是否可视作「有值」（用于「有默认值」筛选与按钮状态） */
export function hasUsableValue(defaultValue: string | null | undefined): boolean {
  return valueForCommand(defaultValue) !== '';
}

export interface BatchOptions {
  /** true = 每行「命令 值」；false = 每行仅命令名 */
  includeValues?: boolean;
}

/** 批量复制文本：一行一条，行尾 LF，不带 BOM、不带尾随换行 */
export function buildBatchText(
  entries: Pick<CommandEntry, 'command' | 'defaultValue'>[],
  options: BatchOptions = {},
): string {
  const includeValues = options.includeValues === true;
  return entries
    .map((entry) =>
      includeValues ? buildCommandLine(entry.command, entry.defaultValue) : (entry.command ?? '').trim(),
    )
    .join('\n');
}

/** 生成可直接粘贴到 .cfg 的完整文本（可选带注释头，默认不带） */
export function buildCfgFile(entries: Pick<CommandEntry, 'command' | 'defaultValue'>[]): string {
  const body = buildBatchText(entries, { includeValues: true });
  return `${body}\n`;
}
