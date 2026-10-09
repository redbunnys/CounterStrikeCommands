import { useCallback, useEffect, useState } from 'react';
import type { CommandEntry, Dataset, DatasetState, DatasetWarning } from '../types.ts';
import { FLAG_WHITELIST } from '../lib/flags.ts';

export const DATASET_URL = '/data/commands.json';

const TROUBLESHOOTING_HINTS = [
  '确认 data/commands.json 存在（由 tools/prepare-data.mjs 生成，约 700 KB / 2528 条）。',
  'pnpm dev：vite.config.ts 里的 cs2-frozen-dataset 插件会以原始 JSON 字节响应 /data/commands.json。',
  'pnpm preview / 静态托管：需要 dist/data/commands.json —— pnpm build 会自动把 data/commands.json 复制过去。',
  '打开浏览器开发者工具的 Network 面板，查看 /data/commands.json 的 HTTP 状态码与响应内容。',
  '不要用 file:// 直接打开 index.html，fetch 会被浏览器拦截；请使用 pnpm dev 或 pnpm preview。',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeEntry(raw: unknown): CommandEntry | null {
  if (!isRecord(raw)) return null;
  const command = raw.command;
  if (typeof command !== 'string' || command.trim() === '') return null;
  const flags = Array.isArray(raw.flags) ? raw.flags.filter((f): f is string => typeof f === 'string') : [];
  return {
    id: typeof raw.id === 'number' ? raw.id : 0,
    command,
    defaultValue: raw.defaultValue === null || raw.defaultValue === undefined ? null : String(raw.defaultValue),
    flags,
    descriptionEn: typeof raw.descriptionEn === 'string' ? raw.descriptionEn : '',
    descriptionZh: typeof raw.descriptionZh === 'string' ? raw.descriptionZh : '',
    section: typeof raw.section === 'string' && raw.section !== '' ? raw.section : '_',
  };
}

function buildWarnings(dataset: Dataset): DatasetWarning[] {
  const warnings: DatasetWarning[] = [];
  const commands = dataset.commands;
  const expected = dataset.meta?.commands;
  if (typeof expected === 'number' && expected !== commands.length) {
    warnings.push({
      id: 'count-mismatch',
      text: `meta.commands=${expected} 与实际条目数 ${commands.length} 不一致，界面以实际数据为准。`,
    });
  }
  const unknownFlags = new Set<string>();
  for (const entry of commands) {
    for (const flag of entry.flags) {
      if (!FLAG_WHITELIST.has(flag)) unknownFlags.add(flag);
    }
  }
  if (unknownFlags.size > 0) {
    warnings.push({
      id: 'unknown-flags',
      text: `数据中出现白名单之外的标记：${[...unknownFlags].join('、')}（按原名展示）。`,
    });
  }
  return warnings;
}

export function useDataset(): { state: DatasetState; reload: () => void } {
  const [state, setState] = useState<DatasetState>({ status: 'loading' });
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => {
    setNonce((value) => value + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });

    const load = async () => {
      let response: Response;
      try {
        response = await fetch(`${DATASET_URL}?t=${Date.now()}`, { cache: 'no-store' });
      } catch (error) {
        if (cancelled) return;
        const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        setState({
          status: 'error',
          message: '无法请求数据文件 /data/commands.json',
          detail: reason,
          hints: TROUBLESHOOTING_HINTS,
        });
        return;
      }

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        if (cancelled) return;
        setState({
          status: 'error',
          message: `数据文件请求失败：HTTP ${response.status} ${response.statusText}`,
          detail: body.slice(0, 400) || '（响应体为空）',
          hints: TROUBLESHOOTING_HINTS,
        });
        return;
      }

      const text = await response.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch (error) {
        if (cancelled) return;
        const reason = error instanceof Error ? error.message : String(error);
        setState({
          status: 'error',
          message: '数据文件不是合法 JSON（解析失败）',
          detail: `${reason}\n响应前 200 字符：${text.slice(0, 200)}`,
          hints: [
            '如果响应以 `export default` 开头，说明 JSON 被当作 ESM 模块返回了，请确认 vite.config.ts 的 cs2-frozen-dataset 插件已生效。',
            ...TROUBLESHOOTING_HINTS,
          ],
        });
        return;
      }

      if (!isRecord(parsed) || !Array.isArray(parsed.commands)) {
        if (cancelled) return;
        setState({
          status: 'error',
          message: '数据文件结构不符合冻结契约（缺少 commands 数组）',
          detail: `顶层键：${isRecord(parsed) ? Object.keys(parsed).join(', ') : typeof parsed}`,
          hints: TROUBLESHOOTING_HINTS,
        });
        return;
      }

      const commands = parsed.commands
        .map(normalizeEntry)
        .filter((entry): entry is CommandEntry => entry !== null);
      if (commands.length === 0) {
        if (cancelled) return;
        setState({
          status: 'error',
          message: '数据文件里没有可用的命令条目',
          detail: `commands 长度为 ${parsed.commands.length}`,
          hints: TROUBLESHOOTING_HINTS,
        });
        return;
      }

      const dataset: Dataset = {
        meta: isRecord(parsed.meta) ? parsed.meta : {},
        commands,
      };
      if (cancelled) return;
      setState({ status: 'ready', dataset, warnings: buildWarnings(dataset) });
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  return { state, reload };
}
