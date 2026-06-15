/**
 * SkillsPanel 组件
 *
 * 技能管理主面板。
 * 自动扫描 ~/.agents/skills 目录下的技能文件夹。
 * - 未选中技能：展示技能卡片列表（窄宽）
 * - 选中技能：左侧技能列表 + 右侧文件浏览器（全宽）
 */

import { useState, useEffect, useCallback } from 'react';
import { readDir } from '@tauri-apps/plugin-fs';
import { homeDir } from '@tauri-apps/api/path';
import { ChevronLeft, Zap, FolderX } from 'lucide-react';
import { useI18n } from '../../../i18n/useI18n';
import { useResizable } from '../../../hooks/useResizable';
import SkillCard from './SkillCard';
import SkillFilePanel from './SkillFilePanel';

interface SkillInfo {
  name: string;
  path: string;
}

interface SkillsPanelProps {
  onLayoutChange?: (fullWidth: boolean) => void;
}

export default function SkillsPanel({ onLayoutChange }: SkillsPanelProps) {
  const { t } = useI18n();
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [dirNotFound, setDirNotFound] = useState(false);
  const [selectedSkill, setSelectedSkill] = useState<SkillInfo | null>(null);

  const { width: sidebarWidth, isResizing, handleProps } = useResizable({
    storageKey: 'skills-sidebar-width',
    defaultWidth: 240,
    minWidth: 200,
    maxWidth: 360,
  });

  // 加载技能列表
  const loadSkills = useCallback(async () => {
    setLoading(true);
    setDirNotFound(false);
    try {
      const home = await homeDir();
      const skillsDir = home.replace(/\/+$/, '') + '/.agents/skills';
      const entries = await readDir(skillsDir);
      const skillEntries = entries.filter(e => e.isDirectory);

      const skillList: SkillInfo[] = skillEntries.map(entry => ({
        name: entry.name,
        path: skillsDir + '/' + entry.name,
      }));

      // 按名称排序
      skillList.sort((a, b) => a.name.localeCompare(b.name));
      setSkills(skillList);
    } catch (err) {
      console.error('[SkillsPanel] Failed to load skills:', err);
      setDirNotFound(true);
      setSkills([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSkills();
  }, [loadSkills]);

  // 通知父组件切换布局
  useEffect(() => {
    onLayoutChange?.(!!selectedSkill);
  }, [selectedSkill, onLayoutChange]);

  // ---- 详情视图：选中技能后全宽双栏 ----
  if (selectedSkill) {
    return (
      <div className="flex h-full overflow-hidden">
        {/* 左侧：技能列表侧边栏 */}
        <aside
          className="relative flex h-full shrink-0 flex-col bg-white dark:bg-[#1e1e1e]"
          style={{ width: sidebarWidth }}
        >
          {/* 返回按钮 */}
          <div className="shrink-0 py-2 px-2">
            <button
              onClick={() => setSelectedSkill(null)}
              className="flex items-center gap-1.5 rounded-md px-2 py-2 text-xs text-gray-600 dark:text-gray-300 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              <ChevronLeft size={14} className="shrink-0" />
              <span>{t('settings.skills.backToList')}</span>
            </button>
          </div>

          {/* 技能列表 */}
          <div className="flex-1 overflow-y-auto px-2 pb-2 flex flex-col gap-1.5">
            {skills.map(skill => (
              <SkillCard
                key={skill.path}
                name={skill.name}
                active={skill.path === selectedSkill.path}
                onClick={() => setSelectedSkill(skill)}
              />
            ))}
          </div>

          {/* 拖拽手柄 */}
          <div
            {...handleProps}
            className={`absolute inset-y-0 right-0 w-1 cursor-col-resize transition-colors hover:bg-blue-500/40 ${
              isResizing ? 'bg-blue-500/40' : ''
            }`}
          />
        </aside>

        {/* 右侧：文件浏览器面板 */}
        <div className="flex-1 overflow-hidden border-l border-gray-200 dark:border-gray-700">
          <SkillFilePanel skillPath={selectedSkill.path} skillName={selectedSkill.name} />
        </div>
      </div>
    );
  }

  // ---- 列表视图：技能卡片列表 ----
  return (
    <div className="flex flex-col gap-4">
      {/* 页面标题 */}
      <div>
        <h2 className="text-base font-semibold text-[#333333] dark:text-gray-100">
          {t('settings.skills.title')}
        </h2>
        <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
          {t('settings.skills.description')}
        </p>
      </div>

      {/* 内容区 */}
      {loading ? (
        <div className="flex items-center justify-center py-12 text-gray-400 dark:text-gray-500">
          <div className="h-4 w-4 rounded-full border-2 border-gray-300 border-t-transparent dark:border-gray-600 animate-spin" />
          <span className="ml-2 text-xs">{t('common.loading')}</span>
        </div>
      ) : dirNotFound ? (
        <div className="flex flex-col items-center justify-center py-12 text-gray-400 dark:text-gray-500 gap-3">
          <FolderX size={32} className="text-gray-300 dark:text-gray-600" />
          <p className="text-xs text-center max-w-sm">{t('settings.skills.dirNotFound')}</p>
        </div>
      ) : skills.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-gray-400 dark:text-gray-500 gap-3">
          <Zap size={32} className="text-gray-300 dark:text-gray-600" />
          <p className="text-xs text-center max-w-sm">{t('settings.skills.empty')}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {skills.map(skill => (
            <SkillCard
              key={skill.path}
              name={skill.name}
              onClick={() => setSelectedSkill(skill)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
