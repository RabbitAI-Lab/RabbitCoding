/**
 * MarkdownViewer — 基于 CherryMarkdown 的只读 Markdown 渲染组件
 *
 * 用于 Wiki 文档内容的渲染，支持代码高亮、表格、Mermaid 等丰富语法。
 * 仅预览模式，不可编辑。
 *
 * 性能优化要点：
 * 1. Cherry 实例延迟到「空闲帧」创建（scheduleIdle），避免挂载帧阻塞主线程。
 * 2. Cherry 实例在空闲帧创建时即带入最新内容与主题，与原同步初始化行为一致；用 lastRenderedRef 跳过 Effect B 的重复渲染。
 * 3. 内容渲染（setMarkdown）同样推迟到空闲帧执行，并先用 isRendering 显示 loading。
 * 4. renderToken 令牌保证快速切换文档时的竞态安全，旧渲染不会覆盖新内容。
 * 5. 字号 effect 仅依赖 fontSize，不再依赖 content；每次 setMarkdown 完成后统一触发一次字号重应用。
 * 6. 字号多重保险（立即 + RAF + RAF² + setTimeout）保留，对抗 PrismJS 异步注入的内联 font-size。
 */

import { memo, useCallback, useEffect, useDeferredValue, useRef, useState } from 'react';
import Cherry from 'cherry-markdown';
import 'cherry-markdown/dist/cherry-markdown.min.css';
import * as echarts from 'echarts';
import { Loader2 } from 'lucide-react';
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
  padding-top: 0;
  scrollbar-width: thin;
  scrollbar-color: rgba(156, 163, 175, 0.45) transparent;
}
/* 移除 Cherry 库为分屏模式预留的拖拽分隔线（previewOnly 模式下编辑器已隐藏，该边框多余） */
/* 限定在 markdown-viewer-container 作用域，避免影响未来编辑+预览分屏模块 */
.markdown-viewer-container .cherry-previewer {
  border-left: none !important;
}
.cherry-previewer::-webkit-scrollbar {
  width: 3px;
}
.cherry-previewer::-webkit-scrollbar-track {
  background: transparent;
}
.cherry-previewer::-webkit-scrollbar-thumb {
  background-color: rgba(156, 163, 175, 0.4);
  border-radius: 3px;
}
.cherry-previewer::-webkit-scrollbar-thumb:hover {
  background-color: rgba(156, 163, 175, 0.6);
}
.cherry.theme__dark .cherry-previewer {
  scrollbar-color: rgba(148, 163, 184, 0.4) transparent;
}
.cherry.theme__dark .cherry-previewer::-webkit-scrollbar-thumb {
  background-color: rgba(148, 163, 184, 0.35);
}
.cherry.theme__dark .cherry-previewer::-webkit-scrollbar-thumb:hover {
  background-color: rgba(148, 163, 184, 0.55);
}
.cherry-previewer .cherry-markdown {
  padding: 20px 28px;
  line-height: 1.7;
}
.cherry-previewer figure[data-type=mermaid] {
  cursor: zoom-in;
  width: 100%;
  text-align: center;
  margin: 0;
}
.cherry-previewer figure[data-type=mermaid] svg {
  display: inline-block;
  max-width: 100% !important;
  height: auto !important;
}
/* Mermaid 图表 hover 操作提示气泡 */
.cherry-previewer figure[data-type=mermaid][data-mermaid-hint]::after {
  content: attr(data-mermaid-hint);
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 5;
  padding: 3px 8px;
  font-size: 11px;
  line-height: 1.4;
  white-space: nowrap;
  color: #fff;
  background: rgba(0, 0, 0, 0.6);
  border-radius: 4px;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.15s ease;
}
.cherry-previewer figure[data-type=mermaid] {
  position: relative;
}
.cherry-previewer figure[data-type=mermaid]:not([data-mermaid-dragging]):hover[data-mermaid-hint]::after {
  opacity: 1;
}

/* Cherry 浮动大纲（TOC）适配：修正定位与明暗主题背景 */
.cherry-flex-toc {
  top: 10px !important;
  height: calc(100% - 20px) !important;
  max-height: none !important;
}
/* 隐藏 TOC 滚动条 */
.cherry-flex-toc,
.cherry-flex-toc * {
  scrollbar-width: none !important;
}
.cherry-flex-toc::-webkit-scrollbar,
.cherry-flex-toc *::-webkit-scrollbar {
  display: none !important;
}
.cherry.theme__default .cherry-flex-toc {
  background: hsla(0, 0%, 100%, 0.9) !important;
}
.cherry.theme__dark .cherry-flex-toc {
  background: rgba(37, 37, 37, 0.9) !important;
  color: var(--md-paragraph-color, #D4D4D4) !important;
}
.cherry.theme__dark .cherry-flex-toc .cherry-toc-one-a {
  color: var(--md-paragraph-color, #D4D4D4) !important;
}
.cherry.theme__dark .cherry-flex-toc .cherry-toc-title {
  color: #fff !important;
}
.cherry-flex-toc .cherry-toc-one-a__1 { padding-left: 8px !important; }
.cherry-flex-toc .cherry-toc-one-a__2 { padding-left: 20px !important; }
.cherry-flex-toc .cherry-toc-one-a__3 { padding-left: 40px !important; }
.cherry-flex-toc .cherry-toc-one-a__4 { padding-left: 60px !important; }
.cherry-flex-toc .cherry-toc-one-a__5 { padding-left: 80px !important; }
.cherry.theme__dark .cherry-flex-toc .cherry-toc-one-a {
  border-left-color: #364153 !important;
}
.cherry.theme__dark .cherry-flex-toc .cherry-toc-one-a.current,
.cherry.theme__dark .cherry-flex-toc .cherry-toc-one-a:hover {
  color: #95958f !important;
  border-left-color: #95958f !important;
}
.cherry-flex-toc .cherry-toc-head i {
  color: #E07B00 !important;
}
.cherry-flex-toc .cherry-toc-head i:hover {
  color: #C46A00 !important;
}

/* Cherry Markdown dark 主题变量覆盖（VSCode Dark+ 风格） */
.cherry.theme__dark {
  /* 主色调：VSCode 经典品牌蓝 */
  --primary-color: #007ACC;
  /* 次级色：完全透明，移除原棕红色块 */
  --secondary-color: transparent;
  /* 基础正文：VSCode 标准文本色 */
  --base-font-color: #D4D4D4;
  /* 编辑区背景：完全透明 */
  --base-editor-bg: transparent;
  /* 预览区背景：完全透明 */
  --base-previewer-bg: transparent;
  /* 边框：中性灰细线 */
  --base-border-color: #3C3C3C;

  /* 工具栏：背景透明，仅保留按钮交互态 */
  --toolbar-bg: transparent;
  --toolbar-btn-color: #CCCCCC;
  --toolbar-btn-hover-bg: rgba(255, 255, 255, 0.08);
  --toolbar-btn-hover-color: #FFFFFF;
  --toolbar-btn-active-bg: rgba(0, 122, 204, 0.3);
  --toolbar-split-color: #3C3C3C;

  /* 编辑区语法高亮 - 对齐 VSCode Dark+ */
  --editor-header-color: var(--primary-color);
  --editor-string-color: #CE9178;
  --editor-comment-color: #6A9955;
  --editor-quote-color: #858585;
  --editor-link-color: #3794FF;
  --editor-url-color: #CE9178;
  --editor-v2-color: #D4D4D4;
  --editor-v3-color: var(--primary-color);
  --editor-keyword-color: #569CD6;
  --editor-selection-bg: rgba(38, 79, 120, 0.6);
  --editor-active-line-bg: rgba(255, 255, 255, 0.04);

  /* 下拉菜单 */
  --dropdown-item-hover-bg: rgba(255, 255, 255, 0.06);
  --dropdown-item-hover-color: #FFFFFF;
  --dropdown-item-active-bg: rgba(0, 122, 204, 0.4);
  --dropdown-item-active-color: #FFFFFF;

  /* Markdown 预览区 */
  --md-heading-color: #FFFFFF;
  --md-paragraph-color: #D4D4D4;
  --md-link-color: #3794FF;
  --md-link-hover-color: #007ACC;
  --md-inline-code-color: #CE9178;
  --md-inline-code-bg: rgba(255, 255, 255, 0.08);
  --md-blockquote-bg: transparent;
  --md-hr-border: #3C3C3C;
  --md-table-border: #3C3C3C;
  --md-table-drag-border-bg: var(--primary-color);
  --md-table-sort-active-bg: rgba(0, 122, 204, 0.2);
  --md-toc-bg: transparent;
  --md-toc-border-color: #3C3C3C;
  --md-toc-indicator-color: #3C3C3C;
  --md-toc-link-hover-bg: rgba(255, 255, 255, 0.06);
  --md-toc-link-active-bg: rgba(0, 122, 204, 0.25);
  --md-paragraph-highlight-line-bg: rgba(255, 255, 255, 0.05);

  /* 折叠面板：全透明背景 */
  --accordion-bg: transparent;
  --accordion-border: #3C3C3C;
  --accordion-summary-bg: transparent;
  --accordion-summary-hover-bg: rgba(0, 122, 204, 0.2);
  --accordion-body-bg: transparent;
  --accordion-body-border: #3C3C3C;
  --accordion-body-color: #D4D4D4;

  /* Mermaid 工具栏 */
  --mermaid-toolbar-slider-bg: rgba(255, 255, 255, 0.15);
  --mermaid-toolbar-tab-active-color: #fff;
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

/** 空闲帧调度：优先 requestIdleCallback（带 200ms 上限），降级双 RAF */
function scheduleIdle(task: () => void): number {
  const ric = (window as any).requestIdleCallback as
    | ((cb: () => void, opts?: { timeout?: number }) => number)
    | undefined;
  if (typeof ric === 'function') {
    return ric(task, { timeout: 200 });
  }
  // 降级：双 RAF 保证任务在下一次绘制之后执行，先把 loading 画出来
  return requestAnimationFrame(() => requestAnimationFrame(task));
}

/** 取消空闲调度 */
function cancelScheduled(handle: number): void {
  const cic = (window as any).cancelIdleCallback as ((h: number) => void) | undefined;
  if (typeof cic === 'function') {
    cic(handle);
  } else {
    cancelAnimationFrame(handle);
  }
}

function MarkdownViewerImpl({ content, fontSize = 'medium' }: MarkdownViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cherryRef = useRef<Cherry | null>(null);
  const renderTokenRef = useRef(0);
  const fontTimersRef = useRef<number[]>([]);
  const { resolvedTheme } = useTheme();
  const { language } = useI18n();

  // 每次 render 同步最新主题/语言到 ref，使初始化 effect 依赖 [] 不随其重建
  const themeRef = useRef(resolvedTheme);
  themeRef.current = resolvedTheme;
  const langRef = useRef(language);
  langRef.current = language;
  // 构造 Cherry 时读取最新内容（初始化在空闲帧执行，需拿到挂载后的最新 content）
  const contentRef = useRef(content);
  contentRef.current = content;
  // 记录最近一次实际渲染进 Cherry 的内容，用于跳过重复渲染
  const lastRenderedRef = useRef<string | null>(null);

  const [phase, setPhase] = useState<'creating' | 'ready'>('creating');
  const [isRendering, setIsRendering] = useState(false);
  const [initError, setInitError] = useState(false);

  // 防抖中间值：快速切换文档时跳过中间 content，减少无效调度
  const deferredContent = useDeferredValue(content);

  /** 写/更新全局动态 <style>（#wiki-dynamic-font），幂等无副作用 */
  const writeDynamicStyle = useCallback((fs: FontSize) => {
    const targetSize = FONT_SIZE_MAP[fs];
    const numSize = parseFloat(targetSize);
    const codeSize = `${(numSize * 0.85).toFixed(1)}px`;
    const mermaidZoom = (numSize / 16).toFixed(4);

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
${sel} .cherry-flex-toc,
${sel} .cherry-flex-toc .cherry-toc-one-a {
  font-size: ${codeSize} !important;
}
`;
  }, []);

  /** 清空上一轮字号 timer */
  const clearFontTimers = useCallback(() => {
    fontTimersRef.current.forEach(t => {
      cancelAnimationFrame(t);
      clearTimeout(t);
    });
    fontTimersRef.current = [];
  }, []);

  /**
   * 字号 inline 重应用 + 多重保险（RAF + RAF² + setTimeout），对抗 PrismJS 异步注入的内联 font-size。
   * 应在每次 setMarkdown 完成后调用一次；字号变化时也调用一次。
   */
  const applyFontSizeAfterRender = useCallback((fs: FontSize) => {
    clearFontTimers();

    const apply = () => {
      const container = containerRef.current;
      if (!container) return;
      const targetSize = FONT_SIZE_MAP[fs];
      const numSize = parseFloat(targetSize);
      const codeSize = `${(numSize * 0.85).toFixed(1)}px`;
      const mermaidZoom = (numSize / 16).toFixed(4);

      const markdownEl = container.querySelector('.cherry-markdown');
      if (markdownEl) {
        (markdownEl as HTMLElement).style.fontSize = targetSize;
      }
      container.querySelectorAll('pre, code').forEach(el => {
        (el as HTMLElement).style.fontSize = codeSize;
      });
      container.querySelectorAll('figure[data-type=mermaid] svg').forEach(el => {
        (el as HTMLElement).style.zoom = mermaidZoom;
      });
      container.querySelectorAll('.cherry-flex-toc, .cherry-flex-toc .cherry-toc-one-a').forEach(el => {
        (el as HTMLElement).style.fontSize = codeSize;
      });
    };

    apply();
    fontTimersRef.current.push(requestAnimationFrame(apply));
    fontTimersRef.current.push(requestAnimationFrame(() => requestAnimationFrame(apply)));
    fontTimersRef.current.push(window.setTimeout(apply, 200));
  }, [clearFontTimers]);

  // ---- Effect A: 延迟创建 Cherry（空内容），仅在空闲帧执行 ----
  useEffect(() => {
    if (!containerRef.current) return;
    ensureStyle();
    setPhase('creating');
    setInitError(false);

    let cancelled = false;
    const handle = scheduleIdle(() => {
      if (cancelled || !containerRef.current) return;
      try {
        // 构造时即带入最新内容与主题，与原同步初始化行为一致，确保主题/配色正确应用
        const initialContent = contentRef.current ?? '';
        const cherry = new Cherry({
          el: containerRef.current,
          value: initialContent,
          locale: langRef.current === 'zh' ? 'zh_CN' : 'en_US',
          toolbars: {
            showToolbar: false,
            toolbar: [],
            bubble: false,
            float: false,
            toc: {},
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
            mainTheme: themeRef.current === 'dark' ? 'dark' : 'default',
            codeBlockTheme: themeRef.current === 'dark' ? 'dark' : 'default',
            inlineCodeTheme: 'black',
          },
        });

        // 创建期间组件已卸载 → 立即销毁
        if (cancelled) {
          try {
            (cherry as any).destroy?.();
          } catch {
            // ignore
          }
          if (containerRef.current) containerRef.current.innerHTML = '';
          return;
        }

        cherryRef.current = cherry;
        lastRenderedRef.current = initialContent;
        // 与原同步初始化对齐：挂载即应用主题标记
        try {
          const mode = themeRef.current === 'dark' ? 'dark' : 'light';
          containerRef.current?.querySelectorAll('.cherry').forEach(el => {
            (el as HTMLElement).dataset.themeMode = mode;
          });
        } catch {
          // ignore
        }
        setPhase('ready');
      } catch {
        if (!cancelled) setInitError(true);
      }
    });

    return () => {
      cancelled = true;
      cancelScheduled(handle);
      if (cherryRef.current) {
        try {
          (cherryRef.current as any).destroy?.();
        } catch {
          // ignore
        }
        cherryRef.current = null;
      }
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
    };
  }, []);

  // ---- Effect B: 内容渲染（分帧 + 令牌竞态保护） ----
  useEffect(() => {
    if (phase !== 'ready' || !cherryRef.current) return;

    const cherry = cherryRef.current;
    const c = deferredContent ?? '';

    // 跳过构造时已经渲染过的内容，避免双重渲染
    if (c === lastRenderedRef.current) {
      return;
    }

    const token = ++renderTokenRef.current;
    setIsRendering(true);
    const handle = scheduleIdle(() => {
      // 令牌校验：已被更新的内容取代 → 丢弃本次渲染
      if (token !== renderTokenRef.current || !cherryRef.current) return;
      try {
        cherry.setMarkdown(c);
        lastRenderedRef.current = c;
      } catch {
        // ignore
      }
      // setMarkdown 完成后统一触发字号重应用（DOM 刚重建）
      applyFontSizeAfterRender(fontSize);
      // 重置滚动位置
      const previewer = containerRef.current?.querySelector('.cherry-previewer');
      if (previewer) (previewer as HTMLElement).scrollTop = 0;
      setIsRendering(false);
    });

    return () => cancelScheduled(handle);
  }, [deferredContent, phase, applyFontSizeAfterRender, fontSize]);

  // ---- Effect C: 字号（仅 fontSize，不再依赖 content） ----
  useEffect(() => {
    writeDynamicStyle(fontSize);
    applyFontSizeAfterRender(fontSize);
    return () => clearFontTimers();
  }, [fontSize, writeDynamicStyle, applyFontSizeAfterRender, clearFontTimers]);

  // ---- Effect D: 主题切换 ----
  // 必须调用 Cherry 的 setTheme / setCodeBlockTheme 真正切换主题类名（theme__dark ↔ theme__default），
  // 否则容器 class 不会更新，dark 主题变量会残留到 light 模式
  useEffect(() => {
    if (cherryRef.current && containerRef.current) {
      const themeName = resolvedTheme === 'dark' ? 'dark' : 'default';
      try {
        (cherryRef.current as any).setTheme?.(themeName);
        (cherryRef.current as any).setCodeBlockTheme?.(themeName);
      } catch {
        // 主题切换失败不影响渲染
      }
      try {
        containerRef.current.querySelectorAll('.cherry').forEach(el => {
          (el as HTMLElement).dataset.themeMode = resolvedTheme === 'dark' ? 'dark' : 'light';
        });
      } catch {
        // ignore
      }
    }
  }, [resolvedTheme]);

  // ---- Effect E: Mermaid 图表缩放与拖拽（事件委托）----
  // Cherry 预览区的 Mermaid 图表原生不支持交互，通过在容器上委托事件实现：
  //  · 滚轮：缩放（0.5×~3×），倍数存于 dataset.scale
  //  · 拖拽：mousedown/mousemove/mouseup 平移，偏移存于 dataset.tx/ty
  //  · 双击：全屏切换（全屏态再双击或按 Esc 退出）
  // 内容重建（setMarkdown）时 dataset 自然丢失，等价于自动重置。
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const getFigure = (el: EventTarget | null): HTMLElement | null =>
      (el as HTMLElement | null)?.closest?.('figure[data-type=mermaid]') as HTMLElement | null;

    // 把 scale + translate 合并为单个 transform，transformOrigin 固定 top center
    const applyTransform = (figure: HTMLElement) => {
      const svg = figure.querySelector('svg');
      if (!svg) return;
      const s = parseFloat(figure.dataset.scale || '1');
      const tx = parseFloat(figure.dataset.tx || '0');
      const ty = parseFloat(figure.dataset.ty || '0');
      svg.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
      svg.style.transformOrigin = 'top center';
    };

    // 仅在按住 Ctrl/Cmd 时滚轮才触发缩放，否则放行页面正常滚动（业界标准交互）
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const figure = getFigure(e.target);
      if (!figure || !figure.querySelector('svg')) return;
      e.preventDefault();
      let scale = parseFloat(figure.dataset.scale || '1');
      scale += e.deltaY > 0 ? -0.1 : 0.1;
      scale = Math.max(0.5, Math.min(3, scale));
      figure.dataset.scale = String(scale);
      applyTransform(figure);
    };

    let drag: {
      figure: HTMLElement;
      startX: number;
      startY: number;
      baseTx: number;
      baseTy: number;
    } | null = null;

    const onMouseDown = (e: MouseEvent) => {
      const figure = getFigure(e.target);
      if (!figure || !figure.querySelector('svg')) return;
      e.preventDefault();
      drag = {
        figure,
        startX: e.clientX,
        startY: e.clientY,
        baseTx: parseFloat(figure.dataset.tx || '0'),
        baseTy: parseFloat(figure.dataset.ty || '0'),
      };
      figure.style.cursor = 'grabbing';
      figure.dataset.mermaidDragging = '1';
      document.body.style.cursor = 'grabbing';
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!drag) return;
      drag.figure.dataset.tx = String(drag.baseTx + (e.clientX - drag.startX));
      drag.figure.dataset.ty = String(drag.baseTy + (e.clientY - drag.startY));
      applyTransform(drag.figure);
    };

    const endDrag = () => {
      if (!drag) return;
      drag.figure.style.cursor = '';
      delete drag.figure.dataset.mermaidDragging;
      document.body.style.cursor = '';
      drag = null;
    };

    // ---- 全屏查看 ----
    let overlay: HTMLDivElement | null = null;
    let overlayClone: SVGElement | null = null;
    let overlayMove: ((e: MouseEvent) => void) | null = null;
    let overlayUp: (() => void) | null = null;
    let overlayKey: ((e: KeyboardEvent) => void) | null = null;

    const exitFullscreen = () => {
      if (overlayMove) document.removeEventListener('mousemove', overlayMove);
      if (overlayUp) document.removeEventListener('mouseup', overlayUp);
      if (overlayKey) document.removeEventListener('keydown', overlayKey);
      overlayMove = overlayUp = overlayKey = null;
      if (overlay) { overlay.remove(); overlay = null; }
      overlayClone = null;
    };

    const enterFullscreen = (figure: HTMLElement) => {
      if (overlay) { exitFullscreen(); return; }
      const svg = figure.querySelector('svg');
      if (!svg) return;
      const root = container.parentElement;
      if (!root) return;

      overlay = document.createElement('div');
      overlay.dataset.scale = '1';
      overlay.dataset.tx = '0';
      overlay.dataset.ty = '0';
      overlay.style.cssText =
        'position:fixed;inset:0;z-index:9999;' +
        'background:rgba(0,0,0,0.88);backdrop-filter:blur(2px);' +
        'display:flex;align-items:center;justify-content:center;' +
        'cursor:zoom-out;overflow:hidden;';

      overlayClone = svg.cloneNode(true) as SVGElement;
      overlayClone.style.cssText =
        'max-width:90vw;max-height:90vh;width:auto;height:auto;' +
        'flex-shrink:0;cursor:grab;';
      overlay.appendChild(overlayClone);

      const applyOT = () => {
        if (!overlay || !overlayClone) return;
        const s = parseFloat(overlay.dataset.scale || '1');
        const tx = parseFloat(overlay.dataset.tx || '0');
        const ty = parseFloat(overlay.dataset.ty || '0');
        overlayClone.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
        overlayClone.style.transformOrigin = 'center center';
      };

      // Ctrl/Cmd + 滚轮缩放（全屏态范围更宽）
      overlay.addEventListener('wheel', (e: WheelEvent) => {
        if (!(e.ctrlKey || e.metaKey) || !overlay) return;
        e.preventDefault();
        let scale = parseFloat(overlay.dataset.scale || '1');
        scale += e.deltaY > 0 ? -0.1 : 0.1;
        scale = Math.max(0.3, Math.min(8, scale));
        overlay.dataset.scale = String(scale);
        applyOT();
      }, { passive: false });

      // 拖拽平移
      let oDrag: { sx: number; sy: number; bx: number; by: number } | null = null;
      overlay.addEventListener('mousedown', (e: MouseEvent) => {
        if (!overlay) return;
        e.preventDefault();
        oDrag = {
          sx: e.clientX, sy: e.clientY,
          bx: parseFloat(overlay.dataset.tx || '0'),
          by: parseFloat(overlay.dataset.ty || '0'),
        };
        overlay.style.cursor = 'grabbing';
        if (overlayClone) overlayClone.style.cursor = 'grabbing';
      });
      overlayMove = (e: MouseEvent) => {
        if (!oDrag || !overlay) return;
        overlay.dataset.tx = String(oDrag.bx + (e.clientX - oDrag.sx));
        overlay.dataset.ty = String(oDrag.by + (e.clientY - oDrag.sy));
        applyOT();
      };
      overlayUp = () => {
        if (!oDrag) return;
        oDrag = null;
        if (overlay) overlay.style.cursor = 'zoom-out';
        if (overlayClone) overlayClone.style.cursor = 'grab';
      };
      document.addEventListener('mousemove', overlayMove);
      document.addEventListener('mouseup', overlayUp);

      // 双击退出
      overlay.addEventListener('dblclick', (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        exitFullscreen();
      });

      // Esc 退出
      overlayKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') exitFullscreen();
      };
      document.addEventListener('keydown', overlayKey);

      root.appendChild(overlay);
    };

    const onDblClick = (e: MouseEvent) => {
      const figure = getFigure(e.target);
      if (!figure) return;
      enterFullscreen(figure);
    };

    // hover 提示文案：根据平台与语言生成（mac 显示 ⌘，其他显示 Ctrl）
    const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
    const modKey = isMac ? '⌘' : 'Ctrl';
    const hintText = langRef.current === 'zh'
      ? `双击全屏 · ${modKey}+滚轮缩放 · 拖拽`
      : `Dbl-click fullscreen · ${modKey}+scroll · drag`;

    const setHint = (figure: HTMLElement) => {
      if (!figure.dataset.mermaidHint) figure.dataset.mermaidHint = hintText;
    };
    const clearHint = (figure: HTMLElement) => {
      delete figure.dataset.mermaidHint;
    };

    const onMouseOver = (e: MouseEvent) => {
      const figure = getFigure(e.target);
      if (figure && figure.querySelector('svg')) setHint(figure);
    };
    const onMouseOut = (e: MouseEvent) => {
      const figure = getFigure(e.target);
      const related = getFigure(e.relatedTarget);
      // 离开 figure 或进入子元素仍属同一 figure 时不清除
      if (figure && figure !== related) clearHint(figure);
    };

    container.addEventListener('wheel', onWheel, { passive: false });
    container.addEventListener('mousedown', onMouseDown);
    container.addEventListener('dblclick', onDblClick);
    container.addEventListener('mouseover', onMouseOver);
    container.addEventListener('mouseout', onMouseOut);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', endDrag);

    return () => {
      exitFullscreen();
      container.removeEventListener('wheel', onWheel);
      container.removeEventListener('mousedown', onMouseDown);
      container.removeEventListener('dblclick', onDblClick);
      container.removeEventListener('mouseover', onMouseOver);
      container.removeEventListener('mouseout', onMouseOut);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', endDrag);
    };
  }, []);

  const showLoading = phase === 'creating' || isRendering;

  return (
    <div className="relative h-full overflow-hidden">
      <div ref={containerRef} className="markdown-viewer-container h-full overflow-hidden" />
      {showLoading && !initError && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/40 backdrop-blur-[1px] dark:bg-[#1e1e1e]/40">
          <Loader2 size={18} className="animate-spin text-gray-400 dark:text-gray-500" />
        </div>
      )}
      {initError && (
        <div className="absolute inset-0 z-10 flex items-center justify-center text-xs text-red-400 dark:text-red-500">
          渲染初始化失败
        </div>
      )}
    </div>
  );
}

const MarkdownViewer = memo(MarkdownViewerImpl);
export default MarkdownViewer;
