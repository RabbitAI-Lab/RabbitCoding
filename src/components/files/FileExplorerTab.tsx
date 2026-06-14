import { useState, useCallback, useEffect, useRef, lazy, Suspense } from 'react';
import { readDir, readTextFile, writeTextFile, exists, type DirEntry } from '@tauri-apps/plugin-fs';
import { FolderOpen, PanelLeftClose, PanelLeftOpen, Search as SearchIcon, ChevronsDownUp, RefreshCw, X, Save, Check, Eye, Pencil } from 'lucide-react';
import { useResizable } from '../../hooks/useResizable';
import FileTree from './FileTree';
import type { FileNode } from './types';
import { useI18n } from '../../i18n/useI18n';

const FileEditor = lazy(() => import('./FileEditor'));
const SearchPanel = lazy(() => import('./SearchPanel'));

/** 面板状态：文件树 / 搜索 / 隐藏 */
type PanelState = 'tree' | 'search' | 'hidden';

/** 需要跳过的目录/文件名 */
const IGNORED_NAMES = new Set([
  'node_modules', '.git', 'target', 'dist', '.next', '.nuxt',
  '__pycache__', '.DS_Store', '.turbo', '.cache', '.vscode',
  '.idea', 'build', '.gradle', '.mvn', 'vendor', 'Pods',
]);

/** 大文件阈值：1MB */
const MAX_FILE_SIZE = 1 * 1024 * 1024;

interface FileExplorerTabProps {
  workspacePath?: string;
  editable?: boolean;
  autoOpenFileName?: string;
}

/** 读取目录并返回排序后的 FileNode 列表 */
async function loadDirectory(dirPath: string): Promise<FileNode[]> {
  const entries: DirEntry[] = await readDir(dirPath);
  console.debug('[FileExplorer] readDir:', dirPath, 'entries:', entries.length);
  const filtered = entries
    .filter(e => !IGNORED_NAMES.has(e.name) && !e.name.startsWith('.'))
    .sort((a, b) => {
      // 文件夹优先，然后按名称排序
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  return filtered.map(e => ({
    name: e.name,
    path: dirPath + '/' + e.name,
    isDirectory: e.isDirectory,
    children: e.isDirectory ? [] : undefined,
    expanded: false,
    loading: false,
  }));
}

/** 递归过滤树节点：按名称匹配（大小写不敏感） */
function filterTree(nodes: FileNode[], query: string): FileNode[] {
  if (!query.trim()) return nodes;
  const lower = query.toLowerCase();
  const result: FileNode[] = [];
  for (const node of nodes) {
    const nameMatch = node.name.toLowerCase().includes(lower);
    if (node.isDirectory) {
      const children = node.children ? filterTree(node.children, query) : [];
      if (nameMatch || children.length > 0) {
        result.push({ ...node, expanded: true, children: children.length > 0 ? children : node.children });
      }
    } else {
      if (nameMatch) result.push(node);
    }
  }
  return result;
}

/** 递归折叠所有节点 */
function collapseAllNodes(nodes: FileNode[]): FileNode[] {
  return nodes.map(node => ({
    ...node,
    expanded: false,
    children: node.children ? collapseAllNodes(node.children) : node.children,
  }));
}

/** 递归设置指定路径节点的展开状态，并加载子节点 */
async function toggleDirInTree(
  nodes: FileNode[],
  targetPath: string,
): Promise<FileNode[]> {
  const result: FileNode[] = [];
  for (const node of nodes) {
    if (node.path === targetPath && node.isDirectory) {
      const expanded = !node.expanded;
      if (expanded && (!node.children || node.children.length === 0)) {
        // 懒加载子目录
        try {
          const children = await loadDirectory(node.path);
          result.push({ ...node, expanded: true, children, loading: false });
        } catch (err) {
          console.error('[FileExplorer] Failed to load subdirectory:', node.path, err);
          result.push({ ...node, expanded: false, loading: false });
        }
      } else {
        result.push({ ...node, expanded });
      }
    } else if (node.children) {
      const updatedChildren = await toggleDirInTree(node.children, targetPath);
      result.push({ ...node, children: updatedChildren });
    } else {
      result.push(node);
    }
  }
  return result;
}

export default function FileExplorerTab({ workspacePath, editable, autoOpenFileName }: FileExplorerTabProps) {
  const { t } = useI18n();
  const [treeData, setTreeData] = useState<FileNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [panelState, setPanelState] = useState<PanelState>('tree');
  const [filterQuery, setFilterQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  // ---- 编辑/保存状态 ----
  const [editMode, setEditMode] = useState(false);
  const [originalContent, setOriginalContent] = useState<string | null>(null);
  const [currentContent, setCurrentContent] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const autoOpenedRef = useRef<string | null>(null);

  const isEditing = editable && editMode;
  const dirty = isEditing && currentContent !== null && originalContent !== null && currentContent !== originalContent;

  const showLeftPanel = panelState !== 'hidden';
  const isSearchMode = panelState === 'search';

  /** 折叠按钮：tree↔hidden，search→tree */
  const toggleCollapse = useCallback(() => {
    setPanelState(prev => (prev === 'tree' ? 'hidden' : 'tree'));
  }, []);

  /** 搜索按钮：search↔tree，hidden→search */
  const toggleSearch = useCallback(() => {
    setPanelState(prev => (prev === 'search' ? 'tree' : 'search'));
  }, []);

  const { width: treeWidth, isResizing, handleProps } = useResizable({
    storageKey: 'file-tree-width',
    defaultWidth: 240,
    minWidth: 200,
    maxWidth: 400,
  });

  // workspacePath 变化时重新加载根目录
  useEffect(() => {
    if (!workspacePath) {
      setTreeData([]);
      setSelectedFilePath(null);
      setFileContent(null);
      return;
    }

    let cancelled = false;
    setTreeLoading(true);
    loadDirectory(workspacePath)
      .then(nodes => {
        if (!cancelled) {
          setTreeData(nodes);
          setTreeLoading(false);
        }
      })
      .catch((err) => {
        console.error('[FileExplorer] Failed to load root directory:', workspacePath, err);
        if (!cancelled) {
          setTreeData([]);
          setTreeLoading(false);
        }
      });

    // 清除选中状态
    setSelectedFilePath(null);
    setFileContent(null);
    setOriginalContent(null);
    setCurrentContent(null);
    autoOpenedRef.current = null;

    return () => { cancelled = true; };
  }, [workspacePath]);

  // 点击文件夹：展开/折叠
  const handleToggleDir = useCallback((path: string) => {
    setTreeData(prev => {
      toggleDirInTree(prev, path).then(updated => setTreeData(updated));
      // 先返回 prev 保持不变，等 async 完成后再更新
      return prev;
    });
  }, []);

  // 全部折叠
  const handleCollapseAll = useCallback(() => {
    setTreeData(prev => collapseAllNodes(prev));
  }, []);

  // 刷新文件树
  const handleRefresh = useCallback(() => {
    if (!workspacePath) return;
    setRefreshing(true);
    loadDirectory(workspacePath)
      .then(nodes => {
        setTreeData(nodes);
        setFilterQuery('');
      })
      .catch(err => {
        console.error('[FileExplorer] Refresh failed:', err);
      })
      .finally(() => setRefreshing(false));
  }, [workspacePath]);

  // 点击文件：加载内容
  const handleSelectFile = useCallback(async (path: string) => {
    setSelectedFilePath(path);
    setFileLoading(true);
    setFileError(null);
    setFileContent(null);
    setOriginalContent(null);
    setCurrentContent(null);
    setEditMode(false);

    try {
      const content = await readTextFile(path);
      // 大文件保护
      if (content.length > MAX_FILE_SIZE) {
        setFileError(t('fileExplorer.fileTooLarge'));
        setFileLoading(false);
        return;
      }
      setFileContent(content);
      setOriginalContent(content);
      setCurrentContent(content);
    } catch (err) {
      setFileError(t('fileExplorer.binaryFile'));
    } finally {
      setFileLoading(false);
    }
  }, [t]);

  // 编辑器内容变更回调
  const handleContentChange = useCallback((value: string) => {
    setCurrentContent(value);
  }, []);

  // 保存文件到磁盘
  const handleSave = useCallback(async () => {
    if (!selectedFilePath || currentContent === null || saving) return;
    setSaving(true);
    try {
      await writeTextFile(selectedFilePath, currentContent);
      setOriginalContent(currentContent);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
    } catch (err) {
      console.error('[FileExplorer] Save failed:', err);
    } finally {
      setSaving(false);
    }
  }, [selectedFilePath, currentContent, saving]);

  // Cmd/Ctrl+S 快捷键保存
  useEffect(() => {
    if (!isEditing) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (dirty) handleSave();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isEditing, dirty, handleSave]);

  // 自动打开指定文件（如 SKILL.md）
  useEffect(() => {
    if (!autoOpenFileName || !workspacePath || treeLoading) return;
    // 防止重复自动打开同一 workspace
    if (autoOpenedRef.current === workspacePath) return;
    autoOpenedRef.current = workspacePath;
    const targetPath = workspacePath + '/' + autoOpenFileName;
    exists(targetPath).then(fileExists => {
      if (fileExists) {
        handleSelectFile(targetPath);
      }
    }).catch(() => {
      // 忽略错误
    });
  }, [autoOpenFileName, workspacePath, treeLoading, handleSelectFile]);

  // 无工作区路径
  if (!workspacePath) {
    return (
      <div className="flex h-full items-center justify-center text-gray-300 dark:text-gray-600">
        <div className="flex flex-col items-center gap-2">
          <FolderOpen size={32} />
          <span className="text-xs">{t('fileExplorer.setWorkspacePath')}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* 路径栏 */}
      <div className="shrink-0 h-7 flex items-center gap-0.5 px-2 border-b border-gray-200 bg-gray-50/50 dark:border-gray-700 dark:bg-[#1e1e1e]">
        {/* 折叠文件树按钮 */}
        <button
          onClick={toggleCollapse}
          title={showLeftPanel ? t('fileExplorer.collapseTree') : t('fileExplorer.expandTree')}
          className={`rounded p-1 transition-colors shrink-0 ${
            panelState === 'tree'
              ? 'text-blue-600 dark:text-blue-400'
              : 'text-[#919191] hover:text-blue-600 dark:text-gray-400 dark:hover:text-blue-400'
          }`}
        >
          {showLeftPanel ? <PanelLeftClose size={14} /> : <PanelLeftOpen size={14} />}
        </button>
        {/* 搜索按钮 */}
        <button
          onClick={toggleSearch}
          title={t('common.search')}
          className={`rounded p-1 transition-colors shrink-0 ${
            isSearchMode
              ? 'text-blue-600 dark:text-blue-400'
              : 'text-[#919191] hover:text-blue-600 dark:text-gray-400 dark:hover:text-blue-400'
          }`}
        >
          <SearchIcon size={14} />
        </button>
        {/* 路径文字 */}
        <span className="text-xs text-gray-500 dark:text-gray-400 truncate ml-1 flex-1">{workspacePath}</span>
        {/* 预览/编辑切换 + 保存（仅 editable 模式） */}
        {editable && selectedFilePath && (
          <>
            {/* 预览/编辑切换按钮 */}
            <button
              onClick={() => setEditMode(prev => !prev)}
              title={editMode ? t('settings.skills.preview') : t('settings.skills.edit')}
              className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-xs transition-colors shrink-0 ml-2 ${
                editMode
                  ? 'text-blue-600 dark:text-blue-400'
                  : 'text-[#919191] hover:text-blue-600 dark:text-gray-400 dark:hover:text-blue-400'
              }`
              }
            >
              {editMode ? <Eye size={12} /> : <Pencil size={12} />}
              <span>{editMode ? t('settings.skills.preview') : t('settings.skills.edit')}</span>
            </button>
            {/* 保存按钮 / 已保存提示（仅编辑模式） */}
            {isEditing && (
              savedFlash ? (
                <span className="flex items-center gap-1 text-xs text-emerald-500 shrink-0 ml-2">
                  <Check size={12} />
                  {t('settings.skills.saved')}
                </span>
              ) : dirty ? (
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 shrink-0 ml-2 disabled:opacity-50"
                >
                  <Save size={12} className={saving ? 'animate-pulse' : ''} />
                  {saving ? t('settings.skills.saving') : t('settings.skills.save')}
                </button>
              ) : (
                <span className="text-xs text-gray-300 dark:text-gray-600 shrink-0 ml-2">{t('settings.skills.saved')}</span>
              )
            )}
          </>
        )}
      </div>

      {/* 左右分栏 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 左侧面板（文件树 / 搜索面板），hidden 态不渲染 */}
        {showLeftPanel && (
          <>
            <div
              className="shrink-0 overflow-hidden border-r border-gray-200 dark:border-gray-700"
              style={{ width: treeWidth }}
            >
              {isSearchMode ? (
                <Suspense fallback={(
                  <div className="flex items-center justify-center h-full text-gray-300 dark:text-gray-500 gap-2">
                    <div className="h-3 w-3 rounded-full border-2 border-gray-300 dark:border-gray-600 border-t-transparent animate-spin" />
                    <span className="text-xs">{t('fileExplorer.loading')}</span>
                  </div>
                )}>
                  <SearchPanel
                    workspacePath={workspacePath}
                    onSelectFile={handleSelectFile}
                  />
                </Suspense>
              ) : treeLoading ? (
                <div className="flex items-center justify-center h-full text-gray-300 dark:text-gray-500 gap-2">
                  <div className="h-3 w-3 rounded-full border-2 border-gray-300 dark:border-gray-600 border-t-transparent animate-spin" />
                  <span className="text-xs">{t('fileExplorer.loading')}</span>
                </div>
              ) : (
                <div className="flex flex-col h-full">
                  {/* 筛选栏 */}
                  <div className="px-2 py-1.5 flex items-center gap-1 shrink-0">
                    <div className="relative flex-1">
                      <input
                        type="text"
                        value={filterQuery}
                        onChange={e => setFilterQuery(e.target.value)}
                        placeholder={t('fileExplorer.filterFiles')}
                        className="w-full h-6 px-2 text-xs rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-[#2a2a2a] dark:text-gray-200 focus:border-blue-400 focus:outline-none placeholder:text-gray-300 dark:placeholder:text-gray-500"
                      />
                      {filterQuery && (
                        <button
                          onClick={() => setFilterQuery('')}
                          title={t('searchPanel.clear')}
                          className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center text-gray-400 dark:text-gray-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                        >
                          <X size={12} />
                        </button>
                      )}
                    </div>
                    <button
                      onClick={handleCollapseAll}
                      title={t('fileExplorer.collapseAll')}
                      className="rounded p-0.5 transition-colors shrink-0 text-[#919191] hover:text-blue-600 dark:text-gray-400 dark:hover:text-blue-400"
                    >
                      <ChevronsDownUp size={12} />
                    </button>
                    <button
                      onClick={handleRefresh}
                      title={t('fileExplorer.refresh')}
                      className={`rounded p-0.5 transition-colors shrink-0 text-[#919191] hover:text-blue-600 dark:text-gray-400 dark:hover:text-blue-400 ${refreshing ? 'pointer-events-none' : ''}`}
                    >
                      <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
                    </button>
                  </div>
                  {/* 文件树 */}
                  <div className="flex-1 overflow-hidden">
                    <FileTree
                      nodes={filterTree(treeData, filterQuery)}
                      selectedPath={selectedFilePath}
                      onSelectFile={handleSelectFile}
                      onToggleDir={handleToggleDir}
                      showPath={!!filterQuery.trim()}
                      workspacePath={workspacePath}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* 分割线 */}
            <div
              {...handleProps}
              className={`w-1 shrink-0 cursor-col-resize transition-colors hover:bg-blue-500/40 ${
                isResizing ? 'bg-blue-500/40' : ''
              }`}
            />
          </>
        )}

        {/* 编辑器 */}
        <div className="flex-1 min-w-[200px]">
          <Suspense fallback={
            <div className="flex h-full items-center justify-center gap-2 text-gray-300 dark:text-gray-500">
              <div className="h-3 w-3 rounded-full border-2 border-gray-300 dark:border-gray-600 border-t-transparent animate-spin" />
              <span className="text-xs">{t('fileExplorer.loadingEditor')}</span>
            </div>
          }>
            <FileEditor
              filePath={selectedFilePath}
              content={fileContent}
              loading={fileLoading}
              error={fileError}
              editable={isEditing}
              onContentChange={handleContentChange}
            />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
