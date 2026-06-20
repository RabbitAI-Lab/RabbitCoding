import { useCallback, useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { FailedDoc, KnowledgeBaseConfig, ModelConfig, WikiMeta, Workspace } from '../../types';
import { useI18n } from '../../i18n/useI18n';
import { useLocalStorage } from '../../hooks/useLocalStorage';
import { useResizable } from '../../hooks/useResizable';
import {
  type CatalogsTree,
  type FailedDocItem,
  type KnowledgeTab,
  type QueueStatus,
  type WikiProgress,
  type WikiTab,
  STORAGE_KEY,
  collectCatalogExpandedKeys,
  defaultConfig,
  formatPath,
} from './wikiTypes';

export function useWikiState(workspace?: Workspace | null) {
  const { t, language } = useI18n();
  const [activeTab, setActiveTab] = useState<KnowledgeTab>('codeWiki');
  const [configs, setConfigs] = useLocalStorage<Record<string, KnowledgeBaseConfig>>(STORAGE_KEY, {});
  const [catalogs, setCatalogs] = useState<CatalogsTree>({ repos: [], workspace: null, missingFilePaths: [] });
  const [loadingTree, setLoadingTree] = useState(false);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [openTabs, setOpenTabs] = useState<WikiTab[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [contentByPath, setContentByPath] = useState<Record<string, string>>({});
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [queueStatus, setQueueStatus] = useState<QueueStatus>({ current: null, queued: [] });
  const [progress, setProgress] = useState<WikiProgress | null>(null);
  const [wikiMeta, setWikiMeta] = useState<WikiMeta | null>(null);
  const [gitInfo, setGitInfo] = useState<{ branch: string | null; commitId: string | null }>({ branch: null, commitId: null });
  const [docModifiedAt, setDocModifiedAt] = useState<number | null>(null);

  const [modelConfigs] = useLocalStorage<ModelConfig[]>('model-configs', []);
  const [selectedModelConfigId] = useLocalStorage<string>('selected-model-config-id', '');

  const selectedModel = useMemo(
    () => modelConfigs.find(c => c.id === selectedModelConfigId && c.enabled),
    [modelConfigs, selectedModelConfigId],
  );

  const { width: navWidth, isResizing, handleProps } = useResizable({
    storageKey: 'knowledge-base-nav-width',
    defaultWidth: 280,
    minWidth: 240,
    maxWidth: 420,
  });

  const workspaceConfig = useMemo(() => {
    const base = defaultConfig(language);
    if (!workspace) return base;
    return { ...base, ...configs[workspace.id] };
  }, [configs, language, workspace]);

  const codeWikiDir = workspace?.path ? formatPath(`${workspace.path}/.rabbit/codewiki`) : '';
  const reposWikiDir = workspace?.path ? formatPath(`${workspace.path}/.rabbit/codewiki/repos`) : '';
  const workspaceWikiDir = workspace?.path ? formatPath(`${workspace.path}/.rabbit/codewiki/workspace`) : '';

  const hasCodeWiki = useMemo(
    () => catalogs.repos.some(r => r.catalog !== null) || catalogs.workspace !== null,
    [catalogs],
  );
  const activeContent = activePath ? contentByPath[activePath] ?? null : null;

  const allFailedDocs = useMemo(() => {
    if (!wikiMeta) return [];
    const result: FailedDocItem[] = [];
    for (const doc of wikiMeta.failedDocs ?? []) {
      result.push({ doc });
    }
    for (const [repoName, repoMeta] of Object.entries(wikiMeta.repos ?? {})) {
      for (const doc of repoMeta.failedDocs ?? []) {
        result.push({ doc, repoName });
      }
    }
    return result;
  }, [wikiMeta]);

  /** 失败文档的 .md 文件路径 → FailedDoc 映射，供树和内容区快速查找 */
  const failedDocByFilePath = useMemo(() => {
    const map = new Map<string, { doc: FailedDoc; repoName?: string }>();
    if (!wikiMeta || !workspace?.path) return map;
    for (const doc of wikiMeta.failedDocs ?? []) {
      const fp = `${workspaceWikiDir}/${doc.path}.md`;
      map.set(fp, { doc });
    }
    for (const [repoName, repoMeta] of Object.entries(wikiMeta.repos ?? {})) {
      for (const doc of repoMeta.failedDocs ?? []) {
        const fp = `${reposWikiDir}/${repoName}/${doc.path}.md`;
        map.set(fp, { doc, repoName });
      }
    }
    // 合并磁盘缺失的文件（不在 failedDocs 中但文件不存在）
    for (const relPath of catalogs.missingFilePaths) {
      const absPath = `${codeWikiDir}/${relPath}`;
      if (!map.has(absPath)) {
        // 从相对路径提取 repoName（如 "repos/MyRepo/foo.md"）和 docPath（"foo"）
        let docPath = relPath;
        let repoName: string | undefined;
        if (relPath.startsWith('repos/')) {
          const parts = relPath.slice(6).split('/');
          if (parts.length >= 2) {
            repoName = parts[0];
            docPath = parts.slice(1).join('/');
          }
        } else if (relPath.startsWith('workspace/')) {
          docPath = relPath.slice(10);
        }
        docPath = docPath.replace(/\.md$/, '');
        map.set(absPath, {
          doc: { path: docPath, error: '文件不存在（可能未成功生成或已被删除）', retries: 0 },
          repoName,
        });
      }
    }
    return map;
  }, [wikiMeta, workspace?.path, workspaceWikiDir, reposWikiDir, codeWikiDir, catalogs.missingFilePaths]);

  // ---- Handlers ----

  const updateConfig = useCallback((patch: Partial<KnowledgeBaseConfig>) => {
    if (!workspace) return;
    setConfigs(prev => ({
      ...prev,
      [workspace.id]: {
        ...defaultConfig(language),
        ...prev[workspace.id],
        ...patch,
      },
    }));
  }, [language, setConfigs, workspace]);

  const loadCodeWiki = useCallback(async () => {
    if (!workspace?.path) {
      setCatalogs({ repos: [], workspace: null, missingFilePaths: [] });
      setTreeError(null);
      return;
    }
    setLoadingTree(true);
    setTreeError(null);
    try {
      const cats = await invoke<CatalogsTree>('list_codewiki_catalogs', {
        workspacePath: workspace.path,
      });
      setCatalogs(cats);
      // 默认展开所有 Section
      const keys: string[] = [];
      for (const repo of cats.repos) {
        if (repo.catalog?.children) {
          collectCatalogExpandedKeys(repo.catalog.children, `repo:${repo.name}`, keys);
        }
      }
      if (cats.workspace?.children) {
        collectCatalogExpandedKeys(cats.workspace.children, 'workspace', keys);
      }
      setExpandedPaths(new Set(keys));
    } catch (err) {
      setCatalogs({ repos: [], workspace: null, missingFilePaths: [] });
      setTreeError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingTree(false);
    }
  }, [workspace?.path]);

  const loadMetaStatus = useCallback(async () => {
    if (!workspace?.path) return;
    try {
      const meta = await invoke<WikiMeta | null>('wiki_meta_status', {
        workspacePath: workspace.path,
      });
      setWikiMeta(meta);
    } catch {
      setWikiMeta(null);
    }
  }, [workspace?.path]);

  const handleGenerate = useCallback(async () => {
    if (!workspace?.path) return;
    setGenerating(true);
    setTreeError(null);
    try {
      await invoke<string>('generate_rabbit_codewiki', {
        path: workspace.path,
        language: workspaceConfig.language,
      });
      setOpenTabs([]);
      setActivePath(null);
      setContentByPath({});
      updateConfig({ generatedAt: Date.now() });
      await loadCodeWiki();
    } catch (err) {
      setTreeError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  }, [loadCodeWiki, updateConfig, workspace?.path, workspaceConfig.language]);

  const handleGenerateAIWiki = useCallback(async () => {
    if (!workspace?.path) return;
    if (!selectedModel) {
      setTreeError(t('knowledgeBase.noModel'));
      return;
    }
    setTreeError(null);
    setGenerating(true);
    try {
      await invoke<string>('generate_ai_wiki', {
        payload: {
          workspacePath: workspace.path,
          workspaceName: workspace.name,
          repos: workspace.repos.map(r => ({ id: r.id, name: r.name, path: r.path })),
          modelId: selectedModel.modelId,
          apiKey: selectedModel.apiKey,
          baseUrl: selectedModel.baseUrl,
          language: workspaceConfig.language,
          resumeMode: true,
          maxRetries: 3,
          maxConsecutiveFailures: 5,
        },
      });
    } catch (err) {
      setGenerating(false);
      setTreeError(err instanceof Error ? err.message : String(err));
    }
  }, [selectedModel, t, workspace, workspaceConfig.language]);

  const handleCancelTask = useCallback(async (taskId: string) => {
    try {
      await invoke('wiki_cancel', { taskId });
    } catch (err) {
      console.error('Cancel failed:', err);
    }
  }, []);

  const handleClearQueue = useCallback(async () => {
    try {
      await invoke('wiki_clear_queue');
    } catch (err) {
      console.error('Clear queue failed:', err);
    }
  }, []);

  const handleRetryFailed = useCallback(async (docPaths?: string[], repoName?: string) => {
    if (!workspace?.path || !selectedModel) return;
    try {
      await invoke<string>('wiki_retry_failed', {
        payload: {
          workspacePath: workspace.path,
          workspaceName: workspace.name,
          repos: workspace.repos.map(r => ({ id: r.id, name: r.name, path: r.path })),
          modelId: selectedModel.modelId,
          apiKey: selectedModel.apiKey,
          baseUrl: selectedModel.baseUrl,
          language: workspaceConfig.language,
          docPaths: docPaths ?? null,
          repoName: repoName ?? null,
        },
      });
      setGenerating(true);
    } catch (err) {
      console.error('Retry failed:', err);
    }
  }, [workspace, selectedModel, workspaceConfig.language]);

  const handleOpenFile = useCallback((filePath: string, title: string) => {
    setOpenTabs(prev => prev.some(tab => tab.path === filePath) ? prev : [...prev, { path: filePath, name: title }]);
    setActivePath(filePath);
  }, []);

  const handleCloseTab = useCallback((path: string) => {
    setOpenTabs(prev => {
      const index = prev.findIndex(tab => tab.path === path);
      const next = prev.filter(tab => tab.path !== path);
      if (activePath === path) {
        const fallback = next[index] ?? next[index - 1] ?? null;
        setActivePath(fallback?.path ?? null);
      }
      return next;
    });
  }, [activePath]);

  const toggleExpanded = useCallback((path: string) => {
    setExpandedPaths(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  /** 从文件路径提取 docPath 和 repoName，用于重新生成任意文档 */
  const handleRegenerateAnyDoc = useCallback((filePath: string) => {
    let docPath = '';
    let repoName: string | undefined;
    if (filePath.startsWith(`${reposWikiDir}/`)) {
      const rest = filePath.slice(reposWikiDir.length + 1); // repoName/docPath.md
      const slashIdx = rest.indexOf('/');
      if (slashIdx > 0) {
        repoName = rest.slice(0, slashIdx);
        docPath = rest.slice(slashIdx + 1);
      }
    } else if (filePath.startsWith(`${workspaceWikiDir}/`)) {
      docPath = filePath.slice(workspaceWikiDir.length + 1);
    }
    docPath = docPath.replace(/\.md$/, '');
    if (docPath) {
      void handleRetryFailed([docPath], repoName);
    }
  }, [reposWikiDir, workspaceWikiDir, handleRetryFailed]);

  // ---- Effects ----

  useEffect(() => {
    setOpenTabs([]);
    setActivePath(null);
    setContentByPath({});
    setFileError(null);
    void loadCodeWiki();
    void loadMetaStatus();
    invoke<QueueStatus>('wiki_queue_status').then(setQueueStatus).catch(() => {});
  }, [loadCodeWiki, loadMetaStatus, workspace?.id]);

  // 获取 git 信息（workspace 变化时）
  useEffect(() => {
    if (!workspace?.path) {
      setGitInfo({ branch: null, commitId: null });
      return;
    }
    invoke<{ branch: string | null; commitId: string | null }>('get_git_info', { path: workspace.path })
      .then(info => setGitInfo(info))
      .catch(() => setGitInfo({ branch: null, commitId: null }));
  }, [workspace?.path]);

  // 获取文件修改时间（activePath 变化时）
  useEffect(() => {
    if (!activePath) {
      setDocModifiedAt(null);
      return;
    }
    invoke<number>('get_file_modified', { path: activePath })
      .then(ms => setDocModifiedAt(ms))
      .catch(() => setDocModifiedAt(null));
  }, [activePath]);

  useEffect(() => {
    const unlisteners: Array<() => void> = [];

    listen<QueueStatus>('wiki-queue-updated', e => {
      setQueueStatus(e.payload);
    }).then(un => unlisteners.push(un));

    listen<WikiProgress>('wiki-progress', e => {
      setProgress(e.payload);
    }).then(un => unlisteners.push(un));

    listen<string>('wiki-task-done', async _e => {
      setGenerating(false);
      setProgress(null);
      // 清空缓存：文件内容可能已变化（重试/重新生成），必须重新读取
      setContentByPath({});
      setOpenTabs([]);
      setActivePath(null);
      // commit 可能已变化，重新获取 git 信息
      if (workspace?.path) {
        invoke<{ branch: string | null; commitId: string | null }>('get_git_info', { path: workspace.path })
          .then(info => setGitInfo(info))
          .catch(() => {});
      }
      await loadCodeWiki();
      await loadMetaStatus();
    }).then(un => unlisteners.push(un));

    listen<[string, string]>('wiki-task-error', async _e => {
      setGenerating(false);
      setProgress(null);
      await loadMetaStatus();
    }).then(un => unlisteners.push(un));

    listen<string>('wiki-task-started', _e => {
      setGenerating(true);
    }).then(un => unlisteners.push(un));

    return () => unlisteners.forEach(fn => fn());
  }, [loadCodeWiki, loadMetaStatus]);

  useEffect(() => {
    // 失败文档不在磁盘上，跳过读取（由 failedDoc 状态处理 UI）
    if (!activePath || contentByPath[activePath] !== undefined) return;
    // 如果当前路径是失败/缺失文件，也不发起读取请求
    if (failedDocByFilePath.has(activePath)) return;

    let cancelled = false;
    setFileLoading(true);
    setFileError(null);
    invoke<string>('read_text_file_unrestricted', { path: activePath })
      .then(content => {
        if (cancelled) return;
        setContentByPath(prev => ({ ...prev, [activePath]: content }));
      })
      .catch(err => {
        if (cancelled) return;
        setFileError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setFileLoading(false);
      });

    return () => { cancelled = true; };
  }, [activePath, contentByPath, failedDocByFilePath]);

  return {
    // State
    activeTab, setActiveTab,
    catalogs, loadingTree, treeError,
    generating,
    expandedPaths,
    openTabs,
    activePath, setActivePath,
    contentByPath,
    fileLoading, fileError,
    queueStatus,
    progress,
    wikiMeta,
    selectedModel,
    workspaceConfig,
    codeWikiDir,
    reposWikiDir,
    workspaceWikiDir,
    hasCodeWiki,
    activeContent,
    allFailedDocs,
    failedDocByFilePath,
    gitInfo,
    docModifiedAt,
    navWidth, isResizing, handleProps,
    // Handlers
    updateConfig,
    loadCodeWiki,
    loadMetaStatus,
    handleGenerate,
    handleGenerateAIWiki,
    handleCancelTask,
    handleClearQueue,
    handleRetryFailed,
    handleRegenerateAnyDoc,
    handleOpenFile,
    handleCloseTab,
    toggleExpanded,
  };
}

export type WikiState = ReturnType<typeof useWikiState>;
