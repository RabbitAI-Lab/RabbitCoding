/**
 * StreamingText 组件
 *
 * 用于渲染 Agent 流式输出的文本块。
 * 基于 @ant-design/x-markdown 实现流式友好渲染，
 * 支持代码高亮、Mermaid 图表、GFM 表格等。
 */

import { memo } from 'react';
import { XMarkdown } from '@ant-design/x-markdown';
import type { ComponentProps } from '@ant-design/x-markdown';
import { CodeHighlighter, Mermaid } from '@ant-design/x';
import { useTheme } from '../../hooks/useTheme';

interface StreamingTextProps {
  text: string;
  isStreaming?: boolean;
}

// Mermaid 包装组件：适配 XMarkdown ComponentProps 到 MermaidProps
const MermaidBlock = (props: ComponentProps) => {
  const { children } = props;
  const code = typeof children === 'string' ? children : String(children ?? '');
  return <Mermaid>{code}</Mermaid>;
};

// 模块级常量，保持引用稳定（XMarkdown 最佳实践）
const components = {
  code: (props: ComponentProps) => {
    const { children, lang, block } = props;
    const codeText = typeof children === 'string' ? children : String(children ?? '');

    // 块级代码使用 CodeHighlighter
    if (block) {
      return <CodeHighlighter lang={lang}>{codeText}</CodeHighlighter>;
    }

    // 行内代码：恢复默认样式（XMarkdown 主题已提供基础样式）
    return <code>{children}</code>;
  },
  mermaid: MermaidBlock,
};

function StreamingTextInner({ text, isStreaming }: StreamingTextProps) {
  const { resolvedTheme } = useTheme();
  if (!text) return null;

  const markdownClass = resolvedTheme === 'dark' ? 'x-markdown-dark' : 'x-markdown-light';

  return (
    <div className={`text-sm leading-relaxed ${markdownClass} text-[#141414] dark:text-gray-100`}>
      <XMarkdown
        content={text}
        components={components}
        streaming={{
          hasNextChunk: !!isStreaming,
          enableAnimation: true,
          tail: true,
        }}
        openLinksInNewTab
      />
    </div>
  );
}

export const StreamingText = memo(StreamingTextInner);
