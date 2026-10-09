import { useEffect, useRef } from 'react';
import { selectAll } from '../lib/clipboard.ts';

export interface ToastState {
  id: number;
  text: string;
  tone: 'success' | 'error' | 'info';
}

interface ToastProps {
  toast: ToastState | null;
  onDismiss: () => void;
}

export function Toast({ toast, onDismiss }: ToastProps) {
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(onDismiss, toast.tone === 'error' ? 4200 : 2000);
    return () => window.clearTimeout(timer);
  }, [toast, onDismiss]);

  if (!toast) return null;
  return (
    <div className={`toast toast--${toast.tone}`} role="status" aria-live="polite">
      <span className="toast__dot" aria-hidden="true" />
      <span>{toast.text}</span>
      <button type="button" className="toast__close" onClick={onDismiss} aria-label="关闭提示">
        ×
      </button>
    </div>
  );
}

interface ManualCopyPanelProps {
  text: string;
  reason: string;
  onClose: () => void;
}

/** Clipboard API 失败时的降级面板：全选文本 + 提示手动 Ctrl+C。 */
export function ManualCopyPanel({ text, reason, onClose }: ManualCopyPanelProps) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    selectAll(ref.current);
  }, [text]);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="手动复制">
      <div className="modal">
        <h3 className="modal__title">自动复制失败，请手动复制</h3>
        <p className="modal__hint">
          原因：{reason}
          <br />
          下面的文本已自动全选，按 <kbd>Ctrl</kbd> + <kbd>C</kbd>（macOS 为 <kbd>⌘</kbd> + <kbd>C</kbd>）复制即可。
        </p>
        <textarea
          ref={ref}
          className="modal__textarea"
          readOnly
          value={text}
          rows={Math.min(14, Math.max(3, text.split('\n').length + 1))}
          onFocus={(event) => event.currentTarget.select()}
        />
        <div className="modal__actions">
          <button
            type="button"
            className="btn"
            onClick={() => {
              selectAll(ref.current);
            }}
          >
            重新全选
          </button>
          <button type="button" className="btn btn--primary" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
