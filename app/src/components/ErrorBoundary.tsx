import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  stack: string;
}

/** 兜底错误边界：渲染期异常时显示可读的错误卡片，绝不白屏。 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, stack: '' };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[cs2-commands-zh] 渲染异常', error, info.componentStack);
    this.setState({ stack: info.componentStack ?? '' });
  }

  render(): ReactNode {
    const { error, stack } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="app-shell">
        <div className="state-card state-card--error" role="alert">
          <h2>界面渲染出错（已捕获，未白屏）</h2>
          <p className="state-card__message">{error.name}: {error.message}</p>
          <pre className="state-card__detail">{stack.trim() || '（没有组件栈信息）'}</pre>
          <ul className="state-card__hints">
            <li>刷新页面重试；若问题持续，检查浏览器控制台的报错信息。</li>
            <li>确认数据文件符合冻结契约：{' '}
              <code>{'{ meta, commands: [{ id, command, defaultValue, flags, descriptionEn, descriptionZh, section }] }'}</code>
            </li>
          </ul>
          <button type="button" className="btn btn--primary" onClick={() => window.location.reload()}>
            刷新页面
          </button>
        </div>
      </div>
    );
  }
}
