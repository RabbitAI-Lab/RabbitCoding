import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Search, CaseSensitive, WholeWord, Regex, ChevronDown,
  ChevronRight, Replace, FileCode2, AlertCircle,
} from 'lucide-react';
import {
  searchWorkspace,
  type SearchOptions,
  type SearchResult,
  type FileSearchResult,
  type SearchMatch,
} from './searchEngine';
import { useI18n } from '../../i18n/useI18n';

/* 忽略的目录/文件名（与 FileExplorerTab 保持一致） */
const IGNORED_NAMES = new Set([
  'node_modules', '.git', 'target', 'dist', '.next', '.nuxt',
  '__pycache__', '.DS_Store', '.turbo', '.cache', '.vscode',
  '.idea', 'build', '.gradle', '.mvn', 'vendor', 'Pods',
]);

const DEBOUNCE_MS = 400;

interface SearchPanelProps {
  workspacePath: string;
  onSelectFile: (path: string) => void;
}

/* ------------------------------------------------------------------ */
/*  条件切换按钮                                                         */
/* ------------------------------------------------------------------ */
function ToggleButton({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`rounded p-0.5 transition-colors shrink-0 ${
        active
          ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30'
          : 'text-gray-400 dark:text-gray-500 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-gray-50 dark:hover:bg-gray-800'
      }`}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  匹配行高亮渲染                                                       */
/* ------------------------------------------------------------------ */
function renderHighlight(match: SearchMatch) {
  const before = match.preview.slice(0, match.matchStart);
  const matched = match.preview.slice(match.matchStart, match.matchStart + match.matchLength);
  const after = match.preview.slice(match.matchStart + match.matchLength);

  return (
    <>
      <span className="text-gray-400 dark:text-gray-500 mr-2 shrink-0 tabular-nums">{match.line}</span>
      <span className="truncate">
        {before}
        <mark className="bg-yellow-200 dark:bg-yellow-700/50 text-inherit rounded-sm px-0.5 whitespace-pre">{matched}</mark>
        {after}
      </span>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  文件结果分组                                                         */
/* ------------------------------------------------------------------ */
function FileResultGroup({
  fileResult,
  onSelectFile,
}: {
  fileResult: FileSearchResult;
  onSelectFile: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div>
      {/* 文件标题行 */}
      <button
        onClick={() => setExpanded(prev => !prev)}
        className="flex items-center gap-1 w-full text-left px-2 py-1 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
      >
        {expanded ? (
          <ChevronDown size={12} className="shrink-0 text-gray-400 dark:text-gray-500" />
        ) : (
          <ChevronRight size={12} className="shrink-0 text-gray-400 dark:text-gray-500" />
        )}
        <FileCode2 size={13} className="shrink-0 text-blue-500 dark:text-blue-400" />
        <span className="text-xs text-[#333333] dark:text-gray-300 truncate flex-1">{fileResult.relativePath}</span>
        <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0">{fileResult.matches.length}</span>
      </button>

      {/* 匹配行列表 */}
      {expanded && (
        <div>
          {fileResult.matches.map((match, i) => (
            <div
              key={i}
              onClick={() => onSelectFile(fileResult.filePath)}
              className="flex items-start gap-0 text-xs py-[2px] pr-2 pl-8 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-[#333333] dark:text-gray-300"
              style={{ paddingLeft: 36 }}
            >
              {renderHighlight(match)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  主组件                                                               */
/* ------------------------------------------------------------------ */
export default function SearchPanel({ workspacePath, onSelectFile }: SearchPanelProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [replaceValue, setReplaceValue] = useState('');
  const [showReplace, setShowReplace] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  // 搜索条件
  const [isCaseSensitive, setIsCaseSensitive] = useState(false);
  const [isWholeWord, setIsWholeWord] = useState(false);
  const [isRegex, setIsRegex] = useState(false);
  const [includePattern, setIncludePattern] = useState('');
  const [excludePattern, setExcludePattern] = useState('');

  // 搜索状态
  const [results, setResults] = useState<SearchResult>({ results: [], totalMatches: 0, truncated: false });
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  // 展开/收起的结果文件
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  /* 触发搜索（debounce） */
  const triggerSearch = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(async () => {
      // 空查询：清空结果
      if (!query.trim()) {
        if (abortRef.current) abortRef.current.abort();
        setResults({ results: [], totalMatches: 0, truncated: false });
        setSearching(false);
        setHasSearched(false);
        return;
      }

      // 取消上一次搜索
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setSearching(true);
      setHasSearched(true);

      const options: SearchOptions = {
        query,
        isCaseSensitive,
        isWholeWord,
        isRegex,
        includePattern,
        excludePattern,
      };

      try {
        const res = await searchWorkspace(workspacePath, options, controller.signal, IGNORED_NAMES);
        if (!controller.signal.aborted) {
          setResults(res);
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          setResults({ results: [], totalMatches: 0, truncated: false, error: String(err) });
        }
      } finally {
        if (!controller.signal.aborted) {
          setSearching(false);
        }
      }
    }, DEBOUNCE_MS);
  }, [query, isCaseSensitive, isWholeWord, isRegex, includePattern, excludePattern, workspacePath]);

  /* 监听搜索条件变化 */
  useEffect(() => {
    triggerSearch();
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [triggerSearch]);

  /* 卸载时取消搜索 */
  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const inputClass =
    'w-full h-6 px-2 text-xs rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-[#2a2a2a] focus:border-blue-400 focus:outline-none placeholder:text-gray-300 dark:placeholder:text-gray-500';

  return (
    <div className="flex h-full flex-col">
      {/* ── 搜索框 + 替换框区域 ── */}
      <div className="px-2 pt-2 flex flex-col gap-1 shrink-0">
        {/* 搜索行 */}
        <div className="flex items-center gap-1">
          {/* 展开/收起替换框 */}
          <button
            onClick={() => setShowReplace(prev => !prev)}
            title={showReplace ? t('searchPanel.collapseReplace') : t('searchPanel.expandReplace')}
            className="flex items-center justify-center w-3 shrink-0 text-gray-400 dark:text-gray-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
          >
            <ChevronDown
              size={12}
              className={`transition-transform ${showReplace ? '' : '-rotate-90'}`}
            />
          </button>

          {/* 搜索输入框 + 内嵌条件按钮 */}
          <div className="relative flex-1">
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={t('searchPanel.searchPlaceholder')}
              className="w-full h-6 pl-2 pr-[78px] text-xs rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-[#2a2a2a] focus:border-blue-400 focus:outline-none placeholder:text-gray-300 dark:placeholder:text-gray-500"
              autoFocus
            />
            <div className="absolute right-[2px] top-0 h-6 mt-0.5 flex items-center gap-1 leading-none">
              <ToggleButton
                active={isCaseSensitive}
                onClick={() => setIsCaseSensitive(prev => !prev)}
                title={t('searchPanel.caseSensitive')}
              >
                <CaseSensitive size={12} />
              </ToggleButton>
              <ToggleButton
                active={isWholeWord}
                onClick={() => setIsWholeWord(prev => !prev)}
                title={t('searchPanel.wholeWord')}
              >
                <WholeWord size={12} />
              </ToggleButton>
              <ToggleButton
                active={isRegex}
                onClick={() => setIsRegex(prev => !prev)}
                title={t('searchPanel.regex')}
              >
                <Regex size={12} />
              </ToggleButton>
            </div>
          </div>
        </div>

        {/* 替换行 + 操作按钮（可展开） */}
        {showReplace && (
          <>
            <div className="flex items-center gap-1">
              <span className="w-3 shrink-0 flex items-center justify-center">
                <Replace size={12} className="text-gray-400 dark:text-gray-500" />
              </span>
              <input
                type="text"
                value={replaceValue}
                onChange={e => setReplaceValue(e.target.value)}
                placeholder={t('searchPanel.replacePlaceholder')}
                className={inputClass}
              />
            </div>
            {/* 操作按钮行 */}
            <div className="flex items-center justify-between pl-[22px] pr-1">
              <button
                className="text-xs text-[#5F6B7A] dark:text-gray-400 hover:opacity-70 transition-opacity"
              >
                {t('searchPanel.replaceAll')}
              </button>
              <button
                onClick={() => { setQuery(''); setReplaceValue(''); }}
                className="text-xs text-[#5F6B7A] dark:text-gray-400 hover:opacity-70 transition-opacity"
              >
                {t('searchPanel.clear')}
              </button>
            </div>
          </>
        )}
      </div>

      {/* ── 搜索详情（可折叠） ── */}
      <div className="mt-[9px] shrink-0">
        <button
          onClick={() => setShowDetails(prev => !prev)}
          className="flex items-center gap-1 w-full px-2 py-1 text-[11px] text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        >
          <ChevronDown
            size={12}
            className={`transition-transform text-gray-400 dark:text-gray-500 ${showDetails ? '' : '-rotate-90'}`}
          />
          <span>{t('searchPanel.searchDetails')}</span>
        </button>

        {showDetails && (
          <div className="px-2 pb-2 flex flex-col gap-[9px]">
            {/* 包含文件 */}
            <div className="flex flex-col gap-2 pl-4">
              <span className="text-[11px] text-gray-400 dark:text-gray-500">{t('searchPanel.include')}</span>
              <input
                type="text"
                value={includePattern}
                onChange={e => setIncludePattern(e.target.value)}
                placeholder="*.ts, *.tsx"
                className={inputClass}
              />
            </div>
            {/* 排除文件 */}
            <div className="flex flex-col gap-2 pl-4">
              <span className="text-[11px] text-gray-400 dark:text-gray-500">{t('searchPanel.exclude')}</span>
              <input
                type="text"
                value={excludePattern}
                onChange={e => setExcludePattern(e.target.value)}
                placeholder="dist, *.log"
                className={inputClass}
              />
            </div>
          </div>
        )}
      </div>

      {/* ── 分割线 ── */}
      <div className="border-t border-gray-100 dark:border-gray-800" />

      {/* ── 搜索结果区域 ── */}
      <div className="flex-1 overflow-auto">
        {/* 错误提示 */}
        {results.error && (
          <div className="flex items-center gap-1.5 px-2 py-2 text-xs text-red-500 dark:text-red-400">
            <AlertCircle size={14} className="shrink-0" />
            <span>{results.error}</span>
          </div>
        )}

        {/* 搜索中 */}
        {searching && !results.error && (
          <div className="flex items-center justify-center py-4 gap-2 text-gray-400 dark:text-gray-500">
            <div className="h-3 w-3 rounded-full border-2 border-gray-300 dark:border-gray-600 border-t-transparent animate-spin" />
            <span className="text-xs">{t('searchPanel.searching')}</span>
          </div>
        )}

        {/* 结果统计 */}
        {!searching && !results.error && hasSearched && query.trim() && results.totalMatches > 0 && (
          <div className="px-2 py-1.5 text-xs text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-800">
            {results.truncated
              ? t('searchPanel.resultsTruncated').replace('${n}', String(results.totalMatches))
              : t('searchPanel.results').replace('${n}', String(results.totalMatches))
            }
          </div>
        )}

        {/* 无结果 */}
        {!searching && !results.error && hasSearched && query.trim() && results.totalMatches === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-gray-400 dark:text-gray-500 gap-1">
            <Search size={24} className="opacity-40" />
            <span className="text-xs">{t('searchPanel.noResults')}</span>
          </div>
        )}

        {/* 空状态（未搜索） */}
        {!searching && !hasSearched && (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 dark:text-gray-500 gap-1">
            <Search size={24} className="opacity-40" />
            <span className="text-xs">{t('searchPanel.startSearch')}</span>
          </div>
        )}

        {/* 结果列表 */}
        {!searching && !results.error && results.results.length > 0 && (
          <div className="py-1">
            {results.results.map(fileResult => (
              <FileResultGroup
                key={fileResult.filePath}
                fileResult={fileResult}
                onSelectFile={onSelectFile}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
