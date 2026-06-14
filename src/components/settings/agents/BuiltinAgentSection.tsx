/**
 * BuiltinAgentSection 组件
 *
 * 内置专家团分区：6 个固定子智能体列表，点击弹出编辑弹窗。
 */

import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { useI18n } from '../../../i18n/useI18n';
import { useLocalStorage } from '../../../hooks/useLocalStorage';
import { useAgentConfigs } from '../../../hooks/useAgentConfigs';
import { SettingSection } from '../settingsShared';
import { BUILTIN_AGENT_META } from './agentConstants';
import BuiltinAgentEditor from './BuiltinAgentEditor';
import type { BuiltinAgentRole, ModelConfig } from '../../../types';

interface BuiltinAgentSectionProps {
  scope: string;
}

export default function BuiltinAgentSection({ scope }: BuiltinAgentSectionProps) {
  const { t } = useI18n();
  const { getScopeConfig, updateBuiltinAgent } = useAgentConfigs();
  const [modelConfigs] = useLocalStorage<ModelConfig[]>('model-configs', []);
  const config = getScopeConfig(scope);
  const [editingRole, setEditingRole] = useState<BuiltinAgentRole | null>(null);

  /** 根据 modelId 获取模型名称用于摘要展示 */
  const getModelName = (modelId: string): string | null => {
    if (!modelId) return null;
    const model = modelConfigs.find((m) => m.id === modelId);
    return model?.name ?? null;
  };

  // 当前编辑的配置项
  const editingMeta = editingRole ? BUILTIN_AGENT_META.find((m) => m.role === editingRole) : null;
  const editingConfig = editingRole
    ? config.builtinAgents.find((a) => a.role === editingRole)
    : null;

  return (
    <SettingSection
      title={t('settings.agents.builtin.title')}
      description={t('settings.agents.builtin.description')}
    >
      <div className="flex flex-col">
        {BUILTIN_AGENT_META.map((meta, index) => {
          const agentConfig = config.builtinAgents.find((a) => a.role === meta.role);
          if (!agentConfig) return null;
          const modelName = getModelName(agentConfig.modelId);
          const Icon = meta.icon;

          return (
            <div key={meta.role}>
              {index > 0 && <div className="border-t border-gray-100 dark:border-gray-800" />}
              {/* 行头（点击弹出弹窗） */}
              <button
                onClick={() => setEditingRole(meta.role)}
                className="flex w-full items-center gap-2.5 py-2.5 text-left rounded-lg px-2 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
              >
                <Icon size={16} className="shrink-0 text-gray-400 dark:text-gray-500" />
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-medium text-[#333333] dark:text-gray-200">
                    {t(meta.nameKey)}
                  </span>
                </div>
                {modelName && (
                  <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                    {modelName}
                  </span>
                )}
                <ChevronRight
                  size={14}
                  className="shrink-0 text-gray-300 dark:text-gray-600"
                />
              </button>
            </div>
          );
        })}
      </div>

      {/* 编辑弹窗 */}
      {editingMeta && editingConfig && (
        <BuiltinAgentEditor
          open={editingRole !== null}
          title={t(editingMeta.nameKey)}
          description={t(editingMeta.descKey)}
          config={editingConfig}
          onClose={() => setEditingRole(null)}
          onSave={(updated) => {
            updateBuiltinAgent(scope, updated);
            setEditingRole(null);
          }}
        />
      )}
    </SettingSection>
  );
}
