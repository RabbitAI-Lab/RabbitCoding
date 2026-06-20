/**
 * AgentDetail 组件
 *
 * 详情子视图：返回按钮 + 面包屑 + 内置专家团分区 + 自定义分区。
 */

import { ChevronLeft } from 'lucide-react';
import { useI18n } from '../../../i18n/useI18n';
import BuiltinAgentSection from './BuiltinAgentSection';
import CustomAgentSection from './CustomAgentSection';

interface AgentDetailProps {
  scope: string;
  scopeTitle: string;
  onBack: () => void;
}

export default function AgentDetail({ scope, scopeTitle, onBack }: AgentDetailProps) {
  const { t } = useI18n();

  return (
    <div className="flex flex-col gap-4">
      {/* 返回按钮 + 面包屑 */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-[var(--brand-primary)] transition-colors"
        >
          <ChevronLeft size={14} />
          {t('settings.agents.backToList')}
        </button>
        <span className="text-xs text-gray-300 dark:text-gray-600">/</span>
        <span className="text-xs font-medium text-[#333333] dark:text-gray-200">
          {scopeTitle}
        </span>
      </div>

      {/* 内置专家团分区 */}
      <BuiltinAgentSection scope={scope} />

      {/* 自定义智能体分区 */}
      <CustomAgentSection scope={scope} />
    </div>
  );
}
