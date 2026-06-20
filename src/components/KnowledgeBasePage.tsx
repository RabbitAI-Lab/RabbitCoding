import { useMemo } from 'react';
import { BookOpen, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import type { Workspace } from '../types';
import { useI18n } from '../i18n/useI18n';
import { useWikiState } from './wiki/useWikiState';
import { WikiTreeArea } from './wiki/WikiTree';
import { WikiFailedPanel, WikiProgressPanel, PausedWarning } from './wiki/WikiPanels';
import { WikiSetupView } from './wiki/WikiSetupView';
import { WikiContentView } from './wiki/WikiContentView';

interface KnowledgeBasePageProps {
  workspace?: Workspace | null;
}

export default function KnowledgeBasePage({ workspace }: KnowledgeBasePageProps) {
  const { t } = useI18n();
  const wiki = useWikiState(workspace);
  const {
    activeTab, setActiveTab,
    catalogs, loadingTree, treeError,
    generating,
    expandedPaths,
    openTabs,
    activePath, setActivePath,
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
  } = wiki;

  const tabs: { key: typeof activeTab; label: string }[] = [
    { key: 'codeWiki', label: t('knowledgeBase.codeWiki') },
    { key: 'flashCard', label: t('knowledgeBase.flashCard') },
    { key: 'memory', label: t('knowledgeBase.memory') },
  ];

  const renderComingSoon = () => (
    <div className="flex h-full items-center justify-center text-xs text-gray-400 dark:text-gray-500">
      {t('knowledgeBase.comingSoon')}
    </div>
  );

  const showSetup = !workspace?.path || (!hasCodeWiki && !generating);

  // 从 Map 构建 Set 供树组件快速查找
  const failedFilePaths = useMemo(
    () => new Set(failedDocByFilePath.keys()),
    [failedDocByFilePath],
  );
  // 当前选中文档的失败信息
  const activeFailedDoc = activePath ? failedDocByFilePath.get(activePath) ?? null : null;

  // 单文档重新生成
  const handleRegenerateDoc = (docPath: string, repoName?: string) => {
    void handleRetryFailed([docPath], repoName);
  };

  return (
    <main className="flex flex-1 flex-col overflow-hidden rounded-bl-xl rounded-tl-xl border-l border-gray-200 bg-white dark:border-gray-700 dark:bg-[#1e1e1e]">
      {/* ---- 顶部工具栏 ---- */}
      <div data-tauri-drag-region className="flex h-[42px] shrink-0 items-center border-b border-gray-200 px-4 dark:border-gray-700">
        <div data-tauri-drag-region className="flex min-w-0 items-center gap-1.5">
          <BookOpen size={15} className="shrink-0 text-[#646261] dark:text-gray-400" />
          <span data-tauri-drag-region className="truncate text-sm font-medium text-[#333333] dark:text-gray-100">{t('knowledgeBase.title')}</span>
          {workspace && (
            <span data-tauri-drag-region className="truncate text-xs text-gray-400 dark:text-gray-500">{workspace.name || t('common.unnamedWorkspace')}</span>
          )}
        </div>
        {/* AI 生成按钮 */}
        {workspace?.path && (
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={handleGenerateAIWiki}
              disabled={generating || !selectedModel}
              className="flex items-center gap-1 rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-blue-50 transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {generating && queueStatus.current ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
              {t('knowledgeBase.aiGenerate')}
            </button>
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* ---- 侧边栏 ---- */}
        <aside
          className="shrink-0 overflow-hidden border-r border-gray-200 dark:border-gray-700"
          style={{ width: navWidth }}
        >
          <div className="flex h-full flex-col">
            {/* Tab 切换 */}
            <div className="flex shrink-0 border-b border-gray-200 dark:border-gray-700">
              {tabs.map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex h-9 flex-1 items-center justify-center px-2 text-xs transition-colors ${
                    activeTab === tab.key
                      ? 'border-b-2 border-[#141414] text-[#141414] dark:border-gray-100 dark:text-gray-100'
                      : 'text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300'
                  }`}
                >
                  <span className="truncate">{tab.label}</span>
                </button>
              ))}
            </div>

            {activeTab === 'codeWiki' ? (
              <div className="flex min-h-0 flex-1 flex-col">
                {/* 进度面板 */}
                <WikiProgressPanel
                  generating={generating}
                  progress={progress}
                  queueStatus={queueStatus}
                  onCancelTask={handleCancelTask}
                  onClearQueue={handleClearQueue}
                />
                {/* 熔断警告 */}
                <PausedWarning status={wikiMeta?.status} />
                {/* 失败项面板 */}
                <WikiFailedPanel
                  allFailedDocs={allFailedDocs}
                  generating={generating}
                  onRetry={handleRetryFailed}
                />

                {/* 操作栏 */}
                <div className="flex h-8 shrink-0 items-center justify-between px-2">
                  <span className="text-xs text-gray-500 dark:text-gray-400">{t('knowledgeBase.outline')}</span>
                  <button
                    onClick={() => { void loadCodeWiki(); void loadMetaStatus(); }}
                    disabled={!workspace?.path || loadingTree}
                    title={t('knowledgeBase.refresh')}
                    className="rounded p-1 text-gray-400 transition-colors hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-40 dark:text-gray-500 dark:hover:text-blue-400"
                  >
                    <RefreshCw size={13} className={loadingTree ? 'animate-spin' : ''} />
                  </button>
                </div>

                {/* 两层目录树 */}
                <div className="min-h-0 flex-1 overflow-auto">
                  {loadingTree ? (
                    <div className="flex h-full items-center justify-center gap-2 text-gray-300 dark:text-gray-600">
                      <Loader2 size={14} className="animate-spin" />
                      <span className="text-xs">{t('knowledgeBase.loading')}</span>
                    </div>
                  ) : hasCodeWiki ? (
                    <WikiTreeArea
                      repos={catalogs.repos}
                      workspaceCatalog={catalogs.workspace}
                      reposWikiDir={reposWikiDir}
                      workspaceWikiDir={workspaceWikiDir}
                      selectedPath={activePath}
                      expandedPaths={expandedPaths}
                      failedFilePaths={failedFilePaths}
                      onToggle={toggleExpanded}
                      onOpenFile={handleOpenFile}
                      repoWikiLabel={t('knowledgeBase.repoWiki')}
                      workspaceWikiLabel={t('knowledgeBase.workspaceWiki')}
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center px-4 text-center text-xs text-gray-400 dark:text-gray-500">
                      {t('knowledgeBase.noOutline')}
                    </div>
                  )}
                </div>
              </div>
            ) : renderComingSoon()}
          </div>
        </aside>

        {/* 拖拽分隔条 */}
        <div
          {...handleProps}
          className={`w-1 shrink-0 cursor-col-resize transition-colors hover:bg-blue-500/40 ${
            isResizing ? 'bg-blue-500/40' : ''
          }`}
        />

        {/* ---- 右侧内容区域 ---- */}
        <section className="min-w-[360px] flex-1 overflow-hidden">
          {activeTab === 'codeWiki' ? (
            showSetup ? (
              <WikiSetupView
                workspace={workspace ?? null}
                workspaceConfig={workspaceConfig}
                codeWikiDir={codeWikiDir}
                generating={generating}
                selectedModel={selectedModel}
                treeError={treeError}
                onGenerate={handleGenerate}
                onGenerateAIWiki={handleGenerateAIWiki}
                onUpdateConfig={updateConfig}
              />
            ) : (
              <WikiContentView
                openTabs={openTabs}
                activePath={activePath}
                activeContent={activeContent}
                fileLoading={fileLoading}
                fileError={fileError}
                failedDoc={activeFailedDoc}
                onCloseTab={handleCloseTab}
                onSetActivePath={setActivePath}
                onRegenerate={handleRegenerateDoc}
                regenerating={generating}
                workspaceName={workspace?.name}
                gitInfo={gitInfo}
                docModifiedAt={docModifiedAt}
                onRegenerateDoc={handleRegenerateAnyDoc}
              />
            )
          ) : renderComingSoon()}
        </section>
      </div>
    </main>
  );
}
