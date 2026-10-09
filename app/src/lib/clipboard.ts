/** 浏览器剪贴板封装：Clipboard API 失败时返回可降级信息，由 UI 提示手动复制。 */

export type CopyOutcome =
  | { ok: true; method: 'clipboard-api' }
  | { ok: false; reason: string; fallbackText: string };

export async function copyToClipboard(text: string): Promise<CopyOutcome> {
  const value = text ?? '';
  if (typeof navigator === 'undefined') {
    return { ok: false, reason: '当前环境没有 navigator.clipboard', fallbackText: value };
  }
  // 非安全上下文（http 且非 localhost）下 navigator.clipboard 为 undefined
  const clipboard = navigator.clipboard;
  if (!clipboard || typeof clipboard.writeText !== 'function') {
    return {
      ok: false,
      reason: '浏览器未提供 Clipboard API（需要 HTTPS 或 localhost）',
      fallbackText: value,
    };
  }
  try {
    await clipboard.writeText(value);
    return { ok: true, method: 'clipboard-api' };
  } catch (error) {
    const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return { ok: false, reason, fallbackText: value };
  }
}

/** 降级方案：返回一个已全选的 textarea，用户按 Ctrl+C 即可手动复制。 */
export function selectAll(element: HTMLTextAreaElement | null): void {
  if (!element) return;
  element.focus();
  element.select();
  try {
    element.setSelectionRange(0, element.value.length);
  } catch {
    /* 部分浏览器对只读 textarea 的 setSelectionRange 会抛错，忽略即可 */
  }
}
