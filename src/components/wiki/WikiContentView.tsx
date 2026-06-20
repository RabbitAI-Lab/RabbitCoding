import { lazy, Suspense, useState } from 'react';
import { AlertCircle, FileText, GitBranch, Loader2, RefreshCw, X } from 'lucide-react';
import type { FailedDoc } from '../../types';
import type { WikiTab } from './wikiTypes';
import { useI18n } from '../../i18n/useI18n';
import type { FontSize } from './MarkdownViewer';

const MarkdownViewer = lazy(() => import('./MarkdownViewer'));

interface GitInfo {
  branch: string | null;
  commitId: string | null;
}

interface WikiContentViewProps {
  openTabs: WikiTab[];
  activePath: string | null;
  activeContent: string | null;
  fileLoading: boolean;
  fileError: string | null;
  /** activePath 对应的失败文档信息（如有） */
  failedDoc: { doc: FailedDoc; repoName?: string } | null;
  onCloseTab: (path: string) => void;
  onSetActivePath: (path: string) => void;
  onRegenerate?: (docPath: string, repoName?: string) => void;
  regenerating?: boolean;
  /** 头部信息栏数据 */
  workspaceName?: string;
  gitInfo?: GitInfo;
  docModifiedAt?: number | null;
  /** 重新生成任意文档（从文件路径推断 docPath/repoName） */
  onRegenerateDoc?: (filePath: string) => void;
}

function formatDateTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function WikiContentView({
  openTabs,
  activePath,
  activeContent,
  fileLoading,
  fileError,
  failedDoc,
  onCloseTab,
  onSetActivePath,
  onRegenerate,
  regenerating,
  workspaceName,
  gitInfo,
  docModifiedAt,
  onRegenerateDoc,
}: WikiContentViewProps) {
  const { t } = useI18n();
  const [fontSize, setFontSize] = useState<FontSize>('medium');

  const fontSizeOptions: { key: FontSize }[] = [
    { key: 'small' },
    { key: 'medium' },
    { key: 'large' },
  ];

  return (
    <div className="flex h-full flex-col">
      {/* 标签栏 */}
      <div className="flex h-8 shrink-0 items-center border-b border-gray-200 bg-gray-50/70 dark:border-gray-700 dark:bg-[#1e1e1e]">
        {openTabs.length > 0 ? (
          <div className="flex min-w-0 flex-1 overflow-x-auto">
            {openTabs.map(tab => (
              <button
                key={tab.path}
                onClick={() => onSetActivePath(tab.path)}
                className={`group flex h-8 w-[160px] shrink-0 items-center gap-1.5 border-r border-gray-200 px-2.5 text-xs transition-colors dark:border-gray-700 ${
                  activePath === tab.path
                    ? 'bg-white text-[#141414] dark:bg-[#252525] dark:text-gray-100'
                    : 'text-gray-500 hover:bg-white/70 hover:text-[#141414] dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100'
                }`}
                title={tab.path}
              >
                <FileText size={13} className="shrink-0" />
                <span className="flex-1 truncate text-left">{tab.name}</span>
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(event) => {
                    event.stopPropagation();
                    onCloseTab(tab.path);
                  }}
                  className="shrink-0 rounded p-0.5 text-gray-400 opacity-0 transition-opacity hover:bg-gray-200 hover:text-gray-600 group-hover:opacity-100 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                  title={t('knowledgeBase.closeTab')}
                >
                  <X size={12} />
                </span>
              </button>
            ))}
          </div>
        ) : (
          <span className="px-3 text-xs text-gray-400 dark:text-gray-500">{t('knowledgeBase.selectFile')}</span>
        )}
      </div>

      {/* 头部信息栏 */}
      {activePath && (
        <div className="flex h-[52px] shrink-0 flex-col justify-center border-b border-gray-100 px-4 dark:border-gray-700/60">
          {/* 第一行：项目名 + 分支 + 重新生成按钮 */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-[#333333] dark:text-gray-200">
              {workspaceName ?? ''}
            </span>
            {gitInfo?.branch && (
              <>
                <span className="text-gray-200 dark:text-gray-700">·</span>
                <span className="flex items-center gap-0.5 text-[11px] text-gray-400 dark:text-gray-500">
                  <GitBranch size={11} className="shrink-0" />
                  {gitInfo.branch}
                </span>
              </>
            )}
            {onRegenerateDoc && (
              <button
                onClick={() => onRegenerateDoc(activePath)}
                disabled={regenerating}
                className="ml-auto flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium text-blue-600 transition-colors hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40 dark:text-blue-400 dark:hover:bg-blue-900/20"
              >
                {regenerating ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                {t('knowledgeBase.regenerateDoc')}
              </button>
            )}
          </div>
          {/* 第二行：更新时间 + commit ID + 字号切换器 */}
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-gray-400 dark:text-gray-500">
            {docModifiedAt ? (
              <span>{formatDateTime(docModifiedAt)}</span>
            ) : (
              <span>—</span>
            )}
            {gitInfo?.commitId && (
              <>
                <span>·</span>
                <span className="font-mono">{gitInfo.commitId}</span>
              </>
            )}
            {/* 字号切换器 */}
            <div className="ml-auto flex items-center gap-0.5 rounded border border-gray-200 px-0.5 py-0.5 dark:border-gray-600">
              {fontSizeOptions.map(opt => (
                <button
                  key={opt.key}
                  onClick={() => setFontSize(opt.key)}
                  className={`flex items-center justify-center rounded px-1 transition-colors ${
                    fontSize === opt.key
                      ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'
                      : 'text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300'
                  }`}
                  style={{
                    minWidth: 18,
                    height: 18,
                    fontSize: opt.key === 'small' ? 9 : opt.key === 'medium' ? 11 : 13,
                    fontWeight: 700,
                  }}
                  title={opt.key === 'small' ? '小' : opt.key === 'medium' ? '中' : '大'}
                >
                  A
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 文件内容 */}
      <div className="min-h-0 flex-1">
        {/* 失败文档状态 */}
        {failedDoc ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-8">
            <AlertCircle size={40} className="text-orange-400 dark:text-orange-500" />
            <div className="text-center">
              <p className="text-sm font-medium text-[#333333] dark:text-gray-200">
                {t('knowledgeBase.docFailed')}
              </p>
              <p className="mt-1 max-w-md text-xs text-gray-400 dark:text-gray-500">
                {failedDoc.doc.error}
              </p>
              {failedDoc.repoName && (
                <p className="mt-0.5 text-[11px] text-gray-300 dark:text-gray-600">
                  {failedDoc.repoName} / {failedDoc.doc.path}
                </p>
              )}
            </div>
            {onRegenerate && (
              <button
                onClick={() => onRegenerate(failedDoc.doc.path, failedDoc.repoName)}
                disabled={regenerating}
                className="mt-2 flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {regenerating ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                {t('knowledgeBase.regenerate')}
              </button>
            )}
          </div>
        ) : (
          <Suspense fallback={(
            <div className="flex h-full items-center justify-center gap-2 text-gray-300 dark:text-gray-600">
              <Loader2 size={16} className="animate-spin" />
              <span className="text-xs">{t('knowledgeBase.loadingFile')}</span>
            </div>
          )}>
            {fileLoading ? (
              <div className="flex h-full items-center justify-center gap-2 text-gray-300 dark:text-gray-600">
                <Loader2 size={16} className="animate-spin" />
                <span className="text-xs">{t('knowledgeBase.loadingFile')}</span>
              </div>
            ) : fileError ? (
              <div className="flex h-full items-center justify-center px-4 text-center text-xs text-red-400 dark:text-red-500">
                {fileError}
              </div>
            ) : activeContent ? (
              <MarkdownViewer content={activeContent} fontSize={fontSize} />
            ) : null}
          </Suspense>
        )}
      </div>
    </div>
  );
}
