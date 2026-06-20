/**
 * AgentScopeCard 组件
 *
 * 卡片列表视图中的单张可点击卡片。
 */

import { ChevronRight, type LucideIcon } from 'lucide-react';

interface AgentScopeCardProps {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  badge?: string;
  onClick: () => void;
}

export default function AgentScopeCard({
  icon: Icon,
  title,
  subtitle,
  badge,
  onClick,
}: AgentScopeCardProps) {
  return (
    <button
      onClick={onClick}
      className="group flex items-center gap-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#1e1e1e] px-5 py-3.5 text-left hover:border-[var(--brand-primary)] hover:shadow-sm transition-all"
    >
      {/* 图标 */}
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800">
        <Icon size={18} className="text-gray-500 dark:text-gray-400" />
      </div>
      {/* 标题 + 副标题 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-[#333333] dark:text-gray-100 truncate">
            {title}
          </span>
          {badge && (
            <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] bg-[var(--brand-soft-bg)] text-[var(--brand-primary)]">
              {badge}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500 truncate">
          {subtitle}
        </p>
      </div>
      {/* 右箭头 */}
      <ChevronRight
        size={16}
        className="shrink-0 text-gray-300 dark:text-gray-600 group-hover:text-[var(--brand-primary)] transition-colors"
      />
    </button>
  );
}
