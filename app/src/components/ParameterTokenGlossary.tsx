import { useMemo, useState } from 'react';
import { PLACEHOLDER_TOKENS } from '../lib/placeholders.ts';

/**
 * 可折叠的参数占位符对照表：82 种占位符的中文释义，
 * 由 app/scripts/inline-parameter-tokens.mjs 从 data/translation/parameter-tokens.md
 * 与 data/commands.json 交叉核对后生成（运行时零额外请求）。
 */
export function ParameterTokenGlossary() {
  const [query, setQuery] = useState('');
  const annotatable = useMemo(
    () => PLACEHOLDER_TOKENS.filter((entry) => entry.source !== 'variant'),
    [],
  );
  const variantCount = PLACEHOLDER_TOKENS.length - annotatable.length;
  const total = annotatable.length;
  const totalOccurrences = useMemo(
    () => annotatable.reduce((sum, entry) => sum + entry.count, 0),
    [annotatable],
  );
  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (keyword === '') return annotatable;
    return annotatable.filter(
      (entry) => entry.token.toLowerCase().includes(keyword) || entry.zh.includes(keyword),
    );
  }, [annotatable, query]);

  return (
    <details className="glossary">
      <summary className="glossary__summary">
        参数占位符对照表（{total} 种 · 描述中共出现 {totalOccurrences} 处
        {variantCount > 0 ? ` · 另有 ${variantCount} 种译文变体` : ''}）
      </summary>
      <p className="glossary__note">
        占位符在描述与复制内容里都是<b>逐字保留英文</b>的技术参数（直接粘进 .cfg / 控制台），
        这里只提供中文释义；<code>{'<t\\|ct>'}</code> 里的反斜杠是源站原文，属于正确数据。
      </p>
      <input
        type="search"
        className="glossary__search"
        placeholder="过滤占位符，如 entity、player、map…"
        value={query}
        spellCheck={false}
        onChange={(event) => setQuery(event.target.value)}
      />
      <ul className="glossary__list">
        {filtered.map((entry) => (
          <li key={entry.token} className="glossary__item">
            <code className="glossary__token">{entry.token}</code>
            <span className="glossary__zh">{entry.zh}</span>
            <span className="glossary__count">×{entry.count}</span>
          </li>
        ))}
        {filtered.length === 0 && <li className="glossary__item">没有匹配的占位符</li>}
      </ul>
    </details>
  );
}
