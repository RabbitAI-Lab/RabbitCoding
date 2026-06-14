/**
 * SkillFilePanel 组件
 *
 * 点击技能后右侧展开的文件浏览器面板。
 * 仅含一个"文件"Tab，复用 FileExplorerTab，支持可编辑。
 */

import { lazy, Suspense } from 'react';
import { FolderOpen } from 'lucide-react';
import { useI18n } from '../../../i18n/useI18n';

const FileExplorerTab = lazy(() => import('../../files/FileExplorerTab'));

interface SkillFilePanelProps {
  skillPath: string;
  skillName: string;
}

export default function SkillFilePanel({ skillPath }: SkillFilePanelProps) {
  const { t } = useI18n();

  return (
    <div className="flex h-full flex-col">
      {/* Tab 栏：仅"文件"Tab */}
      <div className="flex shrink-0 border-b border-gray-200 dark:border-gray-700">
        <div className="flex">
          <button
            className="flex items-center gap-1.5 px-3 py-2 text-xs border-b-2 border-[#141414] dark:border-gray-100 text-[#141414] dark:text-gray-100"
          >
            <FolderOpen size={14} />
            <span>{t('settings.skills.files')}</span>
          </button>
        </div>
      </div>

      {/* Tab 内容：文件浏览器 */}
      <div className="flex-1 overflow-hidden bg-white dark:bg-[#1e1e1e]">
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center gap-2 text-gray-300 dark:text-gray-600">
              <div className="h-3 w-3 rounded-full border-2 border-gray-300 border-t-transparent dark:border-gray-600 animate-spin" />
              <span className="text-xs">{t('rightPanel.loadingFileBrowser')}</span>
            </div>
          }
        >
          <FileExplorerTab
            workspacePath={skillPath}
            editable
            autoOpenFileName="SKILL.md"
          />
        </Suspense>
      </div>
    </div>
  );
}
