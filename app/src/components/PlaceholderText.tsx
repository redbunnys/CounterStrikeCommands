import { useMemo } from 'react';
import { renderPlaceholderSegments } from '../lib/placeholders.ts';

interface PlaceholderTextProps {
  text: string;
  /** true = 在占位符后显示小字中文释义；false = 只保留 tooltip（hover 可见） */
  showGloss: boolean;
}

/**
 * 描述文本的展示组件：占位符逐字原样输出（不改写、不清洗反斜杠），
 * 额外用 <abbr title> + 行内小字给出中文释义，方便中文用户理解参数含义。
 *
 * 注意：这里的注解只存在于“展示层”。复制逻辑（lib/copy.ts）从不经过本组件，
 * 复制的永远是命令名与取值本身，因此占位符（含 `<t\|ct>` 的反斜杠）保持原样。
 */
export function PlaceholderText({ text, showGloss }: PlaceholderTextProps) {
  const segments = useMemo(() => renderPlaceholderSegments(text), [text]);

  return (
    <>
      {segments.map((segment, index) => {
        if (segment.kind === 'text') return <span key={index}>{segment.text}</span>;
        // 译文变体（中文译者改写过的括号内容）不是占位符，原样显示、不加注解
        if (segment.source === 'variant') return <span key={index}>{segment.text}</span>;
        return (
          <abbr
            key={index}
            className="ph"
            title={`参数占位符 ${segment.text}：${segment.zh}（复制时保持原样，可直接粘进 .cfg）`}
          >
            {segment.text}
            {showGloss && <span className="ph__zh">〔{segment.zh}〕</span>}
          </abbr>
        );
      })}
    </>
  );
}
