import { BookOpen, Loader2, Sparkles } from 'lucide-react';
import type { KnowledgeBaseConfig, ModelConfig, Workspace } from '../../types';
import { useI18n } from '../../i18n/useI18n';
import { Toggle } from '../settings/settingsShared';

interface WikiSetupViewProps {
  workspace: Workspace | null;
  workspaceConfig: KnowledgeBaseConfig;
  codeWikiDir: string;
  generating: boolean;
  selectedModel: ModelConfig | undefined;
  treeError: string | null;
  onGenerate: () => void;
  onGenerateAIWiki: () => void;
  onUpdateConfig: (patch: Partial<KnowledgeBaseConfig>) => void;
}

export function WikiSetupView({
  workspace,
  workspaceConfig,
  codeWikiDir,
  generating,
  selectedModel,
  treeError,
  onGenerate,
  onGenerateAIWiki,
  onUpdateConfig,
}: WikiSetupViewProps) {
  const { t } = useI18n();

  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="w-full max-w-[560px]">
        <div className="mb-5">
          <h2 className="text-lg font-semibold text-[#141414] dark:text-gray-100">
            {t('knowledgeBase.generateTitle')}
          </h2>
          <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
            {workspace?.path ? codeWikiDir : t('knowledgeBase.noWorkspacePath')}
          </p>
        </div>

        <div className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white dark:divide-gray-800 dark:border-gray-700 dark:bg-[#1e1e1e]">
          <div className="flex items-center justify-between px-4 py-3">
            <div>
              <p className="text-xs font-medium text-[#333333] dark:text-gray-200">{t('knowledgeBase.language')}</p>
              <p className="mt-0.5 text-[11px] text-gray-400 dark:text-gray-500">{t('knowledgeBase.languageDesc')}</p>
            </div>
            <div className="flex rounded-md border border-gray-200 p-0.5 dark:border-gray-700">
              {(['zh', 'en'] as const).map(lang => (
                <button
                  key={lang}
                  onClick={() => onUpdateConfig({ language: lang })}
                  className={`h-7 px-2.5 text-xs transition-colors ${
                    workspaceConfig.language === lang
                      ? 'rounded bg-[#141414] text-white dark:bg-gray-100 dark:text-[#141414]'
                      : 'text-gray-500 hover:text-[#141414] dark:text-gray-400 dark:hover:text-gray-100'
                  }`}
                >
                  {lang === 'zh' ? t('knowledgeBase.chinese') : t('knowledgeBase.english')}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between px-4 py-3">
            <div>
              <p className="text-xs font-medium text-[#333333] dark:text-gray-200">{t('knowledgeBase.autoUpdate')}</p>
              <p className="mt-0.5 text-[11px] text-gray-400 dark:text-gray-500">{t('knowledgeBase.autoUpdateDesc')}</p>
            </div>
            <Toggle checked={workspaceConfig.autoUpdate} onChange={v => onUpdateConfig({ autoUpdate: v })} />
          </div>

          <div className="flex items-center justify-between px-4 py-3">
            <div>
              <p className="text-xs font-medium text-[#333333] dark:text-gray-200">{t('knowledgeBase.autoExport')}</p>
              <p className="mt-0.5 text-[11px] text-gray-400 dark:text-gray-500">{t('knowledgeBase.exportPath')}: {codeWikiDir || '.rabbit/codewiki'}</p>
            </div>
            <Toggle checked={workspaceConfig.autoExport} onChange={v => onUpdateConfig({ autoExport: v })} />
          </div>

          <div className="flex items-center justify-between px-4 py-3">
            <div>
              <p className="text-xs font-medium text-[#333333] dark:text-gray-200">{t('knowledgeBase.reference')}</p>
              <p className="mt-0.5 text-[11px] text-gray-400 dark:text-gray-500">{t('knowledgeBase.referenceDesc')}</p>
            </div>
            <Toggle checked={workspaceConfig.referenceEnabled} onChange={v => onUpdateConfig({ referenceEnabled: v })} />
          </div>
        </div>

        <div className="mt-5 flex items-center gap-3">
          <button
            onClick={onGenerate}
            disabled={!workspace?.path || generating}
            className="flex h-8 items-center gap-1.5 rounded-md bg-gray-200 px-3 text-xs font-medium text-[#333333] transition-colors hover:bg-gray-300 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
          >
            {generating ? <Loader2 size={14} className="animate-spin" /> : <BookOpen size={14} />}
            {t('knowledgeBase.quickOverview')}
          </button>
          <button
            onClick={onGenerateAIWiki}
            disabled={!workspace?.path || generating || !selectedModel}
            className="flex h-8 items-center gap-1.5 rounded-md bg-blue-600 px-3 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {generating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {t('knowledgeBase.aiGenerate')}
          </button>
          {workspaceConfig.generatedAt && (
            <span className="text-[11px] text-gray-400 dark:text-gray-500">
              {t('knowledgeBase.generatedAt')}: {new Date(workspaceConfig.generatedAt).toLocaleString()}
            </span>
          )}
        </div>

        {!selectedModel && (
          <p className="mt-3 text-xs text-orange-500 dark:text-orange-400">{t('knowledgeBase.noModel')}</p>
        )}
        {treeError && (
          <p className="mt-3 text-xs text-red-500 dark:text-red-400">{treeError}</p>
        )}
      </div>
    </div>
  );
}
