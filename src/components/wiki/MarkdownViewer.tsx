/**
 * MarkdownViewer — 基于 CherryMarkdown 的只读 Markdown 渲染组件
 *
 * 用于 Wiki 文档内容的渲染，支持代码高亮、表格、Mermaid 等丰富语法。
 * 仅预览模式，不可编辑。
 */

import { useEffect, useRef } from 'react';
import Cherry from 'cherry-markdown';
import 'cherry-markdown/dist/cherry-markdown.min.css';
import * as echarts from 'echarts';
import { useTheme } from '../../hooks/useTheme';
import { useI18n } from '../../i18n/useI18n';

// CherryMarkdown 通过 window.echarts 全局获取图表依赖
// （覆盖表格引擎构造、地图 registerMap 等所有 getExternal('echarts') 调用路径）
if (typeof window !== 'undefined' && !(window as any).echarts) {
  (window as any).echarts = echarts;
}

export type FontSize = 'small' | 'medium' | 'large';

interface MarkdownViewerProps {
  content: string;
  fontSize?: FontSize;
}

const FONT_SIZE_MAP: Record<FontSize, string> = {
  small: '11px',
  medium: '13px',
  large: '15px',
};

// CherryMarkdown previewOnly 模式下的高度修正样式
const containerStyle = `
.cherry-markdown {
  height: 100%;
}
.cherry {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.cherry-editor {
  display: none !important;
}
.cherry-previewer {
  width: 100% !important;
  position: static !important;
  height: 100%;
  overflow-y: auto;
}
.cherry-previewer .cherry-markdown {
  padding: 20px 28px;
  line-height: 1.7;
}
`;

let styleInjected = false;
function ensureStyle() {
  if (styleInjected) return;
  const el = document.createElement('style');
  el.textContent = containerStyle;
  document.head.appendChild(el);
  styleInjected = true;
}

export default function MarkdownViewer({ content, fontSize = 'medium' }: MarkdownViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cherryRef = useRef<Cherry | null>(null);
  const { resolvedTheme } = useTheme();
  const { language } = useI18n();

  useEffect(() => {
    if (!containerRef.current) return;
    ensureStyle();

    const cherry = new Cherry({
      el: containerRef.current,
      value: content,
      locale: language === 'zh' ? 'zh_CN' : 'en_US',
      toolbars: {
        showToolbar: false,
        toolbar: [],
        bubble: false,
        float: false,
        toc: false,
      },
      editor: {
        height: '100%',
        defaultModel: 'previewOnly',
      },
      previewer: {
        enablePreviewerBubble: false,
        floatWhenClosePreviewer: false,
      },
      themeSettings: {
        themeList: [
          { className: 'default', label: 'Light' },
          { className: 'dark', label: 'Dark' },
        ],
        mainTheme: resolvedTheme === 'dark' ? 'dark' : 'default',
        codeBlockTheme: resolvedTheme === 'dark' ? 'dark' : 'default',
        inlineCodeTheme: 'black',
      },
    });

    cherryRef.current = cherry;

    return () => {
      // 清理 DOM：CherryMarkdown 卸载时不会自动清理容器内容
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
      cherryRef.current = null;
    };
  }, []);

  // 字号变化时：直接设置 .cherry-markdown 元素的 inline font-size，并同步所有代码块
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const targetSize = FONT_SIZE_MAP[fontSize];
    const numSize = parseFloat(targetSize);
    const codeSize = `${(numSize * 0.85).toFixed(1)}px`;
    // Mermaid SVG 内部字号固定，用 zoom 整体缩放（CherryMarkdown 默认 16px）
    const mermaidZoom = (numSize / 16).toFixed(4);

    // 更新动态 <style>（正确选择器 + 实际像素值 + !important）
    let styleEl = document.getElementById('wiki-dynamic-font') as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'wiki-dynamic-font';
      document.head.appendChild(styleEl);
    }
    const sel = '.markdown-viewer-container';
    styleEl.textContent = `
${sel} .cherry-markdown { font-size: ${targetSize} !important; }
${sel} .cherry-markdown pre,
${sel} .cherry-markdown code,
${sel} .cherry-markdown div[data-type=codeBlock] code,
${sel} .cherry-markdown div[data-type=codeBlock] pre,
${sel} .cherry-markdown div[data-type=codeBlock] pre code,
${sel} .cherry-markdown pre code {
  font-size: ${codeSize} !important;
}
${sel} .cherry-markdown figure[data-type=mermaid] svg {
  zoom: ${mermaidZoom} !important;
}
`;

    // 同时直接设置 inline style（防止 PrismJS 异步高亮后注入样式）
    const applyFontSize = () => {
      const markdownEl = container.querySelector('.cherry-markdown');
      if (markdownEl) {
        (markdownEl as HTMLElement).style.fontSize = targetSize;
      }
      container.querySelectorAll('pre, code').forEach(el => {
        (el as HTMLElement).style.fontSize = codeSize;
      });
      // Mermaid SVG 缩放
      container.querySelectorAll('figure[data-type=mermaid] svg').forEach(el => {
        (el as HTMLElement).style.zoom = mermaidZoom;
      });
    };

    applyFontSize();
    // 延迟再次应用，覆盖 PrismJS 异步高亮后的重渲染
    const raf1 = requestAnimationFrame(applyFontSize);
    const raf2 = requestAnimationFrame(() => requestAnimationFrame(applyFontSize));
    const timer = setTimeout(applyFontSize, 200);

    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      clearTimeout(timer);
    };
  }, [fontSize, content]);

  // 内容变化时更新
  useEffect(() => {
    if (cherryRef.current && content !== undefined) {
      cherryRef.current.setMarkdown(content);
    }
  }, [content]);

  // 主题变化时更新
  useEffect(() => {
    if (cherryRef.current) {
      try {
        const container = containerRef.current;
        if (container) {
          container.querySelectorAll('.cherry').forEach(el => {
            (el as HTMLElement).dataset.themeMode = resolvedTheme === 'dark' ? 'dark' : 'light';
          });
        }
      } catch {
        // 主题切换失败不影响渲染
      }
    }
  }, [resolvedTheme]);

  return (
    <div
      ref={containerRef}
      className="markdown-viewer-container h-full overflow-hidden"
    />
  );
}
