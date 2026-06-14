/**
 * SkillCard 组件
 *
 * 技能列表中的单张可点击卡片，支持 active 高亮态。
 */

import { Zap, type LucideIcon } from 'lucide-react';

interface SkillCardProps {
  name: string;
  description?: string;
  active?: boolean;
  onClick: () => void;
}

export default function SkillCard({
  name,
  description,
  active,
  onClick,
}: SkillCardProps) {
  const Icon: LucideIcon = Zap;
  return (
    <button
      onClick={onClick}
      className={`group flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all ${
        active
          ? 'border-blue-400 dark:border-blue-600 bg-blue-50 dark:bg-blue-900/20'
          : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-[#1e1e1e] hover:border-blue-300 dark:hover:border-blue-700 hover:shadow-sm'
      }`}
    >
      {/* 图标 */}
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800">
        <Icon size={16} className={active ? 'text-blue-500' : 'text-gray-500 dark:text-gray-400'} />
      </div>
      {/* 标题 + 描述 */}
      <div className="flex-1 min-w-0">
        <span className={`text-sm font-medium truncate ${active ? 'text-blue-600 dark:text-blue-400' : 'text-[#333333] dark:text-gray-100'}`}>
          {name}
        </span>
        {description && (
          <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500 truncate">
            {description}
          </p>
        )}
      </div>
    </button>
  );
}
